import { NextRequest, NextResponse } from "next/server";
import { reconcileInventorySummaries } from "@/lib/inventory-batch-server";
import { createLarkInventoryBatchRepository } from "@/lib/inventory-lark-repository";
import { assertLarkWriteEnabled } from "@/lib/lark-server";
import { requireRole } from "@/lib/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseReconcileRequest(body: unknown): { skus?: string[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("请求体格式无效");
  }
  const skus = (body as { skus?: unknown }).skus;
  if (skus === undefined || skus === null) return {};
  if (!Array.isArray(skus)) throw new Error("SKU 列表必须是数组");

  return {
    skus: skus.map((sku) => {
      if (typeof sku !== "string" || !sku.trim()) throw new Error("SKU 不能为空");
      return sku.trim();
    }),
  };
}

export async function POST(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    await requireRole(["admin", "operator"]);
    const input = parseReconcileRequest(await request.json());
    const result = await reconcileInventorySummaries(createLarkInventoryBatchRepository(), input);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const status = message.includes("未登录") || message.includes("登录状态") ? 401
      : message.includes("权限不足") ? 403
        : message.includes("请求体") || message.includes("SKU") || message.includes("必须") ? 400
          : 500;

    return NextResponse.json({ success: false, error: message }, { status });
  }
}
