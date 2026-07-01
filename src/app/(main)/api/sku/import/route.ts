import { NextRequest, NextResponse } from "next/server";
import {
  assertLarkWriteEnabled,
  createLarkRecords,
  listLarkRecords,
  readLarkText,
} from "@/lib/lark-server";
import { configuredLarkUserReference } from "@/lib/lark-user-map";
import { requireRole } from "@/lib/session-server";
import { buildSkuMasterImportRows, type SkuMasterImportRow } from "@/lib/data-entry-sku";
import { parseXlsxTable } from "@/lib/xlsx-table";

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
  if (message.includes("文件") || message.includes("缺少") || message.includes("格式") || message.includes("multipart")) return 400;
  return 500;
}

function isXlsxFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".xlsx")
    || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function existingSkuSet(records: Array<{ fields: Record<string, unknown> }>): Set<string> {
  return new Set(records.map((record) => readLarkText(record.fields.SKU).trim().toUpperCase()).filter(Boolean));
}

function rowSummary(row: SkuMasterImportRow) {
  return {
    sourceRow: row.sourceRow,
    SKU: row.fields.SKU,
    中文品名: row.fields.中文品名,
  };
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
    const skuResult = await listLarkRecords("sku");
    if (skuResult.hasMore) throw new Error("SKU 主数据未完整读取，无法执行导入去重");

    const buildResult = buildSkuMasterImportRows(table, existingSkuSet(skuResult.records));
    let created = 0;
    let recordIds: string[] = [];
    let warning: string | undefined;

    if (commit && buildResult.validRows.length > 0) {
      const ownerReference = configuredLarkUserReference(session.name);
      if (!ownerReference) warning = "SKU 已保存，但当前账号未配置飞书 open_id，负责人未写入";
      const records = buildResult.validRows.map((row) => ({
        ...row.fields,
        ...(ownerReference ? { 负责人: ownerReference } : {}),
      }));
      recordIds = await createLarkRecords("sku", records);
      created = recordIds.length;
    } else if (commit && buildResult.validRows.length === 0) {
      warning = "没有新增 SKU 记录";
    }

    return jsonNoStore({
      success: true,
      commit,
      ready: buildResult.validRows.length,
      created,
      recordIds,
      duplicates: buildResult.duplicates,
      errors: buildResult.errors,
      summary: buildResult.summary,
      rows: buildResult.validRows.slice(0, 20).map(rowSummary),
      warning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return jsonNoStore({ success: false, error: message }, { status: statusForError(message) });
  }
}
