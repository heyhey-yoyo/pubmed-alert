import { AppError, errorMessage } from "./errors.js";
import { renderAlertEmail } from "./email-template.js";
import type {
  AlertState,
  AlertStore,
  CheckResult,
  MailGateway,
  PendingNotification,
  PubMedGateway,
} from "./types.js";
import { findNewPmids, mergePmids, sha256Hex, truncate } from "./utils.js";

const DIGEST_LIMIT = 30;
/** 同一批待发送邮件连续失败多少次后自动作废，避免永久阻塞后续检查。 */
const MAX_SEND_ATTEMPTS = 5;

export class AlertEngine {
  private activeCheck: Promise<CheckResult> | null = null;

  constructor(
    private readonly store: AlertStore,
    private readonly pubmed: PubMedGateway,
    private readonly mailer: MailGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  check(force = false): Promise<CheckResult> {
    if (this.activeCheck) return this.activeCheck;
    const task = this.performCheck(force).finally(() => {
      if (this.activeCheck === task) this.activeCheck = null;
    });
    this.activeCheck = task;
    return task;
  }

  private async performCheck(force: boolean): Promise<CheckResult> {
    const config = await this.store.getConfig();
    let state =
      (await this.store.getState()) ??
      ({ version: 2, initialized: false, keyword: config?.keyword ?? "", seenPmids: [] } satisfies AlertState);

    if (!config || (!config.enabled && !force)) {
      // 定时检查关闭（且非手动强制）时，若存在待发送批次，直接作废并标记已见，
      // 避免重新启用后补发过期邮件；不推进 lastSuccessfulCheckAt，检索窗口只会更宽。
      if (state.pendingNotification) {
        const pending = state.pendingNotification;
        const now = this.now().toISOString();
        await this.store.putState({
          ...state,
          seenPmids: mergePmids(pending.pmids, state.seenPmids),
          lastAttemptAt: now,
          pendingNotification: undefined,
          lastDiscarded: {
            at: now,
            count: pending.pmids.length,
            reason: "提醒已关闭，待发送批次自动作废。",
          },
        });
        return { status: "disabled", message: "提醒尚未启用；存在待发送批次，已自动作废。" };
      }
      return { status: "disabled", message: "提醒尚未启用。" };
    }

    const attemptedAt = this.now().toISOString();

    try {
      if (state.pendingNotification) {
        return await this.retryPending(state);
      }

      const search = await this.pubmed.search(config.keyword, state.lastSuccessfulCheckAt);
      const successAt = this.now().toISOString();

      if (!state.initialized || state.keyword !== config.keyword) {
        state = {
          version: 2,
          initialized: true,
          keyword: config.keyword,
          seenPmids: search.pmids,
          lastAttemptAt: attemptedAt,
          lastSuccessfulCheckAt: successAt,
          lastResultCount: search.totalCount,
          lastNewCount: 0,
          lastEmailedCount: 0,
          lastSearchWindowStart: search.windowStart,
          lastSearchWindowEnd: search.windowEnd,
          lastWarnings: search.warnings,
        };
        await this.store.putState(state);
        return {
          status: "initialized",
          message: "已建立当前检索结果基线；之后出现的新 PMID 才会触发邮件。",
          resultCount: search.totalCount,
          newCount: 0,
          windowStart: search.windowStart,
          windowEnd: search.windowEnd,
        };
      }

      const newPmids = findNewPmids(search.pmids, state.seenPmids);
      if (newPmids.length === 0) {
        state = {
          ...state,
          keyword: config.keyword,
          seenPmids: mergePmids(search.pmids, state.seenPmids),
          lastAttemptAt: attemptedAt,
          lastSuccessfulCheckAt: successAt,
          lastResultCount: search.totalCount,
          lastNewCount: 0,
          lastEmailedCount: 0,
          lastSearchWindowStart: search.windowStart,
          lastSearchWindowEnd: search.windowEnd,
          lastWarnings: search.warnings,
          lastError: undefined,
          lastErrorAt: undefined,
        };
        await this.store.putState(state);
        return {
          status: "no_new",
          message: "检查完成，没有发现新的 PMID。",
          resultCount: search.totalCount,
          newCount: 0,
          windowStart: search.windowStart,
          windowEnd: search.windowEnd,
        };
      }

      const subjectKeyword = truncate(config.keyword.replace(/\s+/g, " ").trim(), 70);
      const subject = `PubMed 新论文 ${newPmids.length} 篇：${subjectKeyword}`;
      const shownPmids = newPmids.slice(0, DIGEST_LIMIT);
      const articles = await this.pubmed.summaries(shownPmids);
      const hiddenCount = Math.max(0, newPmids.length - articles.length);
      const email = renderAlertEmail(config.keyword, articles, hiddenCount, newPmids.length);
      const from = this.mailer.sender();
      const fingerprint = JSON.stringify([from, config.recipient, subject, email.html, email.text]);
      const idempotencyKey = `pubmed-v2-${(await sha256Hex(fingerprint)).slice(0, 48)}`;
      const pending: PendingNotification = {
        idempotencyKey,
        pmids: newPmids,
        keyword: config.keyword,
        recipient: config.recipient,
        from,
        subject,
        html: email.html,
        text: email.text,
        emailedCount: articles.length,
        createdAt: successAt,
        failCount: 0,
      };
      state = {
        ...state,
        lastAttemptAt: attemptedAt,
        lastResultCount: search.totalCount,
        lastNewCount: newPmids.length,
        lastSearchWindowStart: search.windowStart,
        lastSearchWindowEnd: search.windowEnd,
        lastWarnings: search.warnings,
        pendingNotification: pending,
        lastError: undefined,
        lastErrorAt: undefined,
      };
      await this.store.putState(state);
      return await this.deliverPending(state);
    } catch (error) {
      const latestState = (await this.store.getState()) ?? state;
      await this.store.putState({
        ...latestState,
        version: 2,
        lastAttemptAt: attemptedAt,
        lastError: errorMessage(error),
        lastErrorAt: this.now().toISOString(),
      });
      throw error;
    }
  }

  private async retryPending(state: AlertState): Promise<CheckResult> {
    const config = await this.store.getConfig();
    const pending = state.pendingNotification;
    if (!pending) throw new AppError("待发送状态异常。", 500, false);
    if (!config || config.keyword !== pending.keyword || config.recipient !== pending.recipient || !config.enabled) {
      // 作废时把批次 PMID 并入已见，避免下一次检查在同一窗口内重新发现并重复发送。
      const cleared = { ...state, seenPmids: mergePmids(pending.pmids, state.seenPmids), pendingNotification: undefined };
      await this.store.putState(cleared);
      throw new AppError("配置已变化，旧的待发送邮件已取消；请重新检查。", 409);
    }
    return this.deliverPending(state);
  }

  private async deliverPending(state: AlertState): Promise<CheckResult> {
    const pending = state.pendingNotification;
    if (!pending) throw new AppError("待发送状态异常。", 500, false);
    if (!pending.from || !pending.html || !pending.text || !Number.isInteger(pending.emailedCount)) {
      throw new AppError("待发送邮件内容不完整，请取消待发送状态并重新检查。", 409);
    }

    try {
      await this.mailer.send({
        from: pending.from,
        to: pending.recipient,
        subject: pending.subject,
        html: pending.html,
        text: pending.text,
        idempotencyKey: pending.idempotencyKey,
      });
    } catch (error) {
      const failCount = (pending.failCount ?? 0) + 1;
      if (failCount < MAX_SEND_ATTEMPTS) {
        // 未达到作废阈值：记录失败次数，等待下次检查重试（保留 pending 与幂等键）。
        await this.store.putState({ ...state, pendingNotification: { ...pending, failCount } });
        throw error;
      }
      // 连续 MAX_SEND_ATTEMPTS 次失败：作废该批次并标记为已见，避免无限重试阻塞后续检查；
      // 不推进 lastSuccessfulCheckAt，下一次检查的检索窗口只会更宽，不会产生空洞。
      const now = this.now().toISOString();
      await this.store.putState({
        ...state,
        initialized: true,
        keyword: pending.keyword,
        seenPmids: mergePmids(pending.pmids, state.seenPmids),
        lastAttemptAt: now,
        lastNewCount: pending.pmids.length,
        lastEmailedCount: 0,
        lastError: undefined,
        lastErrorAt: undefined,
        pendingNotification: undefined,
        lastDiscarded: {
          at: now,
          count: pending.pmids.length,
          reason: `连续 ${MAX_SEND_ATTEMPTS} 次发送失败：${truncate(errorMessage(error), 200)}`,
        },
      });
      return {
        status: "discarded",
        message: `提醒邮件连续 ${MAX_SEND_ATTEMPTS} 次发送失败，该批次（${pending.pmids.length} 篇）已自动作废并标记为已见，不再重试。请检查 Resend 配置（API Key、发件域名）后重新检查；该批次不会补发。`,
        newCount: pending.pmids.length,
      };
    }

    const now = this.now().toISOString();
    const finalState: AlertState = {
      ...state,
      initialized: true,
      keyword: pending.keyword,
      seenPmids: mergePmids(pending.pmids, state.seenPmids),
      // Advance only to the PubMed search completion time recorded before delivery.
      // If email delivery is retried later, advancing to the retry time would create a search gap.
      lastAttemptAt: now,
      lastSuccessfulCheckAt: pending.createdAt,
      lastEmailAt: now,
      lastNewCount: pending.pmids.length,
      lastEmailedCount: pending.emailedCount,
      lastError: undefined,
      lastErrorAt: undefined,
      pendingNotification: undefined,
    };
    await this.store.putState(finalState);

    return {
      status: "emailed",
      message: `发现 ${pending.pmids.length} 个新 PMID，提醒邮件已发送。`,
      resultCount: state.lastResultCount,
      newCount: pending.pmids.length,
      emailedCount: pending.emailedCount,
      windowStart: state.lastSearchWindowStart,
      windowEnd: state.lastSearchWindowEnd,
    };
  }
}
