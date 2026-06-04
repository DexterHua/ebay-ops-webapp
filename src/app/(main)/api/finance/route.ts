import { NextRequest, NextResponse } from "next/server";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  assertLarkWriteEnabled,
  createLarkRecords,
  listLarkRecords,
  updateLarkRecord,
  uploadLarkRecordAttachment,
} from "@/lib/lark-server";
import { requireRole, requireSession } from "@/lib/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FinancePostPayload = {
  projectName: string;
  amount: number;
  date: string;
  personnelInput: unknown;
  expenseType: string;
  notes: string;
  attachments: unknown[];
  files: File[];
};

function parseDateTimestamp(date: string): number {
  if (!date) return Date.now();
  const normalized = date.replace(/\//g, "-");
  const ts = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T00:00:00+08:00` : normalized);
  return Number.isNaN(ts) ? Date.now() : ts;
}

function parsePersonnel(input: unknown, fallbackName: string): Array<{ id: string }> {
  if (Array.isArray(input)) {
    return input.map((u) => {
      if (u && typeof u === "object") {
        const record = u as Record<string, unknown>;
        const id = String(record.id || "").trim();
        const name = String(record.name || "").trim();
        return { id: id || name || fallbackName };
      }
      return { id: String(u || fallbackName).trim() || fallbackName };
    });
  }

  const name = String(input || fallbackName).trim() || fallbackName;
  return [{ id: name }];
}

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null
    && "arrayBuffer" in value
    && "name" in value
    && "size" in value;
}

function sanitizeFilename(name: string, index: number): string {
  const fallback = `voucher-${index + 1}`;
  const trimmed = name.trim() || fallback;
  return trimmed.replace(/[/\\?%*:|"<>]/g, "_");
}

async function parseFinancePostPayload(request: NextRequest): Promise<FinancePostPayload> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return {
      projectName: String(formData.get("项目名称") || "").trim(),
      amount: Number(formData.get("金额")),
      date: String(formData.get("日期") || ""),
      personnelInput: formData.get("人员"),
      expenseType: String(formData.get("报销类型") || "其他").trim() || "其他",
      notes: String(formData.get("备注") || "").trim(),
      attachments: [],
      files: formData.getAll("files")
        .filter(isUploadedFile)
        .filter((file) => file.size > 0),
    };
  }

  const body = await request.json() as {
    项目名称?: unknown;
    金额?: unknown;
    日期?: unknown;
    人员?: unknown;
    报销类型?: unknown;
    发票及付款记录?: unknown;
    备注?: unknown;
  };

  return {
    projectName: String(body.项目名称 || "").trim(),
    amount: Number(body.金额),
    date: String(body.日期 || ""),
    personnelInput: body.人员,
    expenseType: String(body.报销类型 || "其他").trim() || "其他",
    notes: String(body.备注 || "").trim(),
    attachments: Array.isArray(body.发票及付款记录) ? body.发票及付款记录 : [],
    files: [],
  };
}

async function uploadFinanceAttachments(recordId: string, files: File[]): Promise<void> {
  if (files.length === 0) return;

  const uploadDir = await mkdtemp(join(tmpdir(), "finance-vouchers-"));
  try {
    for (const [index, file] of files.entries()) {
      const filename = sanitizeFilename(file.name, index);
      const filePath = join(uploadDir, `${index + 1}-${filename}`);
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(filePath, buffer, { mode: 0o600 });
      await uploadLarkRecordAttachment({
        table: "finance",
        recordId,
        field: "发票及付款记录",
        filePath,
        name: filename,
      });
    }
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
}

// GET /api/finance — 读取报销记录
export async function GET() {
  try {
    await requireSession();
    const { records, hasMore } = await listLarkRecords("finance");
    const data = records.map((record) => ({
      recordId: record.recordId,
      ...record.fields,
    }));
    return NextResponse.json({ success: true, count: data.length, hasMore, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const status = message.includes("未登录") || message.includes("登录状态") ? 401 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

// POST /api/finance — 提交报销申请
export async function POST(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const session = await requireRole(["admin", "operator"]);

    const payload = await parseFinancePostPayload(request);

    const projectName = payload.projectName;
    if (!projectName) throw new Error("项目名称不能为空");

    const amount = payload.amount;
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("金额必须为正数");

    const dateTimestamp = parseDateTimestamp(payload.date);
    const personnel = parsePersonnel(payload.personnelInput, session.name);

    const fields: Record<string, unknown> = {
      项目名称: projectName,
      金额: amount,
      日期: dateTimestamp,
      人员: personnel,
      报销类型: payload.expenseType,
      审批状态: "待审批",
      备注: payload.notes,
    };
    if (payload.attachments.length > 0) {
      fields.发票及付款记录 = payload.attachments;
    }

    const recordIds = await createLarkRecords("finance", [fields]);
    const recordId = recordIds[0];
    if (recordId) {
      try {
        await uploadFinanceAttachments(recordId, payload.files);
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        return NextResponse.json({
          success: false,
          recordIds,
          error: `报销记录已创建，但凭证上传失败：${message}`,
        }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      recordIds,
      message: payload.files.length > 0
        ? `报销申请已提交，已上传 ${payload.files.length} 个凭证，等待审批`
        : "报销申请已提交，等待审批",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const status = message.includes("未登录") || message.includes("登录状态") ? 401
      : message.includes("权限不足") ? 403
        : message.includes("不能为空") || message.includes("必须") ? 400
          : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

// PUT /api/finance — 审批报销（通过/驳回）
export async function PUT(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    await requireRole(["admin"]);

    const body = await request.json() as {
      recordId?: unknown;
      action?: unknown; // "approve" | "reject"
      rejectReason?: unknown;
    };

    const recordId = String(body.recordId || "").trim();
    if (!recordId) throw new Error("记录ID不能为空");

    const action = String(body.action || "").trim();
    if (action !== "approve" && action !== "reject") throw new Error("审批操作必须为 approve 或 reject");

    const rejectReason = action === "reject" ? String(body.rejectReason || "").trim() : "";

    if (action === "approve") {
      await updateLarkRecord("finance", recordId, { 审批状态: "已通过" });
      return NextResponse.json({ success: true, message: "报销已通过" });
    }

    const notes = rejectReason ? `驳回原因：${rejectReason}` : "已驳回";
    await updateLarkRecord("finance", recordId, { 审批状态: "已驳回", 备注: notes });
    return NextResponse.json({ success: true, message: "报销已驳回" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const status = message.includes("未登录") || message.includes("登录状态") ? 401
      : message.includes("权限不足") ? 403
        : message.includes("不能为空") || message.includes("必须") ? 400
          : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
