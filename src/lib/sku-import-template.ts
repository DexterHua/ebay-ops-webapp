import { SKU_IMPORT_TEMPLATE_HEADERS } from "@/lib/data-entry-sku";
import { buildSingleSheetXlsx } from "@/lib/xlsx-template";

export function buildSkuImportTemplateWorkbook(): Buffer {
  return buildSingleSheetXlsx([
    [...SKU_IMPORT_TEMPLATE_HEADERS],
    ["SP843060E010A001", "84306-0E010*1", "方向游丝", "Steering Wheel Clock Spring", "Clock Spring", "0.32", "13.2", "13.2", "9.4", "https://...", "产品用途/卖点摘要", ""],
  ]);
}
