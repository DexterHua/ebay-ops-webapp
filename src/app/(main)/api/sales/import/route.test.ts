import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lark = vi.hoisted(() => ({
  assertLarkWriteEnabled: vi.fn(),
  listLarkRecords: vi.fn(),
  createLarkRecords: vi.fn(),
  isLarkTableConfigured: vi.fn(),
}));

const session = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

const scan = vi.hoisted(() => ({
  createRepository: vi.fn(() => ({ kind: "sales-scan-repo" })),
  runSalesInventoryScan: vi.fn(),
}));

const importer = vi.hoisted(() => ({
  parseXlsxTable: vi.fn(),
  buildSalesImportRows: vi.fn(),
  remarkHasImportKey: vi.fn((remark: unknown, key: string) => String(remark || "").includes(key)),
}));

vi.mock("@/lib/lark-server", () => ({
  assertLarkWriteEnabled: lark.assertLarkWriteEnabled,
  listLarkRecords: lark.listLarkRecords,
  createLarkRecords: lark.createLarkRecords,
  isLarkTableConfigured: lark.isLarkTableConfigured,
  readLarkText: (value: unknown) => String(value ?? ""),
}));

vi.mock("@/lib/session-server", () => ({
  requireRole: session.requireRole,
}));

vi.mock("@/lib/sales-inventory-lark-repository", () => ({
  createLarkSalesInventoryScanRepository: scan.createRepository,
}));

vi.mock("@/lib/sales-inventory-scan", () => ({
  runSalesInventoryScan: scan.runSalesInventoryScan,
}));

vi.mock("@/lib/sales-daily-import", () => ({
  parseXlsxTable: importer.parseXlsxTable,
  buildSalesImportRows: importer.buildSalesImportRows,
  remarkHasImportKey: importer.remarkHasImportKey,
}));

import { POST } from "@/app/(main)/api/sales/import/route";

const VALID_ROWS = [
  {
    importKey: "店小秘:ORDER-1:SKU-1:2026-06-27",
    sourceRow: 3,
    fields: {
      SKU: "SKU-1",
      商品名称: "Clock Spring",
      店铺: "Solidparts",
      日期: Date.parse("2026-06-27T00:00:00+08:00"),
      售出数量: 1,
      销售额: 18.61,
      备注: "导入Key: 店小秘:ORDER-1:SKU-1:2026-06-27",
    },
  },
  {
    importKey: "店小秘:ORDER-2:SKU-2:2026-06-27",
    sourceRow: 4,
    fields: {
      SKU: "SKU-2",
      商品名称: "Throttle Body",
      店铺: "NewPower",
      日期: Date.parse("2026-06-27T00:00:00+08:00"),
      售出数量: 2,
      销售额: 21.5,
      备注: "导入Key: 店小秘:ORDER-2:SKU-2:2026-06-27",
    },
  },
];

function request(commit: boolean): NextRequest {
  const formData = new FormData();
  formData.append("commit", commit ? "true" : "false");
  formData.append("file", new File(["xlsx"], "sales.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  return new NextRequest("https://internal.test/api/sales/import", {
    method: "POST",
    body: formData,
  });
}

beforeEach(() => {
  lark.assertLarkWriteEnabled.mockReset();
  lark.isLarkTableConfigured.mockReset();
  lark.isLarkTableConfigured.mockImplementation((table: string) => table === "exchangeRate");
  lark.createLarkRecords.mockReset();
  lark.createLarkRecords.mockResolvedValue(["rec-sales-2"]);
  lark.listLarkRecords.mockReset();
  lark.listLarkRecords.mockImplementation((table: string) => {
    if (table === "sku") {
      return Promise.resolve({
        hasMore: false,
        records: [
          { recordId: "sku-1", fields: { SKU: "SKU-1", 中文品名: "Clock Spring" } },
          { recordId: "sku-2", fields: { SKU: "SKU-2", 中文品名: "Throttle Body", 单品采购价_RMB: 20 } },
        ],
      });
    }
    if (table === "sales") {
      return Promise.resolve({
        hasMore: false,
        records: [
          { recordId: "sales-1", fields: { 备注: "导入Key: 店小秘:ORDER-1:SKU-1:2026-06-27" } },
        ],
      });
    }
    if (table === "exchangeRate") {
      return Promise.resolve({
        hasMore: false,
        records: [
          { recordId: "rate-1", fields: { 月份: "2026-06", USD_CNY汇率: 7.1 } },
        ],
      });
    }
    return Promise.resolve({ hasMore: false, records: [] });
  });
  session.requireRole.mockReset();
  session.requireRole.mockResolvedValue({
    name: "运营",
    role: "operator",
    isAdmin: false,
    sessionVersion: 0,
  });
  scan.createRepository.mockClear();
  scan.runSalesInventoryScan.mockReset();
  scan.runSalesInventoryScan.mockResolvedValue({
    scanId: "SCAN-20260628-2230-test0001",
    mode: "manual",
    processed: 1,
    deducted: 1,
    skipped: 0,
    exceptions: 0,
    warnings: 0,
    notificationStatus: "未配置",
  });
  importer.parseXlsxTable.mockReset();
  importer.parseXlsxTable.mockResolvedValue([["header"], ["row"]]);
  importer.buildSalesImportRows.mockReset();
  importer.buildSalesImportRows.mockReturnValue({
    validRows: VALID_ROWS,
    errors: [],
    summary: {
      totalRows: 2,
      validRows: 2,
      errorRows: 0,
      dateRange: { from: "2026-06-27", to: "2026-06-27" },
      stores: ["NewPower", "Solidparts"],
    },
  });
});

describe("POST /api/sales/import", () => {
  it("previews parsed rows without writes or inventory scan", async () => {
    const response = await POST(request(false));
    const json = await response.json() as { success?: boolean; created?: number; duplicates?: unknown[]; ready?: number };

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.ready).toBe(1);
    expect(json.created).toBe(0);
    expect(json.duplicates).toHaveLength(1);
    expect(session.requireRole).toHaveBeenCalledWith(["admin", "operator"]);
    expect(importer.buildSalesImportRows).toHaveBeenCalledWith([["header"], ["row"]], {
      "SKU-1": "Clock Spring",
      "SKU-2": "Throttle Body",
    }, {
      skuContext: {
        "SKU-1": { name: "Clock Spring", purchasePriceRmb: undefined },
        "SKU-2": { name: "Throttle Body", purchasePriceRmb: 20 },
      },
      monthlyExchangeRates: {
        "2026-06": 7.1,
      },
    });
    expect(lark.assertLarkWriteEnabled).not.toHaveBeenCalled();
    expect(lark.createLarkRecords).not.toHaveBeenCalled();
    expect(scan.runSalesInventoryScan).not.toHaveBeenCalled();
  });

  it("commits non-duplicate rows and starts sales inventory scan without waiting for completion", async () => {
    let resolveScan: (value: unknown) => void = () => {};
    scan.runSalesInventoryScan.mockReturnValue(new Promise((resolve) => {
      resolveScan = resolve;
    }));

    const responsePromise = POST(request(true));
    const race = await Promise.race([
      responsePromise.then(() => "response"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 20)),
    ]);

    expect(race).toBe("response");
    resolveScan({
      scanId: "SCAN-20260628-2230-test0001",
      mode: "manual",
      processed: 1,
      deducted: 1,
      skipped: 0,
      exceptions: 0,
      warnings: 0,
      notificationStatus: "未配置",
    });

    const response = await responsePromise;
    const json = await response.json() as { success?: boolean; created?: number; duplicates?: unknown[]; scan?: { status?: string } };

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.created).toBe(1);
    expect(json.duplicates).toHaveLength(1);
    expect(json.scan).toMatchObject({ status: "started" });
    expect(lark.assertLarkWriteEnabled).toHaveBeenCalledOnce();
    expect(lark.createLarkRecords).toHaveBeenCalledWith("sales", [
      expect.objectContaining({ SKU: "SKU-2", 店铺: "NewPower", 售出数量: 2 }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scan.runSalesInventoryScan).toHaveBeenCalledWith(
      { kind: "sales-scan-repo" },
      expect.objectContaining({
        mode: "manual",
        operator: "运营",
        limit: 1,
      }),
    );
  });

  it("commits non-duplicate rows and reports skipped scan when nothing new is written", async () => {
    lark.listLarkRecords.mockImplementation((table: string) => {
      if (table === "sku") {
        return Promise.resolve({
          hasMore: false,
          records: [
            { recordId: "sku-1", fields: { SKU: "SKU-1", 中文品名: "Clock Spring" } },
            { recordId: "sku-2", fields: { SKU: "SKU-2", 中文品名: "Throttle Body" } },
          ],
        });
      }
      if (table === "sales") {
        return Promise.resolve({
          hasMore: false,
          records: VALID_ROWS.map((row) => ({ recordId: row.importKey, fields: { 备注: row.fields.备注 } })),
        });
      }
      if (table === "exchangeRate") {
        return Promise.resolve({ hasMore: false, records: [] });
      }
      return Promise.resolve({ hasMore: false, records: [] });
    });

    const response = await POST(request(true));
    const json = await response.json() as { success?: boolean; created?: number; duplicates?: unknown[]; scan?: { status?: string; reason?: string } };

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.created).toBe(0);
    expect(json.duplicates).toHaveLength(2);
    expect(json.scan).toMatchObject({ status: "skipped", reason: "没有新增销售记录" });
    expect(lark.assertLarkWriteEnabled).toHaveBeenCalledOnce();
    expect(lark.createLarkRecords).not.toHaveBeenCalled();
    expect(scan.runSalesInventoryScan).not.toHaveBeenCalled();
  });

  it("rejects non-xlsx files", async () => {
    const formData = new FormData();
    formData.append("file", new File(["csv"], "sales.csv", { type: "text/csv" }));
    const response = await POST(new NextRequest("https://internal.test/api/sales/import", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(400);
    expect(lark.createLarkRecords).not.toHaveBeenCalled();
  });
});
