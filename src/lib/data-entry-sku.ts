export type SkuMasterForm = {
  SKU: string;
  中文品名: string;
  英文标题关键词: string;
  OEM: string;
  类目: string;
  供应商: string;
  SKU状态: string;
  风险标签: string;
  "商品毛重（g）": string;
  "商品尺寸（含包装）（cm）": string;
  商品图片: string;
  描述: string;
  备注: string;
};

export const SKU_MASTER_DEFAULT_STATUS = "待清点";

export const SKU_IMPORT_TEMPLATE_HEADERS = [
  "SKU",
  "OEM",
  "中文品名",
  "英文标题关键词",
  "类目",
  "重量/KG",
  "长/cm",
  "宽/cm",
  "高/cm",
  "商品图片",
  "描述",
  "备注",
] as const;

export const defaultSkuMasterForm: SkuMasterForm = {
  SKU: "",
  中文品名: "",
  英文标题关键词: "",
  OEM: "",
  类目: "Others",
  供应商: "KY",
  SKU状态: SKU_MASTER_DEFAULT_STATUS,
  风险标签: "低风险",
  "商品毛重（g）": "",
  "商品尺寸（含包装）（cm）": "",
  商品图片: "",
  描述: "",
  备注: "",
};

export function normalizeSkuImageUrlField(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const url = value.trim();
  if (!url) return "";
  return { text: url, link: url };
}

export function normalizeSkuMasterUrlFields(fields: Record<string, unknown>): Record<string, unknown> {
  if (!("商品图片" in fields)) return fields;
  return {
    ...fields,
    商品图片: normalizeSkuImageUrlField(fields.商品图片),
  };
}

export function buildSkuMasterPayload(form: SkuMasterForm): Record<string, unknown> {
  const businessFields: Record<string, unknown> = { ...form };
  delete businessFields.负责人;

  return normalizeSkuMasterUrlFields({
    ...businessFields,
    SKU状态: SKU_MASTER_DEFAULT_STATUS,
    "商品毛重（g）": parseFloat(form["商品毛重（g）"]) || 0,
  });
}

export type SkuMasterImportRow = {
  sourceRow: number;
  sku: string;
  fields: Record<string, unknown>;
};

export type SkuMasterImportDuplicate = {
  sourceRow: number;
  SKU: string;
  中文品名: string;
  reason: "飞书已存在" | "文件内重复";
};

export type SkuMasterImportBuildResult = {
  validRows: SkuMasterImportRow[];
  duplicates: SkuMasterImportDuplicate[];
  errors: Array<{ row: number; message: string }>;
  summary: {
    totalRows: number;
    validRows: number;
    duplicateRows: number;
    errorRows: number;
  };
};

const SKU_IMPORT_REQUIRED_HEADERS = ["SKU", "中文品名"] as const;

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return text(record.text ?? record.value ?? record.name ?? record.number ?? "");
  }
  return "";
}

function normalizeSku(value: unknown): string {
  return text(value).toUpperCase();
}

function indexHeaders(headers: string[]): Map<string, number> {
  return new Map(headers.map((header, index) => [header.trim(), index]));
}

function getCell(row: string[], headers: Map<string, number>, header: string): string {
  const index = headers.get(header);
  return index === undefined ? "" : text(row[index]);
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => !text(cell));
}

function optionalNumber(value: string, label: string): number | undefined {
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`${label} 不是有效数字：${value}`);
  return parsed;
}

function buildPackedSize(length: string, width: string, height: string): string {
  const values = [length, width, height].map((value) => value.trim()).filter(Boolean);
  return values.length === 0 ? "" : values.join("*");
}

export function buildSkuMasterImportRows(
  table: string[][],
  existingSkus: Iterable<string>,
): SkuMasterImportBuildResult {
  const headers = indexHeaders(table[0] || []);
  const bodyRows = table.slice(1).filter((row) => !isBlankRow(row));
  const validRows: SkuMasterImportRow[] = [];
  const duplicates: SkuMasterImportDuplicate[] = [];
  const errors: SkuMasterImportBuildResult["errors"] = [];
  const missingHeaders = SKU_IMPORT_REQUIRED_HEADERS.filter((header) => !headers.has(header));

  if (missingHeaders.length > 0) {
    return {
      validRows,
      duplicates,
      errors: [{ row: 1, message: `缺少必需列：${missingHeaders.join("、")}` }],
      summary: {
        totalRows: bodyRows.length,
        validRows: 0,
        duplicateRows: 0,
        errorRows: 1,
      },
    };
  }

  const existingSkuSet = new Set([...existingSkus].map(normalizeSku).filter(Boolean));
  const fileSkuSet = new Set<string>();

  for (const [bodyIndex, row] of bodyRows.entries()) {
    const sourceRow = bodyIndex + 2;
    const sku = normalizeSku(getCell(row, headers, "SKU"));
    const chineseName = getCell(row, headers, "中文品名");

    try {
      if (!sku) throw new Error("SKU 不能为空");
      if (!chineseName) throw new Error("中文品名不能为空");

      if (existingSkuSet.has(sku)) {
        duplicates.push({ sourceRow, SKU: sku, 中文品名: chineseName, reason: "飞书已存在" });
        continue;
      }
      if (fileSkuSet.has(sku)) {
        duplicates.push({ sourceRow, SKU: sku, 中文品名: chineseName, reason: "文件内重复" });
        continue;
      }

      const weightKg = optionalNumber(getCell(row, headers, "重量/KG"), "重量/KG");
      const form: SkuMasterForm = {
        ...defaultSkuMasterForm,
        SKU: sku,
        OEM: getCell(row, headers, "OEM"),
        中文品名: chineseName,
        英文标题关键词: getCell(row, headers, "英文标题关键词"),
        类目: getCell(row, headers, "类目") || defaultSkuMasterForm.类目,
        "商品毛重（g）": weightKg === undefined ? "" : String(weightKg * 1000),
        "商品尺寸（含包装）（cm）": buildPackedSize(
          getCell(row, headers, "长/cm"),
          getCell(row, headers, "宽/cm"),
          getCell(row, headers, "高/cm"),
        ),
        商品图片: getCell(row, headers, "商品图片"),
        描述: getCell(row, headers, "描述"),
        备注: getCell(row, headers, "备注"),
      };

      validRows.push({ sourceRow, sku, fields: buildSkuMasterPayload(form) });
      fileSkuSet.add(sku);
    } catch (error) {
      errors.push({ row: sourceRow, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    validRows,
    duplicates,
    errors,
    summary: {
      totalRows: bodyRows.length,
      validRows: validRows.length,
      duplicateRows: duplicates.length,
      errorRows: errors.length,
    },
  };
}
