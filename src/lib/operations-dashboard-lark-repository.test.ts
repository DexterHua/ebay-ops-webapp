import { beforeEach, describe, expect, it, vi } from "vitest";

const lark = vi.hoisted(() => ({
  listLarkRecords: vi.fn(),
  createLarkRecords: vi.fn(),
  updateLarkRecord: vi.fn(),
}));

vi.mock("@/lib/lark-server", () => ({
  listLarkRecords: lark.listLarkRecords,
  createLarkRecords: lark.createLarkRecords,
  updateLarkRecord: lark.updateLarkRecord,
}));

import { createLarkOperationsDashboardRepository } from "@/lib/operations-dashboard-lark-repository";

beforeEach(() => {
  lark.listLarkRecords.mockReset();
  lark.createLarkRecords.mockReset();
  lark.updateLarkRecord.mockReset();
});

describe("lark operations dashboard repository", () => {
  it("updates an existing summary record by stable key", async () => {
    lark.listLarkRecords.mockResolvedValue({
      hasMore: false,
      records: [{ recordId: "day-1", fields: { 日汇总Key: "2026-06-30:Solidparts" } }],
    });

    const repo = createLarkOperationsDashboardRepository();
    await repo.upsertDaySummary("2026-06-30:Solidparts", { 日汇总Key: "2026-06-30:Solidparts", 净利润_USD: 7 });

    expect(lark.listLarkRecords).toHaveBeenCalledWith("operatingDaySummary");
    expect(lark.updateLarkRecord).toHaveBeenCalledWith("operatingDaySummary", "day-1", {
      日汇总Key: "2026-06-30:Solidparts",
      净利润_USD: 7,
    });
    expect(lark.createLarkRecords).not.toHaveBeenCalled();
  });

  it("creates a summary record when the stable key is absent", async () => {
    lark.listLarkRecords.mockResolvedValue({ hasMore: false, records: [] });

    const repo = createLarkOperationsDashboardRepository();
    await repo.upsertProfitBreakdown("2026-06:全部店铺:净利润_USD", {
      利润拆解Key: "2026-06:全部店铺:净利润_USD",
      金额: 7,
    });

    expect(lark.createLarkRecords).toHaveBeenCalledWith("profitBreakdown", [{
      利润拆解Key: "2026-06:全部店铺:净利润_USD",
      金额: 7,
    }]);
    expect(lark.updateLarkRecord).not.toHaveBeenCalled();
  });

  it("refuses upsert when a target summary table is truncated", async () => {
    lark.listLarkRecords.mockResolvedValue({ hasMore: true, records: [] });

    const repo = createLarkOperationsDashboardRepository();

    await expect(repo.upsertPeriodSummary("月:2026-06:全部店铺", {})).rejects.toThrow("经营周期汇总未完整读取");
  });
});
