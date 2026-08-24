import type { PubMedArticle } from "./types.js";
import { escapeHtml } from "./utils.js";

export function renderAlertEmail(
  keyword: string,
  articles: PubMedArticle[],
  hiddenCount: number,
  totalNew: number,
): { html: string; text: string } {
  const items = articles
    .map(
      (article) => `
        <li style="margin:0 0 18px;padding:0 0 18px;border-bottom:1px solid #e5e7eb">
          <a href="${article.url}" style="font-size:16px;font-weight:700;color:#0f5fc2;text-decoration:none">${escapeHtml(article.title)}</a>
          <div style="margin-top:6px;color:#4b5563;font-size:13px">${escapeHtml(
            [article.authors, article.journal, article.pubdate, `PMID: ${article.pmid}`].filter(Boolean).join(" · "),
          )}</div>
        </li>`,
    )
    .join("");
  const hidden = hiddenCount > 0 ? `<p>另外还有 ${hiddenCount} 篇未在邮件正文中展开。</p>` : "";
  const html = `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827"><div style="max-width:720px;margin:0 auto;padding:28px 16px"><div style="background:white;border-radius:14px;padding:28px"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">PubMed Keyword Alert</div><h1 style="margin:8px 0 4px;font-size:24px">发现 ${totalNew} 篇新论文</h1><p style="margin:0 0 24px;color:#4b5563"><strong>检索式：</strong>${escapeHtml(keyword)}</p><ol style="padding-left:22px;margin:0">${items}</ol>${hidden}<p style="margin-top:24px;color:#6b7280;font-size:12px">数据来自 NCBI PubMed E-utilities。请打开 PubMed 页面核对最终记录。</p></div></div></body></html>`;

  const lines = articles.flatMap((article, index) => [
    `${index + 1}. ${article.title}`,
    [article.authors, article.journal, article.pubdate, `PMID: ${article.pmid}`].filter(Boolean).join(" · "),
    article.url,
    "",
  ]);
  if (hiddenCount > 0) lines.push(`另外还有 ${hiddenCount} 篇未展开。`, "");
  const text = [`PubMed 发现 ${totalNew} 篇新论文`, `检索式：${keyword}`, "", ...lines].join("\n");
  return { html, text };
}
