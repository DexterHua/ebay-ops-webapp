import type { UserRole } from "@/lib/users";

export const SKU_CHANGE_EDITABLE_FIELDS = [
  "中文品名",
  "英文标题关键词",
  "OEM",
  "类目",
  "供应商",
  "SKU状态",
  "风险标签",
  "商品毛重（g）",
  "商品尺寸（含包装）（cm）",
  "商品图片",
  "描述",
  "备注",
] as const;

export type SkuChangeEditableField = (typeof SKU_CHANGE_EDITABLE_FIELDS)[number];
export type SkuChangeStatus = "待审核" | "已通过" | "已否决";

export type SkuChangeRequest = {
  recordId: string;
  sku: string;
  skuRecordId: string;
  original: Record<string, unknown>;
  patch: Record<string, unknown>;
  changedFields: string[];
  submitter: string;
  submitterRole: string;
  submittedAt: unknown;
  status: SkuChangeStatus;
  reviewer: string;
  reviewedAt: unknown;
  reviewNote: string;
};

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("、");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return text(record.text ?? record.value ?? record.name ?? record.id ?? "");
  }
  return "";
}

function comparable(value: unknown): string {
  if (typeof value === "number") return String(value);
  return text(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeStatus(value: unknown): SkuChangeStatus {
  const status = text(value);
  if (status === "已通过" || status === "已否决") return status;
  return "待审核";
}

export function buildSkuChangePatch(input: {
  original: Record<string, unknown>;
  updates: Record<string, unknown>;
}): { patch: Record<string, unknown>; changedFields: SkuChangeEditableField[] } {
  const patch: Record<string, unknown> = {};
  const changedFields: SkuChangeEditableField[] = [];

  for (const field of SKU_CHANGE_EDITABLE_FIELDS) {
    if (!(field in input.updates)) continue;
    if (comparable(input.original[field]) === comparable(input.updates[field])) continue;
    patch[field] = input.updates[field];
    changedFields.push(field);
  }

  return { patch, changedFields };
}

export function buildSkuChangeRequestFields(input: {
  sku: string;
  skuRecordId: string;
  original: Record<string, unknown>;
  patch: Record<string, unknown>;
  changedFields: string[];
  submitter: string;
  submitterRole: UserRole;
  submittedAt?: number;
}): Record<string, unknown> {
  return {
    申请编号: `SKU-CHANGE-${Date.now()}`,
    SKU: input.sku,
    SKU记录ID: input.skuRecordId,
    原始数据JSON: JSON.stringify(input.original),
    修改内容JSON: JSON.stringify(input.patch),
    修改字段: input.changedFields.join("、"),
    提交人: input.submitter,
    提交角色: input.submitterRole,
    提交时间: input.submittedAt ?? Date.now(),
    审核状态: "待审核",
  };
}

export function normalizeSkuChangeRequest(record: {
  recordId: string;
  fields: Record<string, unknown>;
}): SkuChangeRequest {
  const changedFields = text(record.fields.修改字段).split("、").map((field) => field.trim()).filter(Boolean);
  return {
    recordId: record.recordId,
    sku: text(record.fields.SKU),
    skuRecordId: text(record.fields.SKU记录ID),
    original: parseJsonObject(record.fields.原始数据JSON),
    patch: parseJsonObject(record.fields.修改内容JSON),
    changedFields,
    submitter: text(record.fields.提交人),
    submitterRole: text(record.fields.提交角色),
    submittedAt: record.fields.提交时间,
    status: normalizeStatus(record.fields.审核状态),
    reviewer: text(record.fields.审核人),
    reviewedAt: record.fields.审核时间,
    reviewNote: text(record.fields.审核备注),
  };
}
