import { describe, expect, it } from "vitest";
import { DEFAULT_PROFIT_ASSUMPTIONS, calculateProfit } from "./profit-calculator";

describe("SKU 利润计算", () => {
  it("按参考表参数计算成本、修正后的关税和净利润", () => {
    const result = calculateProfit({
      purchasePriceCny: 11,
      grossWeightG: 110,
      salePriceUsd: 18,
    });

    expect(result.valid).toBe(true);
    expect(result.costs.product).toBeCloseTo(11 / 6.76, 8);
    expect(result.costs.firstMile).toBeCloseTo((0.11 * 20) / 6.76, 8);
    expect(result.costs.lastMile).toBeCloseTo(0.11 * 5, 8);
    expect(result.costs.tariff).toBeCloseTo((11 / 6.76) * 0.275, 8);
    expect(result.costs.ebayFee).toBeCloseTo(18 * 0.1325, 8);
    expect(result.costs.advertising).toBeCloseTo(18 * 0.17, 8);
    expect(result.costs.returns).toBeCloseTo(18 * 0.03, 8);
    expect(result.fixedCost).toBeCloseTo(7.450147928994082, 8);
    expect(result.totalCost).toBeCloseTo(13.435147928994082, 8);
    expect(result.profit).toBeCloseTo(4.564852071005918, 8);
    expect(result.margin).toBeCloseTo(0.2536028928336621, 8);
  });

  it("计算 0%、20% 和 40% 目标利润率售价", () => {
    const result = calculateProfit({
      purchasePriceCny: 11,
      grossWeightG: 110,
      salePriceUsd: 18,
    });

    expect(result.targetPrices.breakEven).toBeCloseTo(result.fixedCost / (1 - 0.3325), 8);
    expect(result.targetPrices.margin20).toBeCloseTo(result.fixedCost / (1 - 0.3325 - 0.2), 8);
    expect(result.targetPrices.margin40).toBeCloseTo(result.fixedCost / (1 - 0.3325 - 0.4), 8);
  });

  it("成本明细之和等于总成本", () => {
    const result = calculateProfit({
      purchasePriceCny: 19,
      grossWeightG: 202,
      salePriceUsd: 18.9,
    });

    const itemTotal = Object.values(result.costs).reduce((sum, value) => sum + value, 0);
    expect(itemTotal).toBeCloseTo(result.totalCost, 8);
  });

  it("支持临时覆盖成本参数", () => {
    const result = calculateProfit({
      purchasePriceCny: 10,
      grossWeightG: 1000,
      salePriceUsd: 20,
      assumptions: {
        ...DEFAULT_PROFIT_ASSUMPTIONS,
        exchangeRate: 5,
        tariffRate: 0,
        ebayFeeRate: 0,
        advertisingRate: 0,
        returnRate: 0,
      },
    });

    expect(result.costs.product).toBe(2);
    expect(result.costs.firstMile).toBe(4);
    expect(result.costs.lastMile).toBe(5);
    expect(result.costs.tariff).toBe(0);
    expect(result.profit).toBe(20 - 2 - 4 - 5 - 1.5 - 3);
  });

  it.each([
    { purchasePriceCny: 0, grossWeightG: 100, salePriceUsd: 10 },
    { purchasePriceCny: 10, grossWeightG: 0, salePriceUsd: 10 },
    { purchasePriceCny: 10, grossWeightG: 100, salePriceUsd: 0 },
  ])("输入无效时返回不可计算状态：%o", (input) => {
    const result = calculateProfit(input);

    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(Number.isFinite(result.profit)).toBe(true);
    expect(Number.isFinite(result.margin)).toBe(true);
  });
});
