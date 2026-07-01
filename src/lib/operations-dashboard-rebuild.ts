import {
  buildOperationsDashboardSummaries,
  type OperationsDashboardSalesRecord,
  type OperationsDashboardSkuSnapshot,
} from "@/lib/operations-dashboard";

export interface OperationsDashboardRepository {
  listSalesRecords(): Promise<{ records: OperationsDashboardSalesRecord[]; hasMore: boolean }>;
  listSkuSummaries(): Promise<{ records: OperationsDashboardSkuSnapshot[]; hasMore: boolean }>;
  upsertDaySummary(key: string, fields: Record<string, unknown>): Promise<void>;
  upsertPeriodSummary(key: string, fields: Record<string, unknown>): Promise<void>;
  upsertSkuPeriodSummary(key: string, fields: Record<string, unknown>): Promise<void>;
  upsertProfitBreakdown(key: string, fields: Record<string, unknown>): Promise<void>;
  updateSkuSummary(recordId: string, fields: Record<string, unknown>): Promise<void>;
}

export interface OperationsDashboardRebuildResult {
  salesRows: number;
  skuSummaryRows: number;
  daySummaries: number;
  periodSummaries: number;
  skuPeriodSummaries: number;
  profitBreakdowns: number;
  skuSummaryPatches: number;
}

export async function runOperationsDashboardRebuild(
  repository: OperationsDashboardRepository,
  options: { now?: number } = {},
): Promise<OperationsDashboardRebuildResult> {
  const [salesResult, skuSummaryResult] = await Promise.all([
    repository.listSalesRecords(),
    repository.listSkuSummaries(),
  ]);

  if (salesResult.hasMore) throw new Error("销售日报未完整读取，拒绝重建运营看板汇总");
  if (skuSummaryResult.hasMore) throw new Error("SKU运营汇总未完整读取，拒绝重建运营看板汇总");

  const summaries = buildOperationsDashboardSummaries({
    salesRecords: salesResult.records,
    skuSnapshots: skuSummaryResult.records,
    now: options.now,
  });

  for (const row of summaries.daySummaries) {
    await repository.upsertDaySummary(String(row.日汇总Key), row);
  }
  for (const row of summaries.periodSummaries) {
    await repository.upsertPeriodSummary(String(row.周期汇总Key), row);
  }
  for (const row of summaries.skuPeriodSummaries) {
    await repository.upsertSkuPeriodSummary(String(row.SKU周期Key), row);
  }
  for (const row of summaries.profitBreakdowns) {
    await repository.upsertProfitBreakdown(String(row.利润拆解Key), row);
  }
  for (const patch of summaries.skuSummaryPatches) {
    await repository.updateSkuSummary(patch.recordId, patch.fields);
  }

  return {
    salesRows: salesResult.records.length,
    skuSummaryRows: skuSummaryResult.records.length,
    daySummaries: summaries.daySummaries.length,
    periodSummaries: summaries.periodSummaries.length,
    skuPeriodSummaries: summaries.skuPeriodSummaries.length,
    profitBreakdowns: summaries.profitBreakdowns.length,
    skuSummaryPatches: summaries.skuSummaryPatches.length,
  };
}
