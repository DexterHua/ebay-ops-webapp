import { describe, expect, it } from "vitest";
import { buildSourcingExportRows, buildSourcingExcelHtml } from "./sourcing-export";

describe("sourcing export", () => {
  it("builds quote request rows with all filled sourcing fields", () => {
    const rows = buildSourcingExportRows([
      {
        recordId: "rec-1",
        OEM码: "ABC-123",
        品牌: "Bosch",
        商品链接: { text: "商品", link: "https://www.ebay.com/itm/123" },
        英文名称: "Brake Pad",
        中文名称: "刹车片",
        近90天销量: 18,
        eBay平均售价: 42.5,
        选品备注: "热销",
        登记人: "严娅",
        登记时间: 1781697600000,
        选品阶段: "已入选待询价",
        初选结果: "入选",
        最高购入价格: 120,
        初选备注: "利润可做",
        初选人: "车泉",
        初选时间: "2026-06-17T10:20:00.000Z",
        供应商: "供应商A",
        供应商报价: 88.6,
        采购备注: "优先问含税价",
        询价人: "刘渊",
        询价时间: "2026-06-17T11:00:00.000Z",
      },
    ]);

    expect(rows).toEqual([
      {
        OEM码: "ABC-123",
        品牌: "Bosch",
        中文名称: "刹车片",
        英文名称: "Brake Pad",
        商品链接: "https://www.ebay.com/itm/123",
        近90天销量: "18",
        eBay平均售价: "42.50",
        最高购入价格: "120.00",
        选品备注: "热销",
        初选备注: "利润可做",
        供应商: "供应商A",
        供应商报价: "88.60",
        采购备注: "优先问含税价",
        登记人: "严娅",
        登记时间: "2026/6/17 20:00:00",
        初选人: "车泉",
        初选时间: "2026/6/17 18:20:00",
        询价人: "刘渊",
        询价时间: "2026/6/17 19:00:00",
        选品阶段: "已入选待询价",
        初选结果: "入选",
      },
    ]);
  });

  it("escapes cell content when building Excel-compatible HTML", () => {
    const html = buildSourcingExcelHtml([
      {
        OEM码: "<OEM>",
        品牌: "A&B",
        中文名称: "中文",
        英文名称: "Name",
        商品链接: "https://example.com?a=1&b=2",
        近90天销量: "5",
        eBay平均售价: "12.00",
        最高购入价格: "8.00",
        选品备注: "",
        初选备注: "",
        供应商: "",
        供应商报价: "",
        采购备注: "",
        登记人: "",
        登记时间: "",
        初选人: "",
        初选时间: "",
        询价人: "",
        询价时间: "",
        选品阶段: "已入选待询价",
        初选结果: "入选",
      },
    ]);

    expect(html).toContain("<table");
    expect(html).toContain("<th>OEM码</th>");
    expect(html).toContain("&lt;OEM&gt;");
    expect(html).toContain("A&amp;B");
    expect(html).toContain("https://example.com?a=1&amp;b=2");
  });
});
