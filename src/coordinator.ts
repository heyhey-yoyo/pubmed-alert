import { DurableObject } from "cloudflare:workers";
import { AlertEngine } from "./alert-engine.js";
import { AppError, errorStatus, publicErrorMessage } from "./errors.js";
import { json, readJsonObject } from "./http.js";
import { ResendMailGateway } from "./mailer.js";
import { NcbiPubMedGateway } from "./pubmed.js";
import type { AlertConfig, AlertState, AlertStore, Env } from "./types.js";
import { escapeHtml, validateConfigInput } from "./utils.js";

const DATA_KEY = "alert:data:v2";

interface PersistedAlertData {
  version: 2;
  config?: AlertConfig;
  state?: AlertState;
}

class DurableAlertStore implements AlertStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  async getConfig(): Promise<AlertConfig | null> {
    return (await this.getData()).config ?? null;
  }

  async putConfig(config: AlertConfig): Promise<void> {
    const data = await this.getData();
    await this.storage.put(DATA_KEY, { ...data, config });
  }

  async getState(): Promise<AlertState | null> {
    return (await this.getData()).state ?? null;
  }

  async putState(state: AlertState): Promise<void> {
    const data = await this.getData();
    await this.storage.put(DATA_KEY, { ...data, state });
  }

  async putConfigAndState(config: AlertConfig, state: AlertState | null): Promise<void> {
    const data: PersistedAlertData = { version: 2, config };
    if (state) data.state = state;
    await this.storage.put(DATA_KEY, data);
  }

  private async getData(): Promise<PersistedAlertData> {
    return (await this.storage.get<PersistedAlertData>(DATA_KEY)) ?? { version: 2 };
  }
}

export class AlertCoordinator extends DurableObject<Env> {
  private readonly store: DurableAlertStore;
  private readonly engine: AlertEngine;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new DurableAlertStore(ctx.storage);
    this.engine = new AlertEngine(this.store, new NcbiPubMedGateway(env), new ResendMailGateway(env));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/status") {
        return await this.status();
      }

      if (request.method === "POST" && url.pathname === "/config") {
        return await this.runExclusive(() => this.saveConfig(request));
      }

      if (request.method === "POST" && url.pathname === "/check") {
        return await this.runExclusive(async () => json({ ok: true, result: await this.engine.check() }));
      }

      if (request.method === "POST" && url.pathname === "/rebaseline") {
        return await this.runExclusive(() => this.rebaseline());
      }

      if (request.method === "POST" && url.pathname === "/test-email") {
        return await this.runExclusive(() => this.sendTestEmail());
      }

      return json({ ok: false, error: "内部接口不存在。" }, 404);
    } catch (error) {
      return json({ ok: false, error: publicErrorMessage(error) }, errorStatus(error));
    }
  }

  private async status(): Promise<Response> {
    const [config, state] = await Promise.all([this.store.getConfig(), this.store.getState()]);
    return json({
      ok: true,
      config,
      state,
      readiness: {
        adminToken: Boolean(this.env.ADMIN_TOKEN && this.env.ADMIN_TOKEN.length >= 24),
        resendApiKey: Boolean(this.env.RESEND_API_KEY),
        mailFrom: Boolean(this.env.MAIL_FROM),
        ncbiContactEmail: Boolean(this.env.NCBI_CONTACT_EMAIL),
        ncbiApiKey: Boolean(this.env.NCBI_API_KEY),
      },
    });
  }

  private async saveConfig(request: Request): Promise<Response> {
    const input = validateConfigInput(await readJsonObject(request));
    const previous = await this.store.getConfig();
    const previousState = await this.store.getState();
    const now = new Date().toISOString();
    const keywordChanged = previous?.keyword !== input.keyword;
    const recipientChanged = previous?.recipient !== input.recipient;
    const config: AlertConfig = {
      ...input,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };

    let nextState = previousState;
    if (keywordChanged) {
      nextState = {
        version: 2,
        initialized: false,
        keyword: input.keyword,
        seenPmids: [],
        lastNewCount: 0,
        lastEmailedCount: 0,
      };
    } else if (recipientChanged && previousState?.pendingNotification) {
      nextState = { ...previousState, pendingNotification: undefined };
    }

    // Config and state share one storage record so the two cannot diverge after a partial write.
    await this.store.putConfigAndState(config, nextState);

    return json({
      ok: true,
      config,
      message: keywordChanged
        ? "配置已保存。第一次检查只建立基线，不会把已有论文当作新论文发送。"
        : recipientChanged && previousState?.pendingNotification
          ? "配置已保存；旧收件地址对应的待发送邮件已取消。"
          : "配置已保存。",
    });
  }

  private async rebaseline(): Promise<Response> {
    const config = await this.store.getConfig();
    if (!config) throw new AppError("请先保存关键词和收件邮箱。", 400);
    await this.store.putState({
      version: 2,
      initialized: false,
      keyword: config.keyword,
      seenPmids: [],
      lastNewCount: 0,
      lastEmailedCount: 0,
    });
    return json({ ok: true, message: "基线已重置。下一次检查只建立新基线，不会发送历史记录。" });
  }

  private async sendTestEmail(): Promise<Response> {
    const config = await this.store.getConfig();
    if (!config) throw new AppError("请先保存关键词和收件邮箱。", 400);
    const mailer = new ResendMailGateway(this.env);
    await mailer.send({
      from: mailer.sender(),
      to: config.recipient,
      subject: `测试成功：${this.env.APP_NAME ?? "PubMed 关键词提醒"}`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>邮件配置正常</h2><p>你的 PubMed 关键词提醒已经可以发送邮件。</p><p><strong>当前关键词：</strong>${escapeHtml(config.keyword)}</p></div>`,
      text: `邮件配置正常\n\n当前关键词：${config.keyword}`,
      idempotencyKey: `test-${crypto.randomUUID()}`,
    });
    return json({ ok: true, message: `测试邮件已发送到 ${config.recipient}` });
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTail;
    let release!: () => void;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
