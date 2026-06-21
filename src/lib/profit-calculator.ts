export interface ProfitAssumptions {
  exchangeRate: number;
  firstMileCnyPerKg: number;
  lastMileUsdPerKg: number;
  tariffRate: number;
  warehouseInboundUsd: number;
  warehouseHandlingUsd: number;
  ebayFeeRate: number;
  advertisingRate: number;
  returnRate: number;
}

export const DEFAULT_PROFIT_ASSUMPTIONS: ProfitAssumptions = {
  exchangeRate: 6.76,
  firstMileCnyPerKg: 20,
  lastMileUsdPerKg: 5,
  tariffRate: 0.275,
  warehouseInboundUsd: 1.5,
  warehouseHandlingUsd: 3,
  ebayFeeRate: 0.1325,
  advertisingRate: 0.17,
  returnRate: 0.03,
};

export interface ProfitCostBreakdown {
  product: number;
  firstMile: number;
  lastMile: number;
  tariff: number;
  warehouseInbound: number;
  warehouseHandling: number;
  ebayFee: number;
  advertising: number;
  returns: number;
}

export interface ProfitCalculation {
  valid: boolean;
  error: string;
  costs: ProfitCostBreakdown;
  fixedCost: number;
  totalCost: number;
  profit: number;
  margin: number;
  targetPrices: {
    breakEven: number | null;
    margin20: number | null;
    margin40: number | null;
  };
}

export interface CalculateProfitInput {
  purchasePriceCny: number;
  grossWeightG: number;
  salePriceUsd: number;
  assumptions?: Partial<ProfitAssumptions>;
}

const EMPTY_COSTS: ProfitCostBreakdown = {
  product: 0,
  firstMile: 0,
  lastMile: 0,
  tariff: 0,
  warehouseInbound: 0,
  warehouseHandling: 0,
  ebayFee: 0,
  advertising: 0,
  returns: 0,
};

function invalidResult(error: string): ProfitCalculation {
  return {
    valid: false,
    error,
    costs: { ...EMPTY_COSTS },
    fixedCost: 0,
    totalCost: 0,
    profit: 0,
    margin: 0,
    targetPrices: {
      breakEven: null,
      margin20: null,
      margin40: null,
    },
  };
}

function targetPrice(fixedCost: number, variableRate: number, targetMargin: number): number | null {
  const denominator = 1 - variableRate - targetMargin;
  return denominator > 0 ? fixedCost / denominator : null;
}

export function calculateProfit(input: CalculateProfitInput): ProfitCalculation {
  const assumptions = { ...DEFAULT_PROFIT_ASSUMPTIONS, ...input.assumptions };
  const inputValues = [input.purchasePriceCny, input.grossWeightG, input.salePriceUsd];
  const assumptionValues = Object.values(assumptions);

  if (inputValues.some((value) => !Number.isFinite(value) || value <= 0)) {
    return invalidResult("采购价、商品毛重和销售价格必须大于 0");
  }
  if (assumptionValues.some((value) => !Number.isFinite(value) || value < 0) || assumptions.exchangeRate <= 0) {
    return invalidResult("成本参数必须是有效的非负数，且汇率必须大于 0");
  }

  const weightKg = input.grossWeightG / 1000;
  const product = input.purchasePriceCny / assumptions.exchangeRate;
  const firstMile = weightKg * assumptions.firstMileCnyPerKg / assumptions.exchangeRate;
  const lastMile = weightKg * assumptions.lastMileUsdPerKg;
  const tariff = product * assumptions.tariffRate;
  const ebayFee = input.salePriceUsd * assumptions.ebayFeeRate;
  const advertising = input.salePriceUsd * assumptions.advertisingRate;
  const returns = input.salePriceUsd * assumptions.returnRate;

  const costs: ProfitCostBreakdown = {
    product,
    firstMile,
    lastMile,
    tariff,
    warehouseInbound: assumptions.warehouseInboundUsd,
    warehouseHandling: assumptions.warehouseHandlingUsd,
    ebayFee,
    advertising,
    returns,
  };
  const fixedCost = product
    + firstMile
    + lastMile
    + tariff
    + assumptions.warehouseInboundUsd
    + assumptions.warehouseHandlingUsd;
  const variableRate = assumptions.ebayFeeRate + assumptions.advertisingRate + assumptions.returnRate;
  const totalCost = Object.values(costs).reduce((sum, value) => sum + value, 0);
  const profit = input.salePriceUsd - totalCost;

  return {
    valid: true,
    error: "",
    costs,
    fixedCost,
    totalCost,
    profit,
    margin: profit / input.salePriceUsd,
    targetPrices: {
      breakEven: targetPrice(fixedCost, variableRate, 0),
      margin20: targetPrice(fixedCost, variableRate, 0.2),
      margin40: targetPrice(fixedCost, variableRate, 0.4),
    },
  };
}
