import { NextRequest, NextResponse } from "next/server";
import {
  assertLarkWriteEnabled,
  createLarkRecords,
  isLarkTableConfigured,
  listLarkRecords,
  readLarkText,
} from "@/lib/lark-server";
import { requireRole } from "@/lib/session-server";
import { createLarkSalesInventoryScanRepository } from "@/lib/sales-inventory-lark-repository";
import { runSalesInventoryScan } from "@/lib/sales-inventory-scan";
import { createSalesScanId } from "@/lib/sales-inventory-scan-api";
import {
  buildSalesImportRows,
  parseXlsxTable,
  remarkHasImportKey,
  type ImportedSalesRow,
} from "@/lib/sales-daily-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function statusForError(message: string): number {
  if (message.includes("未登录") || message.includes("登录状态")) return 401;
  if (message.includes("权限不足")) return 403;
  if (
    message.includes("文件")
    || message.includes("缺少")
    || message.includes("格式")
    || message.includes("multipart")
  ) return 400;
  return 500;
}

function isXlsxFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xlsx")
    || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function skuNameMap(records: Array<{ fields: Record<string, unknown> }>): Record<string, string> {
  return Object.fromEntries(records.map((record) => [
    readLarkText(record.fields.SKU).trim().toUpperCase(),
    readLarkText(record.fields.中文品名),
  ]).filter(([sku]) => sku));
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return readNumber(record.value ?? record.text ?? record.number);
  }
  return undefined;
}

function firstPositiveNumber(record: Record<string, unknown>, fields: string[]): number | undefined {
  for (const field of fields) {
    const value = readNumber(record[field]);
    if (value !== undefined && value > 0) return value;
  }
  return undefined;
}

function skuContextMap(records: Array<{ fields: Record<string, unknown> }>) {
  return Object.fromEntries(records.map((record) => {
    const sku = readLarkText(record.fields.SKU).trim().toUpperCase();
    const name = readLarkText(record.fields.中文品名);
    const purchasePriceRmb = firstPositiveNumber(record.fields, ["单品采购价_RMB", "采购价", "采购成本", "成本价"]);
    return [sku, { name, purchasePriceRmb }] as const;
  }).filter(([sku]) => sku));
}

function monthlyExchangeRateMap(records: Array<{ fields: Record<string, unknown> }>): Record<string, number> {
  const rates: Record<string, number> = {};
  for (const record of records) {
    const month = readLarkText(record.fields.月份).trim();
    const rate = firstPositiveNumber(record.fields, ["USD_CNY汇率"])
      ?? (() => {
        const rawBocValue = firstPositiveNumber(record.fields, ["原始中行折算价"]);
        return rawBocValue === undefined ? undefined : rawBocValue / 100;
      })();
    if (month && rate !== undefined && Number.isFinite(rate) && rate > 0) rates[month] = rate;
  }
  return rates;
}

function duplicateRows(
  rows: ImportedSalesRow[],
  salesRecords: Array<{ fields: Record<string, unknown> }>,
): ImportedSalesRow[] {
  return rows.filter((row) => salesRecords.some((record) => remarkHasImportKey(record.fields.备注, row.importKey)));
}

function rowSummary(row: ImportedSalesRow) {
  return {
    sourceRow: row.sourceRow,
    importKey: row.importKey,
    SKU: row.fields.SKU,
    店铺: row.fields.店铺,
    售出数量: row.fields.售出数量,
  };
}

function startSalesInventoryScan(input: {
  operator: string;
  limit: number;
  alertChatId?: string;
}): void {
  setTimeout(() => {
    const now = Date.now();
    void runSalesInventoryScan(createLarkSalesInventoryScanRepository(), {
      scanId: createSalesScanId(now),
      mode: "manual",
      limit: input.limit,
      operator: input.operator,
      now,
      alertChatId: input.alertChatId,
    }).then((result) => {
      console.info("[sales-import] 库存扣减扫描完成", result);
    }).catch((error) => {
      console.error("[sales-import] 库存扣减扫描失败", error);
    });
  }, 0);
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireRole(["admin", "operator"]);
    const formData = await request.formData();
    const file = formData.get("file");
    const commit = formData.get("commit") === "true";

    if (!(file instanceof File) || file.size === 0) throw new Error("缺少 XLSX 文件");
    if (!isXlsxFile(file)) throw new Error("只支持 .xlsx 文件");
    if (commit) assertLarkWriteEnabled();

    const table = await parseXlsxTable(Buffer.from(await file.arrayBuffer()));
    const [skuResult, salesResult, exchangeRateResult] = await Promise.all([
      listLarkRecords("sku"),
      listLarkRecords("sales"),
      isLarkTableConfigured("exchangeRate")
        ? listLarkRecords("exchangeRate")
        : Promise.resolve({ hasMore: false, records: [] }),
    ]);
    if (skuResult.hasMore) throw new Error("SKU 主数据未完整读取，无法导入销售日报");
    if (salesResult.hasMore) throw new Error("销售记录未完整读取，无法执行导入去重");
    if (exchangeRateResult.hasMore) throw new Error("月度汇率未完整读取，无法导入销售日报");

    const buildResult = buildSalesImportRows(table, skuNameMap(skuResult.records), {
      skuContext: skuContextMap(skuResult.records),
      monthlyExchangeRates: monthlyExchangeRateMap(exchangeRateResult.records),
    });
    const duplicates = duplicateRows(buildResult.validRows, salesResult.records);
    const duplicateKeys = new Set(duplicates.map((row) => row.importKey));
    const readyRows = buildResult.validRows.filter((row) => !duplicateKeys.has(row.importKey));
    let created = 0;
    let recordIds: string[] = [];
    let scan: { status: "started" | "skipped"; limit?: number; reason?: string } | undefined;

    if (commit && readyRows.length > 0) {
      recordIds = await createLarkRecords("sales", readyRows.map((row) => row.fields));
      created = recordIds.length;
      const scanLimit = Math.min(500, Math.max(1, readyRows.length));
      scan = { status: "started", limit: scanLimit };
      startSalesInventoryScan({
        limit: scanLimit,
        operator: session.name,
        alertChatId: process.env.LARK_INVENTORY_ALERT_CHAT_ID?.trim() || undefined,
      });
    } else if (commit) {
      scan = { status: "skipped", reason: "没有新增销售记录" };
    }

    return jsonNoStore({
      success: true,
      commit,
      ready: readyRows.length,
      created,
      recordIds,
      duplicates: duplicates.map(rowSummary),
      errors: buildResult.errors,
      summary: buildResult.summary,
      rows: readyRows.slice(0, 20).map(rowSummary),
      scan,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return jsonNoStore({ success: false, error: message }, { status: statusForError(message) });
  }
}
