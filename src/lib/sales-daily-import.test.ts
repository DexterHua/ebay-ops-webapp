import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  buildSalesImportRows,
  parseXlsxTable,
  remarkHasImportKey,
  salesImportKey,
} from "@/lib/sales-daily-import";

const HEADERS = [
  "发货日期",
  "下单日期",
  "包裹号",
  "订单总价",
  "订单手续费",
  "营销费用",
  "税费",
  "实收费用",
  "物流费用",
  "采购成本",
  "退款费用",
  "其他费用",
  "利润",
  "成本利润率",
  "销售利润率",
  "称重重量",
  "物流称重",
  "订单号",
  "平台SKU",
  "商品SKU",
  "销量",
  "产品取消标记",
  "产品取消数量",
  "交易号",
  "平台",
  "店铺",
  "国家",
  "运单号",
  "物流方式",
  "发货仓库",
  "发货订单亏损率",
];

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function zip(entries: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.from(entry.content);
    const compressed = deflateRawSync(content);
    const crc = crc32(content);

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    localParts.push(localHeader, compressed);

    centralParts.push(Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]));
    offset += localHeader.length + compressed.length;
  }

  const central = Buffer.concat(centralParts);
  const locals = Buffer.concat(localParts);
  return Buffer.concat([
    locals,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(locals.length),
    u16(0),
  ]);
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function sheetXml(rows: string[][]): string {
  const xmlRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => (
      `<c r="${columnName(colIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
    )).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function makeDianxiaomiWorkbook(): Buffer {
  const rows = [
    HEADERS,
    ["合计($)", "--", "--", "30.53", "5.05", "0", "0", "25.48", "0", "0", "0", "0", "25.48", "--", "83.46%", "0", "0", "--", "--", "--", "2", "", "0", "--", "--", "--", "--", "--", "--", "--", "--"],
    ["2026-06-27", "2026-06-27", "XM1", "18.61", "2.98", "0", "0", "15.63", "0", "0", "0", "0", "15.63", "--", "83.99%", "0", "0", "8548767-114", "SP255609CH2DA001", "SP255609CH2DA001", "1", "", "0", "21-14804-33602", "eBay", "SolidParts", "美国", "YWDFW010118640334", "OC shipping", "Solid OC west1-洛杉矶", "--"],
    ["2026-06-26", "2026-06-26", "XM2", "11.92", "2.07", "1.5", "0", "9.85", "3.25", "4.5", "0.5", "0", "5.35", "--", "44.88%", "0", "0", "8549104-112", "SP80292SDA407B001", "SP80292SDA407B001", "1", "", "0", "22-14802-93919", "eBay", "Newpower", "美国", "TRACK-2", "OC shipping", "Solid OC west1-洛杉矶", "--"],
  ];
  return zip([
    {
      name: "xl/worksheets/sheet1.xml",
      content: sheetXml(rows),
    },
  ]);
}

describe("sales daily import", () => {
  it("parses 店小秘 workbook rows and skips the total row", async () => {
    const table = await parseXlsxTable(makeDianxiaomiWorkbook());
    const result = buildSalesImportRows(table, {
      SP255609CH2DA001: "Clock Spring",
      SP80292SDA407B001: "Throttle Body",
    }, {
      skuContext: {
        SP255609CH2DA001: { name: "Clock Spring", purchasePriceRmb: 12.5 },
        SP80292SDA407B001: { name: "Throttle Body", purchasePriceRmb: 20 },
      },
      monthlyExchangeRates: {
        "2026-06": 7.1,
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.validRows).toHaveLength(2);
    expect(result.summary).toMatchObject({
      totalRows: 3,
      validRows: 2,
      errorRows: 0,
      dateRange: { from: "2026-06-26", to: "2026-06-27" },
      stores: ["NewPower", "Solidparts"],
    });
    expect(result.validRows[0].importKey).toBe("店小秘:8548767-114:SP255609CH2DA001:2026-06-27");
    expect(result.validRows[0].fields).toMatchObject({
      SKU: "SP255609CH2DA001",
      商品名称: "Clock Spring",
      店铺: "Solidparts",
      日期: Date.parse("2026-06-27T00:00:00+08:00"),
      售出数量: 1,
      销售额: 18.61,
      销售额_USD: 18.61,
      eBay费用: 2.98,
      订单手续费_USD: 2.98,
      广告费: 0,
      橙联履约费: 0,
      橙联履约费_USD: 0,
      商品成本: 0,
      单品采购价_RMB: 12.5,
      退款金额: 0,
      退款金额_USD: 0,
      其他费用_USD: 0,
      USD_CNY汇率: 7.1,
      导入Key: "店小秘:8548767-114:SP255609CH2DA001:2026-06-27",
    });
    expect(String(result.validRows[0].fields.备注)).toContain("导入Key: 店小秘:8548767-114:SP255609CH2DA001:2026-06-27");
    expect(result.validRows[1].fields).toMatchObject({
      店铺: "NewPower",
      广告费: 1.5,
      订单手续费_USD: 2.07,
      橙联履约费: 3.25,
      橙联履约费_USD: 3.25,
      商品成本: 4.5,
      单品采购价_RMB: 20,
      退款金额: 0.5,
      退款金额_USD: 0.5,
      其他费用_USD: 0,
      USD_CNY汇率: 7.1,
    });
  });

  it("reports missing required headers and invalid row values", () => {
    const result = buildSalesImportRows([
      ["发货日期", "订单号", "商品SKU", "销量", "店铺"],
      ["2026-06-27", "ORDER-1", "SKU-1", "x", "SolidParts"],
    ], {});

    expect(result.validRows).toEqual([]);
    expect(result.errors.map((error) => error.message)).toContain("缺少必需列：订单总价");
  });

  it("matches import keys inside existing remarks", () => {
    const key = salesImportKey({
      orderNo: "ORDER-1",
      sku: "sku-1",
      shippedDate: "2026-06-27",
    });

    expect(key).toBe("店小秘:ORDER-1:SKU-1:2026-06-27");
    expect(remarkHasImportKey(`导入Key: ${key}`, key)).toBe(true);
    expect(remarkHasImportKey([{ text: `导入Key: ${key}` }], key)).toBe(true);
  });
});
