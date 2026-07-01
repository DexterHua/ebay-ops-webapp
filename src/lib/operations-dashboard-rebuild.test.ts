import { describe, expect, it, vi } from "vitest";
import { runOperationsDashboardRebuild, type OperationsDashboardRepository } from "@/lib/operations-dashboard-rebuild";

function ts(date: string): number {
  return Date.parse(`${date}T00:00:00+08:00`);
}

describe("operations dashboard rebuild", () => {
  it("reads source rows and upserts all dashboard summary tables", async () => {
    const repo: OperationsDashboardRepository = {
      listSalesRecords: vi.fn(async () => ({
        hasMore: false,
        records: [
          {
            recordId: "sale-1",
            fields: {
              日期: ts("2026-06-30"),
              店铺: "Solidparts",
              SKU: "SKU-1",
              商品名称: "Clock Spring",
              售出数量: 1,
              销售额_USD: 20,
              退款金额_USD: 0,
              采购成本_USD: 7,
              订单手续费_USD: 2,
              橙联履约费_USD: 3,
              头程费用_USD: 1,
              其他费用_USD: 0,
            },
          },
        ],
      })),
      listSkuSummaries: vi.fn(async () => ({
        hasMore: false,
        records: [
          {
            recordId: "summary-1",
            fields: {
              SKU: "SKU-1",
              总可用库存: 10,
              橙联可售: 8,
              单品采购价_RMB: 50,
              最后销售日期: ts("2026-06-15"),
            },
          },
        ],
      })),
      upsertDaySummary: vi.fn(),
      upsertPeriodSummary: vi.fn(),
      upsertSkuPeriodSummary: vi.fn(),
      upsertProfitBreakdown: vi.fn(),
      updateSkuSummary: vi.fn(),
    };

    const result = await runOperationsDashboardRebuild(repo, { now: ts("2026-06-30") });

    expect(result).toMatchObject({
      salesRows: 1,
      skuSummaryRows: 1,
      daySummaries: 1,
      skuSummaryPatches: 1,
    });
    expect(repo.upsertDaySummary).toHaveBeenCalledWith("2026-06-30:Solidparts", expect.objectContaining({
      净销售额_USD: 20,
      净利润_USD: 7,
    }));
    expect(repo.upsertPeriodSummary).toHaveBeenCalledWith("月:2026-06:全部店铺", expect.objectContaining({
      周期类型: "月",
      周期编号: "2026-06",
      店铺: "全部店铺",
    }));
    expect(repo.upsertSkuPeriodSummary).toHaveBeenCalledWith("月:2026-06:全部店铺:SKU-1", expect.objectContaining({
      SKU: "SKU-1",
      利润排名: 1,
    }));
    expect(repo.upsertProfitBreakdown).toHaveBeenCalledWith("2026-06:全部店铺:净利润_USD", expect.objectContaining({
      类别: "净利润_USD",
      金额: 7,
    }));
    expect(repo.updateSkuSummary).toHaveBeenCalledWith("summary-1", expect.objectContaining({
      近30天销量: 1,
      近30天净利润_USD: 7,
    }));
  });

  it("refuses to rebuild from truncated source reads", async () => {
    const repo = {
      listSalesRecords: vi.fn(async () => ({ hasMore: true, records: [] })),
      listSkuSummaries: vi.fn(async () => ({ hasMore: false, records: [] })),
      upsertDaySummary: vi.fn(),
      upsertPeriodSummary: vi.fn(),
      upsertSkuPeriodSummary: vi.fn(),
      upsertProfitBreakdown: vi.fn(),
      updateSkuSummary: vi.fn(),
    } satisfies OperationsDashboardRepository;

    await expect(runOperationsDashboardRebuild(repo, { now: ts("2026-06-30") })).rejects.toThrow("销售日报未完整读取");
    expect(repo.upsertDaySummary).not.toHaveBeenCalled();
  });
});
