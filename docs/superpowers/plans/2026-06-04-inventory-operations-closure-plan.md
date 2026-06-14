# 库存运营闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐库存流转的一线运营闭环：差异生成异常、异常补回/报损处理、事务记录可落到飞书表。

**Architecture:** `22_SKU批次库存明细` 继续作为库存位置账本，`23_库存异常` 记录差异处理过程，`02_库存流水` 记录异常暂存、补回和报损流水。服务端仍负责状态机、数量校验、幂等事务和汇总重算；飞书多维表格负责视图、负责人、备注和待重试事务协作。

**Tech Stack:** Next.js 16 App Router、TypeScript、Vitest、飞书多维表格。

---

### Task 1: 后端异常行为

**Files:**
- Modify: `src/lib/inventory-batch-server.ts`
- Modify: `src/lib/inventory-batch-server.test.ts`

- [x] 写失败测试：海外仓签收/上架实收少于预期时创建异常，并把差异转入异常暂存。
- [x] 写失败测试：异常补回库存时，减少异常暂存并增加目标位置库存。
- [x] 写失败测试：异常确认报损时，只减少异常暂存并关闭异常。
- [x] 实现最小后端服务和仓库接口扩展。
- [x] 运行 `npm test -- src/lib/inventory-batch-server.test.ts`。

### Task 2: API 与请求解析

**Files:**
- Modify: `src/lib/inventory-flow-api.ts`
- Modify: `src/lib/inventory-flow-api.test.ts`
- Create: `src/app/(main)/api/inventory-flow/exceptions/route.ts`

- [x] 写失败测试：解析异常处理请求。
- [x] 实现 `POST /api/inventory-flow/exceptions`，仅管理员可补回、报损或关闭异常。
- [x] 运行 `npm test -- src/lib/inventory-flow-api.test.ts`。

### Task 3: 飞书仓库持久事务

**Files:**
- Modify: `src/lib/lark-server.ts`
- Modify: `src/lib/inventory-lark-repository.ts`
- Modify: `.env.example`

- [x] 增加 `inventoryTransaction` 表映射。
- [x] 事务表环境变量存在时，把事务读写落到飞书；不存在时保留内存回退。
- [x] 增加异常表读写映射。

### Task 4: 异常 Tab 接入

**Files:**
- Modify: `src/components/inventory-flow/exceptions-tab.tsx`
- Modify: `src/components/inventory-flow/types.ts`

- [x] 读取 `resource=exceptions` 并展示异常列表。
- [x] 支持按处理状态、异常类型、责任节点、SKU 筛选。
- [x] 管理员可选择补回或报损并提交处理。

### Task 5: 验证

- [x] 运行 `npm test -- src/lib/inventory-batch-server.test.ts src/lib/inventory-flow-api.test.ts`。
- [x] 运行 `npm run lint`。
