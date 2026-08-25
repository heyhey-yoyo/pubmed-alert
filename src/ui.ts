import { escapeHtml } from "./utils.js";

export function renderPage(appName: string, nonce: string): string {
  const safeName = escapeHtml(appName);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="description" content="自托管的 PubMed 关键词邮件提醒管理页" />
  <meta name="robots" content="noindex,nofollow,noarchive" />
  <title>${safeName}</title>
  <style nonce="${nonce}">
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #f4f7fb; color: #172033; }
    .wrap { max-width: 820px; margin: 0 auto; padding: 48px 20px 64px; }
    .eyebrow { color: #2463eb; font-weight: 800; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 8px 0 10px; font-size: clamp(30px, 6vw, 48px); line-height: 1.08; letter-spacing: -.04em; }
    .lead { margin: 0 0 28px; max-width: 680px; color: #59657a; font-size: 17px; line-height: 1.7; }
    .card { background: #fff; border: 1px solid #dfe6f1; border-radius: 18px; padding: 24px; box-shadow: 0 18px 55px rgba(34,55,94,.08); }
    [hidden] { display: none !important; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .full { grid-column: 1 / -1; }
    label, .label { display: block; margin-bottom: 7px; font-size: 13px; font-weight: 800; color: #334155; }
    input[type="text"], input[type="email"], input[type="password"] { width: 100%; border: 1px solid #cfd8e6; border-radius: 10px; padding: 12px 13px; font: inherit; outline: none; }
    input:focus-visible, button:focus-visible, a:focus-visible { outline: 3px solid rgba(36,99,235,.35); outline-offset: 2px; }
    input[type="text"]:focus, input[type="email"]:focus, input[type="password"]:focus { border-color: #2463eb; box-shadow: 0 0 0 3px rgba(36,99,235,.12); }
    .hint { margin-top: 7px; color: #5f5a53; font-size: 13px; line-height: 1.5; }
    .switch { display: flex; align-items: center; gap: 10px; min-height: 44px; }
    .remember { margin-top: 9px; display: flex; align-items: center; gap: 8px; color: #5f5a53; font-size: 13px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
    button { border: 0; border-radius: 10px; padding: 11px 16px; font: inherit; font-weight: 800; cursor: pointer; background: #e8eef8; color: #25324a; }
    button.primary { background: #2463eb; color: white; }
    button.danger { background: #fff1f2; color: #9f1239; }
    button:hover:not(:disabled) { transform: translateY(-1px); }
    button:disabled { opacity: .55; cursor: wait; transform: none; }
    #status, #login-status { margin-top: 18px; padding: 14px; border-radius: 10px; background: #f7f9fc; border: 1px solid #e2e8f0; min-height: 48px; color: #42516a; white-space: pre-wrap; line-height: 1.55; }
    #status.error, #login-status.error { background: #fff1f2; border-color: #fecdd3; color: #9f1239; }
    #login-status:empty { display: none; }
    .meta { margin-top: 16px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 18px; color: #64748b; font-size: 13px; }
    .meta div { overflow-wrap: anywhere; }
    .login-card { max-width: 460px; margin: 0 auto; }
    .login-card h2 { margin: 0 0 6px; font-size: 20px; }
    .login-lead { margin: 0 0 18px; color: #59657a; font-size: 14px; line-height: 1.6; }
    .login-card form button { width: 100%; margin-top: 18px; padding: 13px 16px; font-size: 15px; }
    footer { margin-top: 22px; color: #5f5a53; font-size: 13px; line-height: 1.6; }
    footer a { color: inherit; }
    @media (max-width: 650px) { .grid, .meta { grid-template-columns: 1fr; } .full { grid-column: auto; } .card { padding: 19px; } }
    @media (prefers-reduced-motion: reduce) { button { transform: none !important; } }
    /* Portfolio visual system for the settings page. */
    body { background: radial-gradient(circle at 84% -10%, rgba(193,95,60,.1), transparent 30%), #f3eee5; color: #24221f; }
    h1, h2 { font-family: Georgia, "Times New Roman", "Songti SC", serif; font-weight: 400; }
    .card { background: rgba(255,252,247,.84); border-color: rgba(36,34,31,.18); border-radius: 0; box-shadow: none; }
    .eyebrow { color: #c15f3c; }
    .lead, .login-lead { color: #6f6a62; }
    input[type="text"], input[type="email"], input[type="password"] { background: rgba(255,255,255,.46); border-color: rgba(36,34,31,.3); border-radius: 0; color: #24221f; }
    input[type="text"]:focus, input[type="email"]:focus, input[type="password"]:focus { border-color: #c15f3c; box-shadow: 0 0 0 3px rgba(193,95,60,.14); }
    button { border-radius: 0; box-shadow: none; }
    button.primary { background: #c15f3c; color: #fffaf5; }
    button.danger { background: #f6dfdd; color: #8f332f; }
    #status, #login-status { background: #ebe4d8; border-color: rgba(36,34,31,.18); color: #4f4b45; border-radius: 0; }
    #status.error, #login-status.error { background: #f6dfdd; border-color: rgba(184,74,69,.35); color: #8f332f; }
    footer { color: #6f6a62; }
  </style>
</head>
<body>
  <main class="wrap">
    <h1>${safeName}</h1>
    <p class="lead">设置一个 PubMed 检索式和收件邮箱。系统每小时检查一次，只有出现未见过的 PMID 才发送邮件。</p>

    <section id="login-view" class="card login-card" aria-labelledby="login-title">
      <h2 id="login-title">登录</h2>
      <p class="login-lead">请输入管理员口令以管理提醒设置。</p>
      <form id="login-form">
        <label for="token">管理员口令</label>
        <input id="token" type="password" autocomplete="current-password" placeholder="输入管理员口令" required />
        <label class="remember"><input id="remember" type="checkbox" /> 在此设备长期记住口令（共享设备不建议）</label>
        <div class="hint">默认仅保存在当前浏览器会话。管理员口令不会显示在状态中。</div>
        <button class="primary" id="login-btn" type="submit">登录</button>
      </form>
      <div id="login-status" role="status" aria-live="polite"></div>
    </section>

    <section id="main-view" class="card" aria-labelledby="settings-title" hidden>
      <h2 id="settings-title" hidden>提醒设置</h2>
      <div class="grid">
        <div class="full">
          <label for="keyword">PubMed 关键词 / 检索式</label>
          <input id="keyword" type="text" maxlength="500" placeholder='例如：("spatial transcriptomics"[Title/Abstract]) AND cancer' />
          <div class="hint">支持 PubMed 检索语法。结果超过安全上限时会暂停并提示，不会静默遗漏。</div>
        </div>
        <div>
          <label for="recipient">收件邮箱</label>
          <input id="recipient" type="email" maxlength="254" autocomplete="email" placeholder="you@example.com" />
        </div>
        <div class="full">
          <span class="label">定时自动检查</span>
          <label class="switch" for="enabled"><input id="enabled" type="checkbox" checked /><span>开启</span></label>
          <div class="hint">开启后，系统每小时自动检查一次 PubMed，发现新文献就自动发邮件到收件邮箱；关闭后不自动检查，只能手动点「立即检查」。</div>
        </div>
      </div>
      <div class="actions">
        <button class="primary" id="save" type="button">保存配置</button>
        <button id="check" type="button">立即检查</button>
        <button id="test" type="button">发送测试邮件</button>
        <button class="danger" id="rebaseline" type="button">重建基线</button>
        <button id="logout" type="button">退出登录</button>
      </div>
      <div id="status" role="status" aria-live="polite"></div>
      <div class="meta" id="meta" aria-label="运行状态"></div>
    </section>

    <footer>本工具通过 NCBI E-utilities 查询 PubMed，仅发送题录摘要信息。请遵守 <a href="https://www.ncbi.nlm.nih.gov/home/about/policies/" target="_blank" rel="noopener noreferrer">NCBI policies and disclaimers</a>，并以 PubMed 原始页面为准。</footer>
  </main>
<script nonce="${nonce}">
  const $ = (id) => document.getElementById(id);
  const tokenInput = $("token");
  const rememberInput = $("remember");
  const loginView = $("login-view");
  const mainView = $("main-view");
  const savedToken = localStorage.getItem("pubmed-alert-token");
  tokenInput.value = savedToken || sessionStorage.getItem("pubmed-alert-token") || "";
  rememberInput.checked = Boolean(savedToken);

  function persistToken() {
    const token = tokenInput.value.trim();
    if (rememberInput.checked) {
      localStorage.setItem("pubmed-alert-token", token);
      sessionStorage.removeItem("pubmed-alert-token");
    } else {
      sessionStorage.setItem("pubmed-alert-token", token);
      localStorage.removeItem("pubmed-alert-token");
    }
  }

  function setBusy(busy) {
    document.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
  }

  function show(message, isError = false) {
    const status = $("status");
    status.textContent = message;
    status.classList.toggle("error", isError);
    status.setAttribute("role", isError ? "alert" : "status");
  }

  function loginMessage(message, isError = false) {
    const line = $("login-status");
    line.textContent = message;
    line.classList.toggle("error", isError);
    line.setAttribute("role", isError ? "alert" : "status");
  }

  function showMain() {
    loginView.hidden = true;
    mainView.hidden = false;
  }

  function showLogin(message, isError = false) {
    mainView.hidden = true;
    loginView.hidden = false;
    if (message) loginMessage(message, isError);
    tokenInput.focus();
  }

  async function api(path, options = {}) {
    const token = tokenInput.value.trim();
    if (!token) throw new Error("请先输入管理员口令。");
    persistToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const headers = new Headers(options.headers || {});
      headers.set("authorization", "Bearer " + token);
      if (options.body !== undefined) headers.set("content-type", "application/json");
      const response = await fetch(path, { ...options, headers, signal: controller.signal, credentials: "same-origin" });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) throw new Error("服务器返回了非 JSON 响应。");
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "请求失败");
      return data;
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("请求超时，请稍后重试。");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function addMeta(key, value) {
    const div = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = key + "：";
    div.append(strong, document.createTextNode(String(value)));
    $("meta").append(div);
  }

  function formatDate(value) {
    if (!value) return "尚未";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "无效时间";
  }

  function renderStatus(data) {
    if (data.config) {
      $("keyword").value = data.config.keyword || "";
      $("recipient").value = data.config.recipient || "";
      $("enabled").checked = data.config.enabled !== false;
    }
    const state = data.state || {};
    const ready = data.readiness || {};
    $("meta").replaceChildren();
    addMeta("基线已建立", state.initialized ? "是" : "否");
    addMeta("上次尝试", formatDate(state.lastAttemptAt));
    addMeta("上次成功检查", formatDate(state.lastSuccessfulCheckAt));
    addMeta("上次发现新记录", Number.isFinite(state.lastNewCount) ? state.lastNewCount : "—");
    addMeta("上次邮件", formatDate(state.lastEmailAt));
    addMeta("待发送重试", state.pendingNotification ? state.pendingNotification.pmids.length + " 篇" + (state.pendingNotification.failCount ? "（已失败 " + state.pendingNotification.failCount + " 次）" : "") : "无");
    if (state.lastDiscarded) {
      addMeta("最近作废批次", state.lastDiscarded.count + " 篇（" + formatDate(state.lastDiscarded.at) + "）：" + state.lastDiscarded.reason);
    }
    addMeta("Resend 配置", ready.resendApiKey && ready.mailFrom ? "完成" : "缺少 Secret");
    addMeta("NCBI 联系邮箱", ready.ncbiContactEmail ? "已设置" : "建议设置");
    const warningLine = Array.isArray(state.lastWarnings) && state.lastWarnings.length ? "\\nPubMed 提示：" + state.lastWarnings.join("；") : "";
    const errorLine = state.lastError ? "\\n上次错误：" + state.lastError : "";
    show("状态读取成功。" + warningLine + errorLine, Boolean(state.lastError));
  }

  async function run(action) {
    setBusy(true);
    try { await action(); } catch (error) { show(error.message || String(error), true); }
    finally { setBusy(false); }
  }

  async function attemptLogin() {
    const token = tokenInput.value.trim();
    if (!token) {
      loginMessage("请先输入管理员口令。", true);
      tokenInput.focus();
      return;
    }
    $("login-btn").disabled = true;
    try {
      const data = await api("/api/status");
      renderStatus(data);
      showMain();
    } catch (error) {
      loginMessage(error.message || String(error), true);
    } finally {
      $("login-btn").disabled = false;
    }
  }

  $("login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    attemptLogin();
  });

  $("save").addEventListener("click", () => run(async () => {
    const data = await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ keyword: $("keyword").value, recipient: $("recipient").value, enabled: $("enabled").checked }),
    });
    show(data.message);
    renderStatus(await api("/api/status"));
  }));

  $("check").addEventListener("click", () => run(async () => {
    const data = await api("/api/check", { method: "POST", body: JSON.stringify({ force: true }) });
    show(data.result.message + (data.result.resultCount !== undefined ? "\\n检索窗口内结果：" + data.result.resultCount : ""));
    renderStatus(await api("/api/status"));
  }));

  $("test").addEventListener("click", () => run(async () => show((await api("/api/test-email", { method: "POST", body: "{}" })).message)));

  $("rebaseline").addEventListener("click", () => run(async () => {
    if (!confirm("重建基线后，当前检索结果会被视为已有记录，不会发送历史论文。确定继续吗？")) return;
    show((await api("/api/rebaseline", { method: "POST", body: "{}" })).message);
    renderStatus(await api("/api/status"));
  }));

  $("logout").addEventListener("click", () => {
    tokenInput.value = "";
    rememberInput.checked = false;
    localStorage.removeItem("pubmed-alert-token");
    sessionStorage.removeItem("pubmed-alert-token");
    showLogin("已退出登录。");
  });

  rememberInput.addEventListener("change", persistToken);
  if (tokenInput.value) {
    // 已存有口令：先直接显示设置页，避免每次刷新都先闪登录界面；登录验证在后台进行。
    show("正在读取状态…");
    showMain();
    api("/api/status")
      .then((data) => { renderStatus(data); showMain(); })
      .catch((error) => showLogin((error && error.message) || "自动登录失败，请重新输入口令。", true));
  } else {
    tokenInput.focus();
  }
</script>
</body>
</html>`;
}
