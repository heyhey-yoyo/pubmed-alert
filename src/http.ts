import { AppError } from "./errors.js";
import { clampNumber, sleep, truncate } from "./utils.js";

export async function readJsonObject(request: Request, maxBytes = 4096): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AppError("请求必须使用 application/json。", 415);
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new AppError("请求内容过大。", 413);
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new AppError("请求内容过大。", 413);
  }

  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new AppError("请求 JSON 格式不正确。", 400);
  }
}

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(JSON.stringify(data), { status, headers });
}

export interface FetchRetryOptions {
  timeoutMs?: number;
  attempts?: number;
  label: string;
}

export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit,
  options: FetchRetryOptions,
): Promise<Response> {
  const timeoutMs = clampNumber(String(options.timeoutMs ?? ""), 15_000, 2_000, 60_000);
  const attempts = clampNumber(String(options.attempts ?? ""), 3, 1, 4);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
      if (response.ok) return response;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === attempts) return response;

      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      await response.body?.cancel().catch(() => undefined);
      await sleep(retryAfter ?? Math.min(4_000, 250 * 2 ** (attempt - 1)));
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(Math.min(4_000, 250 * 2 ** (attempt - 1)));
    } finally {
      clearTimeout(timeout);
    }
  }

  const detail = lastError instanceof Error ? truncate(lastError.message, 200) : "网络错误";
  throw new AppError(`${options.label}请求失败：${detail}`, 502);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) return Math.min(5_000, Math.max(0, seconds * 1_000));
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(5_000, Math.max(0, timestamp - Date.now()));
}
