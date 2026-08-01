# PubMed 关键词邮件提醒

一个面向单用户的 Cloudflare Worker：在网页中保存 PubMed 检索式和收件邮箱，Cloudflare Cron 每小时检查一次；发现新的 PMID 后，通过 Resend 发送汇总邮件。

## 主要特性

- 首次检查只建立基线，不发送已有论文
- 按 PubMed **Entry Date（`edat`）** 追踪，并从上次成功检索时间继续追赶
- 检索结果超过上限时明确暂停，避免 `retmax` 截断导致静默漏报
- 邮件发送前持久化待发送状态，并使用 Resend 幂等键降低重复邮件概率
- 单例 Durable Object 串行协调配置、手动检查与 Cron 检查
- 管理 API 使用 `ADMIN_TOKEN` Bearer Token 保护；未设置 `ADMIN_TOKEN` 时所有管理 API 拒绝访问
- 默认仅在 `sessionStorage` 保存管理员口令；可由用户选择长期记住
- CSP、安全响应头、请求体大小限制、外部请求超时和有限重试
- TypeScript 严格检查和核心逻辑回归测试
- GitHub Actions 在 Pull Request 上检查，在 `main` 推送后部署

## 架构

```text
浏览器
  └─ Cloudflare Worker（网页、鉴权、管理 API）
       └─ 单例 AlertCoordinator Durable Object
            ├─ SQLite-backed Durable Object Storage（配置、状态、待发送邮件）
            ├─ NCBI ESearch / ESummary（PubMed）
            └─ Resend API（邮件）

Cloudflare Cron Trigger ──每小时──> AlertCoordinator
```

本版本不再需要 Workers KV。Durable Object 用于把同一提醒的状态写入和检查操作集中到一个强一致协调点。

## 需要准备

1. Cloudflare 账户
2. GitHub 账户（使用自动部署时）
3. Node.js 22 或更新版本
4. Resend 账户、API Key，以及已验证的发件域名
5. NCBI 联系邮箱；NCBI API Key 可选

`MAIL_FROM` 必须使用 Resend 已验证域名，例如：

```text
PubMed Alert <alerts@example.com>
```

## 本地安装与检查

```bash
git clone <你的仓库地址>
cd pubmed-keyword-alert-worker
npm ci
npm run check
```

项目没有运行时 npm 依赖。检查和部署脚本会下载明确指定版本的 TypeScript/Wrangler，因此首次执行需要能够访问 npm registry。

本地开发：

```bash
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入本地测试值
npm run dev
```

触发本地 Cron：

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+*+*+*+*"
```

`.dev.vars` 已被 `.gitignore` 排除，禁止提交真实密钥。

## 设置 Cloudflare Secrets

先登录：

```bash
npx --yes wrangler@4.117.0 login
```

依次设置：

```bash
npx --yes wrangler@4.117.0 secret put ADMIN_TOKEN
npx --yes wrangler@4.117.0 secret put RESEND_API_KEY
npx --yes wrangler@4.117.0 secret put MAIL_FROM
npx --yes wrangler@4.117.0 secret put NCBI_CONTACT_EMAIL
```

可选：

```bash
npx --yes wrangler@4.117.0 secret put NCBI_API_KEY
```

建议：

- `ADMIN_TOKEN`：必填，无长度限制；未设置时所有管理 API 拒绝访问。建议使用足够长的随机值，例如 `openssl rand -base64 32`
- `RESEND_API_KEY`：Resend 创建的 API Key
- `MAIL_FROM`：使用已验证域名的发件人
- `NCBI_CONTACT_EMAIL`：程序维护者联系邮箱
- `NCBI_API_KEY`：提高 NCBI API 频率配额时使用；本项目默认每小时检查一次，通常不是必需

## 部署

不需要手动创建 Durable Object 或 KV namespace。配置已经在 `wrangler.jsonc` 中声明。

```bash
npm run check
npm run deploy
```

部署后：

1. 打开 Wrangler 输出的 `workers.dev` 地址
2. 输入 `ADMIN_TOKEN`
3. 保存 PubMed 检索式、收件邮箱和启用状态
4. 点击“立即检查”建立基线
5. 点击“发送测试邮件”验证 Resend

## 从 1.x KV 版本升级

⚠️ **存储架构已从 Workers KV 改为 Durable Object。**

旧 KV 中的数据不会自动复制到新存储。升级步骤：

1. 记录旧网页中的关键词、收件邮箱和启用状态
2. 部署 2.x
3. 在新网页中重新保存配置
4. 点击“立即检查”建立新基线
5. 确认测试邮件和定时检查正常后，再决定是否删除旧 KV namespace

重新建基线会把当前检索结果视为“已有”，因此不会补发历史论文。这是为了避免升级时一次性发送大量旧记录。

## GitHub Actions 自动部署

工作流位于 `.github/workflows/deploy.yml`：

- Pull Request：类型检查和测试
- 推送到 `main`：检查通过后部署
- 手动运行：检查通过后部署

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中添加：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Cloudflare Token 只授予部署该 Worker 所需的最小权限。运行时的 `ADMIN_TOKEN`、`RESEND_API_KEY` 等仍保存在 Cloudflare Worker Secrets 中，不要写入仓库。

工作流中的第三方 Actions 固定到完整提交 SHA，并关闭 checkout 凭据持久化。

## 修改检查频率

`wrangler.jsonc` 默认：

```jsonc
"triggers": {
  "crons": ["0 * * * *"]
}
```

表示每小时第 0 分钟执行。Cloudflare Cron 使用 UTC。

示例：

- 每 6 小时：`0 */6 * * *`
- 每天 08:00 UTC：`0 8 * * *`

修改后重新部署。

## 检索参数

`wrangler.jsonc` 中的默认值：

```jsonc
"vars": {
  "SEARCH_WINDOW_DAYS": "7",
  "SEARCH_OVERLAP_DAYS": "2",
  "MAX_CATCHUP_DAYS": "365",
  "MAX_RESULTS": "1000",
  "REQUEST_TIMEOUT_MS": "15000"
}
```

- `SEARCH_WINDOW_DAYS`：首次建基线时回看天数，范围 1–30
- `SEARCH_OVERLAP_DAYS`：后续检查从上次成功时间向前重叠，范围 0–7；默认 2 天用于覆盖 PubMed 日期精度和边界延迟
- `MAX_CATCHUP_DAYS`：停机后允许自动追赶的最长时间，范围 30–3650；超过后暂停并要求人工决定
- `MAX_RESULTS`：一次 ESearch 允许的最大结果数，范围 1–10000
- `REQUEST_TIMEOUT_MS`：NCBI 和 Resend 单次请求超时，范围 2000–60000 毫秒

当检索结果数大于 `MAX_RESULTS` 时，程序不会使用被截断的 PMID 列表，也不会推进成功检查时间。请缩小检索式或提高上限。

示例检索式：

```text
("spatial transcriptomics"[Title/Abstract]) AND cancer[Title/Abstract]
```

## 页面说明

打开页面先显示**登录界面**，输入管理员口令（`ADMIN_TOKEN`）后点击"登录"（或按回车）进入设置页。口令正确后自动读取状态；口令错误会在登录界面显示提示。

- **保存配置**：保存检索式、邮箱和启用状态；更换检索式会自动清空旧基线
- **读取状态**：读取上次检查、错误和待发送状态
- **立即检查**：手动执行与 Cron 相同的检查
- **发送测试邮件**：不查询 PubMed，仅验证发信配置
- **重建基线**：清空已见 PMID；下一次检查只建立基线
- **退出登录**：从 `sessionStorage` 和 `localStorage` 清除管理员口令并返回登录界面

## 安全说明

- 管理页面地址可以公开访问，但 `/api/*` 必须通过 Bearer Token 鉴权
- 未设置 `ADMIN_TOKEN` 时所有管理 API 拒绝访问
- 默认只在当前浏览器会话保存 Token；“长期记住”会写入 `localStorage`
- 页面使用严格 CSP nonce，不使用动态 `innerHTML` 渲染服务端状态
- API 响应不缓存，并设置 `nosniff`、`no-referrer`、`noindex`
- 外部请求禁止自动跟随重定向，避免把 Authorization Header 转发到意外目标
- 不要把 `.dev.vars`、Cloudflare Token、Resend Key、管理员口令或 NCBI Key 提交到 GitHub

这是单用户工具，没有账户系统。若需要多人使用、审计日志或企业身份认证，建议在 Worker 前增加 Cloudflare Access，而不是共享管理员口令。

## 邮件可靠性说明

发现新记录时，程序先保存 `pendingNotification`，再调用 Resend。发送失败后，下次检查优先重试同一批 PMID，并复用同一幂等键。

仍存在一个不可完全消除的边界：如果 Resend 已接受邮件、但 Worker 没收到成功响应，并且重试发生在 Resend 幂等窗口之外，可能重复发送。状态页会显示待重试批次，便于人工检查。

## 常见问题

### 提示"管理员口令不正确"

确认 `ADMIN_TOKEN` 已设置，且网页中输入的值与之一致。未设置 `ADMIN_TOKEN` 时所有管理 API 都会拒绝访问：

```bash
npx --yes wrangler@4.117.0 secret put ADMIN_TOKEN
```

### Resend 返回 403 或域名错误

确认：

- `MAIL_FROM` 域名已在 Resend 验证
- API Key 属于正确的 Resend 账户
- 发件地址格式正确

### 检查提示结果超过 `MAX_RESULTS`

程序为避免漏报而主动停止。优先缩小检索式；确有需要时提高 `MAX_RESULTS`，最高 10000。

### 很久未运行后要求重建基线

停机时间超过 `MAX_CATCHUP_DAYS` 后，程序不会猜测是否应补发大量历史记录。可以提高追赶天数后再检查，或在确认不需要补发后点击“重建基线”。

### 更换关键词后为什么没有立刻发送

更换检索式后的第一次检查只建立新基线，避免把已有结果当作新论文。

## 文件结构

```text
.
├── .github/
│   ├── dependabot.yml
│   ├── SECURITY.md
│   └── workflows/deploy.yml
├── src/
│   ├── alert-engine.ts
│   ├── coordinator.ts
│   ├── email-template.ts
│   ├── errors.ts
│   ├── globals.d.ts
│   ├── http.ts
│   ├── index.ts
│   ├── mailer.ts
│   ├── pubmed.ts
│   ├── types.ts
│   ├── ui.ts
│   └── utils.ts
├── tests/core.test.mjs
├── .dev.vars.example
├── package-lock.json
├── package.json
├── tsconfig.json
├── tsconfig.test.json
└── wrangler.jsonc
```

## 运行检查

```bash
npm ci
npm run typecheck
npm test
npm run check
```

## 回滚

### Git 回滚

在 GitHub 中找到升级前提交，然后：

```bash
git revert <升级提交哈希>
git push origin main
```

### 使用旧项目重新部署

交付包包含原始项目备份和校验值。恢复 1.x 时需要：

1. 恢复旧项目文件
2. 在旧 `wrangler.jsonc` 中填回原 KV namespace ID
3. 确认旧 KV namespace 仍存在
4. 运行旧版部署命令

### Cloudflare 版本回滚

也可以在 Cloudflare Dashboard 的 Worker 部署记录中回滚到上一版本。回滚后仍应验证绑定、Cron 和 Secrets 是否与旧版本匹配。

## 参考资料

- Cloudflare Durable Objects：https://developers.cloudflare.com/durable-objects/
- Cloudflare Durable Object configuration：https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
- Cloudflare Cron Triggers：https://developers.cloudflare.com/workers/configuration/cron-triggers/
- NCBI E-utilities：https://www.ncbi.nlm.nih.gov/books/NBK25501/
- NCBI ESearch：https://www.ncbi.nlm.nih.gov/books/NBK25499/#chapter4.ESearch
- Resend Cloudflare Workers：https://resend.com/docs/send-with-cloudflare-workers
- Resend Idempotency：https://resend.com/docs/dashboard/emails/idempotency-keys
- GitHub Actions secure use：https://docs.github.com/actions/security-guides/security-hardening-for-github-actions

## License

MIT
