# PubMed 关键词邮件提醒 — AI 代理工作指南

本文件供 AI 编码代理（Claude Code、Codex、Cursor 等）使用。修改代码前请先阅读本文件。

## 项目概览

面向**单用户**的 PubMed 关键词邮件提醒工具。用户通过网页保存检索式和收件邮箱，Cloudflare Cron 每小时触发检查；发现新 PMID 时经 Resend 发送汇总邮件。

核心工作流：Cron 触发 `scheduled`（`src/index.ts`）→ `AlertCoordinator`（Durable Object 单例，`runExclusive` 串行化）→ `AlertEngine`（`src/alert-engine.ts`）→ `NcbiPubMedGateway`（ESearch 按 Entry Date 窗口）→ `ResendMailGateway`。

关键语义（改动时保持）：

- 首次检查只建立基线，不发送已有论文；更换检索式自动清空基线
- 邮件发送前先持久化 `pendingNotification`，失败重试复用同一幂等键；连续 5 次发送失败自动作废批次
- 结果超过 `MAX_RESULTS` 时明确暂停，避免 `retmax` 截断导致静默漏报

## 技术栈与运行架构

- TypeScript 严格模式（`strict`、`noUncheckedIndexedAccess`），**零 npm 运行时依赖**
- Cloudflare Workers + Durable Object（SQLite storage），无 Web 框架，手写 `fetch` 路由（`ALLOWED_API_ROUTES` 白名单）
- 外部服务：NCBI E-utilities（ESearch/ESummary）、Resend API（支持幂等键）
- 依赖通过 `npx --yes` 按固定版本下载：`wrangler@4.117.0`、`typescript@5.8.3`（锁定在 package.json scripts 中）

## 仓库结构

| 文件 | 作用 |
| --- | --- |
| `src/index.ts` | Worker 入口：fetch 路由（页面、/health、/api/* 代理到 DO）+ scheduled（Cron）；导出 `AlertCoordinator` |
| `src/coordinator.ts` | DO 协调：状态/config 持久化（键 `alert:data:v2`）、`runExclusive` 串行、saveConfig/rebaseline/test-email |
| `src/alert-engine.ts` | 核心业务：check/retryPending/deliverPending、基线建立、幂等键（SHA-256 指纹）、失败作废 |
| `src/pubmed.ts` | NCBI 网关：ESearch（edat 窗口）、ESummary（200/批）、429 特化提示 |
| `src/mailer.ts` | Resend 网关：POST /emails、幂等键头 |
| `src/email-template.ts` | HTML + 纯文本双版本邮件模板，`escapeHtml` 转义 |
| `src/http.ts` | `json()`（安全响应头）、`readJsonObject`（413/415 限制）、`fetchWithRetry`（重试与退避） |
| `src/errors.ts` | `AppError`（status + expose 字段） |
| `src/types.ts` | 全部接口：Env、AlertConfig、AlertState、网关接口（便于测试注入） |
| `src/ui.ts` | 整页 HTML（登录 + 设置视图），内联 CSS/JS，CSP nonce |
| `src/utils.ts` | `clampNumber`、`escapeHtml`、`constantTimeEqual`、`isAuthorized`、`findNewPmids` 等 |
| `src/globals.d.ts` | 手写 cloudflare:workers DO 类型声明 |
| `tests/core.test.mjs` | 回归测试（17 个用例），从 `.test-dist/` 导入编译产物 |
| `wrangler.jsonc` | Worker 配置（Cron、DO 绑定、vars） |

## 运行与构建

```bash
npm run dev        # 本地开发（--test-scheduled 支持手动触发 Cron）
npm run check      # typecheck + 测试，部署前必须通过
npm run deploy     # 部署
```

本地开发：先 `cp .dev.vars.example .dev.vars` 填真实密钥；`npm run dev` 后手动触发检查可用 `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+*+*+*+*"`。

## 测试

- Node 内置 `node:test`；`npm test` 先编译 `src/*.ts` 到 `.test-dist/` 再运行
- 覆盖：配置校验、鉴权、搜索窗口计算、去重、邮件模板转义、首次建基线、幂等键复用、5 次失败作废、ESearch 参数断言、429 重试
- 测试用 `MemoryStore` + fake 网关/时钟注入，不发真实网络请求

## 部署

- `wrangler.jsonc`：Cron `0 * * * *`（UTC）、DO binding `ALERT_COORDINATOR`（storage sqlite）、vars 全部经 `clampNumber` 回退
- Secrets（`wrangler secret put`，不写仓库）：`ADMIN_TOKEN`（必填）、`RESEND_API_KEY`、`MAIL_FROM`（须已验证域名）、`NCBI_CONTACT_EMAIL`、可选 `NCBI_API_KEY`
- Cloudflare Workers Builds 连接 GitHub：push main 自动部署，构建命令 `npm run check`，失败则不部署

## 安全与数据注意事项

- 未设置 `ADMIN_TOKEN` 时所有管理 API 一律拒绝；校验用常量时间比较
- 前端默认仅 `sessionStorage` 存 token；勾选"长期记住"才写 `localStorage`
- 页面 CSP nonce + HSTS + `frame-ancestors 'none'`；无动态 `innerHTML`
- 外部请求：仅重试 429/5xx、`redirect: "manual"`、AbortController 超时；请求体上限 4096 字节
- 单用户工具，无账户系统；邮件只含题录摘要

## 代码组织与风格约定

- 模块按职责单文件：入口 / DO 协调 / 业务引擎 / 外部网关（实现 `PubMedGateway`/`MailGateway` 接口）/ 模板 / 基础设施 / 纯类型
- 依赖注入：`AlertEngine` 构造注入 store/pubmed/mailer/时钟，测试用内存 mock
- 业务错误统一抛 `AppError(message, status, expose)`，`expose=false` 时对外返回"服务暂时不可用"
- 所有 env vars 经 `clampNumber(raw, fallback, min, max)` 取值，越界回退默认值
- 存储记录带 `version` 字段；旧 KV 版本需人工迁移（README「从旧 KV 版本升级」节）
- 代码注释与用户可见消息全部为中文

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（包括未来的你自己）都必须遵守：**
>
> - 修改存储架构或检索语义（edat 窗口、MAX_RESULTS 暂停、幂等作废）前先读本文件与 README 相关章节
> - 新增 DO 内部接口必须经 `runExclusive` 串行化，并补充对应测试
> - 部署前必须通过 `npm run check`
