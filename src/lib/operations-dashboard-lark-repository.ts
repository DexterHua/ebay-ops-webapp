import {
  createLarkRecords,
  listLarkRecords,
  updateLarkRecord,
  type LarkRecord,
  type LarkTable,
} from "@/lib/lark-server";
import type { OperationsDashboardRepository } from "@/lib/operations-dashboard-rebuild";

type CachedList = { records: LarkRecord[]; hasMore: boolean };

const UPSERT_TARGETS = {
  day: {
    table: "operatingDaySummary",
    keyField: "日汇总Key",
    label: "经营日汇总",
  },
  period: {
    table: "operatingPeriodSummary",
    keyField: "周期汇总Key",
    label: "经营周期汇总",
  },
  skuPeriod: {
    table: "skuPeriodSummary",
    keyField: "SKU周期Key",
    label: "SKU周期汇总",
  },
  profitBreakdown: {
    table: "profitBreakdown",
    keyField: "利润拆解Key",
    label: "利润拆解",
  },
} as const satisfies Record<string, { table: LarkTable; keyField: string; label: string }>;

function fieldText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(fieldText).filter(Boolean).join(",");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return fieldText(record.text ?? record.value ?? record.name ?? record.number ?? "");
  }
  return "";
}

export function createLarkOperationsDashboardRepository(): OperationsDashboardRepository {
  const cache = new Map<LarkTable, Promise<CachedList>>();

  function listCached(table: LarkTable): Promise<CachedList> {
    const existing = cache.get(table);
    if (existing) return existing;
    const next = listLarkRecords(table);
    cache.set(table, next);
    return next;
  }

  async function upsert(target: keyof typeof UPSERT_TARGETS, key: string, fields: Record<string, unknown>): Promise<void> {
    const { table, keyField, label } = UPSERT_TARGETS[target];
    const result = await listCached(table);
    if (result.hasMore) throw new Error(`${label}未完整读取，拒绝 upsert`);

    const matches = result.records.filter((record) => fieldText(record.fields[keyField]) === key);
    if (matches.length > 1) throw new Error(`${label}中 ${keyField}=${key} 匹配到多条记录`);
    if (matches[0]) {
      await updateLarkRecord(table, matches[0].recordId, fields);
      return;
    }
    await createLarkRecords(table, [fields]);
  }

  return {
    listSalesRecords() {
      return listLarkRecords("sales");
    },

    listSkuSummaries() {
      return listLarkRecords("summary");
    },

    upsertDaySummary(key, fields) {
      return upsert("day", key, fields);
    },

    upsertPeriodSummary(key, fields) {
      return upsert("period", key, fields);
    },

    upsertSkuPeriodSummary(key, fields) {
      return upsert("skuPeriod", key, fields);
    },

    upsertProfitBreakdown(key, fields) {
      return upsert("profitBreakdown", key, fields);
    },

    updateSkuSummary(recordId, fields) {
      return updateLarkRecord("summary", recordId, fields);
    },
  };
}
