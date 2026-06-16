export type DetailStoreId = "SP" | "NP" | "VG" | "TR";
export type DetailTemplateVariant = "withBanner" | "noBanner";

export interface DetailTemplateVariantOption {
  id: DetailTemplateVariant;
  name: string;
  description: string;
  templatePath: string;
}

export interface DetailTemplateStore {
  id: DetailStoreId;
  name: string;
  label: string;
  tableClass: string;
  templates: Record<DetailTemplateVariant, DetailTemplateVariantOption>;
}

export interface DetailFields {
  condition: string;
  reference: string;
  package: string;
  fitment: string;
  buyerCheck: string;
}

export interface DetailRow {
  label: string;
  key: keyof DetailFields;
  value: string;
}

export type SkuRecordLike = Record<string, unknown>;

export const DETAIL_TEMPLATE_STORES: DetailTemplateStore[] = [
  {
    id: "SP",
    name: "Solidparts",
    label: "Solidparts",
    tableClass: "sp-spec",
    templates: {
      withBanner: {
        id: "withBanner",
        name: "带 banner 图",
        description: "完整版",
        templatePath: "/detail-templates/Solidparts_with_banner.html",
      },
      noBanner: {
        id: "noBanner",
        name: "不带 banner 图",
        description: "精简版",
        templatePath: "/detail-templates/Solidparts_no_banner.html",
      },
    },
  },
  {
    id: "NP",
    name: "NewPower",
    label: "Newpower Autoparts",
    tableClass: "np-spec",
    templates: {
      withBanner: {
        id: "withBanner",
        name: "带 banner 图",
        description: "完整版",
        templatePath: "/detail-templates/Newpower_with_banner.html",
      },
      noBanner: {
        id: "noBanner",
        name: "不带 banner 图",
        description: "精简版",
        templatePath: "/detail-templates/Newpower_no_banner.html",
      },
    },
  },
  {
    id: "VG",
    name: "VelocityGear",
    label: "VelocityGear Direct",
    tableClass: "vg-spec",
    templates: {
      withBanner: {
        id: "withBanner",
        name: "带 banner 图",
        description: "完整版",
        templatePath: "/detail-templates/VelocityGear_with_banner.html",
      },
      noBanner: {
        id: "noBanner",
        name: "不带 banner 图",
        description: "精简版",
        templatePath: "/detail-templates/VelocityGear_no_banner.html",
      },
    },
  },
  {
    id: "TR",
    name: "TitanRig",
    label: "TitanRig Auto & Moto",
    tableClass: "tr-spec",
    templates: {
      withBanner: {
        id: "withBanner",
        name: "带 banner 图",
        description: "完整版",
        templatePath: "/detail-templates/TitanRig_with_banner.html",
      },
      noBanner: {
        id: "noBanner",
        name: "不带 banner 图",
        description: "精简版",
        templatePath: "/detail-templates/TitanRig_no_banner.html",
      },
    },
  },
];

export const DETAIL_FIELD_LABELS: Array<{ key: keyof DetailFields; label: string }> = [
  { key: "condition", label: "Condition" },
  { key: "reference", label: "Reference / OEM No." },
  { key: "package", label: "Package" },
  { key: "fitment", label: "Vehicle Fitment" },
  { key: "buyerCheck", label: "Buyer Check" },
];

const FIELD_ALIASES = {
  sku: ["SKU", "sku", "Sku"],
  chineseName: ["中文品名", "品名", "产品名称", "商品名称"],
  englishName: ["英文标题关键词", "英文品名", "英文标题", "英文关键词", "English Title Keywords", "Title Keywords"],
  category: ["类目", "eBay 类目", "分类", "Category"],
  condition: ["Condition", "Item Condition", "成色", "商品成色", "新旧程度"],
  reference: [
    "OEM",
    "OE/OEM Part Number",
    "Reference / OEM No.",
    "Reference Number",
    "Reference No.",
    "参考号",
    "参考号码",
    "OEM号",
    "OE号",
    "原厂号",
  ],
  package: ["Package", "Included", "包装清单", "包装内容", "包装", "包含"],
  fitment: ["Vehicle Fitment", "Fitment", "适配车型", "适配", "车型", "兼容车型", "应用车型"],
  buyerCheck: ["Buyer Check", "买家确认", "检查要点", "购买检查", "核对要点"],
};

export function larkValueToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(larkValueToText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    for (const key of ["text", "name", "value", "title"]) {
      const text = larkValueToText(objectValue[key]);
      if (text) return text;
    }
    return Object.values(objectValue).map(larkValueToText).filter(Boolean).join(" ");
  }
  return String(value).trim();
}

export function getRecordText(record: SkuRecordLike | null | undefined, aliases: string[]): string {
  if (!record) return "";
  for (const alias of aliases) {
    const value = larkValueToText(record[alias]);
    if (value) return value;
  }
  return "";
}

function cleanProductName(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*[|;]\s*$/g, "")
    .trim();
}

export function buildDetailFields(record: SkuRecordLike): DetailFields {
  const sku = getRecordText(record, FIELD_ALIASES.sku);
  const chineseName = getRecordText(record, FIELD_ALIASES.chineseName);
  const englishName = cleanProductName(getRecordText(record, FIELD_ALIASES.englishName));
  const category = getRecordText(record, FIELD_ALIASES.category);
  const productName = englishName || chineseName || sku || "replacement part";
  const reference = getRecordText(record, FIELD_ALIASES.reference);
  const fitment = getRecordText(record, FIELD_ALIASES.fitment);

  return {
    condition:
      getRecordText(record, FIELD_ALIASES.condition) ||
      "New and unused replacement part. Please review the listing photos for exact item details.",
    reference: reference || "Please compare with your current part number and the listing photos before purchase.",
    package:
      getRecordText(record, FIELD_ALIASES.package) ||
      `One ${productName}, as shown in the listing photos.`,
    fitment:
      fitment ||
      (category
        ? `${category}. Please verify fitment before purchase.`
        : "Please verify compatibility through the eBay compatibility section, photos, and your current part details."),
    buyerCheck:
      getRecordText(record, FIELD_ALIASES.buyerCheck) ||
      "Compare ports, mounting points, cable position, hose routing, connector style if applicable, and all visible details with your current part.",
  };
}

export function detailRowsFromFields(fields: DetailFields): DetailRow[] {
  return DETAIL_FIELD_LABELS.map(({ key, label }) => ({ key, label, value: fields[key] }));
}

export function findSkuRecord<T extends SkuRecordLike>(records: T[], sku: string): T | null {
  const normalizedSku = sku.trim().toLowerCase();
  if (!normalizedSku) return null;
  return records.find((record) => getRecordText(record, FIELD_ALIASES.sku).toLowerCase() === normalizedSku) || null;
}

export function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function textToHtml(value: string): string {
  return value.split(/\r?\n/).map((line) => htmlEscape(line)).join("<br>");
}

export function replaceEditableItemDetails(templateHtml: string, fields: DetailFields): string {
  const values = detailRowsFromFields(fields).map((row) => textToHtml(row.value));
  let cellIndex = 0;

  return templateHtml.replace(
    /(<td\b[^>]*contenteditable=["']true["'][^>]*>)([\s\S]*?)(<\/td>)/gi,
    (match, open: string, _existing: string, close: string) => {
      if (cellIndex >= values.length) return match;
      const nextValue = values[cellIndex];
      cellIndex += 1;
      return `${open}${nextValue}${close}`;
    },
  );
}
