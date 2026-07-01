import { describe, expect, it } from "vitest";
import {
  buildOperationsDashboardSummaries,
  type OperationsDashboardSalesRecord,
  type OperationsDashboardSkuSnapshot,
} from "@/lib/operations-dashboard";

const DAY = 24 * 60 * 60 * 1000;

function ts(date: string): number {
  return Date.parse(`${date}T00:00:00+08:00`);
}

describe("operations dashboard summaries", () => {
  it("builds day, period, SKU, profit-breakdown, and SKU-risk summary rows", () => {
    const salesRecords: OperationsDashboardSalesRecord[] = [
      {
        recordId: "sale-1",
        fields: {
          日期: ts("2026-06-29"),
          店铺: "Solidparts",
          SKU: "SKU-1",
          商品名称: "Clock Spring",
          售出数量: 2,
          销售额_USD: 40,
          退款金额_USD: 5,
          采购成本_USD: 14,
          采购成本_RMB: 98,
          订单手续费_USD: 4,
          橙联履约费_USD: 6,
          头程费用_USD: 2,
          头程费用_RMB: 14,
          其他费用_USD: 1,
        },
      },
      {
        recordId: "sale-2",
        fields: {
          日期: ts("2026-06-30"),
          店铺: "NewPower",
          SKU: "SKU-1",
          商品名称: "Clock Spring",
          售出数量: 1,
          销售额_USD: 23,
          退款金额_USD: 0,
          采购成本_USD: 8,
          订单手续费_USD: 2,
          橙联履约费_USD: 3,
          头程费用_USD: 1,
          其他费用_USD: 0,
        },
      },
    ];
    const skuSnapshots: OperationsDashboardSkuSnapshot[] = [
      {
        recordId: "summary-1",
        fields: {
          SKU: "SKU-1",
          总可用库存: 5,
          橙联可售: 3,
          单品采购价_RMB: 49,
          最后销售日期: ts("2026-06-30") - 45 * DAY,
        },
      },
      {
        recordId: "summary-2",
        fields: {
          SKU: "SKU-2",
          总可用库存: 4,
          橙联可售: 4,
          单品采购价_RMB: 100,
          最后销售日期: ts("2026-06-30") - 45 * DAY,
        },
      },
    ];

    const result = buildOperationsDashboardSummaries({
      salesRecords,
      skuSnapshots,
      now: ts("2026-06-30"),
    });

    expect(result.daySummaries).toContainEqual(expect.objectContaining({
      日汇总Key: "2026-06-29:Solidparts",
      日期_天: "2026-06-29",
      店铺: "Solidparts",
      订单数: 1,
      售出数量: 2,
      销售额_USD: 40,
      退款金额_USD: 5,
      净销售额_USD: 35,
      总费用_USD: 13,
      总成本_USD: 27,
      净利润_USD: 8,
    }));

    expect(result.periodSummaries).toContainEqual(expect.objectContaining({
      周期汇总Key: "月:2026-06:全部店铺",
      周期类型: "月",
      周期编号: "2026-06",
      店铺: "全部店铺",
      订单数: 2,
      售出数量: 3,
      净销售额_USD: 58,
      总费用_USD: 19,
      总成本_USD: 41,
      净利润_USD: 17,
      活跃SKU数: 1,
    }));

    expect(result.skuPeriodSummaries).toContainEqual(expect.objectContaining({
      SKU周期Key: "月:2026-06:全部店铺:SKU-1",
      周期类型: "月",
      周期编号: "2026-06",
      店铺: "全部店铺",
      SKU: "SKU-1",
      售出数量: 3,
      净销售额_USD: 58,
      总费用_USD: 19,
      净利润_USD: 17,
      当前库存: 5,
      利润排名: 1,
    }));

    expect(result.profitBreakdowns.filter((row) => row.周期编号 === "2026-06" && row.店铺 === "全部店铺")).toEqual([
      expect.objectContaining({ 类别: "销售额_USD", 方向: "收入", 金额: 63, 排序: 10 }),
      expect.objectContaining({ 类别: "退款金额_USD", 方向: "扣减", 金额: 5, 排序: 20 }),
      expect.objectContaining({ 类别: "采购成本_USD", 方向: "扣减", 金额: 22, 排序: 30 }),
      expect.objectContaining({ 类别: "订单手续费_USD", 方向: "扣减", 金额: 6, 排序: 40 }),
      expect.objectContaining({ 类别: "橙联履约费_USD", 方向: "扣减", 金额: 9, 排序: 50 }),
      expect.objectContaining({ 类别: "头程费用_USD", 方向: "扣减", 金额: 3, 排序: 60 }),
      expect.objectContaining({ 类别: "其他费用_USD", 方向: "扣减", 金额: 1, 排序: 70 }),
      expect.objectContaining({ 类别: "净利润_USD", 方向: "结果", 金额: 17, 排序: 80 }),
    ]);

    expect(result.skuSummaryPatches).toEqual([
      expect.objectContaining({
        recordId: "summary-1",
        sku: "SKU-1",
        fields: expect.objectContaining({
          近30天销量: 3,
          近30天净销售额_USD: 58,
          近30天净利润_USD: 17,
          占用资金_RMB: 245,
          滞销状态: "正常",
          库存预警状态: "正常",
        }),
      }),
      expect.objectContaining({
        recordId: "summary-2",
        sku: "SKU-2",
        fields: expect.objectContaining({
          近30天销量: 0,
          占用资金_RMB: 400,
          滞销状态: "需关注",
        }),
      }),
    ]);
  });
});
