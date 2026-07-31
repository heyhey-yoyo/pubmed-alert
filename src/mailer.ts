import { AppError } from "./errors.js";
import { fetchWithRetry } from "./http.js";
import type { EmailMessage, Env, MailGateway } from "./types.js";
import { clampNumber, truncate } from "./utils.js";

export class ResendMailGateway implements MailGateway {
  constructor(private readonly env: Env) {}

  sender(): string {
    if (!this.env.MAIL_FROM) throw new AppError("尚未设置 MAIL_FROM，例如：PubMed Alert <alerts@example.com>。", 503);
    return this.env.MAIL_FROM;
  }

  async send(message: EmailMessage): Promise<{ id?: string }> {
    if (!this.env.RESEND_API_KEY) throw new AppError("尚未设置 RESEND_API_KEY。", 503);

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.env.RESEND_API_KEY}`,
      "content-type": "application/json",
      accept: "application/json",
    };
    if (message.idempotencyKey) headers["idempotency-key"] = message.idempotencyKey;

    const response = await fetchWithRetry(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      },
      {
        label: "Resend 发信 ",
        timeoutMs: clampNumber(this.env.REQUEST_TIMEOUT_MS, 15_000, 2_000, 60_000),
      },
    );

    const bodyText = await response.text();
    if (!response.ok) {
      let detail = bodyText;
      try {
        const parsed = JSON.parse(bodyText) as { message?: unknown; error?: unknown };
        detail = typeof parsed.message === "string" ? parsed.message : typeof parsed.error === "string" ? parsed.error : bodyText;
      } catch {
        // Keep the plain response body when it is not JSON.
      }
      throw new AppError(`Resend 发信失败：HTTP ${response.status} ${truncate(detail, 300)}`, 502);
    }

    try {
      const parsed = JSON.parse(bodyText) as { id?: unknown };
      return typeof parsed.id === "string" ? { id: parsed.id } : {};
    } catch {
      return {};
    }
  }
}
