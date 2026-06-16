import crypto from "node:crypto";
import type {
  InventoryExceptionRecord,
  InventoryTransactionRecord,
} from "@/lib/inventory-batch-server";
import { summarizeDetails, type InventoryDetail } from "@/lib/inventory-flow";
import { readLarkText, type LarkRecord } from "@/lib/lark-server";

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
  completedSteps: Array<"stock_flow_created" | "summary_updated" | "sales_summary_refreshed" | "warning_written">;
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

function readNumber(value: unknown, label: string, allowMissing = false): number {
  if (allowMissing && (value === undefined || value === null || value === "")) return 0;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return readNumber(record.value ?? record.text ?? record.number, label, allowMissing);
  }
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.replace(/,/g, ""))
      : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`${label}必须是有限数`);
  return parsed;
}

function readText(value: unknown): string {
  return readLarkText(value).trim();
}

function readPositiveInteger(value: unknown, label: string): number {
  const parsed = readNumber(value, label);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label}必须是正整数`);
  return parsed;
}

function readTimestamp(value: unknown, label: string): number {
  const parsed = readNumber(value, label);
  if (!Number.isFinite(parsed)) throw new Error(`${label}必须是有效时间`);
  return parsed;
}

function shanghaiDate(now: number): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(now)).replaceAll("-", "");
}

function stableDigest(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function flowId(transactionId: string, detailId: string): string {
  return `${transactionId}-${detailId}-SALE-OUT`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseSalesDailyRecord(record: LarkRecord): SalesDailyRecord {
  const sku = readText(record.fields.SKU).toUpperCase();
  if (!sku) throw new Error("SKU 不能为空");
  return {
    recordId: record.recordId,
    sku,
    soldQuantity: readPositiveInteger(record.fields.售出数量, "售出数量"),
    saleDate: readTimestamp(record.fields.日期, "日期"),
    store: readText(record.fields.店铺),
    salesAmount: readNumber(record.fields.销售额, "销售额", true),
  };
}

export function buildSalesTransactionId(recordId: string, sku: string): string {
  return `SALE-${recordId.trim()}-${sku.trim().toUpperCase()}`;
}

export function buildWarningId(now: number, sku: string): string {
  return `WARN-${shanghaiDate(now)}-${sku.trim().toUpperCase()}`;
}

export function buildScanLogId(scanId: string): string {
  return `SCANLOG-${scanId}`;
}

export function calculateSalesMetrics(
  sales: SalesDailyRecord[],
  sku: string,
  now: number,
): { cumulativeSales: number; recentDailySales: number } {
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const matching = sales.filter((sale) => sale.sku === sku);
  const cumulativeSales = matching.reduce((sum, sale) => sum + sale.soldQuantity, 0);
  const recentSales = matching
    .filter((sale) => sale.saleDate >= sevenDaysAgo && sale.saleDate <= now)
    .reduce((sum, sale) => sum + sale.soldQuantity, 0);
  return { cumulativeSales, recentDailySales: recentSales / 7 };
}

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
  const sellableDays = input.dailySales > 0 ? input.sellable / input.dailySales : undefined;
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

export function allocateSellableInventory(
  details: InventoryDetail[],
  soldQuantity: number,
): SalesDeductionAllocation[] {
  let remaining = soldQuantity;
  const allocations: SalesDeductionAllocation[] = [];
  const sorted = details
    .filter((detail) => detail.当前状态 === "橙联可售" && detail.当前数量 > 0)
    .sort((a, b) => (a.最近更新时间 ?? 0) - (b.最近更新时间 ?? 0)
      || String(a.明细编号 || "").localeCompare(String(b.明细编号 || "")));
  for (const detail of sorted) {
    if (remaining === 0) break;
    if (!detail.明细编号) throw new Error("橙联可售明细缺少明细编号");
    const quantity = Math.min(detail.当前数量, remaining);
    allocations.push({ detailId: detail.明细编号, quantity, expectedVersion: detail.版本号 ?? 0 });
    remaining -= quantity;
  }
  return allocations;
}

function digestSalesRecord(sale: SalesDailyRecord): string {
  return stableDigest({
    recordId: sale.recordId,
    sku: sale.sku,
    soldQuantity: sale.soldQuantity,
    saleDate: sale.saleDate,
  });
}

function parseRecoveryContext(record: InventoryTransactionRecord | undefined): SalesRecoveryContext | undefined {
  if (!record?.recoveryContext) return undefined;
  const parsed = JSON.parse(record.recoveryContext) as SalesRecoveryContext;
  if (parsed.version !== 1 || !Array.isArray(parsed.allocations)) {
    throw new Error("销售扣减恢复上下文无效");
  }
  return parsed;
}

function makeRecoveryContext(sale: SalesDailyRecord, allocations: SalesDeductionAllocation[]): SalesRecoveryContext {
  return {
    version: 1,
    salesRecordId: sale.recordId,
    sku: sale.sku,
    soldQuantity: sale.soldQuantity,
    saleDate: sale.saleDate,
    allocations,
    completedSteps: [],
  };
}

function inventorySummary(
  details: InventoryDetail[],
  sku: string,
  base?: SkuInventorySnapshot,
) {
  const summaries = summarizeDetails(details.map((detail) => ({
    SKU: detail.SKU,
    当前数量: detail.当前数量,
    当前状态: detail.当前状态,
    异常数量: detail.异常数量,
  })));
  const sellableSummary = summaries[sku] || {
    橙联可售: 0,
    异常暂存: 0,
  };
  const next = {
    本地库存: base?.本地库存 ?? 0,
    国内集货仓: base?.国内集货仓 ?? 0,
    橙联在途: base?.橙联在途 ?? 0,
    橙联可售: sellableSummary.橙联可售,
    异常暂存: (base?.异常暂存 ?? 0) + sellableSummary.异常暂存,
    总可用库存: 0,
    账面总量: 0,
  };
  next.总可用库存 = next.本地库存 + next.国内集货仓 + next.橙联在途 + next.橙联可售;
  next.账面总量 = next.总可用库存 + next.异常暂存;
  return next;
}

function nextWarningStatus(
  existing: InventoryWarningRecord | undefined,
  nextLevel: InventoryWarningLevel,
): InventoryWarningStatus {
  if (existing?.status === "已转采购" || existing?.status === "已关闭") return existing.status;
  if (existing?.status === "已通知" && existing.level !== nextLevel) return "待处理";
  return existing?.status || "待处理";
}

async function upsertWarningForSku(
  repo: SalesInventoryScanRepository,
  input: SalesInventoryScanInput,
  sale: SalesDailyRecord,
  level: InventoryWarningLevel,
  summary: ReturnType<typeof inventorySummary>,
  metrics: { recentDailySales: number },
  strategy: SkuStockStrategy,
  reason: string,
  failureReason?: string,
): Promise<InventoryWarningRecord> {
  const warningId = buildWarningId(input.now, sale.sku);
  const existing = await repo.getWarning(warningId);
  const warningCalc = calculateInventoryWarning({
    sellable: summary.橙联可售,
    totalAvailable: summary.总可用库存,
    dailySales: metrics.recentDailySales,
    safetyStock: strategy.安全库存,
    replenishCycleDays: strategy.补货周期天数,
  });
  const warning: InventoryWarningRecord = {
    warningId,
    recordType: "库存预警",
    scanId: input.scanId,
    sku: sale.sku,
    level,
    triggerReason: reason,
    sellable: summary.橙联可售,
    totalAvailable: summary.总可用库存,
    dailySales: metrics.recentDailySales,
    sellableDays: warningCalc.sellableDays,
    safetyStock: strategy.安全库存,
    replenishCycleDays: strategy.补货周期天数,
    suggestedPurchaseQuantity: warningCalc.suggestedPurchaseQuantity,
    status: nextWarningStatus(existing, level),
    processingRemark: existing?.processingRemark,
    failureReason,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
  await repo.upsertWarning(warning);
  return warning;
}

async function saveTransaction(
  repo: SalesInventoryScanRepository,
  existing: InventoryTransactionRecord | undefined,
  patch: InventoryTransactionRecord,
): Promise<InventoryTransactionRecord> {
  const record = { ...existing, ...patch };
  await repo.saveTransaction(record);
  return record;
}

async function applyAllocations(
  repo: SalesInventoryScanRepository,
  input: SalesInventoryScanInput,
  sale: SalesDailyRecord,
  transactionId: string,
  allocations: SalesDeductionAllocation[],
  sellableDetails: InventoryDetail[],
  stockFlows: LarkRecord[],
): Promise<void> {
  const flowRecordIds = new Set(stockFlows.map((flow) => flow.recordId));
  const detailById = new Map(sellableDetails.map((detail) => [detail.明细编号, detail]));

  for (const allocation of allocations) {
    const id = flowId(transactionId, allocation.detailId);
    if (flowRecordIds.has(id)) continue;

    const detail = detailById.get(allocation.detailId);
    if (!detail?.明细编号) throw new Error(`未找到橙联可售明细 ${allocation.detailId}`);
    const expectedAppliedVersion = allocation.expectedVersion + 1;
    const alreadyUpdated = detail.最近流转事务号 === transactionId && (detail.版本号 ?? 0) === expectedAppliedVersion;

    if (!alreadyUpdated) {
      if ((detail.版本号 ?? 0) !== allocation.expectedVersion) {
        throw new Error(`明细 ${allocation.detailId} 版本不匹配`);
      }
      const nextQuantity = detail.当前数量 - allocation.quantity;
      if (!Number.isSafeInteger(nextQuantity) || nextQuantity < 0) {
        throw new Error(`明细 ${allocation.detailId} 橙联可售库存不足`);
      }
      const nextDetail = {
        ...detail,
        当前数量: nextQuantity,
        版本号: expectedAppliedVersion,
        最近操作人: input.operator,
        最近更新时间: input.now,
        最近流转事务号: transactionId,
      };
      await repo.updateInventoryDetail(allocation.detailId, nextDetail);
      detailById.set(allocation.detailId, nextDetail);
    }

    await repo.upsertStockFlow(id, {
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
    });
    flowRecordIds.add(id);
  }
}

async function writeScanLog(
  repo: SalesInventoryScanRepository,
  input: SalesInventoryScanInput,
  result: Omit<SalesInventoryScanResult, "scanId" | "mode">,
  messageId?: string,
  notificationAt?: number,
): Promise<void> {
  await repo.upsertScanLog({
    warningId: buildScanLogId(input.scanId),
    recordType: "扫描汇总",
    scanId: input.scanId,
    mode: input.mode,
    processed: result.processed,
    deducted: result.deducted,
    skipped: result.skipped,
    exceptions: result.exceptions,
    warnings: result.warnings,
    notificationMessageId: messageId,
    notificationAt,
    failureReason: result.notificationError,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

function notificationText(input: SalesInventoryScanInput, result: SalesInventoryScanResult): string {
  return [
    "库存预警扫描完成",
    `扫描批次：${input.scanId}`,
    `处理销售记录：${result.processed} 条`,
    `成功扣减：${result.deducted} 条`,
    `异常：${result.exceptions} 条`,
    `预警 SKU：${result.warnings} 个`,
  ].join("\n");
}

export async function runSalesInventoryScan(
  repo: SalesInventoryScanRepository,
  input: SalesInventoryScanInput,
): Promise<SalesInventoryScanResult> {
  const salesResult = await repo.listSalesRecords();
  if (salesResult.hasMore) throw new Error("飞书记录未完整读取，拒绝执行销售库存扫描");

  const sales: SalesDailyRecord[] = [];
  let skippedSales = 0;
  for (const record of salesResult.records) {
    try {
      sales.push(parseSalesDailyRecord(record));
    } catch {
      skippedSales += 1;
    }
  }
  const skus = [...new Set(sales.map((sale) => sale.sku))];
  const transactionIds = sales.map((sale) => buildSalesTransactionId(sale.recordId, sale.sku));
  const transactions = await repo.listTransactions(transactionIds);
  const summaries = await repo.listSkuSummaries(skus);
  const strategies = await repo.listStockStrategies(skus);
  let sellableDetails = await repo.listSellableDetails(skus);
  let stockFlows = await repo.listStockFlows(transactionIds);

  const result: SalesInventoryScanResult = {
    scanId: input.scanId,
    mode: input.mode,
    processed: 0,
    deducted: 0,
    skipped: skippedSales,
    exceptions: 0,
    warnings: 0,
    notificationStatus: "未配置",
  };

  const candidates = sales
    .filter((sale) => transactions.get(buildSalesTransactionId(sale.recordId, sale.sku))?.status !== "completed")
    .sort((a, b) => {
      const ta = transactions.get(buildSalesTransactionId(a.recordId, a.sku))?.status === "pending" ? 0 : 1;
      const tb = transactions.get(buildSalesTransactionId(b.recordId, b.sku))?.status === "pending" ? 0 : 1;
      return ta - tb || a.saleDate - b.saleDate || a.recordId.localeCompare(b.recordId);
    })
    .slice(0, input.limit);

  for (const sale of candidates) {
    const transactionId = buildSalesTransactionId(sale.recordId, sale.sku);
    const digest = digestSalesRecord(sale);
    let transaction = transactions.get(transactionId);
    result.processed += 1;

    if (transaction && transaction.digest !== digest) {
      throw new Error("销售记录在扣减开始后被修改");
    }

    const skuDetails = sellableDetails.filter((detail) => detail.SKU === sale.sku);
    const availableQuantity = skuDetails.reduce((sum, detail) => sum + Math.max(0, detail.当前数量), 0);
    const metrics = calculateSalesMetrics(sales, sale.sku, input.now);
    const strategy = strategies.get(sale.sku) || { sku: sale.sku, 安全库存: 0, 补货周期天数: 30 };
    const existingSummary = summaries.get(sale.sku);
    if (!existingSummary) throw new Error(`未找到 SKU ${sale.sku} 的运营汇总记录`);

    const parsedContext = parseRecoveryContext(transaction);
    const context = transaction?.failureReason === "销售扣减库存不足" ? undefined : parsedContext;

    if (!context && availableQuantity < sale.soldQuantity) {
      const shortage = sale.soldQuantity - availableQuantity;
      transaction = await saveTransaction(repo, transaction, {
        transactionId,
        digest,
        status: "pending",
        operationType: "订单出库",
        operator: input.operator,
        createdAt: transaction?.createdAt ?? input.now,
        updatedAt: input.now,
        failureReason: "销售扣减库存不足",
        recoveryContext: undefined,
        remark: transaction?.remark,
      });
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
      const summary = {
        本地库存: existingSummary.本地库存,
        国内集货仓: existingSummary.国内集货仓,
        橙联在途: existingSummary.橙联在途,
        橙联可售: existingSummary.橙联可售,
        异常暂存: existingSummary.异常暂存,
        总可用库存: existingSummary.本地库存 + existingSummary.国内集货仓 + existingSummary.橙联在途 + existingSummary.橙联可售,
        账面总量: existingSummary.本地库存 + existingSummary.国内集货仓 + existingSummary.橙联在途 + existingSummary.橙联可售 + existingSummary.异常暂存,
      };
      await upsertWarningForSku(repo, input, sale, "异常", summary, metrics, strategy, "销售扣减库存不足", "销售扣减库存不足");
      result.exceptions += 1;
      result.warnings += 1;
      continue;
    }

    const allocations = context?.allocations || allocateSellableInventory(skuDetails, sale.soldQuantity);
    transaction = await saveTransaction(repo, transaction, {
      transactionId,
      digest,
      status: "pending",
      operationType: "订单出库",
      operator: input.operator,
      createdAt: transaction?.createdAt ?? input.now,
      updatedAt: input.now,
      failureReason: undefined,
      recoveryContext: JSON.stringify(context || makeRecoveryContext(sale, allocations)),
      remark: transaction?.remark,
    });

    try {
      await applyAllocations(repo, input, sale, transactionId, allocations, sellableDetails, stockFlows);
      sellableDetails = await repo.listSellableDetails(skus);
      stockFlows = await repo.listStockFlows(transactionIds);
      const summary = inventorySummary(
        sellableDetails.filter((detail) => detail.SKU === sale.sku),
        sale.sku,
        existingSummary,
      );
      await repo.updateSkuSummary(sale.sku, {
        ...summary,
        累计销量: metrics.cumulativeSales,
        近7日日均销量: metrics.recentDailySales,
        快照日期: input.now,
      });
      const warning = calculateInventoryWarning({
        sellable: summary.橙联可售,
        totalAvailable: summary.总可用库存,
        dailySales: metrics.recentDailySales,
        safetyStock: strategy.安全库存,
        replenishCycleDays: strategy.补货周期天数,
      });
      if (warning.level) {
        await upsertWarningForSku(repo, input, sale, warning.level, summary, metrics, strategy, warning.level);
        result.warnings += 1;
      }
      await repo.saveTransaction({
        ...transaction,
        status: "completed",
        updatedAt: input.now,
        completedAt: input.now,
        failureReason: undefined,
      });
      transactions.set(transactionId, { ...transaction, status: "completed", digest });
      result.deducted += 1;
    } catch (error) {
      await repo.saveTransaction({
        ...transaction,
        status: "pending",
        updatedAt: input.now,
        failureReason: errorMessage(error),
      });
      throw error;
    }
  }

  let messageId: string | undefined;
  let notificationAt: number | undefined;
  if (input.alertChatId && (result.warnings > 0 || result.exceptions > 0)) {
    try {
      messageId = await repo.sendAlert(input.alertChatId, notificationText(input, result));
      notificationAt = input.now;
      result.notificationStatus = "已发送";
    } catch (error) {
      result.notificationStatus = "发送失败";
      result.notificationError = errorMessage(error);
    }
  }

  await writeScanLog(repo, input, result, messageId, notificationAt);
  return result;
}
