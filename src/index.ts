import { errorMessage } from "./errors.js";
import { json } from "./http.js";
import type { Env } from "./types.js";
import { renderPage } from "./ui.js";
import { isAuthorized } from "./utils.js";

export { AlertCoordinator } from "./coordinator.js";

const ALLOWED_API_ROUTES = new Map<string, Set<string>>([
  ["/api/status", new Set(["GET"])],
  ["/api/config", new Set(["POST"])],
  ["/api/check", new Set(["POST"])],
  ["/api/test-email", new Set(["POST"])],
  ["/api/rebaseline", new Set(["POST"])],
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      const nonce = crypto.randomUUID().replaceAll("-", "");
      const headers = pageHeaders(nonce);
      return new Response(renderPage(env.APP_NAME ?? "PubMed 关键词提醒", nonce), { headers });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: env.APP_NAME ?? "PubMed Keyword Alert" });
    }

    if (url.pathname.startsWith("/api/")) {
      const allowedMethods = ALLOWED_API_ROUTES.get(url.pathname);
      if (!allowedMethods) return json({ ok: false, error: "接口不存在。" }, 404);
      if (!allowedMethods.has(request.method)) {
        return json({ ok: false, error: "请求方法不支持。" }, 405, { allow: [...allowedMethods].join(", ") });
      }
      if (!isAuthorized(request.headers.get("authorization"), env.ADMIN_TOKEN)) {
        return json({ ok: false, error: "管理员口令不正确。" }, 401, {
          "www-authenticate": 'Bearer realm="PubMed Alert"',
        });
      }

      const internalPath = url.pathname.replace(/^\/api/, "");
      const stub = env.ALERT_COORDINATOR.getByName("singleton");
      const headers = new Headers();
      if (request.method !== "GET") headers.set("content-type", request.headers.get("content-type") ?? "application/json");
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
      try {
        const response = await stub.fetch(`https://alert-coordinator.internal${internalPath}`, {
          method: request.method,
          headers,
          body,
        });
        return withApiSecurityHeaders(response);
      } catch (error) {
        console.error(JSON.stringify({ event: "coordinator_request_failed", path: internalPath, error: errorMessage(error) }));
        return json({ ok: false, error: "内部状态服务暂时不可用，请稍后重试。" }, 503);
      }
    }

    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" },
    });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const stub = env.ALERT_COORDINATOR.getByName("singleton");
        const response = await stub.fetch("https://alert-coordinator.internal/check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: unknown };
          throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
        }
      })().catch((error) => {
        controller.noRetry();
        // 不重新抛出：Cloudflare 对 cron 异常的日志只会显示触发它的 cron 表达式（如 "0 * * * * "），
        // 没有诊断价值；真实原因由上面的结构化日志和 DO 状态中的 lastError（状态页「上次错误」）记录。
        console.error(JSON.stringify({ event: "scheduled_pubmed_check_failed", error: errorMessage(error) }));
      }),
    );
  },
};

function pageHeaders(nonce: string): Headers {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'none'",
    ].join("; "),
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-robots-tag": "noindex, nofollow, noarchive",
  });
  return headers;
}

function withApiSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
