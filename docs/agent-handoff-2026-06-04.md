# Agent Handoff - eBay Ops Webapp

Date: 2026-06-04
Workspace: `/Users/chequan/Documents/SolidSrUn/ebay-ops-webapp`

---

## 1. 项目概述

**烁立德（Solid）运营中心** — 面向跨境汽摩配业务的内部运营 Web 应用。连接库存、商品、客服与运营流程，数据存储在飞书多维表格中。

## 2. 项目当前进度

### 2.1 已实现功能模块

| 模块 | 路由 | 状态 | 说明 |
|------|------|------|------|
| 运营仪表盘 | `/dashboard` | ✅ 完成 | 图表化数据看板，库存/销售/售后总览，含国内集货仓展示 |
| 库存监控 | `/inventory` | ✅ 完成 | 实时库存监控与智能补货建议（来自此前版本） |
| **库存流转** | `/inventory-flow` | ✅ 主体完成 | 采购批次创建、7段状态推进、物流批次绑定、留置库存 |
| 详情页生成 | `/listing` | ✅ 完成 | AI 生成 eBay 标题/描述/ItemSpecs |
| 评论回复 | `/reviews` | ✅ 完成 | AI 生成评价回复草稿 |
| 数据录入 | `/data-entry` | ✅ 完成 | 飞书多维表格在线录入 |
| **财务报销** | `/finance` | ✅ 完成 | 报销申请提交与审批，接入「烁立德财务表格」 |
| 账号管理 | `/accounts` | ✅ 完成 | 管理员管理登录账号 |
| 登录 | `/login` | ✅ 完成 | 本地账号登录 |

已删除模块：`选品助手`（原 `/sourcing`），相关代码已清理。

### 2.2 库存流转模块详情（本次会话主要工作）

**7 段状态机**：`本地仓待清点` → `待包装` → `已发往国内集货仓` → `国内集货仓待发` → `橙联在途` → `海外仓待上架` → `橙联可售`

已完成的核心能力：
- 采购批次创建（`purchase-batches-tab.tsx`）— 批量录入多个 SKU 和数量，支持已有 SKU 查找
- 批次流转（`flow-details-tab.tsx`）— 筛选明细、多选、独立修改每条明细的推进数量，**留置库存**标记和筛选
- 头程物流（`shipments-tab.tsx`）— 物流批次创建+明细绑定，支持部分数量绑定拆分，可选自动推进至橙联在途
- 过渡对话框（`transition-dialog.tsx`）— 每条明细可独立设置推进数量，显示留置汇总
- 库存异常 Tab — 仍是占位组件

**留置库存机制**：明细拆分后，源明细保留原始数量不变（`原始数量 > 当前数量 = 留置`），前端显示橙色「留置」徽章和筛选按钮。

### 2.3 飞书多维表格状态

主 Base Token: `RveVbcouwa06KcsDXcIc45AInkg`（26 张表）

库存流转新增的 4 张表（已建好并配置权限）：

| 表名 | Table ID | 用途 |
|------|----------|------|
| `20_采购批次` | `tblHg1ichWAZ0knp` | 采购批次号、采购员、下单日期、批次状态 |
| `21_头程物流批次` | `tblLJLZ8YpnaYrXK` | 物流批次号、承运商、跟踪号、发货日期、批次状态 |
| `22_SKU批次库存明细` | `tblClttEzRKLUyhy` | 明细编号、SKU、数量、状态、版本号等 15 个字段 |
| `23_库存异常` | `tblaVoJ8bWHOw6DJ` | 异常编号、异常类型、差异数量等 13 个字段 |

`02_库存流水` 已补全新字段（流转事务号、来源明细编号、前/后状态、操作类型等 8 个）。
`19_SKU运营汇总` 已补全 `国内集货仓`、`异常暂存`、`账面总量` 字段。

财务 Base: `烁立德财务表格` (`QrvablHAgabBb5siESEcoAyhnOc`)，单表 `数据表` (`tblxIPxyLNGOyPsz`)，已新增 `报销类型` 和 `审批状态` 字段。

## 3. 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 16.2.6 (App Router, Turbopack) |
| 语言 | TypeScript 5 |
| UI | React 19.2.4 + Tailwind CSS 4 + shadcn/ui |
| 图表 | Recharts 3.8 |
| 测试 | Vitest 4.1.8（纯逻辑测试，无浏览器测试） |
| Lint | ESLint 9 + eslint-config-next |
| 数据存储 | 飞书多维表格（Lark Base）— 通过 lark-cli 操作，支持 OpenAPI 直连 |
| AI | DeepSeek v4-pro（通过服务端 `/api/ai` 代理） |
| 认证 | 自建 JWT session（`auth_token` cookie），支持 admin/purchaser/operator 角色 |
| 部署 | OpenNext + Cloudflare Workers（已配置） |

## 4. 关键文件清单

### 4.1 库存流转核心代码

```
src/lib/inventory-flow.ts          # 7段状态机、状态验证、拆分推进、汇总计算（纯函数，测试完善）
src/lib/inventory-flow.test.ts     # 状态机单元测试
src/lib/inventory-batch-server.ts  # 采购入库、状态推进、物流绑定服务层（事务/幂等）
src/lib/inventory-batch-server.test.ts  # 服务层测试（含 MemoryInventoryRepo）
src/lib/inventory-flow-api.ts      # 请求解析与校验（purchase/transition/shipment）
src/lib/inventory-flow-api.test.ts # API 解析测试
src/lib/inventory-lark-repository.ts   # Lark 仓库适配器（含 in-memory transaction store）
```

### 4.2 库存流转前端

```
src/app/(main)/inventory-flow/page.tsx               # 库存流转页面（4 Tab 容器）
src/components/inventory-flow/purchase-batches-tab.tsx  # 「采购批次」Tab
src/components/inventory-flow/flow-details-tab.tsx      # 「批次流转」Tab（留置库存标记）
src/components/inventory-flow/transition-dialog.tsx     # 推进确认弹窗（逐行数量编辑）
src/components/inventory-flow/shipments-tab.tsx         # 「头程物流」Tab
src/components/inventory-flow/exceptions-tab.tsx        # 「库存异常」Tab（占位）
src/components/inventory-flow/types.ts                  # 前端类型定义
```

### 4.3 库存流转 API 路由

```
src/app/(main)/api/inventory-flow/data/route.ts              # GET ?resource=details|purchases|shipments|exceptions
src/app/(main)/api/inventory-flow/purchase-batches/route.ts  # POST 创建采购批次
src/app/(main)/api/inventory-flow/transitions/route.ts       # POST 状态推进
src/app/(main)/api/inventory-flow/shipments/route.ts         # POST 物流批次创建+绑定
```

### 4.4 财务报销

```
src/app/(main)/api/finance/route.ts   # GET 列表 / POST 提交报销 / PUT 审批
src/app/(main)/finance/page.tsx       # 报销页面（列表+新增对话框+审批按钮）
```

### 4.5 仪表盘

```
src/app/(main)/dashboard/page.tsx     # 运营仪表盘（含国内集货仓图表）
src/app/(main)/page.tsx               # 欢迎页（首页概览卡片）
```

### 4.6 全局基础设施

```
src/lib/lark-server.ts           # 飞书多维表格读写、多Base支持、OpenAPI/CLI双通道
src/lib/session-server.ts        # JWT session 管理
src/lib/ai.ts                    # DeepSeek AI 调用封装
src/types/index.ts               # MODULES 导航定义、Store/Sku 等全局类型
src/components/layout/sidebar.tsx    # 侧边栏导航
src/components/layout/module-icons.tsx  # 模块图标映射
src/components/ui/               # shadcn/ui 组件（checkbox/button/card/dialog/input/tabs等）
```

### 4.7 环境变量（.env.local）

```
JWT_SECRET=...                   # JWT 签名密钥
DEEPSEEK_API_KEY=sk-...          # DeepSeek API Key
LARK_BASE_TOKEN=RveVb...         # 主运营 Base
LARK_BASE_FINANCE=Qrvab...       # 财务 Base
LARK_WRITE_ENABLED=true          # 生产环境需设为 false
LARK_TABLE_SKU/PURCHASE_BATCH/INVENTORY_DETAIL/...  # 各表 ID
LARK_TABLE_FINANCE=tblxIPxyLNGOyPsz
LARK_CLI_PATH=...                # lark-cli 路径
```

## 5. 待完成事项

### 5.1 高优先级

- [ ] **库存异常 Tab** (`exceptions-tab.tsx`) — 目前是占位组件，需接入 `23_库存异常` 表实现：
  - 异常记录创建（清点差异、签收差异、报损等）
  - 异常处理方法（补回、报损、关闭）
  - 与明细的关联锁定
- [ ] **事务持久化** — `inventory-lark-repository.ts` 的 `transactionStore` 是 in-memory `Map`，重启即失。应写入独立的飞书事务表或数据库，防止生产环境幂等失效
- [ ] **Dashboard 数据口径统一** — 仪表盘从 `01_SKU主数据`、`19_SKU运营汇总`、`18_SKU库存策略` 合并后使用，但部分数据仍依赖 `SKU状态`（旧字段），建议逐步切换为从 `19_SKU运营汇总` 的 `国内集货仓`、`橙联在途` 等精确字段

### 5.2 中优先级

- [ ] **头程物流多对多绑定 UI** — 当前支持一个物流批次绑定多个明细，但UI 不展示已绑定明细的历史关系
- [ ] **批量操作确认** — 多选批量推进时无撤销能力（后端已支持幂等重试）
- [ ] **飞书消息通知** — 设计文档二期规划了审批提醒、超时升级等
- [ ] **Excel 导入导出** — 批量导入采购明细、导出库存日报
- [ ] **Lark repository 读优化** — `getInventoryDetails` 和 `listInventoryDetailsByState` 每次都全表读取（`listLarkRecords`），数据量大时需加索引或 filter

### 5.3 低优先级

- [ ] **middleware → proxy 迁移** — Next.js 16 警告 middleware 已废弃，需改用 proxy。当前仍可正常构建
- [ ] **财务报销附件上传** — 当前只展示飞书中已有的附件，需支持从 Web 端上传发票图片
- [ ] **财务审批流程** — 当前只有通过/驳回两个操作，可扩展多人审批链、审批意见等
- [ ] **自动化定时任务** — 库存预警、补货建议可定时推送到飞书群

## 6. 开发指南

### 6.1 启动开发环境

```bash
cd /Users/chequan/Documents/SolidSrUn/ebay-ops-webapp
npm run dev                   # http://localhost:3000
```

### 6.2 本地登录

- 账号：`车泉`
- 密码：`chequan123`
- 角色：admin（可访问所有页面和 API）

### 6.3 质量检查

```bash
npm run lint      # ESLint — 当前 0 错误 0 警告
npm test          # Vitest — 当前 5 文件 123 测试全部通过
npm run build     # Next.js build — 编译成功
```

### 6.4 代码约定

- 所有注释和用户界面文本优先使用中文
- 纯函数逻辑放在 `src/lib/`，带测试文件同目录
- 后端 API 路由放在 `src/app/(main)/api/` 下
- 共享 UI 组件放在 `src/components/ui/`
- 业务组件放在 `src/components/<module>/`
- 移动端响应式布局（Tailwind `grid-cols-1 sm:grid-cols-*` 模式）
- shadcn/ui 风格（Card/CardHeader/CardContent/Badge/Button/Dialog）

### 6.5 飞书写入保护

- `.env.local` 中 `LARK_WRITE_ENABLED=true` 才能写入飞书
- 所有写 API 调用 `assertLarkWriteEnabled()`
- 生产部署时应设为 `false` 或通过单独的密钥控制

### 6.6 多 Base 支持

`src/lib/lark-server.ts` 支持不同表对应不同 Base。通过 `BASE_TOKEN_OVERRIDE` 映射：

```typescript
const BASE_TOKEN_OVERRIDE: Partial<Record<LarkTable, string>> = {
  finance: "LARK_BASE_FINANCE",
};
```

新增跨 Base 表时在此处添加映射并在 `.env.local` 配置对应的 Base Token。

## 7. 当前 Git 状态

仓库有约 30 个未提交文件（包括 UI 刷新、auth 更新、Cloudflare 文件、库存流转模块、财务模块等）。**不要 reset 或 revert**，除非用户明确要求。

## 8. 参考文档

原始设计/计划文件：
- `docs/superpowers/specs/2026-06-02-inventory-batch-flow-design.md` — 库存批次流转设计
- `docs/superpowers/plans/2026-06-02-inventory-ledger-backend-plan.md` — 后端详细计划
- `docs/superpowers/plans/2026-06-02-inventory-flow-workbench-plan.md` — 前端工作台计划
- `docs/agent-handoff-2026-06-03.md` — 上次交接文档

AGENTS.md 提示：`node_modules/next/dist/docs/` 中有 Next.js 16 的变更指南，编写代码前应先查阅。此版本有 breaking changes，API 和约定可能与通用训练数据不同。
