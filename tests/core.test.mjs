import assert from "node:assert/strict";
import test from "node:test";
import { AlertEngine } from "../.test-dist/src/alert-engine.js";
import { renderAlertEmail } from "../.test-dist/src/email-template.js";
import { readJsonObject } from "../.test-dist/src/http.js";
import { NcbiPubMedGateway } from "../.test-dist/src/pubmed.js";
import { renderPage } from "../.test-dist/src/ui.js";
import {
  computeSearchRange,
  constantTimeEqual,
  findNewPmids,
  isAuthorized,
  mergePmids,
  validateConfigInput,
} from "../.test-dist/src/utils.js";

class MemoryStore {
  config = null;
  state = null;
  async getConfig() { return this.config; }
  async putConfig(config) { this.config = structuredClone(config); }
  async getState() { return this.state ? structuredClone(this.state) : null; }
  async putState(state) { this.state = structuredClone(state); }
}

test("配置校验拒绝无效输入", () => {
  assert.throws(() => validateConfigInput({ keyword: "a", recipient: "x@y.com", enabled: true }));
  assert.throws(() => validateConfigInput({ keyword: "cancer", recipient: "bad", enabled: true }));
  assert.throws(() => validateConfigInput({ keyword: "cancer", recipient: "a..b@example.com", enabled: true }));
  assert.throws(() => validateConfigInput({ keyword: "cancer", recipient: "a,b@example.com", enabled: true }));
  assert.throws(() => validateConfigInput({ keyword: "cancer", recipient: "x@y.com", enabled: "true" }));
  assert.deepEqual(validateConfigInput({ keyword: " cancer ", recipient: " x@y.com ", enabled: false }), {
    keyword: "cancer",
    recipient: "x@y.com",
    enabled: false,
  });
});

test("鉴权比较支持正确 token 并限制超长输入", () => {
  const token = "a".repeat(32);
  assert.equal(constantTimeEqual(token, token), true);
  assert.equal(constantTimeEqual(token, token + "x"), false);
  assert.equal(isAuthorized(`Bearer ${token}`, token), true);
  assert.equal(isAuthorized(`Bearer ${"x".repeat(513)}`, token), false);
  assert.equal(isAuthorized(`Bearer short`, "short"), false);
});

test("搜索窗口按上次成功时间回退重叠天数", () => {
  const now = new Date("2026-07-31T12:00:00.000Z");
  const range = computeSearchRange({
    now,
    lastSuccessfulCheckAt: "2026-07-30T12:00:00.000Z",
    initialWindowDays: 7,
    overlapDays: 2,
    maxCatchupDays: 365,
  });
  assert.equal(range.start.toISOString(), "2026-07-28T12:00:00.000Z");
  assert.throws(() =>
    computeSearchRange({
      now,
      lastSuccessfulCheckAt: "2024-01-01T00:00:00.000Z",
      initialWindowDays: 7,
      overlapDays: 2,
      maxCatchupDays: 365,
    }),
  );
});

test("PMID 合并去重并识别新增", () => {
  assert.deepEqual(findNewPmids(["3", "2", "1"], ["1", "2"]), ["3"]);
  assert.deepEqual(mergePmids(["3", "2"], ["2", "1"]), ["3", "2", "1"]);
});

test("邮件模板转义标题和检索式", () => {
  const { html, text } = renderAlertEmail("<script>alert(1)</script>", [
    { pmid: "123", title: "<b>title</b>", journal: "J", pubdate: "2026", authors: "A", url: "https://pubmed.ncbi.nlm.nih.gov/123/" },
  ], 0, 1);
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.equal(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), true);
  assert.equal(html.includes("&lt;b&gt;title&lt;/b&gt;"), true);
  assert.equal(text.includes("<script>alert(1)</script>"), true);
});

test("首次检查只建基线，后续新 PMID 只发送一次", async () => {
  const store = new MemoryStore();
  store.config = { keyword: "cancer", recipient: "x@y.com", enabled: true, createdAt: "x", updatedAt: "x" };
  const searches = [
    { pmids: ["2", "1"], totalCount: 2, windowStart: "a", windowEnd: "b", warnings: [] },
    { pmids: ["3", "2", "1"], totalCount: 3, windowStart: "a", windowEnd: "c", warnings: [] },
  ];
  let searchIndex = 0;
  let sendCount = 0;
  const pubmed = {
    async search() { return searches[Math.min(searchIndex++, searches.length - 1)]; },
    async summaries(pmids) { return pmids.map((pmid) => ({ pmid, title: `T${pmid}`, journal: "J", pubdate: "2026", authors: "A", url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` })); },
  };
  const mailer = { sender() { return "Alert <alerts@example.com>"; }, async send() { sendCount += 1; return { id: "mail" }; } };
  let tick = 0;
  const engine = new AlertEngine(store, pubmed, mailer, () => new Date(1_700_000_000_000 + tick++ * 1000));

  assert.equal((await engine.check()).status, "initialized");
  assert.equal(sendCount, 0);
  const [a, b] = await Promise.all([engine.check(), engine.check()]);
  assert.equal(a.status, "emailed");
  assert.equal(b.status, "emailed");
  assert.equal(sendCount, 1);
  assert.equal(store.state.seenPmids.includes("3"), true);
  assert.equal(store.state.pendingNotification, undefined);
});

test("发送失败时保留 pending，下一次使用同一幂等键重试", async () => {
  const store = new MemoryStore();
  store.config = { keyword: "cancer", recipient: "x@y.com", enabled: true, createdAt: "x", updatedAt: "x" };
  store.state = { version: 2, initialized: true, keyword: "cancer", seenPmids: ["1"], lastSuccessfulCheckAt: "2026-07-30T00:00:00Z" };
  const pubmed = {
    async search() { return { pmids: ["2", "1"], totalCount: 2, windowStart: "a", windowEnd: "b", warnings: [] }; },
    async summaries(pmids) { return pmids.map((pmid) => ({ pmid, title: `T${pmid}`, journal: "", pubdate: "", authors: "", url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` })); },
  };
  const keys = [];
  let fail = true;
  const mailer = {
    sender() { return "Alert <alerts@example.com>"; },
    async send(message) {
      keys.push(message.idempotencyKey);
      if (fail) { fail = false; throw new Error("temporary"); }
      return {};
    },
  };
  const engine = new AlertEngine(store, pubmed, mailer, () => new Date("2026-07-31T00:00:00Z"));
  await assert.rejects(engine.check());
  assert.ok(store.state.pendingNotification);
  assert.equal((await engine.check()).status, "emailed");
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("延迟重试成功后不把 PubMed 检索进度推进到重试时刻", async () => {
  const store = new MemoryStore();
  store.config = { keyword: "cancer", recipient: "x@y.com", enabled: true, createdAt: "x", updatedAt: "x" };
  store.state = {
    version: 2,
    initialized: true,
    keyword: "cancer",
    seenPmids: ["1"],
    lastSuccessfulCheckAt: "2026-07-30T00:00:00.000Z",
    pendingNotification: {
      idempotencyKey: "same-key",
      pmids: ["2"],
      keyword: "cancer",
      recipient: "x@y.com",
      from: "Alert <alerts@example.com>",
      subject: "new",
      html: "<p>fixed body</p>",
      text: "fixed body",
      emailedCount: 1,
      createdAt: "2026-07-31T01:00:00.000Z",
    },
  };
  const pubmed = {
    async search() { throw new Error("pending retry should not search first"); },
    async summaries() { throw new Error("pending retry must reuse the stored email payload"); },
  };
  const mailer = { sender() { return "Alert <alerts@example.com>"; }, async send() { return {}; } };
  const engine = new AlertEngine(store, pubmed, mailer, () => new Date("2026-08-02T12:00:00.000Z"));

  assert.equal((await engine.check()).status, "emailed");
  assert.equal(store.state.lastSuccessfulCheckAt, "2026-07-31T01:00:00.000Z");
  assert.equal(store.state.lastEmailAt, "2026-08-02T12:00:00.000Z");
});


test("PubMed ESearch 使用 Entry Date 窗口并解析 PMID", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body || "");
    return new Response(JSON.stringify({ esearchresult: { count: "2", idlist: ["20", "10"] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const gateway = new NcbiPubMedGateway(
      { MAX_RESULTS: "10", SEARCH_WINDOW_DAYS: "7", SEARCH_OVERLAP_DAYS: "2", MAX_CATCHUP_DAYS: "365" },
      () => new Date("2026-07-31T12:00:00.000Z"),
    );
    const result = await gateway.search("cancer[Title]", "2026-07-30T12:00:00.000Z");
    const params = new URLSearchParams(requestBody);
    assert.equal(params.get("db"), "pubmed");
    assert.equal(params.get("datetype"), "edat");
    assert.equal(params.get("mindate"), "2026/07/28");
    assert.equal(params.get("maxdate"), "2026/07/31");
    assert.equal(params.get("term"), "cancer[Title]");
    assert.deepEqual(result.pmids, ["20", "10"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PubMed 结果超过上限时明确失败，不返回截断列表", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ esearchresult: { count: "11", idlist: ["1"] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const gateway = new NcbiPubMedGateway({ MAX_RESULTS: "10" }, () => new Date("2026-07-31T12:00:00.000Z"));
    await assert.rejects(gateway.search("cancer"), /超过 MAX_RESULTS=10/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JSON 接口拒绝错误媒体类型和超大请求", async () => {
  await assert.rejects(readJsonObject(new Request("https://example.test", { method: "POST", body: "{}" })), /application\/json/);
  await assert.rejects(
    readJsonObject(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(5000) }),
      }),
    ),
    /请求内容过大/,
  );
});

test("管理页动态文本被转义且脚本使用 CSP nonce", () => {
  const html = renderPage('<img src=x onerror=alert(1)>', "nonce123");
  assert.equal(html.includes('<img src=x onerror=alert(1)>'), false);
  assert.equal(html.includes('&lt;img src=x onerror=alert(1)&gt;'), true);
  assert.equal((html.match(/nonce="nonce123"/g) || []).length, 2);
  assert.equal(html.includes("innerHTML"), false);
});


test("幂等键绑定完整邮件负载，收件人变化会生成不同键", async () => {
  const keys = [];
  const pubmed = {
    async search() { return { pmids: ["2", "1"], totalCount: 2, windowStart: "a", windowEnd: "b", warnings: [] }; },
    async summaries(pmids) { return pmids.map((pmid) => ({ pmid, title: `T${pmid}`, journal: "J", pubdate: "2026", authors: "A", url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` })); },
  };
  const mailer = { sender() { return "Alert <alerts@example.com>"; }, async send(message) { keys.push(message.idempotencyKey); return {}; } };

  for (const recipient of ["first@example.com", "second@example.com"]) {
    const store = new MemoryStore();
    store.config = { keyword: "cancer", recipient, enabled: true, createdAt: "x", updatedAt: "x" };
    store.state = { version: 2, initialized: true, keyword: "cancer", seenPmids: ["1"], lastSuccessfulCheckAt: "2026-07-30T00:00:00Z" };
    const engine = new AlertEngine(store, pubmed, mailer, () => new Date("2026-07-31T00:00:00Z"));
    assert.equal((await engine.check()).status, "emailed");
  }

  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});
