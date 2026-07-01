import { NextRequest, NextResponse } from "next/server";
import {
  assertLarkWriteEnabled,
  createLarkRecords,
  listLarkRecords,
  updateLarkRecord,
} from "@/lib/lark-server";
import {
  buildSkuChangePatch,
  buildSkuChangeRequestFields,
  normalizeSkuChangeRequest,
} from "@/lib/sku-change-request";
import { requireRole, requireSession } from "@/lib/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusForError(message: string): number {
  if (message.includes("未登录") || message.includes("登录状态")) return 401;
  if (message.includes("权限不足")) return 403;
  if (
    message.includes("不能为空")
    || message.includes("不存在")
    || message.includes("必须")
    || message.includes("没有可提交的修改")
    || message.includes("已经审核")
  ) return 400;
  return 500;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function getRequestRecord(requestId: string) {
  const { records } = await listLarkRecords("skuChangeRequest");
  const record = records.find((item) => item.recordId === requestId);
  if (!record) throw new Error("SKU 修改申请不存在");
  return normalizeSkuChangeRequest(record);
}

export async function GET() {
  try {
    const session = await requireSession();
    const { records, hasMore } = await listLarkRecords("skuChangeRequest");
    const normalized = records
      .map(normalizeSkuChangeRequest)
      .filter((request) => session.isAdmin || request.submitter === session.name);

    return NextResponse.json({
      success: true,
      count: normalized.length,
      hasMore,
      data: normalized,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ success: false, error: message }, { status: statusForError(message) });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const session = await requireRole(["admin", "operator", "purchaser"]);
    const body = await request.json() as {
      sku?: unknown;
      skuRecordId?: unknown;
      original?: unknown;
      updates?: unknown;
    };

    const sku = String(body.sku || "").trim().toUpperCase();
    const skuRecordId = String(body.skuRecordId || "").trim();
    if (!sku) throw new Error("SKU 不能为空");
    if (!skuRecordId) throw new Error("SKU记录ID不能为空");
    if (!isObjectRecord(body.original)) throw new Error("原始数据不能为空");
    if (!isObjectRecord(body.updates)) throw new Error("修改数据不能为空");

    const { patch, changedFields } = buildSkuChangePatch({
      original: body.original,
      updates: body.updates,
    });
    if (changedFields.length === 0) throw new Error("没有可提交的修改");

    const fields = buildSkuChangeRequestFields({
      sku,
      skuRecordId,
      original: body.original,
      patch,
      changedFields,
      submitter: session.name,
      submitterRole: session.role,
    });

    const recordIds = await createLarkRecords("skuChangeRequest", [fields]);
    return NextResponse.json({
      success: true,
      recordIds,
      changedFields,
      message: "SKU 修改申请已提交，等待管理员审核",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ success: false, error: message }, { status: statusForError(message) });
  }
}

export async function PUT(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const session = await requireRole(["admin"]);
    const body = await request.json() as {
      requestId?: unknown;
      action?: unknown;
      reviewNote?: unknown;
    };

    const requestId = String(body.requestId || "").trim();
    if (!requestId) throw new Error("申请记录ID不能为空");
    const action = String(body.action || "").trim();
    if (action !== "approve" && action !== "reject") throw new Error("审核操作必须为 approve 或 reject");

    const changeRequest = await getRequestRecord(requestId);
    if (changeRequest.status !== "待审核") throw new Error("SKU 修改申请已经审核");

    const reviewFields = {
      审核状态: action === "approve" ? "已通过" : "已否决",
      审核人: session.name,
      审核时间: Date.now(),
      审核备注: String(body.reviewNote || "").trim(),
    };

    if (action === "approve") {
      await updateLarkRecord("sku", changeRequest.skuRecordId, changeRequest.patch);
      await updateLarkRecord("skuChangeRequest", requestId, reviewFields);
      return NextResponse.json({ success: true, message: "SKU 修改申请已通过" });
    }

    await updateLarkRecord("skuChangeRequest", requestId, reviewFields);
    return NextResponse.json({ success: true, message: "SKU 修改申请已否决" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ success: false, error: message }, { status: statusForError(message) });
  }
}
