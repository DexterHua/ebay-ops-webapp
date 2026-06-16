import {
  createLarkRecords,
  findUniqueLarkRecordByText,
  listLarkRecords,
  readLarkText,
  sendLarkMarkdownMessage,
  updateLarkRecord,
  type LarkRecord,
  type LarkTable,
} from "@/lib/lark-server";
import type { InventoryDetail, InventoryState } from "@/lib/inventory-flow";
import type { InventoryExceptionRecord, InventoryTransactionRecord } from "@/lib/inventory-batch-server";
import type {
  InventoryScanLogRecord,
  InventoryWarningRecord,
  SalesInventoryScanRepository,
  SkuInventorySnapshot,
  SkuStockStrategy,
} from "@/lib/sales-inventory-scan";

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return toNumber(record.value ?? record.text ?? record.number, fallback);
  }
  return fallback;
}

function requireComplete(result: { hasMore: boolean }, label: string): void {
  if (result.hasMore) throw new Error(`${label}未完整读取，拒绝执行销售库存扫描`);
}

function detailFromFields(recordId: string, fields: Record<string, unknown>): InventoryDetail {
  return {
    recordId,
    明细编号: readLarkText(fields.明细编号),
    来源采购批次: readLarkText(fields.来源采购批次),
    当前物流批次: readLarkText(fields.当前物流批次),
    SKU: readLarkText(fields.SKU),
    中文品名快照: readLarkText(fields.中文品名快照),
    原始数量: toNumber(fields.原始数量),
    当前数量: toNumber(fields.当前数量),
    异常数量: toNumber(fields.异常数量),
    当前状态: readLarkText(fields.当前状态) as InventoryState,
    版本号: toNumber(fields.版本号),
    最近操作人: readLarkText(fields.最近操作人),
    最近更新时间: toNumber(fields.最近更新时间),
    最近流转事务号: readLarkText(fields.最近流转事务号),
    备注: readLarkText(fields.备注),
  } as InventoryDetail & { recordId: string };
}

function detailToFields(detail: InventoryDetail): Record<string, unknown> {
  return {
    明细编号: detail.明细编号,
    来源采购批次: detail.来源采购批次,
    当前物流批次: detail.当前物流批次,
    SKU: detail.SKU,
    中文品名快照: detail.中文品名快照,
    原始数量: detail.原始数量,
    当前数量: detail.当前数量,
    异常数量: detail.异常数量 ?? 0,
    当前状态: detail.当前状态,
    是否完成: detail.当前状态 === "橙联可售",
    最近操作人: detail.最近操作人,
    最近更新时间: detail.最近更新时间,
    最近流转事务号: detail.最近流转事务号,
    版本号: detail.版本号,
    备注: detail.备注,
  };
}

function transactionFromFields(fields: Record<string, unknown>): InventoryTransactionRecord {
  return {
    transactionId: readLarkText(fields.事务号),
    digest: readLarkText(fields.请求摘要),
    status: readLarkText(fields.事务状态) === "completed" ? "completed" : "pending",
    operationType: readLarkText(fields.操作类型),
    operator: readLarkText(fields.操作人),
    createdAt: toNumber(fields.创建时间),
    updatedAt: toNumber(fields.更新时间),
    completedAt: toNumber(fields.完成时间),
    failureReason: readLarkText(fields.失败原因),
    recoveryContext: readLarkText(fields.恢复上下文),
    remark: readLarkText(fields.备注),
  };
}

function transactionToFields(record: InventoryTransactionRecord): Record<string, unknown> {
  return {
    事务号: record.transactionId,
    请求摘要: record.digest,
    事务状态: record.status,
    操作类型: record.operationType,
    操作人: record.operator,
    创建时间: record.createdAt,
    更新时间: record.updatedAt ?? Date.now(),
    完成时间: record.completedAt || null,
    失败原因: record.failureReason || null,
    恢复上下文: record.recoveryContext || null,
    备注: record.remark,
  };
}

function summaryFromRecord(record: LarkRecord): SkuInventorySnapshot {
  return {
    recordId: record.recordId,
    sku: readLarkText(record.fields.SKU),
    本地库存: toNumber(record.fields.本地库存),
    国内集货仓: toNumber(record.fields.国内集货仓),
    橙联在途: toNumber(record.fields.橙联在途),
    橙联可售: toNumber(record.fields.橙联可售),
    异常暂存: toNumber(record.fields.异常暂存),
  };
}

function strategyFromRecord(record: LarkRecord): SkuStockStrategy {
  return {
    sku: readLarkText(record.fields.SKU),
    安全库存: toNumber(record.fields.安全库存),
    补货周期天数: toNumber(record.fields.补货周期天数, 30),
  };
}

function warningFromFields(fields: Record<string, unknown>): InventoryWarningRecord {
  return {
    warningId: readLarkText(fields.预警编号),
    recordType: "库存预警",
    scanId: readLarkText(fields.扫描批次号),
    sku: readLarkText(fields.SKU),
    level: readLarkText(fields.预警等级) as InventoryWarningRecord["level"],
    triggerReason: readLarkText(fields.触发原因),
    sellable: toNumber(fields.橙联可售),
    totalAvailable: toNumber(fields.总可用库存),
    dailySales: toNumber(fields.近7日日均销量),
    sellableDays: toNumber(fields.预计可售天数, Number.NaN),
    safetyStock: toNumber(fields.安全库存),
    replenishCycleDays: toNumber(fields.补货周期天数, 30),
    suggestedPurchaseQuantity: toNumber(fields.建议采购量),
    status: readLarkText(fields.处理状态) as InventoryWarningRecord["status"],
    processingRemark: readLarkText(fields.处理备注),
    failureReason: readLarkText(fields.失败原因),
    createdAt: toNumber(fields.创建时间),
    updatedAt: toNumber(fields.更新时间),
  };
}

function stockFlowMatches(fields: Record<string, unknown>, target: Record<string, unknown>): boolean {
  return readLarkText(fields.流转事务号) === readLarkText(target.流转事务号)
    && readLarkText(fields.来源明细编号) === readLarkText(target.来源明细编号)
    && readLarkText(fields.SKU) === readLarkText(target.SKU)
    && readLarkText(fields.库存位置) === readLarkText(target.库存位置)
    && toNumber(fields.数量变动, Number.NaN) === toNumber(target.数量变动, Number.NaN)
    && readLarkText(fields.操作类型) === readLarkText(target.操作类型);
}

async function upsertByTextField(table: LarkTable, field: string, value: string, fields: Record<string, unknown>): Promise<void> {
  const result = await listLarkRecords(table);
  requireComplete(result, "飞书记录");
  const existing = findUniqueLarkRecordByText(result, field, value);
  if (existing) await updateLarkRecord(table, existing.recordId, fields);
  else await createLarkRecords(table, [fields]);
}

export function createLarkSalesInventoryScanRepository(): SalesInventoryScanRepository {
  return {
    async listSalesRecords() {
      const result = await listLarkRecords("sales");
      return result;
    },

    async listTransactions(transactionIds) {
      const wanted = new Set(transactionIds);
      const result = await listLarkRecords("inventoryTransaction");
      requireComplete(result, "库存事务记录");
      return new Map(result.records
        .map((record) => transactionFromFields(record.fields))
        .filter((record) => wanted.has(record.transactionId))
        .map((record) => [record.transactionId, record]));
    },

    async listSkuSummaries(skus) {
      const wanted = new Set(skus);
      const result = await listLarkRecords("summary");
      requireComplete(result, "SKU运营汇总记录");
      return new Map(result.records
        .map(summaryFromRecord)
        .filter((record) => wanted.has(record.sku))
        .map((record) => [record.sku, record]));
    },

    async listStockStrategies(skus) {
      const wanted = new Set(skus);
      const result = await listLarkRecords("strategy");
      requireComplete(result, "SKU库存策略记录");
      return new Map(result.records
        .map(strategyFromRecord)
        .filter((record) => wanted.has(record.sku))
        .map((record) => [record.sku, record]));
    },

    async listSellableDetails(skus) {
      const wanted = new Set(skus);
      const result = await listLarkRecords("inventoryDetail");
      requireComplete(result, "库存明细记录");
      return result.records
        .map((record) => detailFromFields(record.recordId, record.fields))
        .filter((detail) => wanted.has(detail.SKU) && detail.当前状态 === "橙联可售");
    },

    async listStockFlows(transactionIds) {
      const wanted = new Set(transactionIds);
      const result = await listLarkRecords("stockFlow");
      requireComplete(result, "库存流水记录");
      return result.records.filter((record) => wanted.has(readLarkText(record.fields.流转事务号)));
    },

    async getWarning(warningId) {
      const result = await listLarkRecords("inventoryWarning");
      requireComplete(result, "库存预警记录");
      const existing = findUniqueLarkRecordByText(result, "预警编号", warningId);
      return existing ? warningFromFields(existing.fields) : undefined;
    },

    async saveTransaction(record) {
      await upsertByTextField("inventoryTransaction", "事务号", record.transactionId, transactionToFields(record));
    },

    async updateInventoryDetail(detailId, detail) {
      await upsertByTextField("inventoryDetail", "明细编号", detailId, detailToFields({ ...detail, 明细编号: detailId }));
    },

    async upsertStockFlow(flowId, fields) {
      const normalizedFields = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined && value !== ""),
      );
      const result = await listLarkRecords("stockFlow");
      requireComplete(result, "库存流水记录");
      const existing = result.records.find((record) => record.recordId === flowId || stockFlowMatches(record.fields, normalizedFields));
      if (existing) await updateLarkRecord("stockFlow", existing.recordId, normalizedFields);
      else await createLarkRecords("stockFlow", [normalizedFields]);
    },

    async updateSkuSummary(sku, fields) {
      await upsertByTextField("summary", "SKU", sku, { SKU: sku, ...fields });
    },

    async upsertSalesException(record: InventoryExceptionRecord) {
      await upsertByTextField("inventoryException", "异常编号", record.异常编号, { ...record });
    },

    async upsertWarning(record) {
      await upsertByTextField("inventoryWarning", "预警编号", record.warningId, {
        预警编号: record.warningId,
        记录类型: record.recordType,
        扫描批次号: record.scanId,
        SKU: record.sku,
        预警等级: record.level,
        触发原因: record.triggerReason,
        橙联可售: record.sellable,
        总可用库存: record.totalAvailable,
        近7日日均销量: record.dailySales,
        预计可售天数: Number.isFinite(record.sellableDays) ? record.sellableDays : null,
        安全库存: record.safetyStock,
        补货周期天数: record.replenishCycleDays,
        建议采购量: record.suggestedPurchaseQuantity,
        处理状态: record.status,
        失败原因: record.failureReason || null,
      });
    },

    async upsertScanLog(record: InventoryScanLogRecord) {
      await upsertByTextField("inventoryWarning", "预警编号", record.warningId, {
        预警编号: record.warningId,
        记录类型: record.recordType,
        扫描批次号: record.scanId,
        处理销售记录数: record.processed,
        成功扣减数: record.deducted,
        跳过数: record.skipped,
        异常数: record.exceptions,
        预警SKU数: record.warnings,
        通知消息ID: record.notificationMessageId,
        通知时间: record.notificationAt,
        失败原因: record.failureReason || null,
      });
    },

    async sendAlert(chatId, text) {
      return sendLarkMarkdownMessage(chatId, text);
    },
  };
}
