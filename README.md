# 烁立德 eBay 运营中心

内部使用的 eBay 运营 WebApp。系统读取飞书多维表格作为业务数据源，并通过 DeepSeek 提供库存补货、详情页、售后回复和选品分析能力。

## 功能

- 运营仪表盘与分店铺看板
- 库存监控与 AI 补货建议
- eBay 详情页生成与批量保存
- 售后待办读取、AI 回复草稿与回写
- 选品分析与结果沉淀
- 飞书多维表格在线录入
- JWT 登录与账号管理

## 本地启动

1. 安装依赖：

```bash
npm install
```

2. 复制 `.env.example` 为 `.env.local`，填写本地环境配置。

3. 启动开发环境：

```bash
npm run dev
```

4. 打开 [http://localhost:3000](http://localhost:3000)。

## 数据安全

- 飞书写入在本地、Deploy Preview 和 branch deploy 中默认关闭；GitHub `main` 触发的 Netlify Production Deploy 通过 production context 自动设置 `LARK_WRITE_ENABLED=true`。
- 飞书 Token、表 ID、CLI 路径和 JWT 密钥均通过环境变量注入，不应提交到仓库。
- `data/users.json` 是本地账号持久化文件。后续部署前应迁移到正式账号存储，并使用专用密码哈希算法。
- 如果历史提交中曾出现飞书 Token，应在飞书侧轮换 Token。
- 选品助手已接入 Tavily 实时网页检索。未配置 `TAVILY_API_KEY` 时，只会提示“需要联网数据”，不会生成未经核验的市场份额、近 3 个月销量或政策结论。

## 环境变量

完整配置见 `.env.example`。关键变量：

| 变量 | 用途 |
| --- | --- |
| `JWT_SECRET` | JWT 签名密钥，至少 32 位 |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `DEEPSEEK_MODEL` | DeepSeek 模型 ID，默认 `deepseek-v4-pro` |
| `TAVILY_API_KEY` | Tavily Search API Key，仅选品助手实时网页检索使用 |
| `LARK_BASE_TOKEN` | 飞书多维表格 Token |
| `LARK_CLI_PATH` | `lark-cli` 可执行文件路径，默认从 `PATH` 查找 |
| `LARK_WRITE_ENABLED` | 是否允许写入飞书；本地和预览默认 `false`，Netlify Production 自动为 `true` |
| `LARK_MAX_READ_RECORDS` | 单次接口最多读取的记录数，默认 `5000` |
| `LARK_TABLE_STOCK_STRATEGY` | `18_SKU库存策略` 表 ID |
| `LARK_TABLE_SKU_SUMMARY` | `19_SKU运营汇总` 表 ID，库存与补货看板读取该表 |

## 验证

```bash
npm run release:check
npm run lint
npm run build
```

## 发布策略

生产发布改为由 GitHub `main` 触发 Netlify 自动部署，`develop` 只用于日常开发和验证。发布前先运行 `npm run release:check`，确认本地用户数据、飞书密钥和 Netlify 上传脚本没有进入 Git。详细流程见 `docs/deployment-reform.md`。
