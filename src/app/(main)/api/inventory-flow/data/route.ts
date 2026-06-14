import { NextRequest, NextResponse } from "next/server";
import { resolveInventoryFlowResource } from "@/lib/inventory-flow-api";
import { listLarkRecords } from "@/lib/lark-server";
import { requireSession } from "@/lib/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const { resource, table } = resolveInventoryFlowResource(searchParams.get("resource"));
    const { records, hasMore } = await listLarkRecords(table);
    const data = records.map((record, index) => ({
      _idx: index,
      recordId: record.recordId,
      ...record.fields,
    }));

    return NextResponse.json({
      success: true,
      resource,
      count: data.length,
      hasMore,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const status = message.includes("未登录") || message.includes("登录状态") ? 401
      : message.includes("未知库存流转资源") ? 400
        : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
