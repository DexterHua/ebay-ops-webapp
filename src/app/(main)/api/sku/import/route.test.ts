import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lark = vi.hoisted(() => ({
  assertLarkWriteEnabled: vi.fn(),
  createLarkRecords: vi.fn(),
  listLarkRecords: vi.fn(),
  readLarkText: vi.fn((value: unknown) => String(value ?? "")),
}));

const session = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

const importer = vi.hoisted(() => ({
  parseXlsxTable: vi.fn(),
}));

vi.mock("@/lib/lark-server", () => ({
  assertLarkWriteEnabled: lark.assertLarkWriteEnabled,
  createLarkRecords: lark.createLarkRecords,
  listLarkRecords: lark.listLarkRecords,
  readLarkText: lark.readLarkText,
}));

vi.mock("@/lib/session-server", () => ({
  requireRole: session.requireRole,
}));

vi.mock("@/lib/xlsx-table", () => ({
  parseXlsxTable: importer.parseXlsxTable,
}));

import { POST } from "./route";

function request(commit: boolean, filename = "sku.xlsx"): NextRequest {
  const formData = new FormData();
  formData.append("commit", commit ? "true" : "false");
  formData.append("file", new File(["xlsx"], filename, {
    type: filename.toLowerCase().endsWith(".xlsx")
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv",
  }));
  return new NextRequest("https://internal.test/api/sku/import", {
    method: "POST",
    body: formData,
  });
}

const TEMPLATE_ROWS = [
  ["SKU", "OEM", "中文品名", "英文标题关键词", "类目", "重量/KG", "长/cm", "宽/cm", "高/cm", "商品图片", "描述", "备注"],
  ["SP-001", "OEM-1", "方向游丝", "Clock Spring", "Clock Spring", "0.32", "13.2", "13.2", "9.4", "https://example.com/1.jpg", "卖点", "首批"],
  ["SP-OLD", "OEM-2", "旧品", "Old Part", "Others", "0.2", "10", "8", "6", "", "", ""],
];

beforeEach(() => {
  vi.unstubAllEnvs();
  lark.assertLarkWriteEnabled.mockReset();
  lark.createLarkRecords.mockReset();
  lark.createLarkRecords.mockResolvedValue(["rec-sku-1"]);
  lark.listLarkRecords.mockReset();
  lark.listLarkRecords.mockResolvedValue({
    hasMore: false,
    records: [{ recordId: "old", fields: { SKU: "SP-OLD", 中文品名: "旧品" } }],
  });
  session.requireRole.mockReset();
  session.requireRole.mockResolvedValue({
    name: "车泉",
    role: "operator",
    isAdmin: false,
    sessionVersion: 0,
  });
  importer.parseXlsxTable.mockReset();
  importer.parseXlsxTable.mockResolvedValue(TEMPLATE_ROWS);
});

describe("POST /api/sku/import", () => {
  it("previews importable rows and duplicate SKUs without writing", async () => {
    const response = await POST(request(false));
    const json = await response.json() as {
      success?: boolean;
      ready?: number;
      created?: number;
      duplicates?: unknown[];
      rows?: Array<{ sourceRow: number; SKU: string; 中文品名: string }>;
    };

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.ready).toBe(1);
    expect(json.created).toBe(0);
    expect(json.duplicates).toHaveLength(1);
    expect(json.rows).toEqual([{ sourceRow: 2, SKU: "SP-001", 中文品名: "方向游丝" }]);
    expect(lark.assertLarkWriteEnabled).not.toHaveBeenCalled();
    expect(lark.createLarkRecords).not.toHaveBeenCalled();
  });

  it("commits only non-duplicate SKUs with the authenticated owner mapping", async () => {
    vi.stubEnv("LARK_USER_OPEN_IDS", JSON.stringify({ 车泉: "ou_owner_123" }));

    const response = await POST(request(true));
    const json = await response.json() as { success?: boolean; created?: number; recordIds?: string[]; warning?: string };

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.created).toBe(1);
    expect(json.recordIds).toEqual(["rec-sku-1"]);
    expect(json.warning).toBeUndefined();
    expect(lark.assertLarkWriteEnabled).toHaveBeenCalledOnce();
    expect(lark.createLarkRecords).toHaveBeenCalledWith("sku", [
      expect.objectContaining({
        SKU: "SP-001",
        中文品名: "方向游丝",
        负责人: [{ id: "ou_owner_123" }],
      }),
    ]);
  });

  it("commits without owner and returns a warning when no mapping exists", async () => {
    vi.stubEnv("LARK_USER_OPEN_IDS", "");

    const response = await POST(request(true));
    const json = await response.json() as { warning?: string };

    expect(response.status).toBe(200);
    expect(json.warning).toContain("负责人未写入");
    expect(lark.createLarkRecords).toHaveBeenCalledWith("sku", [
      expect.not.objectContaining({ 负责人: expect.anything() }),
    ]);
  });

  it("rejects non-xlsx files", async () => {
    const response = await POST(request(false, "sku.csv"));

    expect(response.status).toBe(400);
    expect(lark.createLarkRecords).not.toHaveBeenCalled();
  });
});
