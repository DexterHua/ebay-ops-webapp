import { describe, expect, it } from "vitest";
import { buildSkuMasterPayload, defaultSkuMasterForm } from "./data-entry-sku";

describe("data entry SKU master payload", () => {
  it("writes hidden default status, current owner, supplier text, and product image", () => {
    const form = {
      ...defaultSkuMasterForm,
      SKU: "SP843060E010A001",
      中文品名: "方向游丝",
      供应商: "Custom Supplier",
      SKU状态: "停售",
      商品图片: "https://example.com/product.jpg",
      "商品毛重（g）": "320",
    };

    expect(buildSkuMasterPayload(form, " 车泉 ")).toMatchObject({
      SKU: "SP843060E010A001",
      中文品名: "方向游丝",
      供应商: "Custom Supplier",
      SKU状态: "待清点",
      商品图片: "https://example.com/product.jpg",
      负责人: "车泉",
      "商品毛重（g）": 320,
    });
  });

  it("requires the logged-in user before saving", () => {
    expect(() => buildSkuMasterPayload(defaultSkuMasterForm, " ")).toThrow("登录状态失效");
  });
});
