export interface FinanceListRecord extends Record<string, unknown> {
  recordId: string;
  金额: number;
  附件: FinanceAttachment[];
  进度?: string;
  列表状态?: string;
}

export interface FinanceAttachment {
  fileToken: string;
  name: string;
  size: number;
  type?: string;
  url?: string;
  tmpUrl?: string;
}

type FinanceRecordLike = {
  fields: Record<string, unknown>;
};

const AMOUNT_FIELDS = ["金额", "报销金额", "付款金额", "费用金额", "支出金额"];
const LARK_OPEN_ID_PATTERN = /^ou_[A-Za-z0-9_-]+$/;

function readNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const normalized = value.replace(/[,￥¥\s]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = readNumber(item);
      if (parsed !== 0) return parsed;
    }
    return 0;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "number", "amount", "text"]) {
      const parsed = readNumber(record[key]);
      if (parsed !== 0) return parsed;
    }
  }
  return 0;
}

function readText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(readText).filter(Boolean).join("、");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "name", "value", "title"]) {
      const text = readText(record[key]);
      if (text) return text;
    }
  }
  return "";
}

function readAmount(fields: Record<string, unknown>): number {
  for (const field of AMOUNT_FIELDS) {
    const amount = readNumber(fields[field]);
    if (amount !== 0) return amount;
  }
  return 0;
}

function readAttachment(value: unknown): FinanceAttachment | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const fileToken = readText(record.file_token ?? record.fileToken ?? record.token);
  const name = readText(record.name ?? record.title) || "附件";
  if (!fileToken && !readText(record.url)) return undefined;
  return {
    fileToken,
    name,
    size: readNumber(record.size),
    type: readText(record.type) || undefined,
    url: readText(record.url) || undefined,
    tmpUrl: readText(record.tmp_url ?? record.tmpUrl) || undefined,
  };
}

function readAttachments(fields: Record<string, unknown>): FinanceAttachment[] {
  const value = fields.发票及付款记录;
  const attachments = Array.isArray(value) ? value : [value];
  return attachments.map(readAttachment).filter((attachment): attachment is FinanceAttachment => Boolean(attachment));
}

export function normalizeFinanceRecord(recordId: string, fields: Record<string, unknown>): FinanceListRecord {
  const progress = readText(fields.进度);
  const approvalStatus = readText(fields.审批状态);
  return {
    recordId,
    ...fields,
    金额: readAmount(fields),
    附件: readAttachments(fields),
    进度: progress || undefined,
    列表状态: progress || approvalStatus || undefined,
  };
}

function collectPersonnelQueries(input: unknown, fallbackName: string): string[] {
  const values = Array.isArray(input) ? input : [input];
  const queries = values.flatMap((value) => {
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return [readText(record.id), readText(record.name)].filter(Boolean);
    }
    return readText(value);
  }).filter(Boolean);

  return queries.length > 0 ? queries : [fallbackName.trim()].filter(Boolean);
}

function buildFinancePersonnelMap(records: FinanceRecordLike[]): Map<string, string> {
  const personnelByName = new Map<string, string>();
  for (const record of records) {
    const personnel = record.fields.人员;
    const users = Array.isArray(personnel) ? personnel : [personnel];
    for (const user of users) {
      if (!user || typeof user !== "object") continue;
      const item = user as Record<string, unknown>;
      const id = readText(item.id);
      const name = readText(item.name);
      if (id && name && LARK_OPEN_ID_PATTERN.test(id) && !personnelByName.has(name)) {
        personnelByName.set(name, id);
      }
    }
  }
  return personnelByName;
}

export function resolveFinancePersonnelReferences(
  input: unknown,
  fallbackName: string,
  records: FinanceRecordLike[],
): Array<{ id: string }> {
  const personnelByName = buildFinancePersonnelMap(records);
  const ids = new Set<string>();

  for (const query of collectPersonnelQueries(input, fallbackName)) {
    if (LARK_OPEN_ID_PATTERN.test(query)) {
      ids.add(query);
      continue;
    }
    const id = personnelByName.get(query);
    if (id) ids.add(id);
  }

  return [...ids].map((id) => ({ id }));
}
