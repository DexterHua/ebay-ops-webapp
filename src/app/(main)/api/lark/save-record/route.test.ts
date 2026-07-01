import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lark = vi.hoisted(() => ({
  assertLarkWriteEnabled: vi.fn(),
  createLarkRecords: vi.fn(),
  syncSalesSummary: vi.fn(),
  syncStockSummaryFromFlow: vi.fn(),
}));

const session = vi.hoisted(() => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/lark-server", () => ({
  assertLarkWriteEnabled: lark.assertLarkWriteEnabled,
  createLarkRecords: lark.createLarkRecords,
  syncSalesSummary: lark.syncSalesSummary,
  syncStockSummaryFromFlow: lark.syncStockSummaryFromFlow,
}));

vi.mock("@/lib/session-server", () => ({
  requireSession: session.requireSession,
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
  lark.syncSalesSummary.mockReset();
  lark.syncStockSummaryFromFlow.mockReset();
  session.requireSession.mockReset();
  session.requireSession.mockResolvedValue({
    name: "车泉",
    isAdmin: true,
    role: "admin",
    sessionVersion: 0,
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("save-record SKU ownership", () => {
  it("ignores the client owner and writes the authenticated user's configured open_id", async () => {
    vi.stubEnv("LARK_USER_OPEN_IDS", JSON.stringify({ 车泉: "ou_owner_123" }));

    const response = await POST(request({
      table: "skuMaster",
      fields: {
        SKU: "SKU-1",
        中文品名: "方向游丝",
        负责人: "客户端伪造",
      },
    }));
    const json = await response.json() as { warning?: string };

    expect(response.status).toBe(200);
    expect(json.warning).toBeUndefined();
    expect(lark.createLarkRecords).toHaveBeenCalledWith("sku", [{
      SKU: "SKU-1",
      中文品名: "方向游丝",
      负责人: [{ id: "ou_owner_123" }],
    }]);
  });

  it("normalizes SKU image URL fields before writing to Lark", async () => {
    vi.stubEnv("LARK_USER_OPEN_IDS", "");

    const response = await POST(request({
      table: "skuMaster",
      fields: {
        SKU: "SKU-1",
        中文品名: "方向游丝",
        商品图片: "https://example.com/product.jpg",
      },
    }));

    expect(response.status).toBe(200);
    expect(lark.createLarkRecords).toHaveBeenCalledWith("sku", [{
      SKU: "SKU-1",
      中文品名: "方向游丝",
      商品图片: {
        text: "https://example.com/product.jpg",
        link: "https://example.com/product.jpg",
      },
    }]);
  });

  it("saves without an owner and warns when the current user has no mapping", async () => {
    vi.stubEnv("LARK_USER_OPEN_IDS", "");

    const response = await POST(request({
      table: "skuMaster",
      fields: {
        SKU: "SKU-1",
        中文品名: "方向游丝",
        负责人: "客户端伪造",
      },
    }));
    const json = await response.json() as { warning?: string };

    expect(response.status).toBe(200);
    expect(json.warning).toContain("负责人未写入");
    expect(lark.createLarkRecords).toHaveBeenCalledWith("sku", [{
      SKU: "SKU-1",
      中文品名: "方向游丝",
    }]);
  });

  it("rejects the write when the authenticated session is invalid", async () => {
    session.requireSession.mockRejectedValue(new Error("登录状态已失效"));

    const response = await POST(request({
      table: "skuMaster",
      fields: {
        SKU: "SKU-1",
        中文品名: "方向游丝",
        负责人: "客户端伪造",
      },
    }));

    expect(response.status).toBe(401);
    expect(lark.createLarkRecords).not.toHaveBeenCalled();
  });

  it("preserves status 500 for unexpected session failures", async () => {
    session.requireSession.mockRejectedValue(new Error("用户存储不可用"));

    const response = await POST(request({
      table: "skuMaster",
      fields: {
        SKU: "SKU-1",
        中文品名: "方向游丝",
      },
    }));

    expect(response.status).toBe(500);
    expect(lark.createLarkRecords).not.toHaveBeenCalled();
  });

  it("preserves status 500 for non-auth write failures", async () => {
    lark.createLarkRecords.mockRejectedValue(new Error("飞书登录状态同步失败"));

    const response = await POST(request({
      table: "skuMaster",
      fields: {
        SKU: "SKU-1",
        中文品名: "方向游丝",
      },
    }));
    const json = await response.json() as { error?: string };

    expect(response.status).toBe(500);
    expect(json.error).toBe("飞书登录状态同步失败");
  });
});

describe("save-record sourcing", () => {
  it("accepts sourcing records and normalizes registration time", async () => {
    const response = await POST(request({
      table: "sourcing",
      fields: {
        OEM码: "84306-0E010",
        商品链接: "https://www.ebay.com/itm/123456",
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
      商品链接: {
        text: "https://www.ebay.com/itm/123456",
        link: "https://www.ebay.com/itm/123456",
      },
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
