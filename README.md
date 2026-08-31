# PubMed 关键词邮件提醒

一个面向单用户的 Cloudflare Worker：在网页中保存 PubMed 检索式和收件邮箱，Cloudflare Cron 每小时检查一次；发现新的 PMID 后，通过 Resend 发送汇总邮件。

## 主要功能

- 首次检查只建立基线，不发送已有论文
- 按 PubMed Entry Date（`edat`）追踪，并从上次成功检索时间继续追赶
- 检索结果超过上限时明确暂停，避免 `retmax` 截断导致静默漏报
- 邮件发送前持久化待发送状态，并使用 Resend 幂等键降低重复邮件概率
- 单例 Durable Object 串行协调配置、手动检查与 Cron 检查
- 管理 API 使用 `ADMIN_TOKEN` Bearer Token 保护；未设置时所有管理 API 拒绝访问
- 默认仅在 `sessionStorage` 保存管理员口令，可由用户选择长期记住
- CSP、安全响应头、请求体大小限制、外部请求超时和有限重试
- 部署由 Cloudflare Workers Builds 自动完成；部署前自动运行类型检查与测试，失败则不会部署

## 界面风格

管理页面采用 `ydchen-portfolio` 的暖米白、浅灰与赤陶色视觉系统，使用衬线标题和扁平化设置卡片；认证、配置、Cron 和邮件幂等语义保持不变。

设置页面正文采用 15px 以上基线，说明、记住状态和页脚文字不小于 13px；桌面与手机端不得出现页面整体横向溢出。

## 数据与隐私

- 这是单用户工具，没有账户系统
- 管理页面地址可以公开访问，但 `/api/*` 必须通过 Bearer Token 鉴权
- 默认只在当前浏览器会话保存 Token；勾选「长期记住」会写入 `localStorage`
- 页面使用严格 CSP nonce，不使用动态 `innerHTML` 渲染服务端状态
- 不要把 `.dev.vars`、Cloudflare Token、Resend Key、管理员口令或 NCBI Key 提交到 GitHub

## 本地运行

需要：

1. Cloudflare 账户
2. GitHub 账户（使用自动部署时）
3. Node.js 22 或更新版本
4. Resend 账户、API Key，以及已验证的发件域名
5. NCBI 联系邮箱；NCBI API Key 可选

```bash
git clone <你的仓库地址>
cd pubmed-alert
npm ci
npm run check
```

项目没有运行时 npm 依赖。TypeScript 与 Wrangler 是锁定版本的开发依赖；先运行 `npm ci`，检查、开发和部署脚本不会再临时下载工具。

本地开发：

```bash
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入本地测试值
npm run dev
```

`.dev.vars` 已被 `.gitignore` 排除，禁止提交真实密钥。

## 部署

先登录并设置 Secrets：

```bash
npm exec -- wrangler login
npm exec -- wrangler secret put ADMIN_TOKEN
npm exec -- wrangler secret put RESEND_API_KEY
npm exec -- wrangler secret put MAIL_FROM
npm exec -- wrangler secret put NCBI_CONTACT_EMAIL
```

可选设置 NCBI API Key：

```bash
npm exec -- wrangler secret put NCBI_API_KEY
```

部署：

```bash
npm run check
npm run deploy
```

部署后：

1. 打开 Wrangler 输出的 `workers.dev` 地址
2. 输入 `ADMIN_TOKEN`
3. 保存 PubMed 检索式、收件邮箱和启用状态
4. 点击「立即检查」建立基线
5. 点击「发送测试邮件」验证 Resend

`MAIL_FROM` 必须使用 Resend 已验证域名，例如 `PubMed Alert <alerts@example.com>`。

代码部署由 Cloudflare Workers Builds 完成：在 Cloudflare Dashboard 连接本仓库，Production branch 选择 `main`，构建命令填 `npm run check`。推送到 `main` 后自动检测并部署。

## 责任边界

这是单用户工具，没有账户系统。若需要多人使用、审计日志或企业身份认证，建议在 Worker 前增加 Cloudflare Access，而不是共享管理员口令。

## License

MIT

---

> AI 编程代理请阅读 [AGENTS.md](./AGENTS.md) 了解代码架构、测试策略与开发约定。

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（Claude Code、Cursor、Copilot 等）都必须同步更新本文件与 [AGENTS.md](./AGENTS.md)。**
>
> - 修改存储架构（Durable Object / SQLite）或检索语义前先读 [AGENTS.md](./AGENTS.md) 的相关章节
