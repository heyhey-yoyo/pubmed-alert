import { AppError } from "./errors.js";
import { fetchWithRetry } from "./http.js";
import type { Env, PubMedArticle, PubMedGateway, PubMedSearchResult } from "./types.js";
import { clampNumber, computeSearchRange, formatNcbiDate, sleep, truncate } from "./utils.js";

const ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const ESUMMARY_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";
const SUMMARY_BATCH_SIZE = 200;

export class NcbiPubMedGateway implements PubMedGateway {
  constructor(private readonly env: Env, private readonly now: () => Date = () => new Date()) {}

  async search(keyword: string, lastSuccessfulCheckAt?: string): Promise<PubMedSearchResult> {
    const maxResults = clampNumber(this.env.MAX_RESULTS, 2_000, 1, 10_000);
    const initialWindowDays = clampNumber(this.env.SEARCH_WINDOW_DAYS, 7, 1, 30);
    const overlapDays = clampNumber(this.env.SEARCH_OVERLAP_DAYS, 2, 0, 7);
    const maxCatchupDays = clampNumber(this.env.MAX_CATCHUP_DAYS, 365, 30, 3_650);
    const timeoutMs = clampNumber(this.env.REQUEST_TIMEOUT_MS, 15_000, 2_000, 60_000);
    const { start, end } = computeSearchRange({
      now: this.now(),
      lastSuccessfulCheckAt,
      initialWindowDays,
      overlapDays,
      maxCatchupDays,
    });

    const params = this.baseParams();
    params.set("term", keyword);
    params.set("retmode", "json");
    params.set("retmax", String(maxResults));
    params.set("sort", "pub_date");
    params.set("datetype", "edat");
    params.set("mindate", formatNcbiDate(start));
    params.set("maxdate", formatNcbiDate(end));

    const response = await fetchWithRetry(
      ESEARCH_URL,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: params.toString(),
      },
      { label: "PubMed ESearch ", timeoutMs },
    );

    if (!response.ok) {
      if (response.status === 429) {
        throw new AppError(
          "PubMed ESearch 请求被限流（HTTP 429）。NCBI 对未设置 NCBI_API_KEY 的请求按来源 IP 限流（每秒 3 次），" +
            "Cloudflare Worker 的出站 IP 与其他用户共享，可能被连带限流。建议设置 NCBI_API_KEY（按密钥限流、每秒 10 次）" +
            "并确认已设置 NCBI_CONTACT_EMAIL。本次检查未推进，下次检查会自动重试。",
          502,
        );
      }
      throw new AppError(`PubMed ESearch 请求失败：HTTP ${response.status}`, 502);
    }

    const data = (await response.json()) as {
      esearchresult?: {
        count?: string;
        idlist?: unknown;
        errorlist?: unknown;
        warninglist?: unknown;
        ERROR?: unknown;
      };
    };
    const result = data.esearchresult;
    if (!result) throw new AppError("PubMed ESearch 返回格式异常。", 502);

    const fatal = collectMessages(result.ERROR, result.errorlist);
    if (fatal.length > 0) throw new AppError(`PubMed 检索式错误：${truncate(fatal.join("；"), 500)}`, 400);

    const totalCount = Number.parseInt(result.count ?? "0", 10);
    if (!Number.isFinite(totalCount) || totalCount < 0) {
      throw new AppError("PubMed ESearch 返回了无效的结果数量。", 502);
    }
    if (totalCount > maxResults) {
      throw new AppError(
        `本次检索有 ${totalCount} 条记录，超过 MAX_RESULTS=${maxResults}，检查已暂停、状态未推进（避免截断列表导致静默漏报）。` +
          `请改用更精确的检索式，例如限定字段或加条件：("term"[Title/Abstract]) AND 期刊/年份限定；` +
          `确有需要时可在 wrangler.jsonc 中提高 MAX_RESULTS（最高 10000）后重新部署。`,
        409,
      );
    }

    const rawIds = Array.isArray(result.idlist) ? result.idlist : [];
    const pmids = rawIds.filter((value): value is string => typeof value === "string" && /^\d+$/.test(value));
    if (pmids.length !== rawIds.length) throw new AppError("PubMed 返回了无效 PMID。", 502);

    return {
      pmids,
      totalCount,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      warnings: collectMessages(result.warninglist).slice(0, 10).map((message) => truncate(message, 300)),
    };
  }

  async summaries(pmids: string[]): Promise<PubMedArticle[]> {
    if (pmids.length === 0) return [];
    const timeoutMs = clampNumber(this.env.REQUEST_TIMEOUT_MS, 15_000, 2_000, 60_000);
    const articles = new Map<string, PubMedArticle>();

    for (let offset = 0; offset < pmids.length; offset += SUMMARY_BATCH_SIZE) {
      const batch = pmids.slice(offset, offset + SUMMARY_BATCH_SIZE);
      if (offset > 0) await sleep(this.env.NCBI_API_KEY ? 110 : 350);

      const params = this.baseParams();
      params.set("db", "pubmed");
      params.set("id", batch.join(","));
      params.set("retmode", "json");

      const response = await fetchWithRetry(
        ESUMMARY_URL,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: params.toString(),
        },
        { label: "PubMed ESummary ", timeoutMs },
      );
      if (!response.ok) {
        if (response.status === 429) {
          throw new AppError(
            "PubMed ESummary 请求被限流（HTTP 429）。NCBI 对未设置 NCBI_API_KEY 的请求按来源 IP 限流（每秒 3 次），" +
              "Cloudflare Worker 的出站 IP 与其他用户共享，可能被连带限流。建议设置 NCBI_API_KEY（按密钥限流、每秒 10 次）" +
              "并确认已设置 NCBI_CONTACT_EMAIL。本次检查未推进，下次检查会自动重试。",
            502,
          );
        }
        throw new AppError(`PubMed ESummary 请求失败：HTTP ${response.status}`, 502);
      }

      const data = (await response.json()) as { result?: Record<string, unknown> & { uids?: unknown } };
      const result = data.result;
      if (!result) throw new AppError("PubMed ESummary 返回格式异常。", 502);

      for (const pmid of batch) {
        const entry = (result[pmid] ?? {}) as {
          title?: unknown;
          fulljournalname?: unknown;
          source?: unknown;
          pubdate?: unknown;
          sortpubdate?: unknown;
          authors?: unknown;
        };
        const authors = Array.isArray(entry.authors)
          ? entry.authors
              .map((author) => (author && typeof author === "object" ? (author as { name?: unknown }).name : undefined))
              .filter((name): name is string => typeof name === "string" && name.length > 0)
              .slice(0, 6)
              .join(", ")
          : "";
        const title = typeof entry.title === "string" ? entry.title.replace(/\s+/g, " ").trim() : "";
        const journal =
          typeof entry.fulljournalname === "string"
            ? entry.fulljournalname
            : typeof entry.source === "string"
              ? entry.source
              : "";
        const pubdate =
          typeof entry.pubdate === "string"
            ? entry.pubdate
            : typeof entry.sortpubdate === "string"
              ? entry.sortpubdate
              : "";
        articles.set(pmid, {
          pmid,
          title: truncate(title || `PMID ${pmid}`, 1_000),
          journal: truncate(journal, 300),
          pubdate: truncate(pubdate, 100),
          authors: truncate(authors, 1_000),
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        });
      }
    }

    return pmids.map(
      (pmid) =>
        articles.get(pmid) ?? {
          pmid,
          title: `PMID ${pmid}`,
          journal: "",
          pubdate: "",
          authors: "",
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        },
    );
  }

  private baseParams(): URLSearchParams {
    const params = new URLSearchParams({ db: "pubmed", tool: "pubmed_keyword_alert_worker" });
    if (this.env.NCBI_CONTACT_EMAIL) params.set("email", this.env.NCBI_CONTACT_EMAIL);
    if (this.env.NCBI_API_KEY) params.set("api_key", this.env.NCBI_API_KEY);
    return params;
  }
}

function collectMessages(...values: unknown[]): string[] {
  const messages: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string" && value.trim()) messages.push(value.trim());
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  values.forEach(visit);
  return [...new Set(messages)];
}
