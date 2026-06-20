# Netlify Production 自动开启飞书写入设计

## 目标

当 GitHub `main` 分支触发 Netlify Production Deploy 时，自动设置 `LARK_WRITE_ENABLED=true`，使线上业务表单和库存流程能够写入飞书。Deploy Preview、branch deploy 与本地环境继续保持默认只读。

## 现状与根因

`src/lib/lark-server.ts` 的写操作统一经过 `assertLarkWriteEnabled()`。该保护函数只有在 `LARK_WRITE_ENABLED` 精确等于 `true` 时才放行，否则抛出“飞书写入已关闭”。当前 `netlify.toml` 没有给 Production context 设置该变量，因此 `main` 发布到 Netlify 后会落到只读状态。

## 方案

在 `netlify.toml` 中新增 Production context 环境变量：

```toml
[context.production.environment]
  LARK_WRITE_ENABLED = "true"
```

不在全局 `[build.environment]`、Deploy Preview 或 branch deploy context 中开启该变量。这样只有 Netlify Production Deploy 自动获得写权限。

保留 `assertLarkWriteEnabled()` 当前的 fail-closed 行为，不在应用代码中根据 `NETLIFY` 或分支名绕过保护。环境边界继续由部署配置表达，业务写操作仍只依赖统一开关。

## 数据流

1. GitHub `main` 更新触发 Netlify Production Deploy。
2. Netlify 读取 production context，将 `LARK_WRITE_ENABLED=true` 注入构建和运行环境。
3. 线上 API 路由调用飞书写操作。
4. `assertLarkWriteEnabled()` 读取到 `true` 后放行。
5. Deploy Preview、branch deploy 与本地环境没有该 production 覆盖，写操作继续被拒绝。

## 安全与异常处理

- 不在仓库中保存飞书 Token、App Secret、表 ID 或其他敏感值。
- Preview 与非生产分支保持只读，避免测试数据写入正式飞书表格。
- 飞书凭据缺失或 OpenAPI 调用失败时，沿用现有错误处理，不因开启写入而吞掉配置或权限错误。
- 若需紧急关闭生产写入，应修改 production context 配置并重新部署；不改变应用内统一写入保护。

## 测试与验证

- 增加发布安全回归测试，解析或检查 `netlify.toml`，确认 Production context 明确设置 `LARK_WRITE_ENABLED=true`。
- 同一测试确认全局 build environment 没有开启该变量，避免 Preview 和 branch deploy 意外继承写权限。
- 运行相关测试、完整 `npm test`、`npm run release:check` 与 `npm run lint`。
- 同步 README 和 `docs/deployment-reform.md`，明确 `main → Production` 自动可写、其他部署只读。

## 不在本次范围

- 不修改飞书凭据或表格权限。
- 不直接触发 Netlify 部署。
- 不允许 Deploy Preview 或 branch deploy 写入飞书。
- 不改动现有飞书读写 API、业务字段映射或库存流程。
