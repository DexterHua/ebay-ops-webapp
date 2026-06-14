import { NextRequest, NextResponse } from "next/server";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  assertLarkWriteEnabled,
  createLarkRecords,
  deleteLarkRecord,
  listLarkRecords,
  sendLarkTextToUser,
  updateLarkRecord,
  uploadLarkRecordAttachment,
} from "@/lib/lark-server";
import { normalizeFinanceRecord, resolveFinancePersonnelReferences } from "@/lib/finance-record";
import { requireRole, requireSession } from "@/lib/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FINANCE_NOTIFY_RECIPIENT_NAMES = ["车泉", "贺严"];
const FINANCE_NOTIFY_FALLBACK_IDS = [
  "ou_2330cbb724020d04dee33600660d9b72",
  "ou_88ed08e0aa4b552fadf19468f3ae1943",
];

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

function readDisplayText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(readDisplayText).filter(Boolean).join("、");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["name", "text", "value", "title", "id"]) {
      const text = readDisplayText(record[key]);
      if (text) return text;
    }
  }
  return "";
}

function formatFinanceDate(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp).replace(/\//g, "-");
}

function configuredFinanceNotifyRecipientIds(): string[] {
  return (process.env.LARK_FINANCE_NOTIFY_OPEN_IDS || "")
    .split(/[\s,，;；]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

function resolveFinanceNotifyRecipientIds(records: { fields: Record<string, unknown> }[]): string[] {
  const configured = configuredFinanceNotifyRecipientIds();
  if (configured.length > 0) return [...new Set(configured)];

  const ids = new Set([
    ...resolveFinancePersonnelReferences(FINANCE_NOTIFY_RECIPIENT_NAMES, "", records).map((user) => user.id),
    ...FINANCE_NOTIFY_FALLBACK_IDS,
  ]);
  return [...ids];
}

function buildFinanceNotificationText(input: {
  payload: FinancePostPayload;
  dateTimestamp: number;
  recordId?: string;
  submitter: string;
}): string {
  const reimbursementPerson = readDisplayText(input.payload.personnelInput) || input.submitter;
  const amount = input.payload.amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return [
    "新增财务报销",
    `项目：${input.payload.projectName}`,
    `金额：¥${amount}`,
    `报销人：${reimbursementPerson}`,
    `提交人：${input.submitter}`,
    `日期：${formatFinanceDate(input.dateTimestamp)}`,
    `类型：${input.payload.expenseType}`,
    input.payload.notes ? `备注：${input.payload.notes}` : "",
    input.payload.files.length > 0 ? `凭证：已上传 ${input.payload.files.length} 个` : "",
    input.recordId ? `记录ID：${input.recordId}` : "",
  ].filter(Boolean).join("\n");
}

function financeFieldsFromPayload(
  payload: FinancePostPayload,
  personnel: Array<{ id: string }>,
  extraFields: Record<string, unknown> = {},
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    项目名称: payload.projectName,
    金额: payload.amount,
    日期: parseDateTimestamp(payload.date),
    报销类型: payload.expenseType,
    备注: payload.notes,
    ...extraFields,
  };
  if (personnel.length > 0) {
    fields.人员 = personnel;
  }
  if (payload.attachments.length > 0) {
    fields.发票及付款记录 = payload.attachments;
  }
  return fields;
}

async function notifyFinanceReimbursement(input: {
  records: { fields: Record<string, unknown> }[];
  payload: FinancePostPayload;
  dateTimestamp: number;
  recordId?: string;
  submitter: string;
}): Promise<number> {
  const recipientIds = resolveFinanceNotifyRecipientIds(input.records);
  if (recipientIds.length === 0) return 0;

  const text = buildFinanceNotificationText(input);
  await Promise.all(recipientIds.map((recipientId) => sendLarkTextToUser(recipientId, text)));
  return recipientIds.length;
}

function financeRecordStatus(fields: Record<string, unknown>): string {
  return readDisplayText(fields.进度) || readDisplayText(fields.审批状态);
}

function financeRecordSubmitter(fields: Record<string, unknown>): string {
  return readDisplayText(fields.提交人);
}

function financeRecordPersonnelNames(fields: Record<string, unknown>): string[] {
  const personnel = fields.人员;
  const users = Array.isArray(personnel) ? personnel : [personnel];
  return users.map(readDisplayText).filter(Boolean);
}

function canManageFinanceRecord(fields: Record<string, unknown>, session: { name: string; isAdmin: boolean }): boolean {
  if (session.isAdmin) return true;
  const submitter = financeRecordSubmitter(fields);
  if (submitter) return submitter === session.name;
  return financeRecordPersonnelNames(fields).includes(session.name);
}

async function getFinanceRecordForMutation(recordId: string) {
  const result = await listLarkRecords("finance");
  const record = result.records.find((item) => item.recordId === recordId);
  if (!record) throw new Error("报销记录不存在");
  return { record, records: result.records };
}

function assertFinanceRecordMutable(fields: Record<string, unknown>, session: { name: string; isAdmin: boolean }): void {
  if (!canManageFinanceRecord(fields, session)) throw new Error("只能修改或撤回自己提交的报销申请");
  if (financeRecordStatus(fields) !== "待审批") throw new Error("只有待审批的报销申请可以修改或撤回");
}

async function parseFinancePostPayload(request: NextRequest): Promise<FinancePostPayload> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    return parseFinanceFormData(await request.formData());
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

function parseFinanceFormData(formData: FormData): FinancePostPayload {
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
    const data = records.map((record) => normalizeFinanceRecord(record.recordId, record.fields));
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
    const session = await requireSession();

    const payload = await parseFinancePostPayload(request);

    const projectName = payload.projectName;
    if (!projectName) throw new Error("项目名称不能为空");

    const amount = payload.amount;
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("金额必须为正数");

    const dateTimestamp = parseDateTimestamp(payload.date);
    const existingFinanceRecords = await listLarkRecords("finance");
    const personnel = resolveFinancePersonnelReferences(payload.personnelInput, session.name, existingFinanceRecords.records);

    const fields = financeFieldsFromPayload(payload, personnel, {
      提交人: session.name,
      审批状态: "待审批",
      进度: "待审批",
    });

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

    let notificationSuffix = "";
    if (recordId) {
      try {
        const notifiedCount = await notifyFinanceReimbursement({
          records: existingFinanceRecords.records,
          payload,
          dateTimestamp,
          recordId,
          submitter: session.name,
        });
        notificationSuffix = notifiedCount > 0 ? `，已通知 ${notifiedCount} 人` : "，未找到可通知人员";
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        notificationSuffix = `，但飞书通知失败：${message}`;
      }
    }

    return NextResponse.json({
      success: true,
      recordIds,
      message: payload.files.length > 0
        ? `报销申请已提交，已上传 ${payload.files.length} 个凭证，等待审批${notificationSuffix}`
        : `报销申请已提交，等待审批${notificationSuffix}`,
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

// PATCH /api/finance — 提交人修改待审批报销
export async function PATCH(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const session = await requireSession();

    const contentType = request.headers.get("content-type") || "";
    let recordId = "";
    let payload: FinancePostPayload;
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      recordId = String(formData.get("recordId") || "").trim();
      payload = parseFinanceFormData(formData);
    } else {
      const body = await request.json() as {
        recordId?: unknown;
        项目名称?: unknown;
        金额?: unknown;
        日期?: unknown;
        人员?: unknown;
        报销类型?: unknown;
        发票及付款记录?: unknown;
        备注?: unknown;
      };
      recordId = String(body.recordId || "").trim();
      payload = {
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

    if (!recordId) throw new Error("记录ID不能为空");
    if (!payload.projectName) throw new Error("项目名称不能为空");
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) throw new Error("金额必须为正数");

    const { record, records } = await getFinanceRecordForMutation(recordId);
    assertFinanceRecordMutable(record.fields, session);
    const personnel = resolveFinancePersonnelReferences(payload.personnelInput, session.name, records);
    await updateLarkRecord("finance", recordId, financeFieldsFromPayload(payload, personnel));
    await uploadFinanceAttachments(recordId, payload.files);

    return NextResponse.json({
      success: true,
      message: payload.files.length > 0
        ? `报销申请已更新，已追加上传 ${payload.files.length} 个凭证`
        : "报销申请已更新",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const status = message.includes("未登录") || message.includes("登录状态") ? 401
      : message.includes("权限不足") || message.includes("只能修改") ? 403
        : message.includes("不能为空") || message.includes("必须") || message.includes("只有待审批") || message.includes("不存在") ? 400
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
      await updateLarkRecord("finance", recordId, { 审批状态: "已通过", 进度: "已通过" });
      return NextResponse.json({ success: true, message: "报销已通过" });
    }

    const notes = rejectReason ? `驳回原因：${rejectReason}` : "已驳回";
    await updateLarkRecord("finance", recordId, { 审批状态: "已驳回", 进度: "已驳回", 备注: notes });
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

// DELETE /api/finance — 提交人撤回待审批报销
export async function DELETE(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const session = await requireSession();
    const body = await request.json().catch(() => ({})) as { recordId?: unknown };
    const recordId = String(body.recordId || new URL(request.url).searchParams.get("recordId") || "").trim();
    if (!recordId) throw new Error("记录ID不能为空");

    const { record } = await getFinanceRecordForMutation(recordId);
    assertFinanceRecordMutable(record.fields, session);
    await deleteLarkRecord("finance", recordId);
    return NextResponse.json({ success: true, message: "报销申请已撤回" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const status = message.includes("未登录") || message.includes("登录状态") ? 401
      : message.includes("权限不足") || message.includes("只能修改") ? 403
        : message.includes("不能为空") || message.includes("只有待审批") || message.includes("不存在") ? 400
          : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
