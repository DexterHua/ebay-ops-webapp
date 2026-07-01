import { NextRequest, NextResponse } from "next/server";
import { assertLarkWriteEnabled } from "@/lib/lark-server";
import { createLarkOperationsDashboardRepository } from "@/lib/operations-dashboard-lark-repository";
import { runOperationsDashboardRebuild } from "@/lib/operations-dashboard-rebuild";
import { requireRole } from "@/lib/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function verifyScheduledAuthorization(authorization: string, expectedSecret?: string): void {
  const secret = expectedSecret?.trim();
  if (!secret) throw new Error("运营看板重建密钥未配置");
  if (!authorization.startsWith("Bearer ")) throw new Error("运营看板重建密钥无效");
  if (authorization.slice("Bearer ".length).trim() !== secret) throw new Error("运营看板重建密钥无效");
}

function statusForError(message: string): number {
  if (message.includes("密钥") || message.includes("未登录") || message.includes("登录状态")) return 401;
  if (message.includes("权限不足")) return 403;
  if (message.includes("未完整读取")) return 409;
  return 500;
}

export async function POST(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const authorization = request.headers.get("authorization");
    const mode = authorization === null ? "manual" : "scheduled";

    if (authorization === null) {
      await requireRole(["admin"]);
    } else {
      verifyScheduledAuthorization(authorization, process.env.OPERATIONS_DASHBOARD_REBUILD_SECRET);
    }

    const result = await runOperationsDashboardRebuild(createLarkOperationsDashboardRepository(), {
      now: Date.now(),
    });

    return jsonNoStore({ success: true, mode, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return jsonNoStore({ success: false, error: message }, { status: statusForError(message) });
  }
}
