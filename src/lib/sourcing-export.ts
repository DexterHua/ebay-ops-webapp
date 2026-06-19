export type SourcingExportRecord = {
  recordId?: string;
  OEM码?: unknown;
  品牌?: unknown;
  商品链接?: unknown;
  英文名称?: unknown;
  中文名称?: unknown;
  近90天销量?: unknown;
  eBay平均售价?: unknown;
  选品备注?: unknown;
  登记人?: unknown;
  登记时间?: unknown;
  选品阶段?: unknown;
  初选结果?: unknown;
  最高购入价格?: unknown;
  初选备注?: unknown;
  初选人?: unknown;
  初选时间?: unknown;
  供应商?: unknown;
  供应商报价?: unknown;
  采购备注?: unknown;
  询价人?: unknown;
  询价时间?: unknown;
};

export type SourcingExportRow = Record<typeof SOURCING_EXPORT_COLUMNS[number], string>;

export const SOURCING_EXPORT_COLUMNS = [
  "OEM码",
  "品牌",
  "中文名称",
  "英文名称",
  "商品链接",
  "近90天销量",
  "eBay平均售价",
  "最高购入价格",
  "选品备注",
  "初选备注",
  "供应商",
  "供应商报价",
  "采购备注",
  "登记人",
  "登记时间",
  "初选人",
  "初选时间",
  "询价人",
  "询价时间",
  "选品阶段",
  "初选结果",
] as const;

function collectText(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectText);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return ["text", "name", "value", "url", "link"].flatMap((key) => collectText(record[key]));
  }
  return [];
}

function text(value: unknown): string {
  return collectText(value).join("、");
}

function urlText(value: unknown): string {
  return collectText(value).find((item) => /^https?:\/\//i.test(item)) || text(value);
}

function numberText(value: unknown, decimals?: number): string {
  const raw = text(value);
  if (!raw) return "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return raw;
  return decimals === undefined ? String(parsed) : parsed.toFixed(decimals);
}

function dateText(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";

  const numeric = Number(raw);
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildSourcingExportRows(records: SourcingExportRecord[]): SourcingExportRow[] {
  return records.map((record) => ({
    OEM码: text(record.OEM码),
    品牌: text(record.品牌),
    中文名称: text(record.中文名称),
    英文名称: text(record.英文名称),
    商品链接: urlText(record.商品链接),
    近90天销量: numberText(record.近90天销量),
    eBay平均售价: numberText(record.eBay平均售价, 2),
    最高购入价格: numberText(record.最高购入价格, 2),
    选品备注: text(record.选品备注),
    初选备注: text(record.初选备注),
    供应商: text(record.供应商),
    供应商报价: numberText(record.供应商报价, 2),
    采购备注: text(record.采购备注),
    登记人: text(record.登记人),
    登记时间: dateText(record.登记时间),
    初选人: text(record.初选人),
    初选时间: dateText(record.初选时间),
    询价人: text(record.询价人),
    询价时间: dateText(record.询价时间),
    选品阶段: text(record.选品阶段),
    初选结果: text(record.初选结果),
  }));
}

export function buildSourcingExcelHtml(rows: SourcingExportRow[]): string {
  const headers = SOURCING_EXPORT_COLUMNS.map((column) => `<th>${htmlEscape(column)}</th>`).join("");
  const body = rows.map((row) => (
    `<tr>${SOURCING_EXPORT_COLUMNS.map((column) => `<td>${htmlEscape(row[column] || "")}</td>`).join("")}</tr>`
  )).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    table { border-collapse: collapse; font-family: Arial, "Microsoft YaHei", sans-serif; font-size: 12px; }
    th, td { border: 1px solid #d8dee8; padding: 6px 8px; mso-number-format: "\\@"; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 700; }
  </style>
</head>
<body>
  <table>
    <thead><tr>${headers}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
}
