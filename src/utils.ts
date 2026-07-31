import { AppError } from "./errors.js";

export const MAX_SEEN_PMIDS = 10_000;

export function clampNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function isValidEmail(value: string): boolean {
  if (value.length === 0 || value.length > 254 || /[^\x21-\x7e]/.test(value)) return false;
  const at = value.lastIndexOf("@");
  if (at <= 0 || at !== value.indexOf("@")) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  return labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
  );
}

export function validateConfigInput(body: Record<string, unknown>): {
  keyword: string;
  recipient: string;
  enabled: boolean;
} {
  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  const recipient = typeof body.recipient === "string" ? body.recipient.trim() : "";

  if (keyword.length < 2 || keyword.length > 500) {
    throw new AppError("关键词长度需要在 2–500 个字符之间。", 400);
  }
  if (!isValidEmail(recipient)) {
    throw new AppError("请输入有效的收件邮箱。", 400);
  }
  if (typeof body.enabled !== "boolean") {
    throw new AppError("提醒状态必须是布尔值。", 400);
  }

  return { keyword, recipient, enabled: body.enabled };
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length > 512 || b.length > 512) return false;
  const maxLength = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function isAuthorized(authorization: string | null, expectedToken: string | undefined): boolean {
  if (!expectedToken || expectedToken.length < 24) return false;
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  return constantTimeEqual(supplied, expectedToken);
}

export function mergePmids(current: string[], previous: string[]): string[] {
  return [...new Set([...current, ...previous])].slice(0, MAX_SEEN_PMIDS);
}

export function findNewPmids(current: string[], seenPmids: string[]): string[] {
  const seen = new Set(seenPmids);
  return current.filter((pmid) => !seen.has(pmid));
}

export function formatNcbiDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

export function computeSearchRange(input: {
  now: Date;
  lastSuccessfulCheckAt?: string;
  initialWindowDays: number;
  overlapDays: number;
  maxCatchupDays: number;
}): { start: Date; end: Date } {
  const { now, lastSuccessfulCheckAt, initialWindowDays, overlapDays, maxCatchupDays } = input;
  const end = new Date(now);
  let start: Date;

  if (lastSuccessfulCheckAt) {
    const parsed = new Date(lastSuccessfulCheckAt);
    if (!Number.isFinite(parsed.getTime())) throw new AppError("保存的上次检查时间无效，请重建基线。", 409);
    if (parsed.getTime() > now.getTime() + 5 * 60_000) {
      throw new AppError("保存的上次检查时间位于未来，请重建基线。", 409);
    }
    const elapsedDays = (now.getTime() - parsed.getTime()) / 86_400_000;
    if (elapsedDays > maxCatchupDays) {
      throw new AppError(
        `距上次成功检查已超过 ${maxCatchupDays} 天。为避免静默漏报，检查已暂停；请重建基线或调大 MAX_CATCHUP_DAYS。`,
        409,
      );
    }
    start = new Date(parsed.getTime() - overlapDays * 86_400_000);
  } else {
    start = new Date(now.getTime() - initialWindowDays * 86_400_000);
  }

  return { start, end };
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
