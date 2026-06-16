export type SkuDetailRecord = Record<string, unknown>;

export interface SkuDetails {
  sku: string;
  productName: string;
  englishKeywords: string;
  oem: string;
  category: string;
  status: string;
  supplier: string;
  lowestPrice: number;
  purchasePrice: number;
  grossWeightG: number;
  packedSizeCm: string;
  imageUrl: string;
  available: number;
  inTransit: number;
  localStock: number;
  domesticWarehouse: number;
  totalAvailable: number;
  dailySales7d: number;
  sellableDays: number | null;
  safetyStock: number;
  replenishCycleDays: number;
  replenishStatus: string;
}

const IMAGE_FIELDS = ["商品图片（链接）", "商品图片", "图片链接", "Image URL", "imageUrl"] as const;
const URL_PATTERN = /^https?:\/\/\S+/i;

function collectTextValues(value: unknown): string[] {
  if (value == null) return [];

  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];

  if (Array.isArray(value)) return value.flatMap((item) => collectTextValues(item));

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const directValues = ["text", "name", "value", "url", "link"].flatMap((key) => collectTextValues(record[key]));
    if (directValues.length > 0) return directValues;
  }

  return [];
}

export function toDisplayText(value: unknown): string {
  return collectTextValues(value).join("、");
}

export function toLarkNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  if (typeof value === "string") {
    const normalized = value.trim().replace(/,/g, "");
    if (!normalized) return 0;

    const isPercentage = normalized.endsWith("%");
    const parsed = Number(isPercentage ? normalized.slice(0, -1) : normalized);
    if (!Number.isFinite(parsed)) return 0;
    return isPercentage ? parsed / 100 : parsed;
  }

  if (Array.isArray(value)) return value.reduce((sum, item) => sum + toLarkNumber(item), 0);

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "text", "number"]) {
      if (key in record) return toLarkNumber(record[key]);
    }
  }

  return 0;
}

export function extractImageUrl(record: SkuDetailRecord): string {
  for (const field of IMAGE_FIELDS) {
    const url = collectTextValues(record[field]).find((text) => URL_PATTERN.test(text));
    if (url) return url;
  }
  return "";
}

function normalizeSku(value: unknown): string {
  return toDisplayText(value).trim().toUpperCase();
}

function rowsBySku(rows: SkuDetailRecord[]): Map<string, SkuDetailRecord> {
  return new Map(
    rows
      .map((row) => [normalizeSku(row.SKU), row] as const)
      .filter(([sku]) => Boolean(sku)),
  );
}

function firstText(record: SkuDetailRecord | undefined, fields: string[]): string {
  if (!record) return "";
  for (const field of fields) {
    const value = toDisplayText(record[field]);
    if (value) return value;
  }
  return "";
}

function firstNumber(record: SkuDetailRecord | undefined, fields: string[]): number {
  if (!record) return 0;
  for (const field of fields) {
    const value = toLarkNumber(record[field]);
    if (value !== 0) return value;
  }
  return 0;
}

function resolveSellableDays(summary: SkuDetailRecord | undefined, available: number, dailySales7d: number): number | null {
  const explicit = firstNumber(summary, ["预计可售天数", "可售天数"]);
  if (explicit > 0) return explicit;
  if (dailySales7d > 0) return Number((available / dailySales7d).toFixed(2));
  return null;
}

export function buildSkuDetails(input: {
  skuRows: SkuDetailRecord[];
  strategyRows: SkuDetailRecord[];
  summaryRows: SkuDetailRecord[];
}): SkuDetails[] {
  const strategyBySku = rowsBySku(input.strategyRows);
  const summaryBySku = rowsBySku(input.summaryRows);

  return input.skuRows
    .map((row) => {
      const sku = normalizeSku(row.SKU);
      if (!sku) return null;

      const strategy = strategyBySku.get(sku);
      const summary = summaryBySku.get(sku);
      const available = firstNumber(summary, ["橙联可售"]);
      const inTransit = firstNumber(summary, ["橙联在途"]);
      const localStock = firstNumber(summary, ["本地库存"]);
      const domesticWarehouse = firstNumber(summary, ["国内集货仓"]);
      const totalFromSummary = firstNumber(summary, ["总可用库存"]);
      const dailySales7d = firstNumber(summary, ["近7日日均销量", "日均销量(自动)"]);

      return {
        sku,
        productName: firstText(row, ["中文品名", "商品名称", "品名"]),
        englishKeywords: firstText(row, ["英文标题关键词", "英文标题", "title"]),
        oem: firstText(row, ["OEM", "OE/OEM Part Number", "OEM号"]),
        category: firstText(row, ["类目", "分类"]),
        status: firstText(row, ["SKU状态", "状态"]),
        supplier: firstText(row, ["供应商"]),
        lowestPrice: firstNumber(row, ["最低售价"]),
        purchasePrice: firstNumber(row, ["采购价", "采购成本", "成本价"]),
        grossWeightG: firstNumber(row, ["商品毛重（g）", "商品重量（g）", "重量"]),
        packedSizeCm: firstText(row, ["商品尺寸（含包装）（cm）", "商品尺寸", "尺寸"]),
        imageUrl: extractImageUrl(row),
        available,
        inTransit,
        localStock,
        domesticWarehouse,
        totalAvailable: totalFromSummary || available + inTransit + localStock + domesticWarehouse,
        dailySales7d,
        sellableDays: resolveSellableDays(summary, available, dailySales7d),
        safetyStock: firstNumber(strategy, ["安全库存"]),
        replenishCycleDays: firstNumber(strategy, ["补货周期天数"]),
        replenishStatus: firstText(summary, ["补货状态"]),
      };
    })
    .filter((item): item is SkuDetails => Boolean(item));
}

function searchableText(item: SkuDetails): string {
  return [
    item.sku,
    item.productName,
    item.englishKeywords,
    item.oem,
    item.category,
    item.supplier,
    item.status,
  ].join(" ").toLowerCase();
}

export function searchSkuDetails(items: SkuDetails[], query: string, limit = 8): SkuDetails[] {
  const normalizedQuery = query.trim().toLowerCase();
  const cappedLimit = Math.max(0, limit);
  if (!normalizedQuery) return items.slice(0, cappedLimit);

  return items
    .filter((item) => searchableText(item).includes(normalizedQuery))
    .slice(0, cappedLimit);
}
