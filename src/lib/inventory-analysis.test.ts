import { describe, expect, it } from "vitest";

import {
  buildReplenishmentExcelHtml,
  buildReplenishmentExportRows,
  buildRuleBasedInventoryAnalysis,
  hydrateInventoryAnalysisFromSource,
  isRecoverableInventoryAiError,
  type InventoryAnalysisInput,
  type InventoryAnalysisResult,
} from "@/lib/inventory-analysis";

describe("inventory analysis fallback", () => {
  it("creates complete replenishment analysis without AI output", () => {
    const skus: InventoryAnalysisInput[] = [
      {
        sku: "FAST-1",
        productName: "Fast Seller",
        available: 2,
        inTransit: 0,
        local: 0,
        dailySales: 1,
        salesTrend: "已有销售数据",
        replenishCycle: 30,
        profitMargin: 0.42,
        safetyStock: 5,
        cost: 80,
        category: "Engine",
        status: "在售",
        totalSales: 20,
        autoDailySales: 1,
      },
      {
        sku: "NEW-1",
        productName: "New Product",
        available: 0,
        inTransit: 4,
        local: 0,
        dailySales: 0,
        salesTrend: "尚无销售数据",
        replenishCycle: 30,
        profitMargin: 0.2,
        safetyStock: 0,
        cost: 180,
        category: "Body",
        status: "待售",
        totalSales: 0,
        autoDailySales: 0,
      },
    ];

    const result = buildRuleBasedInventoryAnalysis(skus);

    expect(result.summary).toMatchObject({
      urgentCount: 1,
      warningCount: 1,
      normalCount: 0,
    });
    expect(result.analysis).toHaveLength(2);
    expect(result.analysis[0]).toMatchObject({
      sku: "FAST-1",
      priority: "urgent",
      daysUntilStockout: 2,
      suggestedOrderQty: 45,
      suggestedOrderDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(result.analysis[1]).toMatchObject({
      sku: "NEW-1",
      priority: "this_month",
      daysUntilStockout: 0,
      suggestedOrderQty: 0,
      suggestedOrderDate: "N/A",
    });
    expect(result.analysis[1].riskNote).toContain("高货值");
  });

  it("only falls back for recoverable AI output-shape failures", () => {
    expect(isRecoverableInventoryAiError("AI 返回的 JSON 不完整，请重试。")).toBe(true);
    expect(isRecoverableInventoryAiError("AI 未返回可解析内容，请重试。")).toBe(true);
    expect(isRecoverableInventoryAiError("DEEPSEEK_API_KEY 未配置")).toBe(false);
  });

  it("hydrates AI stock fields from source inventory data", () => {
    const result: InventoryAnalysisResult = {
      analysis: [
        {
          sku: "SKU-1",
          productName: "AI Name",
          currentStock: { available: 0, inTransit: 0, local: 0 },
          dailySales: 0,
          salesTrend: "stable",
          trendExplanation: "",
          daysUntilStockout: 0,
          suggestedOrderQty: 20,
          suggestedOrderDate: "2026-07-01",
          priority: "urgent",
          priorityReason: "",
          riskNote: "",
          aiSummary: "",
        },
      ],
      summary: { urgentCount: 1, warningCount: 0, normalCount: 0, overallAdvice: "" },
    };

    const hydrated = hydrateInventoryAnalysisFromSource(result, [{
      sku: "SKU-1",
      productName: "Source Name",
      available: 12,
      inTransit: 3,
      local: 4,
      dailySales: 2,
      salesTrend: "已有销售数据",
      replenishCycle: 30,
      profitMargin: 0.35,
      safetyStock: 5,
      cost: 80,
      category: "Clock Spring",
      status: "在售",
      totalSales: 20,
      autoDailySales: 2,
    }]);

    expect(hydrated.analysis[0]).toMatchObject({
      productName: "Source Name",
      currentStock: { available: 12, inTransit: 3, local: 4 },
      dailySales: 2,
      daysUntilStockout: 6,
    });
  });

  it("exports only replenishment-needed items to Excel-compatible HTML", () => {
    const result: InventoryAnalysisResult = {
      analysis: [
        {
          sku: "NEED-1",
          productName: "Need & Buy",
          currentStock: { available: 8, inTransit: 1, local: 0 },
          dailySales: 2,
          salesTrend: "stable",
          trendExplanation: "",
          daysUntilStockout: 4,
          suggestedOrderQty: 40,
          suggestedOrderDate: "2026-07-01",
          priority: "urgent",
          priorityReason: "low",
          riskNote: "<risk>",
          aiSummary: "buy",
        },
        {
          sku: "OK-1",
          productName: "No Buy",
          currentStock: { available: 80, inTransit: 0, local: 0 },
          dailySales: 1,
          salesTrend: "stable",
          trendExplanation: "",
          daysUntilStockout: 80,
          suggestedOrderQty: 0,
          suggestedOrderDate: "N/A",
          priority: "normal",
          priorityReason: "",
          riskNote: "",
          aiSummary: "",
        },
      ],
      summary: { urgentCount: 1, warningCount: 0, normalCount: 1, overallAdvice: "" },
    };

    const rows = buildReplenishmentExportRows(result);
    const html = buildReplenishmentExcelHtml(rows);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      SKU: "NEED-1",
      商品名称: "Need & Buy",
      橙联可售: "8",
      建议采购量: "40",
      采购优先级: "紧急",
    });
    expect(html).toContain("Need &amp; Buy");
    expect(html).toContain("&lt;risk&gt;");
    expect(html).not.toContain("OK-1");
  });
});
