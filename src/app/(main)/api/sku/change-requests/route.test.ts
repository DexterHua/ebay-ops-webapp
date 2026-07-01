import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lark = vi.hoisted(() => ({
  assertLarkWriteEnabled: vi.fn(),
  createLarkRecords: vi.fn(),
  listLarkRecords: vi.fn(),
  updateLarkRecord: vi.fn(),
}));

const session = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireSession: vi.fn(),
}));

vi.mock("@/lib/lark-server", () => ({
  assertLarkWriteEnabled: lark.assertLarkWriteEnabled,
  createLarkRecords: lark.createLarkRecords,
  listLarkRecords: lark.listLarkRecords,
  updateLarkRecord: lark.updateLarkRecord,
}));

vi.mock("@/lib/session-server", () => ({
  requireRole: session.requireRole,
  requireSession: session.requireSession,
}));

import { POST, PUT } from "./route";

function jsonRequest(method: string, body: unknown): NextRequest {
  return new NextRequest("https://internal.test/api/sku/change-requests", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PENDING_REQUEST = {
  recordId: "rec-request-1",
  fields: {
    SKU: "SP-001",
    SKU记录ID: "rec-sku-1",
    原始数据JSON: "{\"SKU\":\"SP-001\",\"中文品名\":\"旧名称\"}",
    修改内容JSON: "{\"中文品名\":\"新名称\",\"SKU状态\":\"已上架\"}",
    修改字段: "中文品名、SKU状态",
    提交人: "运营",
    提交角色: "operator",
    提交时间: 1782892800000,
    审核状态: "待审核",
  },
};

beforeEach(() => {
  lark.assertLarkWriteEnabled.mockReset();
  lark.createLarkRecords.mockReset();
  lark.createLarkRecords.mockResolvedValue(["rec-request-1"]);
  lark.listLarkRecords.mockReset();
  lark.listLarkRecords.mockResolvedValue({ hasMore: false, records: [PENDING_REQUEST] });
  lark.updateLarkRecord.mockReset();
  session.requireRole.mockReset();
  session.requireRole.mockResolvedValue({
    name: "运营",
    role: "operator",
    isAdmin: false,
    sessionVersion: 0,
  });
  session.requireSession.mockReset();
  session.requireSession.mockResolvedValue({
    name: "运营",
    role: "operator",
    isAdmin: false,
    sessionVersion: 0,
  });
});

describe("POST /api/sku/change-requests", () => {
  it("creates a pending change request without updating SKU master data", async () => {
    const response = await POST(jsonRequest("POST", {
      sku: "SP-001",
      skuRecordId: "rec-sku-1",
      original: { SKU: "SP-001", 中文品名: "旧名称", OEM: "A" },
      updates: { SKU: "SP-002", 中文品名: "新名称", OEM: "A", 负责人: "伪造" },
    }));
    const json = await response.json() as { success?: boolean; recordIds?: string[]; changedFields?: string[] };

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.recordIds).toEqual(["rec-request-1"]);
    expect(json.changedFields).toEqual(["中文品名"]);
    expect(lark.assertLarkWriteEnabled).toHaveBeenCalledOnce();
    expect(session.requireRole).toHaveBeenCalledWith(["admin", "operator", "purchaser"]);
    expect(lark.createLarkRecords).toHaveBeenCalledWith("skuChangeRequest", [
      expect.objectContaining({
        SKU: "SP-001",
        SKU记录ID: "rec-sku-1",
        修改字段: "中文品名",
        提交人: "运营",
        提交角色: "operator",
        审核状态: "待审核",
      }),
    ]);
    expect(JSON.parse(String(lark.createLarkRecords.mock.calls[0][1][0].修改内容JSON))).toEqual({ 中文品名: "新名称" });
    expect(lark.updateLarkRecord).not.toHaveBeenCalledWith("sku", expect.any(String), expect.any(Object));
  });

  it("rejects submissions without changed editable fields", async () => {
    const response = await POST(jsonRequest("POST", {
      sku: "SP-001",
      skuRecordId: "rec-sku-1",
      original: { SKU: "SP-001", 中文品名: "旧名称" },
      updates: { SKU: "SP-002", 中文品名: "旧名称" },
    }));

    expect(response.status).toBe(400);
    expect(lark.createLarkRecords).not.toHaveBeenCalled();
  });
});

describe("PUT /api/sku/change-requests", () => {
  beforeEach(() => {
    session.requireRole.mockResolvedValue({
      name: "车泉",
      role: "admin",
      isAdmin: true,
      sessionVersion: 0,
    });
  });

  it("approves a pending request by updating SKU master data before marking the request approved", async () => {
    const response = await PUT(jsonRequest("PUT", {
      requestId: "rec-request-1",
      action: "approve",
      reviewNote: "确认补录",
    }));
    const json = await response.json() as { success?: boolean; message?: string };

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toBe("SKU 修改申请已通过");
    expect(lark.updateLarkRecord).toHaveBeenNthCalledWith(1, "sku", "rec-sku-1", {
      中文品名: "新名称",
      SKU状态: "已上架",
    });
    expect(lark.updateLarkRecord).toHaveBeenNthCalledWith(2, "skuChangeRequest", "rec-request-1", expect.objectContaining({
      审核状态: "已通过",
      审核人: "车泉",
      审核备注: "确认补录",
    }));
  });

  it("normalizes SKU image URL patches before approving into master data", async () => {
    lark.listLarkRecords.mockResolvedValue({
      hasMore: false,
      records: [{
        recordId: "rec-request-url",
        fields: {
          SKU: "SP-001",
          SKU记录ID: "rec-sku-1",
          原始数据JSON: "{\"SKU\":\"SP-001\",\"商品图片\":\"\"}",
          修改内容JSON: "{\"商品图片\":\"https://example.com/product.jpg\"}",
          修改字段: "商品图片",
          提交人: "运营",
          提交角色: "operator",
          提交时间: 1782892800000,
          审核状态: "待审核",
        },
      }],
    });

    const response = await PUT(jsonRequest("PUT", {
      requestId: "rec-request-url",
      action: "approve",
    }));

    expect(response.status).toBe(200);
    expect(lark.updateLarkRecord).toHaveBeenNthCalledWith(1, "sku", "rec-sku-1", {
      商品图片: {
        text: "https://example.com/product.jpg",
        link: "https://example.com/product.jpg",
      },
    });
  });

  it("rejects a pending request without updating SKU master data", async () => {
    const response = await PUT(jsonRequest("PUT", {
      requestId: "rec-request-1",
      action: "reject",
      reviewNote: "资料不足",
    }));

    expect(response.status).toBe(200);
    expect(lark.updateLarkRecord).toHaveBeenCalledTimes(1);
    expect(lark.updateLarkRecord).toHaveBeenCalledWith("skuChangeRequest", "rec-request-1", expect.objectContaining({
      审核状态: "已否决",
      审核人: "车泉",
      审核备注: "资料不足",
    }));
  });
});
