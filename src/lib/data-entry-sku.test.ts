import { describe, expect, it } from "vitest";
import { buildSkuMasterPayload, defaultSkuMasterForm } from "./data-entry-sku";

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
    };

    const payload = buildSkuMasterPayload(form);
    expect(payload).toMatchObject({
      SKU: "SP843060E010A001",
      中文品名: "方向游丝",
      供应商: "Custom Supplier",
      SKU状态: "待清点",
      商品图片: "https://example.com/product.jpg",
      "商品毛重（g）": 320,
    });
    expect(payload).not.toHaveProperty("负责人");
  });
});
