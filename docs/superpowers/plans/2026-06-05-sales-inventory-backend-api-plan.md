# Sales Daily Inventory Backend and API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan `07_销售日报`, idempotently deduct sellable inventory, refresh SKU summaries, persist exceptions and warnings, optionally send a Lark alert, and expose one authenticated scan endpoint.

**Architecture:** `src/lib/sales-inventory-scan.ts` owns the domain workflow and depends on a narrow repository interface. The Lark adapter reads complete snapshots from the existing Base tables and persists deterministic transactions, stock flows, warnings, scan summaries, and inventory exceptions. `POST /api/inventory/sales-scan` determines scheduled versus manual execution from authentication only: a Bearer token selects scheduled mode, while requests without Authorization require an administrator session.

**Tech Stack:** TypeScript, Next.js 16 Route Handlers, Vitest, Lark Base through the existing `lark-server.ts` OpenAPI/CLI abstraction.

---

## Scope and Ownership

This plan is limited to backend services and the API route. It does not create or modify Lark Base tables or views, and it does not configure the scheduler.

### Files created by backend agent

- `src/lib/sales-inventory-scan.ts`: domain types, input parsing from Lark records, FIFO allocation, idempotent deduction recovery, summary refresh, warning calculation, scan summary, and optional notification orchestration.
- `src/lib/sales-inventory-scan-api.ts`: HTTP body parsing, scan ID generation, and scheduled Bearer verification helpers.
- `src/lib/sales-inventory-lark-repository.ts`: Lark implementation of the scan repository.
- `src/app/(main)/api/inventory/sales-scan/route.ts`: authentication-mode selection, service invocation, response mapping, and HTTP status mapping.

### Existing files modified by backend agent

- `src/lib/inventory-batch-server.ts`: extend transaction metadata and inventory exception type; prevent the existing discrepancy-resolution workflow from processing sales-shortage exceptions.
- `src/lib/inventory-lark-repository.ts`: persist and read the new transaction metadata, including the dedicated `恢复上下文` field.
- `src/lib/lark-server.ts`: add only the `inventoryWarning` table key mapped to `LARK_TABLE_INVENTORY_WARNING`.

### Files owned by test and scheduler agent

- `src/lib/sales-inventory-scan.test.ts`
- `src/lib/sales-inventory-scan-api.test.ts`
- `src/app/(main)/api/inventory/sales-scan/route.test.ts`
- Scheduler configuration and deployment documentation.

### Files owned by Lark Base agent

- `.env.example`
- Remote table and field definitions.
- Remote Base views.

The backend agent must not modify `.env.example`, scheduler files, or remote Base metadata.

## Stable Backend Contracts

Add these exported types to `src/lib/sales-inventory-scan.ts`:

```ts
import type { InventoryDetail } from "@/lib/inventory-flow";
import type {
  InventoryExceptionRecord,
  InventoryTransactionRecord,
} from "@/lib/inventory-batch-server";
import type { LarkRecord } from "@/lib/lark-server";

export type SalesScanMode = "manual" | "scheduled";
export type InventoryWarningLevel = "异常" | "紧急" | "需采购" | "低库存";
export type InventoryWarningStatus = "待处理" | "已通知" | "已转采购" | "已关闭";

export interface SalesDailyRecord {
  recordId: string;
  sku: string;
  soldQuantity: number;
  saleDate: number;
  store: string;
  salesAmount: number;
}

export interface SkuInventorySnapshot {
  recordId: string;
  sku: string;
  本地库存: number;
  国内集货仓: number;
  橙联在途: number;
  橙联可售: number;
  异常暂存: number;
}

export interface SkuStockStrategy {
  sku: string;
  安全库存: number;
  补货周期天数: number;
}

export interface SalesDeductionAllocation {
  detailId: string;
  quantity: number;
  expectedVersion: number;
}

export interface SalesRecoveryContext {
  version: 1;
  salesRecordId: string;
  sku: string;
  soldQuantity: number;
  saleDate: number;
  allocations: SalesDeductionAllocation[];
  completedSteps: Array<
    "stock_flow_created"
    | "summary_updated"
    | "sales_summary_refreshed"
    | "warning_written"
  >;
}

export interface InventoryWarningRecord {
  warningId: string;
  recordType: "库存预警";
  scanId: string;
  sku: string;
  level: InventoryWarningLevel;
  triggerReason: string;
  sellable: number;
  totalAvailable: number;
  dailySales: number;
  sellableDays?: number;
  safetyStock: number;
  replenishCycleDays: number;
  suggestedPurchaseQuantity: number;
  status: InventoryWarningStatus;
  processingRemark?: string;
  failureReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface InventoryScanLogRecord {
  warningId: string;
  recordType: "扫描汇总";
  scanId: string;
  mode: SalesScanMode;
  processed: number;
  deducted: number;
  skipped: number;
  exceptions: number;
  warnings: number;
  notificationMessageId?: string;
  notificationAt?: number;
  failureReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SalesInventoryScanInput {
  scanId: string;
  mode: SalesScanMode;
  limit: number;
  operator: string;
  now: number;
  alertChatId?: string;
}

export interface SalesInventoryScanResult {
  scanId: string;
  mode: SalesScanMode;
  processed: number;
  deducted: number;
  skipped: number;
  exceptions: number;
  warnings: number;
  notificationStatus: "未配置" | "已发送" | "发送失败";
  notificationError?: string;
}

export interface SalesInventoryScanRepository {
  listSalesRecords(): Promise<{ records: LarkRecord[]; hasMore: boolean }>;
  listTransactions(transactionIds: string[]): Promise<Map<string, InventoryTransactionRecord>>;
  listSkuSummaries(skus: string[]): Promise<Map<string, SkuInventorySnapshot>>;
  listStockStrategies(skus: string[]): Promise<Map<string, SkuStockStrategy>>;
  listSellableDetails(skus: string[]): Promise<InventoryDetail[]>;
  listStockFlows(transactionIds: string[]): Promise<LarkRecord[]>;
  getWarning(warningId: string): Promise<InventoryWarningRecord | undefined>;
  saveTransaction(record: InventoryTransactionRecord): Promise<void>;
  updateInventoryDetail(detailId: string, detail: InventoryDetail): Promise<void>;
  upsertStockFlow(flowId: string, fields: Record<string, unknown>): Promise<void>;
  updateSkuSummary(sku: string, fields: Record<string, unknown>): Promise<void>;
  upsertSalesException(record: InventoryExceptionRecord): Promise<void>;
  upsertWarning(record: InventoryWarningRecord): Promise<void>;
  upsertScanLog(record: InventoryScanLogRecord): Promise<void>;
  sendAlert(chatId: string, text: string): Promise<string | undefined>;
}
```

Extend `InventoryTransactionRecord` in `src/lib/inventory-batch-server.ts` without breaking existing callers:

```ts
export interface InventoryTransactionRecord {
  transactionId: string;
  digest: string;
  status: "pending" | "completed";
  operationType?: string;
  operator?: string;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  failureReason?: string;
  recoveryContext?: string;
  remark?: string;
}
```

`recoveryContext` maps exclusively to `24_库存流转事务.恢复上下文`. It must never be stored in `备注`.

## Authentication and Request Contract

The request body cannot select execution mode.

```ts
export interface SalesScanRequestBody {
  limit?: unknown;
}
```

Route mode selection is deterministic:

```ts
const authorization = request.headers.get("authorization");

if (authorization !== null) {
  verifyScheduledScanAuthorization(authorization);
  mode = "scheduled";
  operator = "系统自动扫描";
} else {
  const session = await requireRole(["admin"]);
  mode = "manual";
  operator = session.name;
}
```

Any present but invalid Authorization header returns `401`; it must not fall back to an administrator cookie.

The only scheduler secret name is:

```text
INVENTORY_SALES_SCAN_SECRET
```

The optional notification destination is:

```text
LARK_INVENTORY_ALERT_CHAT_ID
```

The backend reads these variables but does not edit `.env.example`.

---

### Task 1: Confirm the failing-test contract supplied by Agent 3

**Files:**
- Read only: `src/lib/sales-inventory-scan.test.ts`
- Read only: `src/lib/sales-inventory-scan-api.test.ts`
- Read only: `src/app/(main)/api/inventory/sales-scan/route.test.ts`

Agent 3 owns all detailed test implementation. The backend agent must not create or edit these files.

- [ ] **Step 1: Confirm the domain test dependency exists**

`src/lib/sales-inventory-scan.test.ts` must cover:

```text
strict sales parsing
deterministic SALE transaction IDs
warning priority and suggested purchase quantity
FIFO deduction across sellable details
fully depleted detail retained at quantity 0
completed transaction replay
pending transaction partial-write recovery
sales record modification conflict
positive sales-shortage difference
warning and scan-summary deterministic IDs
preservation of 已转采购 and 已关闭
notification disabled, success, and failure degradation
scan-log persistence
```

- [ ] **Step 2: Confirm the API helper test dependency exists**

`src/lib/sales-inventory-scan-api.test.ts` must cover body validation, rejection of body-selected mode, Bearer verification, and Shanghai scan-ID formatting.

- [ ] **Step 3: Confirm the Route test dependency exists**

`src/app/(main)/api/inventory/sales-scan/route.test.ts` must cover administrator manual mode, Bearer scheduled mode, invalid Bearer without cookie fallback, status mapping, and notification fields in the response.

- [ ] **Step 4: Run tests before implementation**

Run:

```bash
npm test -- src/lib/sales-inventory-scan.test.ts \
  src/lib/sales-inventory-scan-api.test.ts \
  src/app/\(main\)/api/inventory/sales-scan/route.test.ts
```

Expected: FAIL only because the backend modules and Route do not exist or do not yet export the required interfaces.

---

### Task 2: Implement pure parsing, metrics, IDs, and warning rules

**Files:**
- Create: `src/lib/sales-inventory-scan.ts`
- Test dependency, read only: `src/lib/sales-inventory-scan.test.ts`

- [ ] **Step 1: Implement strict Lark scalar readers**

Add private helpers that accept direct scalars and Lark wrapper objects but reject missing, non-finite, or malformed required values. `售出数量` must be a positive safe integer. SKU must be trimmed and uppercased.

```ts
export function parseSalesDailyRecord(record: LarkRecord): SalesDailyRecord {
  const sku = readRequiredText(record.fields.SKU, "SKU").toUpperCase();
  const soldQuantity = readPositiveSafeInteger(record.fields.售出数量, "售出数量");
  const saleDate = readFiniteTimestamp(record.fields.日期, "日期");

  return {
    recordId: record.recordId,
    sku,
    soldQuantity,
    saleDate,
    store: readOptionalText(record.fields.店铺),
    salesAmount: readOptionalFiniteNumber(record.fields.销售额, 0),
  };
}
```

- [ ] **Step 2: Implement deterministic transaction, warning, and scan-log IDs**

```ts
export function buildSalesTransactionId(recordId: string, sku: string): string {
  return `SALE-${recordId.trim()}-${sku.trim().toUpperCase()}`;
}

export function buildWarningId(now: number, sku: string): string {
  return `WARN-${formatShanghaiDate(now)}-${sku.trim().toUpperCase()}`;
}

export function buildScanLogId(scanId: string): string {
  return `SCANLOG-${scanId}`;
}
```

`formatShanghaiDate` must use `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })` and remove separators.

- [ ] **Step 3: Implement complete-sales metrics**

```ts
export function calculateSalesMetrics(
  sales: SalesDailyRecord[],
  sku: string,
  now: number,
): { cumulativeSales: number; recentDailySales: number } {
  const matching = sales.filter((sale) => sale.sku === sku);
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const cumulativeSales = matching.reduce((sum, sale) => sum + sale.soldQuantity, 0);
  const recentSales = matching
    .filter((sale) => sale.saleDate >= sevenDaysAgo && sale.saleDate <= now)
    .reduce((sum, sale) => sum + sale.soldQuantity, 0);
  return { cumulativeSales, recentDailySales: recentSales / 7 };
}
```

- [ ] **Step 4: Implement warning calculation**

```ts
export function calculateInventoryWarning(input: {
  sellable: number;
  totalAvailable: number;
  dailySales: number;
  safetyStock: number;
  replenishCycleDays: number;
}): {
  level?: Exclude<InventoryWarningLevel, "异常">;
  sellableDays?: number;
  suggestedPurchaseQuantity: number;
} {
  const sellableDays = input.dailySales > 0
    ? input.sellable / input.dailySales
    : undefined;
  const suggestedPurchaseQuantity = Math.max(
    0,
    Math.ceil((input.replenishCycleDays + 15) * input.dailySales - input.totalAvailable),
  );

  const level = sellableDays !== undefined && sellableDays < 7
    ? "紧急"
    : sellableDays !== undefined && sellableDays < input.replenishCycleDays
      ? "需采购"
      : input.totalAvailable <= input.safetyStock
        ? "低库存"
        : undefined;

  return { level, sellableDays, suggestedPurchaseQuantity };
}
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
npm test -- src/lib/sales-inventory-scan.test.ts
```

Expected: parsing, IDs, sales metrics, and warning-rule tests pass; orchestration tests still fail.

- [ ] **Step 6: Commit pure domain rules**

```bash
git add src/lib/sales-inventory-scan.ts
git commit -m "feat: add sales inventory scan domain rules"
```

---

### Task 3: Extend transaction and exception persistence contracts

**Files:**
- Modify: `src/lib/inventory-batch-server.ts`
- Modify: `src/lib/inventory-lark-repository.ts`
- Test dependency, read only: `src/lib/inventory-batch-server.test.ts`
- Test dependency, read only: `src/lib/lark-server.test.ts`

- [ ] **Step 1: Confirm Agent 3's failing transaction-mapping tests**

Assert the repository writes and reads:

```text
操作类型
操作人
创建时间
更新时间
完成时间
失败原因
恢复上下文
备注
```

Assert `恢复上下文` and `备注` are independent. Assert a completed transaction clears the prior failure reason.

- [ ] **Step 2: Confirm Agent 3's failing exception-resolution guard test**

Seed an exception with type `销售扣减库存不足` and call `resolveInventoryException`. Expect:

```text
销售扣减库存不足不能通过差异补回处理，请补录库存或修正销售日报后重新扫描
```

- [ ] **Step 3: Extend transaction and exception types**

Add the optional transaction fields from the Stable Backend Contracts section. Extend:

```ts
export type InventoryExceptionType =
  | "清点差异"
  | "集货仓签收差异"
  | "海外仓签收差异"
  | "上架差异"
  | "销售扣减库存不足"
  | "报损"
  | "其他";
```

- [ ] **Step 4: Persist transaction metadata**

Update `transactionFromFields` and `transactionToFields`:

```ts
function transactionToFields(record: InventoryTransactionRecord): Record<string, unknown> {
  return {
    事务号: record.transactionId,
    请求摘要: record.digest,
    事务状态: record.status,
    操作类型: record.operationType,
    操作人: record.operator,
    创建时间: record.createdAt,
    更新时间: record.updatedAt ?? Date.now(),
    完成时间: record.completedAt ?? null,
    失败原因: record.failureReason ?? null,
    恢复上下文: record.recoveryContext ?? null,
    备注: record.remark,
  };
}
```

Do not remove `null` values before updating a transaction; Lark needs them to clear stale failure and completion fields.

- [ ] **Step 5: Guard sales-shortage exceptions**

Place the guard immediately after loading the exception and before loading or updating any inventory detail:

```ts
if (exception.异常类型 === "销售扣减库存不足") {
  throw new Error(
    "销售扣减库存不足不能通过差异补回处理，请补录库存或修正销售日报后重新扫描",
  );
}
```

- [ ] **Step 6: Run affected tests**

Run:

```bash
npm test -- src/lib/inventory-batch-server.test.ts src/lib/lark-server.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the shared persistence contract**

```bash
git add src/lib/inventory-batch-server.ts \
  src/lib/inventory-lark-repository.ts
git commit -m "feat: persist sales scan recovery metadata"
```

---

### Task 4: Implement idempotent FIFO inventory deduction

**Files:**
- Modify: `src/lib/sales-inventory-scan.ts`
- Test dependency, read only: `src/lib/sales-inventory-scan.test.ts`

- [ ] **Step 1: Implement a stable request digest**

Digest only immutable sales facts:

```ts
function digestSalesRecord(sale: SalesDailyRecord): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    recordId: sale.recordId,
    sku: sale.sku,
    soldQuantity: sale.soldQuantity,
    saleDate: sale.saleDate,
  })).digest("hex");
}
```

- [ ] **Step 2: Implement FIFO allocation**

Only use details whose `当前状态 === "橙联可售"` and `当前数量 > 0`. Sort by `最近更新时间 ?? 0`, then `明细编号`.

```ts
export function allocateSellableInventory(
  details: InventoryDetail[],
  soldQuantity: number,
): SalesDeductionAllocation[] {
  let remaining = soldQuantity;
  const allocations: SalesDeductionAllocation[] = [];

  for (const detail of sortedSellableDetails(details)) {
    if (remaining === 0) break;
    if (!detail.明细编号) throw new Error("橙联可售明细缺少明细编号");
    const quantity = Math.min(detail.当前数量, remaining);
    allocations.push({
      detailId: detail.明细编号,
      quantity,
      expectedVersion: detail.版本号 ?? 0,
    });
    remaining -= quantity;
  }

  if (remaining > 0) throw new InsufficientSellableInventoryError(soldQuantity - remaining);
  return allocations;
}
```

- [ ] **Step 3: Persist recovery context before inventory mutation**

For a new transaction:

```ts
await repo.saveTransaction({
  transactionId,
  digest,
  status: "pending",
  operationType: "订单出库",
  operator: input.operator,
  createdAt: input.now,
  updatedAt: input.now,
  failureReason: undefined,
  recoveryContext: JSON.stringify(context),
});
```

If a pending transaction already has recovery context, parse and validate it. If its digest differs from current sales facts, persist an abnormal warning and throw the modification-conflict error without mutating inventory.

- [ ] **Step 4: Implement allocation recovery**

For each allocation:

1. If the deterministic flow already exists, treat the allocation as applied.
2. Otherwise load the current detail.
3. If the detail has current transaction ID and version `expectedVersion + 1`, skip the quantity update and write the missing flow.
4. Otherwise require version `expectedVersion`, require enough quantity, update the detail, then write the flow.

The detail update must allow zero:

```ts
const nextQuantity = detail.当前数量 - allocation.quantity;
if (!Number.isSafeInteger(nextQuantity) || nextQuantity < 0) {
  throw new Error(`明细 ${allocation.detailId} 橙联可售库存不足`);
}

await repo.updateInventoryDetail(allocation.detailId, {
  ...detail,
  当前数量: nextQuantity,
  版本号: allocation.expectedVersion + 1,
  最近操作人: input.operator,
  最近更新时间: input.now,
  最近流转事务号: transactionId,
});
```

- [ ] **Step 5: Write deterministic stock flows**

Use:

```ts
const flowId = `${transactionId}-${allocation.detailId}-SALE-OUT`;
```

Fields:

```ts
{
  流转事务号: transactionId,
  来源明细编号: allocation.detailId,
  SKU: sale.sku,
  日期: sale.saleDate,
  库存位置: "橙联可售",
  数量变动: -allocation.quantity,
  相关单号: sale.recordId,
  操作人: input.operator,
  操作时间: input.now,
  操作类型: "订单出库",
  备注: "销售日报自动扣减",
}
```

- [ ] **Step 6: Rebuild the affected SKU summary**

Read all inventory details for the SKU after allocations and calculate inventory fields through the existing `summarizeDetails` function. Merge the complete-sales metrics:

```ts
await repo.updateSkuSummary(sale.sku, {
  ...inventorySummary,
  累计销量: metrics.cumulativeSales,
  近7日日均销量: metrics.recentDailySales,
  快照日期: input.now,
});
```

- [ ] **Step 7: Retain pending status until warning persistence succeeds**

After detail, flow, and summary writes succeed, keep the transaction pending until Task 5 has upserted the SKU warning or confirmed that no warning is required. This ensures a warning-write failure can retry without deducting inventory twice.

```ts
await repo.saveTransaction({
  ...transaction,
  status: "pending",
  updatedAt: input.now,
  failureReason: undefined,
});
```

On failure:

```ts
await repo.saveTransaction({
  ...transaction,
  status: "pending",
  updatedAt: input.now,
  failureReason: errorMessage,
});
throw error;
```

- [ ] **Step 8: Run recovery tests**

Run:

```bash
npm test -- src/lib/sales-inventory-scan.test.ts
```

Expected: FIFO, zero-balance detail, completed replay, pending recovery, and sales-modification conflict tests pass.

- [ ] **Step 9: Commit deduction orchestration**

```bash
git add src/lib/sales-inventory-scan.ts
git commit -m "feat: implement sales inventory deductions"
```

---

### Task 5: Implement shortages, warnings, scan summaries, and notification degradation

**Files:**
- Modify: `src/lib/sales-inventory-scan.ts`
- Test dependency, read only: `src/lib/sales-inventory-scan.test.ts`

- [ ] **Step 1: Implement shortage handling before allocation persistence**

If total sellable detail quantity is below sold quantity:

```ts
const shortage = sale.soldQuantity - availableQuantity;
```

Persist the positive shortage:

```ts
await repo.upsertSalesException({
  异常编号: `EX-${transactionId}`,
  来源明细编号: `SALE-${sale.recordId}`,
  SKU: sale.sku,
  异常类型: "销售扣减库存不足",
  责任节点: "橙联可售",
  预期数量: sale.soldQuantity,
  实收数量: availableQuantity,
  差异数量: shortage,
  处理状态: "待处理",
  创建时间: input.now,
  备注: "销售日报扣减库存不足；补录库存或修正销售日报后重新扫描",
});
```

Do not update details or write stock flows. Keep the transaction pending with the shortage reason.

- [ ] **Step 2: Implement warning status preservation**

```ts
function nextWarningStatus(
  existing: InventoryWarningRecord | undefined,
  nextLevel: InventoryWarningLevel,
): InventoryWarningStatus {
  if (existing?.status === "已转采购" || existing?.status === "已关闭") {
    return existing.status;
  }
  if (existing?.status === "已通知" && existing.level !== nextLevel) {
    return "待处理";
  }
  return existing?.status ?? "待处理";
}
```

- [ ] **Step 3: Upsert SKU warnings**

Use:

```text
WARN-${Asia/Shanghai YYYYMMDD}-${SKU}
```

Persist warning rows after each affected SKU reaches a stable state. An inventory shortage or record-modification conflict writes level `异常`. Do not write `10_补货采购建议` in this phase.

- [ ] **Step 4: Complete the sales transaction only after warning persistence**

For a successfully deducted sale, after `upsertWarning` succeeds, or after calculation confirms that the SKU needs no warning, mark the sales transaction completed:

```ts
await repo.saveTransaction({
  ...transaction,
  status: "completed",
  updatedAt: input.now,
  completedAt: input.now,
  failureReason: undefined,
});
```

If warning persistence fails, retain `pending` and save the warning error in `失败原因`. On retry, allocation recovery must observe the existing detail and flow markers, skip the inventory deduction, retry the warning upsert while preserving `已转采购` or `已关闭`, and then complete the transaction.

Shortage transactions and sales-record modification conflicts remain pending after their abnormal warning is saved. They complete only after the source data or available inventory permits a normal deduction retry.

- [ ] **Step 5: Implement candidate selection without starvation**

Parse the full sales table before any write. Sort candidates as:

1. Pending transactions first.
2. Sale date ascending.
3. Record ID ascending.

Completed transactions and invalid records do not consume `limit`. Process records for the same SKU serially. After a record fails, skip later records for that SKU in the current scan so their calculations do not overwrite the failure state.

- [ ] **Step 6: Implement scan summary persistence**

Every service invocation writes exactly one summary row:

```ts
await repo.upsertScanLog({
  warningId: buildScanLogId(input.scanId),
  recordType: "扫描汇总",
  scanId: input.scanId,
  mode: input.mode,
  processed,
  deducted,
  skipped,
  exceptions,
  warnings,
  notificationMessageId,
  notificationAt,
  failureReason,
  createdAt: input.now,
  updatedAt: input.now,
});
```

The ID is:

```text
SCANLOG-${scanId}
```

Wrap the scan body so validation, repository, deduction, warning, and notification errors are copied into the scan summary before the service returns or rethrows. If `upsertScanLog` itself fails, surface that failure as `500`; there is no durable summary to claim success.

- [ ] **Step 7: Implement optional alert formatting**

Only send when `input.alertChatId` is non-empty and the scan produced an `异常`, `紧急`, or newly upgraded `需采购` warning. The message includes scan ID, processed counts, and at most 20 highest-priority SKUs.

```ts
const priority = { 异常: 0, 紧急: 1, 需采购: 2, 低库存: 3 } as const;
```

- [ ] **Step 8: Degrade notification failures without rolling back inventory**

Wrap only `repo.sendAlert`:

```ts
try {
  notificationMessageId = await repo.sendAlert(input.alertChatId, message);
  notificationAt = input.now;
  notificationStatus = "已发送";
} catch (error) {
  notificationStatus = "发送失败";
  notificationError = toErrorMessage(error);
}
```

Then write the scan summary with `notificationError` in `失败原因`. Do not change completed inventory transactions back to pending.

If `alertChatId` is absent, set `notificationStatus` to `未配置` and skip message delivery.

- [ ] **Step 9: Run warning, scan-log, and notification tests**

Run:

```bash
npm test -- src/lib/sales-inventory-scan.test.ts
```

Expected: all domain tests pass, including scan-log creation, manual-state preservation, notification omission, notification success, and notification failure degradation.

- [ ] **Step 10: Commit scan collaboration outputs**

```bash
git add src/lib/sales-inventory-scan.ts
git commit -m "feat: add inventory scan warnings and logs"
```

---

### Task 6: Implement the Lark scan repository

**Files:**
- Create: `src/lib/sales-inventory-lark-repository.ts`
- Modify: `src/lib/lark-server.ts`
- Test dependency, read only: `src/lib/lark-server.test.ts`
- Test dependency, read only: `src/lib/sales-inventory-scan.test.ts`

- [ ] **Step 1: Confirm Agent 3's failing table-key test**

In `src/lib/lark-server.test.ts`, assert:

```ts
vi.stubEnv("LARK_TABLE_INVENTORY_WARNING", "warning-table-id");
expect(getLarkTableId("inventoryWarning")).toBe("warning-table-id");
```

- [ ] **Step 2: Add only the backend-owned table key**

In `src/lib/lark-server.ts`:

```ts
inventoryWarning: "LARK_TABLE_INVENTORY_WARNING",
```

Do not modify `.env.example`.

- [ ] **Step 3: Implement strict complete reads**

The repository may read complete table snapshots and filter in memory. For sales, transactions, summaries, strategies, details, and flows, any `hasMore: true` result must throw before the first write:

```text
飞书记录未完整读取，拒绝执行销售库存扫描
```

The service must load all required snapshots before mutating inventory.

- [ ] **Step 4: Implement record conversions**

Conversions must use exact remote field names:

```text
07_销售日报: SKU, 日期, 售出数量, 店铺, 销售额
18_SKU库存策略: SKU, 安全库存, 补货周期天数
19_SKU运营汇总: SKU, 本地库存, 国内集货仓, 橙联在途, 橙联可售, 异常暂存
22_SKU批次库存明细: existing InventoryDetail mapping
24_库存流转事务: transaction metadata including 恢复上下文
25_库存预警日志: fields supplied by Lark Base agent
```

- [ ] **Step 5: Implement deterministic warning upserts**

Use `findUniqueLarkRecordByText` against `预警编号`. Map:

```ts
{
  预警编号: record.warningId,
  记录类型: record.recordType,
  扫描批次号: record.scanId,
  SKU: record.sku,
  预警等级: record.level,
  触发原因: record.triggerReason,
  橙联可售: record.sellable,
  总可用库存: record.totalAvailable,
  近7日日均销量: record.dailySales,
  预计可售天数: record.sellableDays,
  安全库存: record.safetyStock,
  补货周期天数: record.replenishCycleDays,
  建议采购量: record.suggestedPurchaseQuantity,
  处理状态: record.status,
  失败原因: record.failureReason ?? null,
}
```

Do not write `处理备注`; automated scans must preserve the human-entered value. Do not write the system-managed `创建时间` or `更新时间`.

- [ ] **Step 6: Implement deterministic scan-summary upserts**

Map:

```ts
{
  预警编号: record.warningId,
  记录类型: "扫描汇总",
  扫描批次号: record.scanId,
  处理销售记录数: record.processed,
  成功扣减数: record.deducted,
  跳过数: record.skipped,
  异常数: record.exceptions,
  预警SKU数: record.warnings,
  通知消息ID: record.notificationMessageId,
  通知时间: record.notificationAt,
  失败原因: record.failureReason ?? null,
}
```

- [ ] **Step 7: Delegate notification to the existing server helper**

```ts
async sendAlert(chatId, text) {
  return sendLarkMarkdownMessage(chatId, text);
}
```

The repository does not read the environment variable; the Route passes the optional chat ID into service input.

- [ ] **Step 8: Run repository tests**

Run:

```bash
npm test -- src/lib/lark-server.test.ts src/lib/sales-inventory-scan.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the Lark adapter**

```bash
git add src/lib/lark-server.ts \
  src/lib/sales-inventory-lark-repository.ts
git commit -m "feat: add lark sales inventory repository"
```

---

### Task 7: Implement API parsing and authentication helpers

**Files:**
- Create: `src/lib/sales-inventory-scan-api.ts`
- Test dependency, read only: `src/lib/sales-inventory-scan-api.test.ts`

- [ ] **Step 1: Confirm Agent 3's body-parser contract**

Assert:

```ts
expect(parseSalesScanRequest({})).toEqual({ limit: 200 });
expect(parseSalesScanRequest({ limit: 50 })).toEqual({ limit: 50 });
expect(() => parseSalesScanRequest({ limit: 0 })).toThrow("limit 必须是 1 到 500 的整数");
expect(() => parseSalesScanRequest({ limit: 501 })).toThrow("limit 必须是 1 到 500 的整数");
expect(() => parseSalesScanRequest({ mode: "scheduled" })).toThrow("请求体不允许指定 mode");
```

- [ ] **Step 2: Confirm Agent 3's Bearer verification contract**

Cover missing configured secret, malformed header, wrong token, and correct token.

```ts
expect(() => verifyScheduledScanAuthorization(
  "Bearer scan-secret",
  "scan-secret",
)).not.toThrow();
```

Use `crypto.timingSafeEqual` for equal-length token comparison.

- [ ] **Step 3: Confirm Agent 3's scan-ID contract**

With a fixed Shanghai timestamp and deterministic UUID input:

```ts
expect(createSalesScanId(1780621200000, "abcdef12-0000-0000-0000-000000000000"))
  .toBe("SCAN-20260605-0900-abcdef12");
```

- [ ] **Step 4: Run the API helper tests before implementation**

Run:

```bash
npm test -- src/lib/sales-inventory-scan-api.test.ts
```

Expected: FAIL because the API helper module does not exist.

- [ ] **Step 5: Implement the helper module**

Exports:

```ts
export function parseSalesScanRequest(body: unknown): { limit: number };
export function verifyScheduledScanAuthorization(
  authorization: string,
  expectedSecret?: string,
): void;
export function createSalesScanId(
  now?: number,
  uuid?: string,
): string;
```

The parser rejects arrays, non-object bodies, unknown `mode`, and limits outside `1..500`.

`createSalesScanId` must format both date and time with `Intl.DateTimeFormat` using `timeZone: "Asia/Shanghai"` and `hourCycle: "h23"`.

- [ ] **Step 6: Run helper tests**

Run:

```bash
npm test -- src/lib/sales-inventory-scan-api.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit API helpers**

```bash
git add src/lib/sales-inventory-scan-api.ts
git commit -m "feat: add sales scan api validation"
```

---

### Task 8: Implement the authenticated scan Route

**Files:**
- Create: `src/app/(main)/api/inventory/sales-scan/route.ts`
- Test dependency, read only: `src/app/(main)/api/inventory/sales-scan/route.test.ts`

- [ ] **Step 1: Confirm Agent 3's failing Route contract**

Mock:

```ts
vi.mock("@/lib/session-server");
vi.mock("@/lib/lark-server");
vi.mock("@/lib/sales-inventory-scan");
vi.mock("@/lib/sales-inventory-lark-repository");
```

Cover:

1. No Authorization header invokes `requireRole(["admin"])` and uses `mode: "manual"`.
2. Valid Bearer skips session lookup and uses `mode: "scheduled"` and operator `系统自动扫描`.
3. Invalid Bearer returns `401` even when an administrator cookie would be available.
4. Request body cannot select mode.
5. Invalid limit returns `400`.
6. Successful scan returns the service counters and notification status.
7. Sales-record modification conflict returns `409`.
8. Lark failures return `500` with a diagnosable message.

- [ ] **Step 2: Run route tests and verify failure**

Run:

```bash
npm test -- src/app/\(main\)/api/inventory/sales-scan/route.test.ts
```

Expected: FAIL because the Route does not exist.

- [ ] **Step 3: Implement Route mode selection**

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const now = Date.now();
    const authorization = request.headers.get("authorization");
    let mode: SalesScanMode;
    let operator: string;

    if (authorization !== null) {
      verifyScheduledScanAuthorization(
        authorization,
        process.env.INVENTORY_SALES_SCAN_SECRET,
      );
      mode = "scheduled";
      operator = "系统自动扫描";
    } else {
      const session = await requireRole(["admin"]);
      mode = "manual";
      operator = session.name;
    }

    const { limit } = parseSalesScanRequest(await request.json());
    const result = await runSalesInventoryScan(
      createLarkSalesInventoryScanRepository(),
      {
        scanId: createSalesScanId(now),
        mode,
        limit,
        operator,
        now,
        alertChatId: process.env.LARK_INVENTORY_ALERT_CHAT_ID?.trim() || undefined,
      },
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const status = salesScanErrorStatus(message);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
```

- [ ] **Step 4: Implement exact status mapping**

```ts
function salesScanErrorStatus(message: string): number {
  if (
    message.includes("计划任务密钥")
    || message.includes("未登录")
    || message.includes("登录状态")
  ) return 401;
  if (message.includes("权限不足")) return 403;
  if (message.includes("销售记录在扣减开始后被修改")) return 409;
  if (
    message.includes("limit")
    || message.includes("请求体")
    || message.includes("不允许指定 mode")
  ) return 400;
  return 500;
}
```

- [ ] **Step 5: Run route tests**

Run:

```bash
npm test -- src/app/\(main\)/api/inventory/sales-scan/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the Route**

```bash
git add src/app/\(main\)/api/inventory/sales-scan/route.ts
git commit -m "feat: expose authenticated sales inventory scan"
```

---

### Task 9: Cross-agent integration and full verification

**Files:**
- Verify: `src/lib/sales-inventory-scan.ts`
- Verify: `src/lib/sales-inventory-lark-repository.ts`
- Verify: `src/app/(main)/api/inventory/sales-scan/route.ts`
- Verify: `.env.example` changes supplied by Lark Base agent
- Verify: scheduler changes supplied by test and scheduler agent

- [ ] **Step 1: Verify the Lark Base agent contract**

Confirm the remote Base contains:

1. `24_库存流转事务.恢复上下文` as long text.
2. `23_库存异常.异常类型` option `销售扣减库存不足`.
3. `25_库存预警日志` fields used by Task 6.
4. `LARK_TABLE_INVENTORY_WARNING` documented in `.env.example`.

- [ ] **Step 2: Verify the scheduler agent contract**

The scheduler calls:

```http
POST /api/inventory/sales-scan
Authorization: Bearer ${INVENTORY_SALES_SCAN_SECRET}
Content-Type: application/json

{"limit":200}
```

The scheduler must not send `mode`.

- [ ] **Step 3: Run all focused tests**

Run:

```bash
npm test -- src/lib/sales-inventory-scan.test.ts \
  src/lib/sales-inventory-scan-api.test.ts \
  src/app/\(main\)/api/inventory/sales-scan/route.test.ts \
  src/lib/inventory-batch-server.test.ts \
  src/lib/lark-server.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the full suite**

Run:

```bash
npm test
```

Expected: all test files and tests pass.

- [ ] **Step 5: Run static verification**

Run:

```bash
npm run lint
npm run build
```

Expected: ESLint exits successfully and Next.js production build succeeds.

- [ ] **Step 6: Perform a controlled integration check**

With a test SKU whose `橙联可售` quantity is `10`, insert one sales row with quantity `3`, invoke the manual endpoint as an administrator, and verify:

1. One or more `22_SKU批次库存明细` rows total `7` sellable units.
2. `02_库存流水` contains total delta `-3` for the sales transaction.
3. `19_SKU运营汇总.橙联可售` equals `7`.
4. One `25_库存预警日志` scan summary exists with ID `SCANLOG-${scanId}`.
5. Repeating the scan does not deduct another `3`.

- [ ] **Step 7: Commit only integration corrections, if required**

Stage only files owned by this backend plan:

```bash
git add src/lib/sales-inventory-scan.ts \
  src/lib/sales-inventory-scan-api.ts \
  src/lib/sales-inventory-lark-repository.ts \
  src/lib/inventory-batch-server.ts \
  src/lib/inventory-lark-repository.ts \
  src/lib/lark-server.ts \
  src/app/\(main\)/api/inventory/sales-scan/route.ts
git commit -m "fix: complete sales inventory scan integration"
```

Skip this commit when no integration correction is necessary.

## Interface Contract with Lark Base Agent

The Lark Base agent owns remote schema, views, and `.env.example`. The backend requires these exact fields:

### `24_库存流转事务`

```text
事务号
请求摘要
事务状态
操作类型
操作人
创建时间
更新时间
完成时间
失败原因
恢复上下文
备注
```

### `23_库存异常`

`异常类型` includes `销售扣减库存不足`.

### `25_库存预警日志`

```text
预警编号
记录类型
扫描批次号
SKU
预警等级
触发原因
橙联可售
总可用库存
近7日日均销量
预计可售天数
安全库存
补货周期天数
建议采购量
处理状态
处理备注
处理销售记录数
成功扣减数
跳过数
异常数
预警SKU数
通知消息ID
通知时间
失败原因
创建时间
更新时间
```

Required select values:

```text
记录类型: 库存预警, 扫描汇总
预警等级: 异常, 紧急, 需采购, 低库存
处理状态: 待处理, 已通知, 已转采购, 已关闭
```

## Interface Contract with Test and Scheduler Agent

The test and scheduler agent owns detailed tests and deployment schedule configuration. It must use:

```text
INVENTORY_SALES_SCAN_SECRET
LARK_INVENTORY_ALERT_CHAT_ID
```

`LARK_INVENTORY_ALERT_CHAT_ID` is optional. Missing configuration is a normal `未配置` result, not an error.

The scheduled request body contains only:

```json
{"limit":200}
```

The backend must expose these functions for tests:

```ts
parseSalesDailyRecord
buildSalesTransactionId
buildWarningId
buildScanLogId
calculateSalesMetrics
calculateInventoryWarning
allocateSellableInventory
runSalesInventoryScan
parseSalesScanRequest
verifyScheduledScanAuthorization
createSalesScanId
```

## Error Semantics

| Situation | Backend behavior | HTTP result |
| --- | --- | --- |
| Manual request without session | No scan | `401` |
| Manual request by non-admin | No scan | `403` |
| Present invalid Bearer header | No cookie fallback, no scan | `401` |
| Invalid limit or body-selected mode | No scan | `400` |
| Sales table truncated | No write | `500` |
| Invalid sales record with parseable SKU | Persist abnormal warning, skip record | Successful scan summary with exception count |
| Invalid sales record without SKU | Skip record and record the reason in scan summary | Successful scan summary with exception count |
| Missing SKU summary | Persist abnormal warning, skip SKU | Successful scan summary with exception count |
| Sellable inventory shortage | Positive shortage exception, no deduction | Successful scan summary with exception count |
| Pending transaction facts modified after allocation | No further mutation | `409` |
| Flow or summary write failure | Transaction remains pending with recovery context | `500` |
| Warning write failure | Surface failure so retry is visible | `500` |
| Notification not configured | Skip sending | `200`, status `未配置` |
| Notification send failure | Preserve completed inventory, write failure into scan summary | `200`, status `发送失败` |

## Risks and Required Mitigations

1. Lark Base has no cross-table transaction. Persist allocation context before mutation and use deterministic flow IDs plus detail transaction/version markers.
2. Deducting only `19_SKU运营汇总` would allow a later detail rebuild to restore sold stock. Every successful sale must update `22_SKU批次库存明细`.
3. A completely sold detail must remain with quantity `0`; deleting it would remove the recovery marker.
4. Full sales-table reads are required for correct cumulative and seven-day metrics. Truncated reads must stop before writes.
5. Concurrent manual and scheduled scans can race because Lark lacks a unique constraint. Deployment scheduling should avoid overlap, while deterministic transaction IDs limit duplicate effects.
6. Human warning states `已转采购` and `已关闭` are authoritative and must survive automated upserts.
7. Notification is ancillary. Its failure must never undo inventory, transaction, flow, summary, exception, or warning writes.
8. Phase one does not write `10_补货采购建议`; only warning logs and optional notifications are produced.
