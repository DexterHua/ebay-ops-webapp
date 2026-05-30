// ============================================================
// 通用数据写入 API — 支持任意表的新增记录
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assertLarkWriteEnabled, getLarkBaseToken, getLarkTableId, LarkTable, resolveLarkUserReference, runLarkCli } from "@/lib/lark-server";

const TABLE_MAP: Record<string, LarkTable> = {
  skuMaster: "sku",
  sales: "sales",
  stockFlow: "stockFlow",
  issues: "issues",
  competitors: "competitors",
  replenish: "replenish",
  sourcing: "sourcing",
};

const DATE_FIELDS: Partial<Record<LarkTable, string[]>> = {
  sales: ["日期"],
  stockFlow: ["日期"],
  issues: ["创建日期"],
  competitors: ["记录日期"],
};

function normalizeDateTime(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().replace(/\//g, "-");
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized} 00:00:00` : normalized;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let tmpFile = "";
  try {
    assertLarkWriteEnabled();
    const body = await request.json();
    const { table, fields } = body;

    if (!table || !fields || typeof fields !== "object" || Array.isArray(fields)) {
      return NextResponse.json({ success: false, error: "缺少 table 或 fields" }, { status: 400 });
    }

    const tableKey = TABLE_MAP[table];
    if (!tableKey) {
      return NextResponse.json({ success: false, error: `未知表: ${table}，可选: ${Object.keys(TABLE_MAP).join(", ")}` }, { status: 400 });
    }

    const normalizedFields = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== ""),
    );
    if (table === "skuMaster" && typeof normalizedFields.负责人 === "string") {
      normalizedFields.负责人 = await resolveLarkUserReference(normalizedFields.负责人);
    }
    for (const field of DATE_FIELDS[tableKey] || []) {
      if (field in normalizedFields) normalizedFields[field] = normalizeDateTime(normalizedFields[field]);
    }

    // 将 fields 对象转为 lark-cli record-batch-create 格式
    const fieldNames = Object.keys(normalizedFields);
    const row = fieldNames.map((fn) => normalizedFields[fn] ?? null);
    const payload = { fields: fieldNames, rows: [row] };

    tmpFile = join(tmpdir(), `_save_${table}_${Date.now()}.json`);
    writeFileSync(tmpFile, JSON.stringify(payload));

    const { stdout } = await runLarkCli([
      "base", "+record-batch-create",
      "--base-token", getLarkBaseToken(),
      "--table-id", getLarkTableId(tableKey),
      "--json", `@${tmpFile}`,
      "--as", "user",
    ], { maxBuffer: 5 * 1024 * 1024 });

    unlinkSync(tmpFile);
    const result = JSON.parse(stdout);

    if (result.ok) {
      return NextResponse.json({ success: true, table, recordIds: result.data?.record_id_list || [] });
    }
    return NextResponse.json({ success: false, error: result.error?.message || "写入失败" }, { status: 500 });
  } catch (error) {
    if (tmpFile) { try { unlinkSync(tmpFile); } catch { /* ok */ } }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
