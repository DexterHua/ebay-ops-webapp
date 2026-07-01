import { describe, expect, it } from "vitest";
import { buildSkuMasterImportRows, buildSkuMasterPayload, defaultSkuMasterForm } from "./data-entry-sku";

describe("data entry SKU master payload", () => {
  it("writes hidden status and business fields without a client-controlled owner", () => {
    const form = {
      ...defaultSkuMasterForm,
      SKU: "SP843060E010A001",
      中文品名: "方向游丝",
      供应商: "Custom Supplier",
      SKU状态: "停售",
      商品图片: "https://example.com/product.jpg",
      "商品毛重（g）": "320",
      负责人: "客户端伪造",
    };

    const payload = buildSkuMasterPayload(form);
    expect(payload).toMatchObject({
      SKU: "SP843060E010A001",
      中文品名: "方向游丝",
      供应商: "Custom Supplier",
      SKU状态: "待清点",
      商品图片: { text: "https://example.com/product.jpg", link: "https://example.com/product.jpg" },
      "商品毛重（g）": 320,
    });
    expect(payload).not.toHaveProperty("负责人");
  });
});

describe("SKU master import rows", () => {
  it("maps the upload template into SKU master fields and skips existing or repeated SKUs", () => {
    const table = [
      ["SKU", "OEM", "中文品名", "英文标题关键词", "类目", "重量/KG", "长/cm", "宽/cm", "高/cm", "商品图片", "描述", "备注"],
      ["sp-001", "OEM-1", "方向游丝", "Clock Spring", "Clock Spring", "0.32", "13.2", "13.2", "9.4", "https://example.com/1.jpg", "卖点", "首批"],
      ["SP-OLD", "OEM-2", "旧品", "Old Part", "Others", "0.2", "10", "8", "6", "", "", ""],
      ["SP-001", "OEM-3", "重复新品", "Duplicate", "Others", "", "", "", "", "", "", ""],
    ];

    const result = buildSkuMasterImportRows(table, new Set(["SP-OLD"]));

    expect(result.validRows).toEqual([{
      sourceRow: 2,
      sku: "SP-001",
      fields: {
        SKU: "SP-001",
        OEM: "OEM-1",
        中文品名: "方向游丝",
        英文标题关键词: "Clock Spring",
        类目: "Clock Spring",
        供应商: "KY",
        SKU状态: "待清点",
        风险标签: "低风险",
        "商品毛重（g）": 320,
        "商品尺寸（含包装）（cm）": "13.2*13.2*9.4",
        商品图片: { text: "https://example.com/1.jpg", link: "https://example.com/1.jpg" },
        描述: "卖点",
        备注: "首批",
      },
    }]);
    expect(result.duplicates).toEqual([
      { sourceRow: 3, SKU: "SP-OLD", 中文品名: "旧品", reason: "飞书已存在" },
      { sourceRow: 4, SKU: "SP-001", 中文品名: "重复新品", reason: "文件内重复" },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({
      totalRows: 3,
      validRows: 1,
      duplicateRows: 2,
      errorRows: 0,
    });
  });

  it("reports missing required headers and invalid numeric values", () => {
    const missingHeaders = buildSkuMasterImportRows([["SKU"], ["SP-001"]], new Set());
    expect(missingHeaders.errors).toEqual([{ row: 1, message: "缺少必需列：中文品名" }]);

    const invalidNumber = buildSkuMasterImportRows([
      ["SKU", "中文品名", "重量/KG"],
      ["SP-002", "油箱盖", "heavy"],
    ], new Set());
    expect(invalidNumber.validRows).toEqual([]);
    expect(invalidNumber.errors).toEqual([{ row: 2, message: "重量/KG 不是有效数字：heavy" }]);
  });
});
