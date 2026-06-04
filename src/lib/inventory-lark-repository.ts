import {
  createLarkRecords,
  findUniqueLarkRecordByText,
  listLarkRecords,
  readLarkText,
  updateLarkRecord,
} from "@/lib/lark-server";
import type {
  InventoryBatchRepository,
  InventoryExceptionRecord,
  InventoryTransactionRecord,
} from "@/lib/inventory-batch-server";
import type { InventoryDetail, InventoryState } from "@/lib/inventory-flow";

const transactionStore = new Map<string, InventoryTransactionRecord>();

function hasPersistentTransactionTable(): boolean {
  return Boolean(process.env.LARK_TABLE_INVENTORY_TRANSACTION?.trim());
}

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

function toInventoryState(value: unknown): InventoryState {
  const text = readLarkText(value) as InventoryState;
  return text;
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
    当前状态: toInventoryState(fields.当前状态),
    版本号: toNumber(fields.版本号),
    最近操作人: readLarkText(fields.最近操作人),
    最近更新时间: toNumber(fields.最近更新时间),
    最近流转事务号: readLarkText(fields.最近流转事务号),
    备注: readLarkText(fields.备注),
  } as InventoryDetail & { recordId: string };
}

function detailToFields(detail: InventoryDetail): Record<string, unknown> {
  return Object.fromEntries(Object.entries({
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
  }).filter(([, value]) => value !== undefined && value !== ""));
}

function transactionFromFields(fields: Record<string, unknown>): InventoryTransactionRecord {
  const transactionId = readLarkText(fields.事务号);
  const digest = readLarkText(fields.请求摘要);
  const status = readLarkText(fields.事务状态) === "completed" ? "completed" : "pending";
  if (!transactionId || !digest) throw new Error("库存事务记录缺少事务号或请求摘要");
  return { transactionId, digest, status };
}

function transactionToFields(record: InventoryTransactionRecord): Record<string, unknown> {
  return {
    事务号: record.transactionId,
    请求摘要: record.digest,
    事务状态: record.status,
    更新时间: Date.now(),
  };
}

function exceptionFromFields(fields: Record<string, unknown>): InventoryExceptionRecord {
  return {
    异常编号: readLarkText(fields.异常编号),
    来源明细编号: readLarkText(fields.来源明细编号),
    SKU: readLarkText(fields.SKU),
    异常类型: readLarkText(fields.异常类型) as InventoryExceptionRecord["异常类型"],
    责任节点: readLarkText(fields.责任节点) as InventoryExceptionRecord["责任节点"],
    预期数量: toNumber(fields.预期数量),
    实收数量: toNumber(fields.实收数量),
    差异数量: toNumber(fields.差异数量),
    处理状态: readLarkText(fields.处理状态) as InventoryExceptionRecord["处理状态"],
    负责人: readLarkText(fields.负责人),
    创建时间: toNumber(fields.创建时间),
    关闭时间: toNumber(fields.关闭时间),
    备注: readLarkText(fields.备注),
  };
}

function exceptionToFields(exception: Partial<InventoryExceptionRecord>): Record<string, unknown> {
  return Object.fromEntries(Object.entries({
    异常编号: exception.异常编号,
    来源明细编号: exception.来源明细编号,
    SKU: exception.SKU,
    异常类型: exception.异常类型,
    责任节点: exception.责任节点,
    预期数量: exception.预期数量,
    实收数量: exception.实收数量,
    差异数量: exception.差异数量,
    处理状态: exception.处理状态,
    负责人: exception.负责人,
    创建时间: exception.创建时间,
    关闭时间: exception.关闭时间,
    备注: exception.备注,
  }).filter(([, value]) => value !== undefined && value !== ""));
}

function stockFlowMatches(fields: Record<string, unknown>, target: Record<string, unknown>): boolean {
  return readLarkText(fields.流转事务号) === readLarkText(target.流转事务号)
    && readLarkText(fields.来源明细编号) === readLarkText(target.来源明细编号)
    && readLarkText(fields.SKU) === readLarkText(target.SKU)
    && readLarkText(fields.库存位置) === readLarkText(target.库存位置)
    && toNumber(fields.数量变动, Number.NaN) === toNumber(target.数量变动, Number.NaN)
    && readLarkText(fields.操作类型) === readLarkText(target.操作类型);
}

async function upsertByTextField(
  table: Parameters<typeof listLarkRecords>[0],
  field: string,
  value: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const result = await listLarkRecords(table);
  const existing = findUniqueLarkRecordByText(result, field, value);
  if (existing) {
    await updateLarkRecord(table, existing.recordId, fields);
  } else {
    await createLarkRecords(table, [fields]);
  }
}

export function createLarkInventoryBatchRepository(): InventoryBatchRepository {
  return {
    async getTransaction(transactionId) {
      if (hasPersistentTransactionTable()) {
        const result = await listLarkRecords("inventoryTransaction");
        const existing = findUniqueLarkRecordByText(result, "事务号", transactionId);
        return existing ? transactionFromFields(existing.fields) : undefined;
      }
      return transactionStore.get(transactionId);
    },

    async saveTransaction(record) {
      if (hasPersistentTransactionTable()) {
        await upsertByTextField("inventoryTransaction", "事务号", record.transactionId, transactionToFields(record));
        return;
      }
      transactionStore.set(record.transactionId, record);
    },

    async upsertPurchaseBatch(batchNo, fields) {
      await upsertByTextField("purchaseBatch", "采购批次号", batchNo, fields);
    },

    async upsertShipmentBatch(batchNo, fields) {
      await upsertByTextField("shipmentBatch", "物流批次号", batchNo, fields);
    },

    async upsertInventoryDetail(detail) {
      if (!detail.明细编号) throw new Error("明细编号不能为空");
      await upsertByTextField("inventoryDetail", "明细编号", detail.明细编号, detailToFields(detail));
    },

    async getInventoryDetails(detailIds) {
      const wanted = new Set(detailIds);
      const result = await listLarkRecords("inventoryDetail");
      if (result.hasMore) throw new Error("库存明细记录未完整读取，无法安全推进");
      return result.records
        .map((record) => detailFromFields(record.recordId, record.fields))
        .filter((detail) => detail.明细编号 && wanted.has(detail.明细编号));
    },

    async updateInventoryDetail(detailId, detail) {
      await upsertByTextField("inventoryDetail", "明细编号", detailId, detailToFields({ ...detail, 明细编号: detailId }));
    },

    async upsertInventoryException(exception) {
      await upsertByTextField("inventoryException", "异常编号", exception.异常编号, exceptionToFields(exception));
    },

    async getInventoryException(exceptionId) {
      const result = await listLarkRecords("inventoryException");
      const existing = findUniqueLarkRecordByText(result, "异常编号", exceptionId);
      return existing ? exceptionFromFields(existing.fields) : undefined;
    },

    async updateInventoryException(exceptionId, fields) {
      await upsertByTextField("inventoryException", "异常编号", exceptionId, exceptionToFields({ ...fields, 异常编号: exceptionId }));
    },

    async upsertStockFlow(_flowId, fields) {
      const normalizedFields = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined && value !== ""),
      );
      const result = await listLarkRecords("stockFlow");
      if (result.hasMore) throw new Error("库存流水记录未完整读取，无法安全幂等写入");
      const existing = result.records.find((record) => stockFlowMatches(record.fields, normalizedFields));
      if (existing) {
        await updateLarkRecord("stockFlow", existing.recordId, normalizedFields);
      } else {
        await createLarkRecords("stockFlow", [normalizedFields]);
      }
    },

    async listInventoryDetailsBySku(skus) {
      const wanted = new Set(skus);
      const result = await listLarkRecords("inventoryDetail");
      if (result.hasMore) throw new Error("库存明细记录未完整读取，无法重算汇总");
      return result.records
        .map((record) => detailFromFields(record.recordId, record.fields))
        .filter((detail) => wanted.has(detail.SKU));
    },

    async listInventoryDetailsByState(state) {
      const result = await listLarkRecords("inventoryDetail");
      if (result.hasMore) throw new Error("库存明细记录未完整读取，无法按状态筛选");
      return result.records
        .map((record) => detailFromFields(record.recordId, record.fields))
        .filter((detail) => detail.当前状态 === state);
    },

    async updateSkuSummary(sku, fields) {
      await upsertByTextField("summary", "SKU", sku, { SKU: sku, ...fields, 快照日期: Date.now() });
    },
  };
}
