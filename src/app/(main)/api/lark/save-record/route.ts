// ============================================================
// 通用数据写入 API — 支持任意表的新增记录
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  assertLarkWriteEnabled,
  createLarkRecords,
  LarkTable,
  resolveLarkUserReference,
  syncSalesSummary,
  syncStockSummaryFromFlow,
} from "@/lib/lark-server";

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
  if (typeof value === "number") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().replace(/\//g, "-");
  const timestamp = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? `${normalized}T00:00:00+08:00`
      : normalized,
  );
  return Number.isNaN(timestamp) ? value : timestamp;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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

    const recordIds = await createLarkRecords(tableKey, [normalizedFields]);
    let warning: string | undefined;
    try {
      if (tableKey === "stockFlow") await syncStockSummaryFromFlow(normalizedFields);
      if (tableKey === "sales") await syncSalesSummary(String(normalizedFields.SKU || ""));
    } catch (error) {
      warning = `业务记录已保存，但运营汇总同步失败：${(error as Error).message}`;
      console.error("[lark] 汇总同步失败:", warning);
    }

    return NextResponse.json({ success: true, table, recordIds, warning });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
