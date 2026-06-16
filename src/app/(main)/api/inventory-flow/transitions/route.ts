import { NextRequest, NextResponse } from "next/server";
import { createLarkInventoryBatchRepository } from "@/lib/inventory-lark-repository";
import { transitionInventoryDetails } from "@/lib/inventory-batch-server";
import { parseTransitionRequest } from "@/lib/inventory-flow-api";
import { assertLarkWriteEnabled } from "@/lib/lark-server";
import { requireRole } from "@/lib/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const session = await requireRole(["admin", "operator"]);
    const input = parseTransitionRequest(await request.json(), session);
    const result = await transitionInventoryDetails(createLarkInventoryBatchRepository(), input);

    return NextResponse.json({
      success: true,
      transactionId: result.transactionId,
      replayed: result.replayed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const status = message.includes("未登录") || message.includes("登录状态") ? 401
      : message.includes("权限不足") ? 403
        : message.includes("不能为空") || message.includes("必须") || message.includes("无效") || message.includes("重复") || message.includes("超限") || message.includes("版本不匹配") || message.includes("非法状态") ? 400
          : 500;

    return NextResponse.json({ success: false, error: message }, { status });
  }
}
