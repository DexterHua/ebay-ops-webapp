// ============================================================
// 飞书多维表格 API Route — 服务端代理 Lark CLI 调用
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getLarkReadLimit, LarkTable, listLarkRecords } from "@/lib/lark-server";

// 表 ID 映射
const TABLE_IDS: Record<string, LarkTable> = {
  sku: "sku",
  sales: "sales",
  issues: "issues",
  replenish: "replenish",
  flow: "flow",
  strategy: "strategy",
  summary: "summary",
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table") || "sku";
  const tableKey = TABLE_IDS[table];

  if (!tableKey) {
    return NextResponse.json(
      { success: false, error: `未知表: ${table}，可选: ${Object.keys(TABLE_IDS).join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const maxRecords = getLarkReadLimit();
    const { records, hasMore } = await listLarkRecords(tableKey, maxRecords);
    const data = records.map((record, index) => ({ _idx: index, recordId: record.recordId, ...record.fields }));

    return NextResponse.json({
      success: true,
      table,
      count: data.length,
      hasMore,
      truncated: hasMore && records.length >= maxRecords,
      data,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误";
    console.error(`[lark:${table}] 请求失败:`, msg.slice(0, 300));
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
