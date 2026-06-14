import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lark = vi.hoisted(() => ({
  assertLarkWriteEnabled: vi.fn(),
  createLarkRecords: vi.fn(),
  resolveLarkUserReference: vi.fn(),
  syncSalesSummary: vi.fn(),
  syncStockSummaryFromFlow: vi.fn(),
}));

vi.mock("@/lib/lark-server", () => ({
  assertLarkWriteEnabled: lark.assertLarkWriteEnabled,
  createLarkRecords: lark.createLarkRecords,
  resolveLarkUserReference: lark.resolveLarkUserReference,
  syncSalesSummary: lark.syncSalesSummary,
  syncStockSummaryFromFlow: lark.syncStockSummaryFromFlow,
}));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("https://internal.test/api/lark/save-record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  lark.assertLarkWriteEnabled.mockReset();
  lark.createLarkRecords.mockReset();
  lark.createLarkRecords.mockResolvedValue(["rec-sourcing-1"]);
  lark.resolveLarkUserReference.mockReset();
  lark.syncSalesSummary.mockReset();
  lark.syncStockSummaryFromFlow.mockReset();
});

describe("save-record sourcing", () => {
  it("accepts sourcing records and normalizes registration time", async () => {
    const response = await POST(request({
      table: "sourcing",
      fields: {
        OEM码: "84306-0E010",
        英文名称: "Clock Spring",
        中文名称: "方向盘游丝",
        登记人: "运营",
        登记时间: "2026/06/14",
        选品阶段: "初选待处理",
      },
    }));
    const json = await response.json() as { success?: boolean; recordIds?: string[] };

    expect(response.status).toBe(200);
    expect(json).toEqual({ success: true, table: "sourcing", recordIds: ["rec-sourcing-1"] });
    expect(lark.createLarkRecords).toHaveBeenCalledWith("sourcing", [{
      OEM码: "84306-0E010",
      英文名称: "Clock Spring",
      中文名称: "方向盘游丝",
      登记人: "运营",
      登记时间: Date.parse("2026-06-14T00:00:00+08:00"),
      选品阶段: "初选待处理",
    }]);
    expect(lark.syncSalesSummary).not.toHaveBeenCalled();
    expect(lark.syncStockSummaryFromFlow).not.toHaveBeenCalled();
  });
});
