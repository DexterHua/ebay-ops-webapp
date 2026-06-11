import { describe, expect, it } from "vitest";
import { buildSkuDetails, extractImageUrl, searchSkuDetails, toDisplayText, toLarkNumber } from "./sku-details";

describe("SKU 详情数据整理", () => {
  it("合并主数据、库存策略和运营汇总，但不暴露采购价和毛利率", () => {
    const [detail] = buildSkuDetails({
      skuRows: [{
        SKU: "  np-001 ",
        中文品名: "刹车泵",
        英文标题关键词: "Brake Master Cylinder",
        OEM: "OEM-123",
        类目: ["Brake"],
        SKU状态: ["已上架"],
        供应商: ["供应商A"],
        最低售价: "39.99",
        采购价: 12,
        预估毛利率: "35%",
        "商品毛重（g）": "780",
        "商品尺寸（含包装）（cm）": "13*12*8",
        "商品图片（链接）": "https://example.com/brake.jpg",
      }],
      strategyRows: [{
        SKU: "NP-001",
        安全库存: "10",
        补货周期天数: "30",
      }],
      summaryRows: [{
        SKU: "NP-001",
        橙联可售: "24",
        橙联在途: "8",
        本地库存: "3",
        国内集货仓: "2",
        总可用库存: "37",
        近7日日均销量: "4",
        补货状态: "需关注",
      }],
    });

    expect(detail).toMatchObject({
      sku: "NP-001",
      productName: "刹车泵",
      englishKeywords: "Brake Master Cylinder",
      oem: "OEM-123",
      category: "Brake",
      status: "已上架",
      supplier: "供应商A",
      lowestPrice: 39.99,
      grossWeightG: 780,
      packedSizeCm: "13*12*8",
      imageUrl: "https://example.com/brake.jpg",
      available: 24,
      inTransit: 8,
      localStock: 3,
      domesticWarehouse: 2,
      totalAvailable: 37,
      dailySales7d: 4,
      sellableDays: 6,
      safetyStock: 10,
      replenishCycleDays: 30,
      replenishStatus: "需关注",
    });
    expect(detail).not.toHaveProperty("suggestedPrice");
    expect(detail).not.toHaveProperty("purchasePrice");
    expect(detail).not.toHaveProperty("profitMargin");
  });

  it("优先使用已有预计可售天数字段，并兼容可售天数字段", () => {
    const details = buildSkuDetails({
      skuRows: [{ SKU: "SKU-1", 中文品名: "商品一" }, { SKU: "SKU-2", 中文品名: "商品二" }],
      strategyRows: [],
      summaryRows: [
        { SKU: "SKU-1", 预计可售天数: "12.5", 橙联可售: 100, 近7日日均销量: 10 },
        { SKU: "SKU-2", 可售天数: "8", 橙联可售: 100, 近7日日均销量: 10 },
      ],
    });

    expect(details.find((item) => item.sku === "SKU-1")?.sellableDays).toBe(12.5);
    expect(details.find((item) => item.sku === "SKU-2")?.sellableDays).toBe(8);
  });

  it.each([
    ["商品图片（链接）"],
    ["商品图片"],
    ["图片链接"],
    ["Image URL"],
    ["imageUrl"],
  ])("从 %s 提取第一个 URL", (field) => {
    expect(extractImageUrl({ [field]: ["无效文本", { text: "https://example.com/a.png" }] })).toBe("https://example.com/a.png");
  });

  it("按任意运营字段模糊搜索 SKU", () => {
    const details = buildSkuDetails({
      skuRows: [
        { SKU: "NP-001", 中文品名: "刹车泵", 英文标题关键词: "Brake Master Cylinder", OEM: "OEM-123", 类目: "Brake", 供应商: "A厂", SKU状态: "已上架" },
        { SKU: "TR-002", 中文品名: "油箱盖", 英文标题关键词: "Fuel Cap", OEM: "CAP-9", 类目: "Fuel", 供应商: "B厂", SKU状态: "待清点" },
      ],
      strategyRows: [],
      summaryRows: [],
    });

    expect(searchSkuDetails(details, "master").map((item) => item.sku)).toEqual(["NP-001"]);
    expect(searchSkuDetails(details, "CAP-9").map((item) => item.sku)).toEqual(["TR-002"]);
    expect(searchSkuDetails(details, "B厂").map((item) => item.sku)).toEqual(["TR-002"]);
    expect(searchSkuDetails(details, "待清点").map((item) => item.sku)).toEqual(["TR-002"]);
  });
});

describe("SKU 详情字段解析", () => {
  it("把飞书数组和对象字段整理成可读文本", () => {
    expect(toDisplayText(["A", { text: "B" }, { name: "C" }])).toBe("A、B、C");
  });

  it("解析数字字符串、百分比和飞书对象", () => {
    expect(toLarkNumber("1,234.5")).toBe(1234.5);
    expect(toLarkNumber("35%")).toBe(0.35);
    expect(toLarkNumber({ value: "42" })).toBe(42);
  });
});
