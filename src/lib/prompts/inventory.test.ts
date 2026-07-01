import { describe, expect, it } from "vitest";

import { buildInventoryUserMessage } from "@/lib/prompts/inventory";

describe("inventory prompt", () => {
  it("includes per-SKU sellable inventory so AI can fill currentStock.available", () => {
    const message = buildInventoryUserMessage([
      {
        sku: "SKU-1",
        productName: "Clock Spring",
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
      },
    ]);

    expect(message).toContain("橙联可售12件");
    expect(message).toContain("在途3件");
    expect(message).toContain("本地4件");
  });
});
