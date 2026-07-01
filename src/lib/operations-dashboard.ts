export interface OperationsDashboardSalesRecord {
  recordId: string;
  fields: Record<string, unknown>;
}

export interface OperationsDashboardSkuSnapshot {
  recordId: string;
  fields: Record<string, unknown>;
}

export interface OperationsDashboardBuildInput {
  salesRecords: OperationsDashboardSalesRecord[];
  skuSnapshots?: OperationsDashboardSkuSnapshot[];
  now?: number;
}

export interface OperationsDashboardBuildResult {
  daySummaries: Array<Record<string, unknown>>;
  periodSummaries: Array<Record<string, unknown>>;
  skuPeriodSummaries: Array<Record<string, unknown>>;
  profitBreakdowns: Array<Record<string, unknown>>;
  skuSummaryPatches: Array<{ recordId: string; sku: string; fields: Record<string, unknown> }>;
}

type PeriodType = "周" | "月";

interface SaleMetric {
  recordId: string;
  date: number;
  day: string;
  week: string;
  month: string;
  store: string;
  sku: string;
  productName: string;
  orderKey: string;
  quantity: number;
  grossSalesUsd: number;
  refundUsd: number;
  netSalesUsd: number;
  purchaseCostRmb: number;
  purchaseCostUsd: number;
  orderFeeUsd: number;
  fulfillmentFeeUsd: number;
  firstMileRmb: number;
  firstMileUsd: number;
  otherFeeUsd: number;
  totalFeeUsd: number;
  totalCostUsd: number;
  netProfitUsd: number;
}

interface AggregateMetric {
  orderKeys: Set<string>;
  skus: Set<string>;
  quantity: number;
  grossSalesUsd: number;
  refundUsd: number;
  netSalesUsd: number;
  purchaseCostRmb: number;
  purchaseCostUsd: number;
  orderFeeUsd: number;
  fulfillmentFeeUsd: number;
  firstMileRmb: number;
  firstMileUsd: number;
  otherFeeUsd: number;
  totalFeeUsd: number;
  totalCostUsd: number;
  netProfitUsd: number;
}

const EMPTY_AGGREGATE = (): AggregateMetric => ({
  orderKeys: new Set<string>(),
  skus: new Set<string>(),
  quantity: 0,
  grossSalesUsd: 0,
  refundUsd: 0,
  netSalesUsd: 0,
  purchaseCostRmb: 0,
  purchaseCostUsd: 0,
  orderFeeUsd: 0,
  fulfillmentFeeUsd: 0,
  firstMileRmb: 0,
  firstMileUsd: 0,
  otherFeeUsd: 0,
  totalFeeUsd: 0,
  totalCostUsd: 0,
  netProfitUsd: 0,
});

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(",");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return text(record.text ?? record.value ?? record.name ?? record.number ?? "");
  }
  return "";
}

function number(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return number(record.value ?? record.text ?? record.number);
  }
  return undefined;
}

function firstNumber(fields: Record<string, unknown>, names: string[], fallback = 0): number {
  for (const name of names) {
    const value = number(fields[name]);
    if (value !== undefined) return value;
  }
  return fallback;
}

function dateParts(timestamp: number): { day: string; month: string; week: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = formatter.format(new Date(timestamp));
  const weekNo = weekNumber(new Date(`${day}T00:00:00+08:00`));
  return { day, month: day.slice(0, 7), week: `${day.slice(0, 4)}-W${String(weekNo).padStart(2, "0")}` };
}

function weekNumber(date: Date): number {
  const start = Date.parse(`${date.getUTCFullYear()}-01-01T00:00:00Z`);
  const diffDays = Math.floor((date.getTime() - start) / (24 * 60 * 60 * 1000));
  return Math.floor(diffDays / 7) + 1;
}

function dateTimestamp(day: string): number {
  return Date.parse(`${day}T00:00:00+08:00`);
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function parseSale(record: OperationsDashboardSalesRecord): SaleMetric | undefined {
  const date = firstNumber(record.fields, ["日期"], Number.NaN);
  const sku = text(record.fields.SKU).toUpperCase();
  const store = text(record.fields.店铺);
  if (!Number.isFinite(date) || !sku || !store) return undefined;

  const { day, week, month } = dateParts(date);
  const quantity = firstNumber(record.fields, ["售出数量"]);
  const grossSalesUsd = firstNumber(record.fields, ["销售额_USD", "销售额"]);
  const refundUsd = firstNumber(record.fields, ["退款金额_USD", "退款金额"]);
  const netSalesUsd = firstNumber(record.fields, ["净销售额_USD"], grossSalesUsd - refundUsd);
  const purchaseCostRmb = firstNumber(record.fields, ["采购成本_RMB", "商品成本"]);
  const purchaseCostUsd = firstNumber(record.fields, ["采购成本_USD"]);
  const orderFeeUsd = firstNumber(record.fields, ["订单手续费_USD", "eBay费用"]);
  const fulfillmentFeeUsd = firstNumber(record.fields, ["橙联履约费_USD", "橙联履约费"]);
  const firstMileRmb = firstNumber(record.fields, ["头程费用_RMB"]);
  const firstMileUsd = firstNumber(record.fields, ["头程费用_USD"]);
  const otherFeeUsd = firstNumber(record.fields, ["其他费用_USD"]);
  const totalFeeUsd = firstNumber(record.fields, ["总费用_USD"], orderFeeUsd + fulfillmentFeeUsd + firstMileUsd + otherFeeUsd);
  const totalCostUsd = firstNumber(record.fields, ["总成本_USD"], purchaseCostUsd + totalFeeUsd);
  const netProfitUsd = firstNumber(record.fields, ["净利润_USD"], netSalesUsd - totalCostUsd);

  return {
    recordId: record.recordId,
    date,
    day,
    week,
    month,
    store,
    sku,
    productName: text(record.fields.商品名称),
    orderKey: text(record.fields.导入Key) || record.recordId,
    quantity,
    grossSalesUsd,
    refundUsd,
    netSalesUsd,
    purchaseCostRmb,
    purchaseCostUsd,
    orderFeeUsd,
    fulfillmentFeeUsd,
    firstMileRmb,
    firstMileUsd,
    otherFeeUsd,
    totalFeeUsd,
    totalCostUsd,
    netProfitUsd,
  };
}

function addSale(aggregate: AggregateMetric, sale: SaleMetric): void {
  aggregate.orderKeys.add(sale.orderKey);
  aggregate.skus.add(sale.sku);
  aggregate.quantity += sale.quantity;
  aggregate.grossSalesUsd += sale.grossSalesUsd;
  aggregate.refundUsd += sale.refundUsd;
  aggregate.netSalesUsd += sale.netSalesUsd;
  aggregate.purchaseCostRmb += sale.purchaseCostRmb;
  aggregate.purchaseCostUsd += sale.purchaseCostUsd;
  aggregate.orderFeeUsd += sale.orderFeeUsd;
  aggregate.fulfillmentFeeUsd += sale.fulfillmentFeeUsd;
  aggregate.firstMileRmb += sale.firstMileRmb;
  aggregate.firstMileUsd += sale.firstMileUsd;
  aggregate.otherFeeUsd += sale.otherFeeUsd;
  aggregate.totalFeeUsd += sale.totalFeeUsd;
  aggregate.totalCostUsd += sale.totalCostUsd;
  aggregate.netProfitUsd += sale.netProfitUsd;
}

function baseSummary(aggregate: AggregateMetric): Record<string, unknown> {
  return {
    订单数: aggregate.orderKeys.size,
    售出数量: round(aggregate.quantity),
    销售额_USD: round(aggregate.grossSalesUsd),
    退款金额_USD: round(aggregate.refundUsd),
    净销售额_USD: round(aggregate.netSalesUsd),
    采购成本_RMB: round(aggregate.purchaseCostRmb),
    采购成本_USD: round(aggregate.purchaseCostUsd),
    订单手续费_USD: round(aggregate.orderFeeUsd),
    橙联履约费_USD: round(aggregate.fulfillmentFeeUsd),
    头程费用_RMB: round(aggregate.firstMileRmb),
    头程费用_USD: round(aggregate.firstMileUsd),
    其他费用_USD: round(aggregate.otherFeeUsd),
    总费用_USD: round(aggregate.totalFeeUsd),
    总成本_USD: round(aggregate.totalCostUsd),
    净利润_USD: round(aggregate.netProfitUsd),
  };
}

function upsertAggregate(map: Map<string, AggregateMetric>, key: string, sale: SaleMetric): void {
  const aggregate = map.get(key) ?? EMPTY_AGGREGATE();
  addSale(aggregate, sale);
  map.set(key, aggregate);
}

function periodParts(periodType: PeriodType, periodNo: string): { start: number; end: number } {
  if (periodType === "月") {
    const [year, month] = periodNo.split("-").map(Number);
    const startDay = `${periodNo}-01`;
    const end = Date.parse(`${year}-${String(month + 1).padStart(2, "0")}-01T00:00:00+08:00`) - 1;
    return { start: dateTimestamp(startDay), end };
  }
  return { start: 0, end: 0 };
}

function snapshotBySku(snapshots: OperationsDashboardSkuSnapshot[]): Map<string, OperationsDashboardSkuSnapshot> {
  const entries: Array<[string, OperationsDashboardSkuSnapshot]> = [];
  for (const snapshot of snapshots) {
    const sku = text(snapshot.fields.SKU).toUpperCase();
    if (sku) entries.push([sku, snapshot]);
  }
  return new Map(entries);
}

export function buildOperationsDashboardSummaries(input: OperationsDashboardBuildInput): OperationsDashboardBuildResult {
  const now = input.now ?? Date.now();
  const sales = input.salesRecords.map(parseSale).filter((sale): sale is SaleMetric => Boolean(sale));
  const snapshots = snapshotBySku(input.skuSnapshots ?? []);

  const dayGroups = new Map<string, AggregateMetric>();
  const periodGroups = new Map<string, { periodType: PeriodType; periodNo: string; store: string; aggregate: AggregateMetric }>();
  const skuGroups = new Map<string, { periodType: PeriodType; periodNo: string; store: string; sku: string; productName: string; aggregate: AggregateMetric }>();

  for (const sale of sales) {
    upsertAggregate(dayGroups, `${sale.day}:${sale.store}`, sale);

    for (const [periodType, periodNo] of [["周", sale.week], ["月", sale.month]] as const) {
      for (const store of [sale.store, "全部店铺"]) {
        const periodKey = `${periodType}:${periodNo}:${store}`;
        const period = periodGroups.get(periodKey) ?? { periodType, periodNo, store, aggregate: EMPTY_AGGREGATE() };
        addSale(period.aggregate, sale);
        periodGroups.set(periodKey, period);

        const skuKey = `${periodType}:${periodNo}:${store}:${sale.sku}`;
        const skuPeriod = skuGroups.get(skuKey) ?? { periodType, periodNo, store, sku: sale.sku, productName: sale.productName, aggregate: EMPTY_AGGREGATE() };
        addSale(skuPeriod.aggregate, sale);
        skuGroups.set(skuKey, skuPeriod);
      }
    }
  }

  const daySummaries = [...dayGroups.entries()].map(([key, aggregate]) => {
    const [day, store] = key.split(":");
    const parts = dateParts(dateTimestamp(day));
    return {
      日汇总Key: key,
      汇总日期: dateTimestamp(day),
      日期_天: day,
      日期_周: parts.week,
      日期_月: parts.month,
      店铺: store,
      ...baseSummary(aggregate),
    };
  });

  const periodSummaries = [...periodGroups.values()].map(({ periodType, periodNo, store, aggregate }) => {
    const parts = periodParts(periodType, periodNo);
    return {
      周期汇总Key: `${periodType}:${periodNo}:${store}`,
      周期类型: periodType,
      周期编号: periodNo,
      周期开始: parts.start || null,
      周期结束: parts.end || null,
      店铺: store,
      ...baseSummary(aggregate),
      活跃SKU数: aggregate.skus.size,
      负利润订单数: 0,
      高费用率订单数: 0,
      库存预警SKU数: 0,
      滞销SKU数: 0,
      滞销占用资金_RMB: 0,
      上期净销售额_USD: 0,
      上期净利润_USD: 0,
      上期总费用_USD: 0,
    };
  });

  const skuPeriodSummaries: Array<Record<string, unknown>> = [...skuGroups.values()].map(({ periodType, periodNo, store, sku, productName, aggregate }) => {
    const snapshot = snapshots.get(sku);
    const currentInventory = firstNumber(snapshot?.fields ?? {}, ["总可用库存", "橙联可售"]);
    const fields: Record<string, unknown> = {
      SKU周期Key: `${periodType}:${periodNo}:${store}:${sku}`,
      周期类型: periodType,
      周期编号: periodNo,
      店铺: store,
      SKU: sku,
      商品名称: productName,
      ...baseSummary(aggregate),
      当前库存: currentInventory,
      最后销售日期: Math.max(...sales.filter((sale) => sale.sku === sku).map((sale) => sale.date)),
      无销售天数: 0,
      占用资金_RMB: firstNumber(snapshot?.fields ?? {}, ["占用资金_RMB"], currentInventory * firstNumber(snapshot?.fields ?? {}, ["单品采购价_RMB", "采购价"])),
      滞销状态: "正常",
      利润排名: 0,
      利润贡献占比: 0,
      累计利润贡献占比: 0,
    };
    return fields;
  });

  for (const key of new Set(skuPeriodSummaries.map((row) => `${row.周期类型}:${row.周期编号}:${row.店铺}`))) {
    const rows = skuPeriodSummaries
      .filter((row) => `${row.周期类型}:${row.周期编号}:${row.店铺}` === key)
      .sort((a, b) => Number(b["净利润_USD"]) - Number(a["净利润_USD"]));
    const totalProfit = rows.reduce((sum, row) => sum + Math.max(0, Number(row["净利润_USD"]) || 0), 0);
    let cumulative = 0;
    rows.forEach((row, index) => {
      row.利润排名 = index + 1;
      const contribution = totalProfit > 0 ? Math.max(0, Number(row["净利润_USD"]) || 0) / totalProfit : 0;
      cumulative += contribution;
      row.利润贡献占比 = round(contribution);
      row.累计利润贡献占比 = round(cumulative);
    });
  }

  const profitBreakdowns = [...periodGroups.values()].flatMap(({ periodNo, store, aggregate }) => ([
    ["销售额_USD", "收入", aggregate.grossSalesUsd, 10],
    ["退款金额_USD", "扣减", aggregate.refundUsd, 20],
    ["采购成本_USD", "扣减", aggregate.purchaseCostUsd, 30],
    ["订单手续费_USD", "扣减", aggregate.orderFeeUsd, 40],
    ["橙联履约费_USD", "扣减", aggregate.fulfillmentFeeUsd, 50],
    ["头程费用_USD", "扣减", aggregate.firstMileUsd, 60],
    ["其他费用_USD", "扣减", aggregate.otherFeeUsd, 70],
    ["净利润_USD", "结果", aggregate.netProfitUsd, 80],
  ] as const).map(([category, direction, amount, order]) => ({
    利润拆解Key: `${periodNo}:${store}:${category}`,
    周期编号: periodNo,
    店铺: store,
    类别: category,
    方向: direction,
    金额: round(amount),
    排序: order,
  })));

  const recentStart = now - 30 * 24 * 60 * 60 * 1000;
  const skuSummaryPatches = [...snapshots.values()].map((snapshot) => {
    const sku = text(snapshot.fields.SKU).toUpperCase();
    const matching = sales.filter((sale) => sale.sku === sku && sale.date >= recentStart && sale.date <= now);
    const lastSaleDate = matching.reduce((max, sale) => Math.max(max, sale.date), firstNumber(snapshot.fields, ["最后销售日期"], 0));
    const noSalesDays = lastSaleDate > 0 ? Math.floor((now - lastSaleDate) / (24 * 60 * 60 * 1000)) : 9999;
    const totalInventory = firstNumber(snapshot.fields, ["总可用库存"]);
    const sellable = firstNumber(snapshot.fields, ["橙联可售"]);
    const safetyStock = firstNumber(snapshot.fields, ["安全库存"]);
    const sellableDays = firstNumber(snapshot.fields, ["可售天数"], Number.POSITIVE_INFINITY);
    const replenishDays = firstNumber(snapshot.fields, ["补货周期天数"], 30);
    const purchasePrice = firstNumber(snapshot.fields, ["单品采购价_RMB", "采购价"]);
    const stockGap = Math.max(safetyStock - sellable, 0);
    return {
      recordId: snapshot.recordId,
      sku,
      fields: {
        近30天销量: round(matching.reduce((sum, sale) => sum + sale.quantity, 0)),
        近30天净销售额_USD: round(matching.reduce((sum, sale) => sum + sale.netSalesUsd, 0)),
        近30天净利润_USD: round(matching.reduce((sum, sale) => sum + sale.netProfitUsd, 0)),
        最后销售日期: lastSaleDate || null,
        无销售天数: noSalesDays,
        占用资金_RMB: round(totalInventory * purchasePrice),
        库存缺口: stockGap,
        滞销状态: totalInventory <= 0 ? "无库存" : noSalesDays > 60 ? "严重滞销" : noSalesDays >= 30 ? "需关注" : "正常",
        库存预警状态: sellable <= 0 ? "缺货" : stockGap > 0 ? "低于安全库存" : sellableDays <= replenishDays ? "需补货" : "正常",
      },
    };
  });

  return { daySummaries, periodSummaries, skuPeriodSummaries, profitBreakdowns, skuSummaryPatches };
}
