# Netlify Git 发布改革运行手册

目标：以后由 GitHub `main` 触发 Netlify 生产部署，`develop` 用于日常开发和本地验证，避免 Codex 或本地 CLI 反复上传 Production Deploy 消耗 credits。

## 当前策略

- 继续使用现有 Netlify 项目：`ebay-ops-webapp-v1`
- 生产发布来源：GitHub `DexterHua/ebay-ops-webapp` 的 `main` 分支
- 日常开发分支：`develop`
- Codex 默认职责：改代码、跑测试、提交/推送 Git，不直接调用 Netlify Production Deploy
- Netlify Blobs 用户数据保留在现有 site，不新建 site，不用新 site 替换生产站点

## 禁止事项

- 不运行 `netlify deploy --prod` 作为常规发布方式
- 不把 `.env.local`、`.env`、`data/users.json`、`.netlify/state.json` 提交到 Git
- 不把飞书 Base Token、表 ID、JWT 密钥、用户密码或 `AUTH_USERS` 实值写入 `.env.example`
- 不在 Deploy Preview 或 branch deploy 中开启飞书写入
- 不新建 Netlify site 来承接当前生产流量，除非已经完成用户数据迁移方案

## Netlify UI 设置

这些步骤必须在 Netlify UI 中由有权限的账号确认，执行前先不要触发部署。

1. 打开 `ebay-ops-webapp-v1` 项目。
2. 连接 GitHub 仓库 `DexterHua/ebay-ops-webapp`。
3. 将 Production branch 设置为 `main`。
4. Build command 保持 `npm run build`。
5. Publish directory 保持 `.next`。
6. Node version 保持 `20`。
7. 插件保持 `@netlify/plugin-nextjs`。
8. Branch deploys 只保留明确需要的分支；如果不需要预览，关闭 “all branches”。
9. Deploy Previews/branch deploy 不设置 `LARK_WRITE_ENABLED=true`，保持只读。
10. Production context 由仓库 `netlify.toml` 自动设置 `LARK_WRITE_ENABLED=true`；Netlify UI 不要用同名变量覆盖该值。

## 生产环境变量

除下文明确由仓库 `netlify.toml` 的 Production context 注入的 `LARK_WRITE_ENABLED` 外，以下生产值只配置在 Netlify 环境变量中，不提交到 Git。

### 登录与账号

- `JWT_SECRET`：至少 32 位，用于签发登录 Cookie
- `AUTH_USERS`：仅用于首次 seed 用户；如果 Netlify Blobs 已有用户，可保持不变或按需留空

用户账号在 Netlify 环境中优先存储到 Netlify Blobs。保持同一个 Netlify site 可以保留已有用户数据；新建 site 会得到新的 Blobs 空间。

### 飞书 OpenAPI

生产环境优先使用 OpenAPI，避免依赖 Netlify Functions 中存在本机 `lark-cli`。

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `LARK_BASE_TOKEN`
- `LARK_BASE_FINANCE`
- `LARK_USER_OPEN_IDS`：可选的登录姓名到飞书 `open_id` 的 JSON 映射；缺失或格式无效时，SKU 仍会保存，负责人保持空白，成功响应会返回 `warning`，页面会显示相应提示。仓库只保留空映射占位，生产实值仅配置在 Netlify 环境变量中
- `LARK_TABLE_SKU`
- `LARK_TABLE_SALES`
- `LARK_TABLE_STOCK_FLOW`
- `LARK_TABLE_ISSUES`
- `LARK_TABLE_COMPETITORS`
- `LARK_TABLE_REPLENISH`
- `LARK_TABLE_LISTING`
- `LARK_TABLE_SOURCING`
- `LARK_TABLE_FLOW`
- `LARK_TABLE_STOCK_STRATEGY`
- `LARK_TABLE_SKU_SUMMARY`
- `LARK_TABLE_PURCHASE_BATCH`
- `LARK_TABLE_SHIPMENT_BATCH`
- `LARK_TABLE_INVENTORY_DETAIL`
- `LARK_TABLE_INVENTORY_EXCEPTION`
- `LARK_TABLE_INVENTORY_TRANSACTION`
- `LARK_TABLE_INVENTORY_WARNING`
- `LARK_TABLE_FINANCE`

### 飞书写入与自动扫描

- `LARK_WRITE_ENABLED=false`：本地 Next.js 开发、preview、branch deploy 的默认只读状态
- `LARK_WRITE_ENABLED=true`：由 `netlify.toml` 的 Production context 自动注入，不需要每次发布手动开启

Cloudflare/Wrangler 使用独立配置，不属于本 Netlify 发布流程。

- `INVENTORY_SALES_SCAN_SECRET`：计划任务调用 `/api/inventory/sales-scan` 的 Bearer secret
- `LARK_INVENTORY_ALERT_CHAT_ID`：库存扫描通知群，可为空

## 本地发布前检查

每次准备从 `develop` 合并到 `main` 前运行：

```bash
npm run release:check
npm test
npm run lint
```

`release:check` 只读取本地文件和 Git 跟踪列表，不会调用 Netlify API、不会 build、不会 deploy。

它会阻断：

- `.env`、`.env.local`、`data/users.json`、`.netlify/state.json` 被 Git 跟踪
- `.env.example` 中缺少必要空模板
- `.env.example` 中出现敏感实值
- `package.json` 脚本直接调用 `netlify deploy`

它会警告：

- 当前分支是 `develop`，说明还不应触发生产发布
- 如设置了 `EXPECTED_NETLIFY_SITE_ID`，本地 `.netlify/state.json` 指向旧 siteId 时会提示 relink

## 推荐发布流程

```bash
git checkout develop
npm run release:check
npm test
npm run lint

git checkout main
git merge develop
npm run release:check
npm test
npm run lint
git push origin main
```

推送 `main` 后，由 Netlify 自动创建一次 Production Deploy。

## 本地 Netlify CLI

当前项目不依赖本地 Netlify CLI 发布。只有在确实需要用 CLI 读取状态或管理环境变量时，才执行 relink。

```bash
netlify unlink
netlify link
```

选择现有项目 `ebay-ops-webapp-v1`。不要创建新项目。

如需让 `release:check` 校验本地 `.netlify/state.json` 是否指向正确项目，可只在本机临时传入真实 siteId：

```bash
EXPECTED_NETLIFY_SITE_ID=真实_site_id npm run release:check
```

不要把真实 siteId 写入仓库文件。
