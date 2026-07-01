import { describe, expect, it } from "vitest";
import { SKU_IMPORT_TEMPLATE_HEADERS } from "@/lib/data-entry-sku";
import { buildSkuImportTemplateWorkbook } from "@/lib/sku-import-template";
import { parseXlsxTable } from "@/lib/xlsx-table";

describe("SKU import template workbook", () => {
  it("builds an XLSX template readable by the import parser", async () => {
    const table = await parseXlsxTable(buildSkuImportTemplateWorkbook());

    expect(table[0]).toEqual([...SKU_IMPORT_TEMPLATE_HEADERS]);
    expect(table[1].slice(0, 6)).toEqual([
      "SP843060E010A001",
      "84306-0E010*1",
      "方向游丝",
      "Steering Wheel Clock Spring",
      "Clock Spring",
      "0.32",
    ]);
  });
});
