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

设置页面正文采用 16px 基线，说明、记住状态和页脚文字不小于 13px；桌面与手机端不得出现页面整体横向溢出。

本项目为 Tools 工具类。页眉桌面 72px、手机（≤640px）64px；YDchen 为衬线 20px/600，Tools 为无衬线 20px/300，手机字标 18px；标题 18px/600、手机 16px；分隔线 36px/32px，品牌、分隔线与标题间距 16px/12px。

页眉内容区最大宽度 1280px（含两侧各 16px 内边距），整体居中；品牌和标题靠左，操作区靠右，窄屏换行后仍保持该对齐。品牌页眉在文档顶部正常排布，随页面滚走，不固定或吸顶；表格内部表头、侧边工具和手机底部导航可按功能保留。

正文采用统一系统无衬线字体，默认 16px / 1.6；标题采用 Georgia、Times New Roman、Songti SC、STSong 衬线族。数字与代码可使用 SFMono-Regular、Consolas、Liberation Mono、Microsoft YaHei 等宽族。按钮和输入通常 15px，辅助文字 12–14px，密集科学数据允许有理由的局部调整。页面底色 #f3eee5、正文 #24221f、赤陶强调 #a94f31，柔和底色上的强调文字 #823a25；科学分类色、热图、作品主题与状态色保留必要区分度。

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

## 维护与兼容

设置页面最大宽度收敛到 720px，登录卡片保持独立居中，手机继续使用单列。

归入 Tools 类并统一页眉，项目方章保留为 favicon。存储不可用时仍可登录和操作，界面明确提示口令不能持久保存或清除；本地浏览器用隔离 API 响应验证登录、检查中状态、恢复按钮及退出，没有发送邮件。

检查命令与技术约束见 [AGENTS.md](./AGENTS.md)。上述浏览器验证描述对应 2026-09-13 的维护验收；后续修改仍须重新验证。

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（Claude Code、Cursor、Copilot 等）都必须同步更新本文件与 [AGENTS.md](./AGENTS.md)。**
>
> - 修改存储架构（Durable Object / SQLite）或检索语义前先读 [AGENTS.md](./AGENTS.md) 的相关章节
