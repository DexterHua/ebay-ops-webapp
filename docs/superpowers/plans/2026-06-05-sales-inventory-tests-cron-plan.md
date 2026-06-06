# Sales Inventory Scan Tests And Cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为“销售日报自动扣减库存与预警”建立可重复的单元/API 测试，并通过 Cloudflare Cron 在每天 Asia/Shanghai 09:00 和 17:00 安全触发扫描。

**Architecture:** 服务层测试使用内存仓库验证幂等、失败恢复、库存边界和预警口径；Route 测试直接调用 Next.js Handler，并 mock 会话、仓库与扫描服务。Cloudflare 根入口包装生成后的 `.open-next/worker.js`，通过纯 `.mjs` helper 构造带共享密钥的内部请求并调用 OpenNext Worker 的 `fetch`，不从根入口导入未编译的 `src/*.ts`。

**Tech Stack:** TypeScript 5、Vitest 4、Next.js 16 Route Handler、OpenNext for Cloudflare 1.19、Wrangler 4、Cloudflare Cron Triggers

---

## Scope And Ownership

本计划的实施代理只修改以下文件：

- Create: `src/lib/sales-inventory-scan.test.ts`
- Create: `src/lib/sales-inventory-scan-api.test.ts`
- Create: `src/app/(main)/api/inventory/sales-scan/route.test.ts`
- Create: `src/lib/cloudflare-sales-scan.test.ts`
- Create: `cloudflare-sales-scan.mjs`
- Create: `cloudflare-worker.mjs`
- Modify: `wrangler.jsonc`
- Modify: `package.json`
- Modify: `src/middleware.ts`

以下文件由代理 1 或代理 2负责，本计划的实施代理不得修改：

- `src/lib/sales-inventory-scan.ts`
- `src/lib/sales-inventory-scan-api.ts`
- `src/lib/sales-inventory-lark-repository.ts`
- `src/app/(main)/api/inventory/sales-scan/route.ts`
- `src/lib/lark-server.ts`
- `.env.example`
- 飞书 Base 表、字段和视图

仓库中已有未提交改动。执行时只暂存本计划列出的文件，不回退、不覆盖、不格式化其他文件。

## Required Contracts From Agent 1

测试开始前，主代理必须确认代理 1 已提供以下导出。名称和字段必须一致，否则先由代理 1修正，测试代理不修改业务服务。

```ts
// src/lib/sales-inventory-scan.ts
export type SalesInventoryWarningLevel = "异常" | "紧急" | "需采购" | "低库存";

export interface SalesInventoryScanInput {
  trigger: "manual" | "scheduled";
  limit: number;
  operator: string;
  now: number;
}

export interface SalesInventoryScanResult {
  scanId: string;
  processed: number;
  deducted: number;
  skipped: number;
  exceptions: number;
  warnings: number;
}

export interface SalesInventoryScanRepository {
  listSalesRecords(limit: number): Promise<Array<{
    recordId: string;
    fields: Record<string, unknown>;
  }>>;
  getTransaction(transactionId: string): Promise<{
    transactionId: string;
    digest: string;
    status: "pending" | "completed";
  } | undefined>;
  saveTransaction(record: {
    transactionId: string;
    digest: string;
    status: "pending" | "completed";
  }): Promise<void>;
  getSkuSummary(sku: string): Promise<Record<string, unknown> | undefined>;
  getStockStrategy(sku: string): Promise<Record<string, unknown> | undefined>;
  upsertStockFlow(flowId: string, fields: Record<string, unknown>): Promise<void>;
  updateSkuSummary(sku: string, fields: Record<string, unknown>): Promise<void>;
  upsertInventoryException(exceptionId: string, fields: Record<string, unknown>): Promise<void>;
  upsertWarning(warningId: string, fields: Record<string, unknown>): Promise<void>;
  upsertScanSummary(scanId: string, fields: Record<string, unknown>): Promise<void>;
  notifyScanResult(message: string): Promise<void>;
}

export function runSalesInventoryScan(
  repo: SalesInventoryScanRepository,
  input: SalesInventoryScanInput,
): Promise<SalesInventoryScanResult>;

export function classifySalesInventoryWarning(input: {
  hasException: boolean;
  availableQuantity: number;
  totalAvailableQuantity: number;
  averageDailySales7d: number;
  replenishmentLeadDays: number;
  safetyStock: number;
}): SalesInventoryWarningLevel | undefined;
```

```ts
// src/lib/sales-inventory-scan-api.ts
export function parseSalesInventoryScanRequest(
  body: unknown,
  context: {
    trigger: "manual" | "scheduled";
    operator: string;
    now?: number;
  },
): SalesInventoryScanInput;

export function hasValidInventorySalesScanAuthorization(
  authorization: string | null,
  secret: string | undefined,
): boolean;
```

```ts
// src/lib/sales-inventory-lark-repository.ts
export function createLarkSalesInventoryScanRepository(): SalesInventoryScanRepository;
```

Route 契约：

- `Authorization: Bearer <INVENTORY_SALES_SCAN_SECRET>` 校验成功时，服务端认定 `trigger: "scheduled"`。
- 没有合法 Authorization 时必须调用 `requireRole(["admin"])`，成功后认定 `trigger: "manual"`。
- 请求体只接受 `{ "limit": number }`；出现 `mode` 字段返回 400。
- 默认 `limit` 为 200，合法范围为 1 至 500 的正整数。
- scheduled 的 operator 固定为 `系统定时扫描`；manual 使用当前管理员姓名。
- Route 调用 `assertLarkWriteEnabled()`，所有响应设置 `Cache-Control: no-store`。

## Required Contract From Agent 2

代理 2必须提供 `25_库存预警日志` 的表 ID 配置和以下业务字段：

```text
预警编号、扫描批次号、SKU、预警等级、橙联可售、总可用库存、
近7日日均销量、预计可售天数、建议采购量、处理状态、
失败原因、创建时间、更新时间
```

测试按以下稳定标识验证：

```text
事务号：SALE-${销售日报记录ID}-${SKU}
每日预警编号：WARN-${Asia/Shanghai 的 YYYYMMDD}-${SKU}
扫描汇总编号：扫描服务返回的 scanId
```

同一天同一 SKU 的预警必须更新同一条 `WARN-*` 记录；扫描汇总按每次 `scanId` 独立保存。

### Task 1: Build The In-Memory Test Repository

**Files:**
- Create: `src/lib/sales-inventory-scan.test.ts`
- Read: `src/lib/sales-inventory-scan.ts`

- [ ] **Step 1: Add deterministic fixtures and the memory repository**

在测试文件中创建固定时间、销售记录和内存仓库。仓库需保存每一种写入，并支持一次性故障注入。

```ts
import { describe, expect, it } from "vitest";
import {
  classifySalesInventoryWarning,
  runSalesInventoryScan,
  type SalesInventoryScanRepository,
} from "@/lib/sales-inventory-scan";

const NOW = Date.parse("2026-06-05T09:00:00+08:00");

function sale(
  recordId: string,
  sku: string,
  quantity: unknown,
  date = Date.parse("2026-06-05T00:00:00+08:00"),
) {
  return {
    recordId,
    fields: { SKU: sku, 售出数量: quantity, 日期: date, 店铺: "测试店铺" },
  };
}

class MemorySalesInventoryScanRepository implements SalesInventoryScanRepository {
  sales: Array<{ recordId: string; fields: Record<string, unknown> }> = [];
  transactions = new Map<string, { transactionId: string; digest: string; status: "pending" | "completed" }>();
  summaries = new Map<string, Record<string, unknown>>();
  strategies = new Map<string, Record<string, unknown>>();
  stockFlows = new Map<string, Record<string, unknown>>();
  exceptions = new Map<string, Record<string, unknown>>();
  warnings = new Map<string, Record<string, unknown>>();
  scanSummaries = new Map<string, Record<string, unknown>>();
  notifications: string[] = [];
  failSummaryUpdates = 0;
  failNotifications = 0;

  async listSalesRecords(limit: number) { return this.sales.slice(0, limit); }
  async getTransaction(id: string) { return this.transactions.get(id); }
  async saveTransaction(record: { transactionId: string; digest: string; status: "pending" | "completed" }) {
    this.transactions.set(record.transactionId, record);
  }
  async getSkuSummary(sku: string) { return this.summaries.get(sku); }
  async getStockStrategy(sku: string) { return this.strategies.get(sku); }
  async upsertStockFlow(id: string, fields: Record<string, unknown>) {
    this.stockFlows.set(id, { ...this.stockFlows.get(id), ...fields });
  }
  async updateSkuSummary(sku: string, fields: Record<string, unknown>) {
    if (this.failSummaryUpdates > 0) {
      this.failSummaryUpdates -= 1;
      throw new Error("模拟汇总更新失败");
    }
    this.summaries.set(sku, { ...this.summaries.get(sku), ...fields });
  }
  async upsertInventoryException(id: string, fields: Record<string, unknown>) {
    this.exceptions.set(id, { ...this.exceptions.get(id), ...fields });
  }
  async upsertWarning(id: string, fields: Record<string, unknown>) {
    this.warnings.set(id, { ...this.warnings.get(id), ...fields });
  }
  async upsertScanSummary(id: string, fields: Record<string, unknown>) {
    this.scanSummaries.set(id, { ...this.scanSummaries.get(id), ...fields });
  }
  async notifyScanResult(message: string) {
    if (this.failNotifications > 0) {
      this.failNotifications -= 1;
      throw new Error("模拟通知失败");
    }
    this.notifications.push(message);
  }
}

function scanInput() {
  return {
    trigger: "manual" as const,
    limit: 200,
    operator: "管理员",
    now: NOW,
  };
}
```

- [ ] **Step 2: Run the focused test file before adding cases**

Run:

```bash
npm test -- src/lib/sales-inventory-scan.test.ts
```

Expected: FAIL if the agent 1 contract has not landed; otherwise PASS with zero test cases and confirm the imports compile.

- [ ] **Step 3: Commit the test harness**

```bash
git add src/lib/sales-inventory-scan.test.ts
git commit -m "test: add sales scan memory repository"
```

### Task 2: Cover Deduction, Sell-Out, Idempotency And Digest Conflicts

**Files:**
- Modify: `src/lib/sales-inventory-scan.test.ts`
- Test: `src/lib/sales-inventory-scan.test.ts`

- [ ] **Step 1: Write failing success-path and sell-out tests**

新增以下断言：

```ts
it("扣减橙联可售并写入订单出库流水", async () => {
  const repo = new MemorySalesInventoryScanRepository();
  repo.sales = [sale("sales-1", "SKU-1", 3)];
  repo.summaries.set("SKU-1", {
    SKU: "SKU-1", 本地库存: 2, 国内集货仓: 4, 橙联在途: 5,
    橙联可售: 10, 异常暂存: 1, 累计销量: 20, 近7日日均销量: 2,
  });

  const result = await runSalesInventoryScan(repo, scanInput());

  expect(result).toMatchObject({ processed: 1, deducted: 1, exceptions: 0 });
  expect(repo.stockFlows).toHaveLength(1);
  expect([...repo.stockFlows.values()][0]).toMatchObject({
    SKU: "SKU-1",
    变动类型: "订单出库",
    库存位置: "橙联可售",
    数量变动: -3,
    流转事务号: "SALE-sales-1-SKU-1",
  });
  expect(repo.summaries.get("SKU-1")).toMatchObject({
    橙联可售: 7,
    总可用库存: 18,
    账面总量: 19,
  });
  expect(repo.transactions.get("SALE-sales-1-SKU-1")).toMatchObject({ status: "completed" });
});

it("销售数量等于可售库存时允许库存归零", async () => {
  const repo = new MemorySalesInventoryScanRepository();
  repo.sales = [sale("sales-1", "SKU-1", 10)];
  repo.summaries.set("SKU-1", {
    SKU: "SKU-1", 本地库存: 0, 国内集货仓: 0, 橙联在途: 0,
    橙联可售: 10, 异常暂存: 0, 近7日日均销量: 2,
  });

  await runSalesInventoryScan(repo, scanInput());

  expect(repo.summaries.get("SKU-1")).toMatchObject({
    橙联可售: 0,
    总可用库存: 0,
    账面总量: 0,
  });
});
```

- [ ] **Step 2: Add idempotency and changed-record conflict tests**

```ts
it("completed 事务重复扫描不会再次扣减", async () => {
  const repo = new MemorySalesInventoryScanRepository();
  repo.sales = [sale("sales-1", "SKU-1", 3)];
  repo.summaries.set("SKU-1", { SKU: "SKU-1", 橙联可售: 10, 近7日日均销量: 1 });

  await runSalesInventoryScan(repo, scanInput());
  await runSalesInventoryScan(repo, { ...scanInput(), now: NOW + 60_000 });

  expect(repo.stockFlows).toHaveLength(1);
  expect(repo.summaries.get("SKU-1")).toMatchObject({ 橙联可售: 7 });
});

it("相同销售记录被修改后摘要冲突并拒绝污染账本", async () => {
  const repo = new MemorySalesInventoryScanRepository();
  repo.sales = [sale("sales-1", "SKU-1", 3)];
  repo.summaries.set("SKU-1", { SKU: "SKU-1", 橙联可售: 10, 近7日日均销量: 1 });
  await runSalesInventoryScan(repo, scanInput());

  repo.sales = [sale("sales-1", "SKU-1", 4)];

  await expect(runSalesInventoryScan(repo, { ...scanInput(), now: NOW + 60_000 }))
    .rejects.toThrow("事务号已被不同请求使用");
  expect(repo.stockFlows).toHaveLength(1);
  expect(repo.summaries.get("SKU-1")).toMatchObject({ 橙联可售: 7 });
});
```

- [ ] **Step 3: Verify RED, then hand defects to agent 1**

Run:

```bash
npm test -- src/lib/sales-inventory-scan.test.ts
```

Expected before compatible service behavior: FAIL on the first unmet assertion. The test agent reports the exact assertion to the main agent and does not alter `src/lib/sales-inventory-scan.ts`.

- [ ] **Step 4: Re-run after agent 1 fixes the service**

Run:

```bash
npm test -- src/lib/sales-inventory-scan.test.ts
```

Expected: all tests in this task PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sales-inventory-scan.test.ts
git commit -m "test: cover sales deduction idempotency"
```

### Task 3: Cover Pending Recovery, Invalid Input And Notification Isolation

**Files:**
- Modify: `src/lib/sales-inventory-scan.test.ts`
- Test: `src/lib/sales-inventory-scan.test.ts`

- [ ] **Step 1: Add pending recovery test**

```ts
it("流水成功但汇总失败时保持 pending，重试只补齐汇总", async () => {
  const repo = new MemorySalesInventoryScanRepository();
  repo.sales = [sale("sales-1", "SKU-1", 3)];
  repo.summaries.set("SKU-1", { SKU: "SKU-1", 橙联可售: 10, 近7日日均销量: 1 });
  repo.failSummaryUpdates = 1;

  await expect(runSalesInventoryScan(repo, scanInput())).rejects.toThrow("模拟汇总更新失败");
  expect(repo.stockFlows).toHaveLength(1);
  expect(repo.transactions.get("SALE-sales-1-SKU-1")).toMatchObject({ status: "pending" });

  await runSalesInventoryScan(repo, { ...scanInput(), now: NOW + 60_000 });

  expect(repo.stockFlows).toHaveLength(1);
  expect(repo.summaries.get("SKU-1")).toMatchObject({ 橙联可售: 7 });
  expect(repo.transactions.get("SALE-sales-1-SKU-1")).toMatchObject({ status: "completed" });
});
```

- [ ] **Step 2: Add shortage and malformed sales tests**

覆盖以下输入和预期：

| Input | Expected |
| --- | --- |
| 可售 2，销售 3 | 不写流水、不改汇总、事务保持 pending、创建销售扣减库存不足异常 |
| SKU 空字符串 | skipped +1，创建异常扫描结果，不写流水 |
| 售出数量 0 | skipped +1，不写流水 |
| 售出数量 -1 | skipped +1，不写流水 |
| 售出数量 1.5 | skipped +1，不写流水 |
| 售出数量 `"abc"` | skipped +1，不写流水 |
| 找不到 SKU 汇总 | exceptions +1，不写流水 |

所有用例使用 `it.each`，并断言库存从未小于 0。

- [ ] **Step 3: Add notification failure non-rollback test**

```ts
it("通知失败不回滚已完成的库存扣减", async () => {
  const repo = new MemorySalesInventoryScanRepository();
  repo.sales = [sale("sales-1", "SKU-1", 3)];
  repo.summaries.set("SKU-1", { SKU: "SKU-1", 橙联可售: 10, 近7日日均销量: 2 });
  repo.failNotifications = 1;

  const result = await runSalesInventoryScan(repo, scanInput());

  expect(result.deducted).toBe(1);
  expect(repo.stockFlows).toHaveLength(1);
  expect(repo.summaries.get("SKU-1")).toMatchObject({ 橙联可售: 7 });
  expect(repo.transactions.get("SALE-sales-1-SKU-1")).toMatchObject({ status: "completed" });
  expect([...repo.scanSummaries.values()][0]).toMatchObject({
    通知状态: "失败",
    失败原因: expect.stringContaining("模拟通知失败"),
  });
});
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- src/lib/sales-inventory-scan.test.ts
```

Expected: all service tests PASS after agent 1 satisfies the contract.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sales-inventory-scan.test.ts
git commit -m "test: cover sales scan failure recovery"
```

### Task 4: Cover Warning Priority, Stable Daily IDs And Scan Summaries

**Files:**
- Modify: `src/lib/sales-inventory-scan.test.ts`
- Test: `src/lib/sales-inventory-scan.test.ts`

- [ ] **Step 1: Add warning priority table tests**

直接测试代理 1 导出的纯函数，避免通过销售重算间接改变近 7 日均销量：

```ts
it.each([
  {
    name: "异常覆盖其他等级",
    input: {
      hasException: true, availableQuantity: 2, totalAvailableQuantity: 2,
      averageDailySales7d: 1, replenishmentLeadDays: 30, safetyStock: 10,
    },
    expected: "异常",
  },
  {
    name: "预计可售不足 7 天为紧急",
    input: {
      hasException: false, availableQuantity: 6, totalAvailableQuantity: 100,
      averageDailySales7d: 1, replenishmentLeadDays: 30, safetyStock: 1,
    },
    expected: "紧急",
  },
  {
    name: "预计可售等于 7 天不算紧急但可算需采购",
    input: {
      hasException: false, availableQuantity: 7, totalAvailableQuantity: 100,
      averageDailySales7d: 1, replenishmentLeadDays: 30, safetyStock: 1,
    },
    expected: "需采购",
  },
  {
    name: "低于补货周期为需采购",
    input: {
      hasException: false, availableQuantity: 14, totalAvailableQuantity: 100,
      averageDailySales7d: 1, replenishmentLeadDays: 15, safetyStock: 1,
    },
    expected: "需采购",
  },
  {
    name: "无更高等级且总可用不高于安全库存为低库存",
    input: {
      hasException: false, availableQuantity: 20, totalAvailableQuantity: 20,
      averageDailySales7d: 0, replenishmentLeadDays: 15, safetyStock: 20,
    },
    expected: "低库存",
  },
  {
    name: "无风险时不生成预警",
    input: {
      hasException: false, availableQuantity: 30, totalAvailableQuantity: 30,
      averageDailySales7d: 0, replenishmentLeadDays: 15, safetyStock: 20,
    },
    expected: undefined,
  },
])("$name", ({ input, expected }) => {
  expect(classifySalesInventoryWarning(input)).toBe(expected);
});
```

- [ ] **Step 2: Verify stable warning and scan summary identifiers**

新增测试：

1. `2026-06-05T09:00:00+08:00` 和 `2026-06-05T17:00:00+08:00` 对同一 SKU 均 upsert `WARN-20260605-SKU-1`，Map 中只存在一条预警。
2. 次日 `2026-06-06T09:00:00+08:00` 生成 `WARN-20260606-SKU-1`。
3. 每次扫描均写一条以返回 `scanId` 为键的扫描汇总，字段至少包含 `processed`、`deducted`、`skipped`、`exceptions`、`warnings`、`trigger`、`创建时间`。
4. 同日预警等级从“需采购”升级为“紧急”时更新原记录，不新增第二条。

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- src/lib/sales-inventory-scan.test.ts
```

Expected: all warning, identifier and summary assertions PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sales-inventory-scan.test.ts
git commit -m "test: cover sales inventory warning priority"
```

### Task 5: Test Request Parsing And Authorization Helpers

**Files:**
- Create: `src/lib/sales-inventory-scan-api.test.ts`
- Read: `src/lib/sales-inventory-scan-api.ts`

- [ ] **Step 1: Write failing parser tests**

覆盖以下精确行为：

```ts
import { describe, expect, it } from "vitest";
import {
  hasValidInventorySalesScanAuthorization,
  parseSalesInventoryScanRequest,
} from "@/lib/sales-inventory-scan-api";

describe("sales inventory scan api", () => {
  it("手动请求默认 limit 为 200", () => {
    expect(parseSalesInventoryScanRequest({}, {
      trigger: "manual",
      operator: "管理员",
      now: 1780611600000,
    })).toEqual({
      trigger: "manual",
      operator: "管理员",
      limit: 200,
      now: 1780611600000,
    });
  });

  it.each([0, -1, 1.5, 501, "200", null])("拒绝非法 limit: %p", (limit) => {
    expect(() => parseSalesInventoryScanRequest({ limit }, {
      trigger: "manual",
      operator: "管理员",
    })).toThrow("limit");
  });

  it("拒绝客户端提交 mode", () => {
    expect(() => parseSalesInventoryScanRequest({ mode: "scheduled", limit: 200 }, {
      trigger: "manual",
      operator: "管理员",
    })).toThrow("mode");
  });
});
```

- [ ] **Step 2: Add secret authorization tests**

使用统一变量名 `INVENTORY_SALES_SCAN_SECRET` 的语义验证：

- 精确的 `Bearer <secret>` 返回 true。
- 缺少 Authorization、错误 scheme、错误 secret 返回 false。
- 未配置 secret 或 secret 少于 32 字符返回 false。
- 比较不得因前缀相同而通过。

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- src/lib/sales-inventory-scan-api.test.ts
```

Expected: tests fail before the agent 1 helper exists, then PASS without modifying the helper from this workstream.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sales-inventory-scan-api.test.ts
git commit -m "test: cover sales scan request validation"
```

### Task 6: Test The Route Handler

**Files:**
- Create: `src/app/(main)/api/inventory/sales-scan/route.test.ts`
- Read: `src/app/(main)/api/inventory/sales-scan/route.ts`

- [ ] **Step 1: Mock all route boundaries before importing POST**

Hoist mocks for:

```ts
const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertLarkWriteEnabled: vi.fn(),
  createRepository: vi.fn(() => ({ kind: "repo" })),
  runScan: vi.fn(),
}));
```

Mock these modules:

- `@/lib/session-server`
- `@/lib/lark-server`
- `@/lib/sales-inventory-lark-repository`
- `@/lib/sales-inventory-scan`

Set `INVENTORY_SALES_SCAN_SECRET` to a 32+ character test value in `beforeEach`, and remove it in `afterEach`.

- [ ] **Step 2: Add manual authorization cases**

直接调用 `POST(new NextRequest(...))` 并验证：

- `requireRole` 抛出“未登录”时返回 401。
- `requireRole` 抛出“权限不足”时返回 403。
- admin 成功时调用扫描服务，input 为 `{ trigger: "manual", operator: "管理员", limit: 200, now: expect.any(Number) }`。
- body 出现 `mode` 返回 400，扫描服务不执行。
- 非法 JSON、limit 0、limit 501、非整数 limit 返回 400。

- [ ] **Step 3: Add scheduled authorization cases**

构造请求：

```ts
new NextRequest("https://internal/api/inventory/sales-scan", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.INVENTORY_SALES_SCAN_SECRET}`,
  },
  body: JSON.stringify({ limit: 200 }),
});
```

断言：

- 合法密钥不调用 `requireRole`。
- input 使用 `trigger: "scheduled"` 和 `operator: "系统定时扫描"`。
- 错误密钥不能进入 scheduled 分支，而是继续走 admin 鉴权。
- 客户端不能通过 body 改写触发来源。
- success response 包含全部六个统计字段和 `Cache-Control: no-store`。
- 扫描服务错误返回 500，响应正文不包含共享密钥。
- `assertLarkWriteEnabled` 失败时不创建仓库、不调用扫描服务。

- [ ] **Step 4: Run focused route tests**

Run:

```bash
npm test -- 'src/app/(main)/api/inventory/sales-scan/route.test.ts'
```

Expected: all route tests PASS after agent 1 route lands.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(main)/api/inventory/sales-scan/route.test.ts'
git commit -m "test: cover sales scan route authorization"
```

### Task 7: Build And Test The Pure Cron Helper

**Files:**
- Create: `cloudflare-sales-scan.mjs`
- Create: `src/lib/cloudflare-sales-scan.test.ts`

- [ ] **Step 1: Write failing helper tests**

动态导入 `../../cloudflare-sales-scan.mjs`，覆盖：

- 缺少或不足 32 字符的 `INVENTORY_SALES_SCAN_SECRET` 时拒绝调用 Worker。
- 内部请求固定为 `POST https://internal/api/inventory/sales-scan`。
- body 精确等于 `{ "limit": 200 }`，不含 `mode`。
- Authorization 精确为 `Bearer <secret>`。
- 把同一个 `env` 和 `ctx` 传给 OpenNext Worker 的 `fetch`。
- 非 2xx response 抛出包含 HTTP 状态和最多 300 字符响应摘要的错误，错误不包含 secret。
- 2xx response 返回解析后的扫描统计。

Run:

```bash
npm test -- src/lib/cloudflare-sales-scan.test.ts
```

Expected: FAIL because `cloudflare-sales-scan.mjs` does not exist.

- [ ] **Step 2: Implement the minimal pure mjs helper**

```js
const MIN_SECRET_LENGTH = 32;

function requireSecret(env) {
  const secret = String(env.INVENTORY_SALES_SCAN_SECRET || "").trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error("INVENTORY_SALES_SCAN_SECRET 未配置或长度不足");
  }
  return secret;
}

export async function invokeScheduledSalesInventoryScan(openNextWorker, controller, env, ctx) {
  const secret = requireSecret(env);
  const request = new Request("https://internal/api/inventory/sales-scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
      "X-Cloudflare-Cron": controller.cron,
    },
    body: JSON.stringify({ limit: 200 }),
  });

  const response = await openNextWorker.fetch(request, env, ctx);
  if (!response.ok) {
    const summary = (await response.text()).slice(0, 300).replaceAll(secret, "[redacted]");
    throw new Error(`销售库存定时扫描失败 (${response.status}): ${summary}`);
  }
  return response.json();
}
```

- [ ] **Step 3: Run helper tests**

Run:

```bash
npm test -- src/lib/cloudflare-sales-scan.test.ts
```

Expected: all helper tests PASS.

- [ ] **Step 4: Commit**

```bash
git add cloudflare-sales-scan.mjs src/lib/cloudflare-sales-scan.test.ts
git commit -m "feat: add Cloudflare sales scan helper"
```

### Task 8: Add The OpenNext Wrapper And Preserve Durable Object Exports

**Files:**
- Create: `cloudflare-worker.mjs`
- Modify: `wrangler.jsonc`
- Test: `src/lib/cloudflare-sales-scan.test.ts`

- [ ] **Step 1: Create the wrapper**

Wrapper 必须直接导入生成后的 OpenNext Worker，并重新导出当前版本使用的全部 Durable Object：

```js
import openNextWorker from "./.open-next/worker.js";
import { invokeScheduledSalesInventoryScan } from "./cloudflare-sales-scan.mjs";

export {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";

export default {
  fetch(request, env, ctx) {
    return openNextWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    await invokeScheduledSalesInventoryScan(openNextWorker, controller, env, ctx);
  },
};
```

- [ ] **Step 2: Point Wrangler at the wrapper and configure UTC schedules**

将 `wrangler.jsonc` 的 `main` 改为：

```json
"main": "cloudflare-worker.mjs"
```

增加：

```json
"triggers": {
  "crons": ["0 1 * * *", "0 9 * * *"]
}
```

换算口径：

- `0 1 * * *` = 每日 01:00 UTC = Asia/Shanghai 09:00。
- `0 9 * * *` = 每日 09:00 UTC = Asia/Shanghai 17:00。
- Asia/Shanghai 当前不实行夏令时，UTC+8 全年固定，无季节性偏移。

- [ ] **Step 3: Verify OpenNext exports after a build**

Run:

```bash
npm run build:cloudflare
rg '^export \\{' .open-next/worker.js
```

Expected: generated worker exports `BucketCachePurge`, `DOQueueHandler`, and `DOShardedTagCache`; wrapper contains the same three names.

- [ ] **Step 4: Commit**

```bash
git add cloudflare-worker.mjs wrangler.jsonc
git commit -m "feat: schedule twice daily inventory scans"
```

### Task 9: Allow The Route Through Middleware Without Weakening Route Auth

**Files:**
- Modify: `src/middleware.ts`
- Test: `src/app/(main)/api/inventory/sales-scan/route.test.ts`

- [ ] **Step 1: Add the exact route to public middleware paths**

在 `PUBLIC_PATHS` 中加入精确匹配：

```ts
/^\/api\/inventory\/sales-scan$/,
```

不得放行 `/api/inventory/*`，也不得在 middleware 中验证共享密钥。该改动只允许请求到达 Route，Route 仍负责 scheduled secret 或 admin session 鉴权。

- [ ] **Step 2: Run route tests after middleware change**

Run:

```bash
npm test -- 'src/app/(main)/api/inventory/sales-scan/route.test.ts'
```

Expected: all route authorization tests remain PASS.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "fix: allow authenticated sales scan cron route"
```

### Task 10: Add Local Scheduled Preview Script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the script**

在 `scripts` 中加入：

```json
"preview:scheduled": "opennextjs-cloudflare build && wrangler dev --test-scheduled"
```

- [ ] **Step 2: Check package JSON and Wrangler config**

Run:

```bash
node -e 'const p=require("./package.json"); if(!p.scripts["preview:scheduled"]) process.exit(1)'
npx wrangler deploy --dry-run --outdir /tmp/ebay-ops-sales-scan-dry-run
```

Expected: package script exists; Wrangler dry-run succeeds, reports `cloudflare-worker.mjs` as entrypoint, and does not contact or modify production.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add scheduled worker preview command"
```

### Task 11: Full Verification Without Production Writes

**Files:**
- Verify only: all files owned by this plan

- [ ] **Step 1: Run all unit and API tests**

Run:

```bash
npm test
```

Expected: all Vitest files PASS, including sales scan service, parser, route and Cloudflare helper tests.

- [ ] **Step 2: Run static checks and builds**

Run:

```bash
npm run lint
npm run build
npm run build:cloudflare
```

Expected: all commands exit 0. The existing Next.js middleware deprecation warning may remain, but no new error is allowed.

- [ ] **Step 3: Run Wrangler dry-run**

Run:

```bash
npx wrangler deploy --dry-run --outdir "/tmp/ebay-ops-sales-scan-dry-run-$(date +%s)"
```

Expected: dry-run exits 0, bundles the wrapper, recognizes the Durable Object exports, and lists both Cron expressions.

- [ ] **Step 4: Validate local scheduled dispatch with non-production configuration**

Start:

```bash
INVENTORY_SALES_SCAN_SECRET=local-test-secret-at-least-32-characters npm run preview:scheduled
```

In another terminal:

```bash
curl -i "http://localhost:8787/__scheduled?cron=0%201%20*%20*%20*"
```

Expected: scheduled handler reaches `/api/inventory/sales-scan`. With test Lark configuration it returns a scan summary; without required Lark configuration it returns a controlled failure visible in local logs, with no secret value printed.

- [ ] **Step 5: Confirm no production action occurred**

Do not run `npm run deploy:cloudflare`, `wrangler deploy` without `--dry-run`, or `wrangler secret put`. Do not create, rotate or inspect the production `INVENTORY_SALES_SCAN_SECRET`.

- [ ] **Step 6: Review the final diff**

Run:

```bash
git status --short
git diff -- src/lib/sales-inventory-scan.test.ts \
  src/lib/sales-inventory-scan-api.test.ts \
  'src/app/(main)/api/inventory/sales-scan/route.test.ts' \
  src/lib/cloudflare-sales-scan.test.ts \
  cloudflare-sales-scan.mjs \
  cloudflare-worker.mjs \
  wrangler.jsonc \
  package.json \
  src/middleware.ts
```

Expected: only plan-owned implementation files appear in this workstream; unrelated existing changes remain untouched.

## Integration Verification Checklist For The Main Agent

- [ ] Agent 1 service and API contracts match the names and field shapes in this plan.
- [ ] Agent 2 warning table supports stable daily warning upsert and scan summary persistence.
- [ ] Re-running the same sales record does not add a second stock flow.
- [ ] Modifying a completed sales record produces a digest conflict instead of a second deduction.
- [ ] A pending transaction resumes after summary failure without duplicating the flow.
- [ ] Exact sell-out produces zero inventory and is not classified as insufficient stock.
- [ ] Notification failure leaves deduction and transaction completion intact.
- [ ] Request body containing `mode` is rejected.
- [ ] scheduled classification comes only from valid `Authorization`.
- [ ] Wrapper re-exports all three OpenNext Durable Object classes.
- [ ] Cron expressions remain `0 1 * * *` and `0 9 * * *`.
- [ ] Full tests, lint, Next build, OpenNext build and Wrangler dry-run pass.
- [ ] No real deployment or production secret operation was performed.

## Risks

1. Lark Base has no unique constraint. Concurrent manual and scheduled runs still depend on deterministic transaction IDs, request digests and stock-flow upsert behavior supplied by agent 1.
2. `.open-next/worker.js` is generated and ignored by Git. The wrapper must import it but never edit or commit it.
3. OpenNext may change its named Durable Object exports during dependency upgrades. The build verification must compare generated exports with `cloudflare-worker.mjs`.
4. Cloudflare Cron uses UTC and may execute a few minutes late. Business logic must use Asia/Shanghai calendar conversion for daily warning IDs rather than assuming exact trigger time.
5. Making the route middleware-public is safe only while the Route performs its own secret-or-admin authorization on every request.
6. A scan limit of 200 can leave additional sales rows for later runs. Scan summaries must describe the current batch and must not claim that the entire table was processed.
7. Local scheduled verification can write data if pointed at production Lark credentials. It must use an isolated test Base or run only far enough to confirm controlled configuration failure.
