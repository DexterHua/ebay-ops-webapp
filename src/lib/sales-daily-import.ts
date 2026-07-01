import { parseXlsxTable } from "@/lib/xlsx-table";

export { parseXlsxTable };

export interface ImportedSalesRow {
  importKey: string;
  sourceRow: number;
  fields: Record<string, unknown>;
}

export interface SalesImportSkuContext {
  name?: string;
  purchasePriceRmb?: number;
}

export interface SalesImportBuildOptions {
  skuContext?: Record<string, SalesImportSkuContext>;
  monthlyExchangeRates?: Record<string, number>;
}

export interface SalesImportBuildResult {
  validRows: ImportedSalesRow[];
  errors: Array<{ row: number; message: string }>;
  summary: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    dateRange?: { from: string; to: string };
    stores: string[];
  };
}

const REQUIRED_HEADERS = ["发货日期", "订单号", "商品SKU", "销量", "店铺", "订单总价"] as const;

const STORE_NAMES: Record<string, string> = {
  newpower: "NewPower",
  velocitygear: "VelocityGear",
  titanrig: "TitanRig",
  solidparts: "Solidparts",
  nexusmoto: "Nexusmoto",
};

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

function parseDate(value: string): string | undefined {
  const normalized = value.trim().replace(/\//g, "-");
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
}

function parseOptionalNumber(value: string): number {
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized || normalized === "--") return 0;
  const parsed = Number(normalized.endsWith("%") ? normalized.slice(0, -1) : normalized);
  if (!Number.isFinite(parsed)) throw new Error(`不是有效数字：${value}`);
  return parsed;
}

function finitePositive(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseQuantity(value: string): number {
  const parsed = parseOptionalNumber(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("销量必须是正整数");
  return parsed;
}

function normalizeSku(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeStore(value: string): string | undefined {
  return STORE_NAMES[value.trim().toLowerCase()];
}

function dateTimestamp(date: string): number {
  return Date.parse(`${date}T00:00:00+08:00`);
}

function dateMonth(date: string): string {
  return date.slice(0, 7);
}

function indexHeaders(headers: string[]): Map<string, number> {
  return new Map(headers.map((header, index) => [header.trim(), index]));
}

function getCell(row: string[], headers: Map<string, number>, header: string): string {
  const index = headers.get(header);
  return index === undefined ? "" : text(row[index]);
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => !text(cell));
}

function isTotalRow(row: string[]): boolean {
  return text(row[0]).startsWith("合计");
}

export function salesImportKey(row: { orderNo: string; sku: string; shippedDate: string }): string {
  return `店小秘:${row.orderNo.trim()}:${normalizeSku(row.sku)}:${row.shippedDate.trim()}`;
}

export function remarkHasImportKey(remark: unknown, importKey: string): boolean {
  return text(remark).includes(importKey);
}

function resolveSkuContext(
  sku: string,
  skuNames: Record<string, string>,
  options: SalesImportBuildOptions,
): SalesImportSkuContext {
  return {
    name: options.skuContext?.[sku]?.name || skuNames[sku] || "",
    purchasePriceRmb: finitePositive(options.skuContext?.[sku]?.purchasePriceRmb),
  };
}

function buildRemark(input: {
  importKey: string;
  orderNo: string;
  transactionNo: string;
  trackingNo: string;
  platform: string;
  platformSku: string;
  warehouse: string;
  profit: number;
}): string {
  return [
    `导入Key: ${input.importKey}`,
    `店小秘订单号: ${input.orderNo}`,
    input.transactionNo ? `交易号: ${input.transactionNo}` : "",
    input.trackingNo ? `运单号: ${input.trackingNo}` : "",
    input.platform ? `平台: ${input.platform}` : "",
    input.platformSku ? `平台SKU: ${input.platformSku}` : "",
    input.warehouse ? `发货仓库: ${input.warehouse}` : "",
    `利润: ${input.profit}`,
  ].filter(Boolean).join("；");
}

export function buildSalesImportRows(
  table: string[][],
  skuNames: Record<string, string>,
  options: SalesImportBuildOptions = {},
): SalesImportBuildResult {
  const headerRow = table[0] || [];
  const headers = indexHeaders(headerRow);
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.has(header));
  const bodyRows = table.slice(1).filter((row) => !isBlankRow(row));
  const errors: SalesImportBuildResult["errors"] = [];
  const validRows: ImportedSalesRow[] = [];

  if (missingHeaders.length > 0) {
    return {
      validRows,
      errors: [{ row: 1, message: `缺少必需列：${missingHeaders.join("、")}` }],
      summary: {
        totalRows: bodyRows.length,
        validRows: 0,
        errorRows: 1,
        stores: [],
      },
    };
  }

  for (const [bodyIndex, row] of bodyRows.entries()) {
    const sourceRow = bodyIndex + 2;
    if (isTotalRow(row)) continue;

    try {
      const shippedDate = parseDate(getCell(row, headers, "发货日期"));
      if (!shippedDate) throw new Error("发货日期格式无效");

      const orderNo = getCell(row, headers, "订单号");
      if (!orderNo) throw new Error("订单号不能为空");

      const sku = normalizeSku(getCell(row, headers, "商品SKU"));
      if (!sku) throw new Error("商品SKU不能为空");

      const store = normalizeStore(getCell(row, headers, "店铺"));
      if (!store) throw new Error(`未知店铺：${getCell(row, headers, "店铺")}`);

      const quantity = parseQuantity(getCell(row, headers, "销量"));
      const importKey = salesImportKey({ orderNo, sku, shippedDate });
      const profit = parseOptionalNumber(getCell(row, headers, "利润"));
      const skuContext = resolveSkuContext(sku, skuNames, options);
      const salesAmount = parseOptionalNumber(getCell(row, headers, "订单总价"));
      const refundAmount = parseOptionalNumber(getCell(row, headers, "退款费用"));
      const orderFee = parseOptionalNumber(getCell(row, headers, "订单手续费"));
      const fulfillmentFee = parseOptionalNumber(getCell(row, headers, "物流费用"));
      const otherFee = parseOptionalNumber(getCell(row, headers, "其他费用"));
      const marketingFee = parseOptionalNumber(getCell(row, headers, "营销费用"));
      const importPurchaseCost = parseOptionalNumber(getCell(row, headers, "采购成本"));
      const monthlyRate = finitePositive(options.monthlyExchangeRates?.[dateMonth(shippedDate)]);
      const fields = {
        SKU: sku,
        商品名称: skuContext.name || "",
        店铺: store,
        日期: dateTimestamp(shippedDate),
        售出数量: quantity,
        销售额: salesAmount,
        销售额_USD: salesAmount,
        商品成本: importPurchaseCost,
        单品采购价_RMB: skuContext.purchasePriceRmb ?? null,
        eBay费用: orderFee,
        订单手续费_USD: orderFee,
        广告费: marketingFee,
        橙联履约费: fulfillmentFee,
        橙联履约费_USD: fulfillmentFee,
        退款金额: refundAmount,
        退款金额_USD: refundAmount,
        其他费用_USD: otherFee,
        USD_CNY汇率: monthlyRate ?? null,
        导入Key: importKey,
        备注: buildRemark({
          importKey,
          orderNo,
          transactionNo: getCell(row, headers, "交易号"),
          trackingNo: getCell(row, headers, "运单号"),
          platform: getCell(row, headers, "平台"),
          platformSku: getCell(row, headers, "平台SKU"),
          warehouse: getCell(row, headers, "发货仓库"),
          profit,
        }),
      };

      validRows.push({ importKey, sourceRow, fields });
    } catch (error) {
      errors.push({ row: sourceRow, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const dates = validRows
    .map((row) => new Date(Number(row.fields.日期) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10))
    .sort();
  const stores = [...new Set(validRows.map((row) => String(row.fields.店铺)))].sort();

  return {
    validRows,
    errors,
    summary: {
      totalRows: bodyRows.length,
      validRows: validRows.length,
      errorRows: errors.length,
      dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : undefined,
      stores,
    },
  };
}
