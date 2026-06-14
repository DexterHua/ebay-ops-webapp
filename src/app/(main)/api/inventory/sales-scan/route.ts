import { NextRequest, NextResponse } from "next/server";
import { assertLarkWriteEnabled } from "@/lib/lark-server";
import { requireRole } from "@/lib/session-server";
import { createLarkSalesInventoryScanRepository } from "@/lib/sales-inventory-lark-repository";
import { runSalesInventoryScan, type SalesScanMode } from "@/lib/sales-inventory-scan";
import {
  createSalesScanId,
  parseSalesScanRequest,
  verifyScheduledScanAuthorization,
} from "@/lib/sales-inventory-scan-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function statusForError(message: string): number {
  if (message.includes("计划任务密钥") || message.includes("未登录") || message.includes("登录状态")) return 401;
  if (message.includes("权限不足")) return 403;
  if (message.includes("销售记录在扣减开始后被修改")) return 409;
  if (message.includes("limit") || message.includes("请求体") || message.includes("JSON") || message.includes("不允许指定 mode")) {
    return 400;
  }
  return 500;
}

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("请求体不是有效 JSON");
  }
}

export async function POST(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const now = Date.now();
    const authorization = request.headers.get("authorization");
    let mode: SalesScanMode;
    let operator: string;

    if (authorization !== null) {
      verifyScheduledScanAuthorization(authorization, process.env.INVENTORY_SALES_SCAN_SECRET);
      mode = "scheduled";
      operator = "系统自动扫描";
    } else {
      const session = await requireRole(["admin"]);
      mode = "manual";
      operator = session.name;
    }

    const { limit } = parseSalesScanRequest(await readJson(request));
    const result = await runSalesInventoryScan(createLarkSalesInventoryScanRepository(), {
      scanId: createSalesScanId(now),
      mode,
      limit,
      operator,
      now,
      alertChatId: process.env.LARK_INVENTORY_ALERT_CHAT_ID?.trim() || undefined,
    });

    return jsonNoStore({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return jsonNoStore({ success: false, error: message }, { status: statusForError(message) });
  }
}
