# Netlify 账号迁移与生产飞书写入设计

## 目标

将 GitHub `main` 的当前生产版本迁移到 Netlify 团队 `Solid`（slug: `axin0825`）下的新站点 `ebay-ops-webapp-main`，保持现有账号、密码哈希、角色和会话版本不变，并确保生产环境能够读取和写入飞书多维表格。

## 约束

- 用户资料和密码不得重新生成、重置或提交到 Git。
- `.env.local`、`data/users.json` 和 `.netlify/` 不得进入版本控制。
- 新站点的环境变量必须在首次生产部署前配置完成。
- 迁移只触发一次新站点生产部署。
- 飞书验证不得创建、修改或删除业务记录。

## 架构

### 用户迁移

新增 `AUTH_USERS_JSON` 环境变量作为空站点的一次性用户种子。变量保存与本地 `data/users.json` 相同的用户对象，包括密码哈希、角色、创建日期、会话版本和删除状态。

`seedUsers()` 继续以站点级 Netlify Blobs 的 `users` store 为生产存储：

1. Blobs 已存在用户时直接返回，不读取或覆盖种子。
2. Blobs 为空时优先解析并校验 `AUTH_USERS_JSON`。
3. 校验通过后将记录原样写入 Blobs，不重新计算密码哈希。
4. 未配置 JSON 种子时保留现有 `AUTH_USERS` 明文初始化兼容路径。

JSON 种子必须是用户数组；每条记录至少包含非空 `name`、64 位十六进制 SHA-256 `password` 和有效 `createdAt`。角色、会话版本和删除状态沿用现有业务校验。

### 飞书生产写入

将本地提交 `26634c3` 合入 `main`。写入判定遵循：

1. `LARK_WRITE_ENABLED` 有显式值时严格按 `true` 或非 `true` 判断。
2. 显式值缺失时，仅 Netlify 内置 `CONTEXT=production` 放行。
3. 本地、Deploy Preview、branch deploy 和显式 `false` 继续只读。

这保留 fail-closed 保护，同时避免 Next.js Server Handler 无法读取自定义运行时变量时误判生产为只读。

### Netlify 配置

在新团队创建 `ebay-ops-webapp-main`。从 `.env.local` 迁移所有非空生产变量，并新增 `AUTH_USERS_JSON`；排除本机路径变量 `LARK_CLI_PATH` 和 `LARK_EXTRA_PATH`。`LARK_WRITE_ENABLED` 在 production 中设为 `true`，飞书调用使用 `LARK_APP_ID`、`LARK_APP_SECRET`、Base token 和各表 ID。

敏感变量只写入 Netlify 环境配置，不输出到日志、回复或 Git 历史。

## 数据流

首次无效登录探测会调用 `verifyUser()`，继而触发 `seedUsers()`。新 Blobs 为空时，哈希用户种子被原样写入；探测使用故意错误的密码，因此不会建立登录会话。后续正常登录直接读取 Blobs。

飞书读请求通过 OpenAPI 凭据和表映射访问 Base。写请求先经过 `assertLarkWriteEnabled()`，再经过业务认证；生产安全探测使用错误的计划任务凭据，应在认证阶段返回 401，且不会触发飞书写入。

## 错误处理

- `AUTH_USERS_JSON` 无效时初始化失败，不回退到生成不同密码的用户。
- 用户种子为空或存在重复用户名时拒绝写入 Blobs。
- Netlify 环境变量配置不完整时不部署。
- 构建或部署失败时不重复提交部署指令，先读取失败原因。
- 线上写入探测仍返回“飞书写入已关闭”时，不执行任何真实业务写入。

## 测试与验收

- 单元测试覆盖 JSON 种子原样导入、已有 Blobs 不覆盖、无效种子拒绝、原 `AUTH_USERS` 兼容路径。
- 必跑 `npm test`、`npm run lint`、`npm run release:check`、`npm run build`。
- 发布前确认 Git 仅包含预期代码和规格，敏感文件未被跟踪。
- Netlify Deploy 必须为 `ready`，Next.js 插件成功，密钥扫描零命中。
- 无效登录触发一次 Blobs 初始化但不创建会话。
- 飞书直接验证覆盖读取和空批次写授权，创建记录数必须为 0。
- 应用写入守卫探测必须返回认证错误，而不是“飞书写入已关闭”。

## 发布顺序

1. 实现并验证用户 JSON 种子。
2. 将飞书 production fallback 与用户迁移代码合入本地 `main`。
3. 创建新 Netlify 站点。
4. 配置生产环境变量与用户哈希种子。
5. 只执行一次生产部署。
6. 完成用户初始化、飞书读写和应用守卫验收。
