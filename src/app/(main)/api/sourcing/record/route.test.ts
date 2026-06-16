import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lark = vi.hoisted(() => ({
  assertLarkWriteEnabled: vi.fn(),
  updateLarkRecord: vi.fn(),
}));

vi.mock("@/lib/lark-server", () => ({
  assertLarkWriteEnabled: lark.assertLarkWriteEnabled,
  updateLarkRecord: lark.updateLarkRecord,
}));

import { PATCH } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("https://internal.test/api/sourcing/record", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  lark.assertLarkWriteEnabled.mockReset();
  lark.updateLarkRecord.mockReset();
  lark.updateLarkRecord.mockResolvedValue(undefined);
});

describe("sourcing record update api", () => {
  it("updates sourcing review fields and normalizes timestamps", async () => {
    const response = await PATCH(request({
      recordId: "rec-1",
      fields: {
        初选结果: "入选",
        最高购入价格: 35.8,
        初选备注: "利润可以",
        初选人: "车泉",
        初选时间: "2026/06/14 21:40",
        选品阶段: "已入选待询价",
      },
    }));
    const json = await response.json() as { success?: boolean };

    expect(response.status).toBe(200);
    expect(json).toEqual({ success: true });
    expect(lark.updateLarkRecord).toHaveBeenCalledWith("sourcing", "rec-1", {
      初选结果: "入选",
      最高购入价格: 35.8,
      初选备注: "利润可以",
      初选人: "车泉",
      初选时间: Date.parse("2026-06-14 21:40"),
      选品阶段: "已入选待询价",
    });
  });

  it("normalizes sourcing URL values when updating link fields", async () => {
    const response = await PATCH(request({
      recordId: "rec-1",
      fields: {
        商品链接: "https://www.ebay.com/itm/123456",
      },
    }));

    expect(response.status).toBe(200);
    expect(lark.updateLarkRecord).toHaveBeenCalledWith("sourcing", "rec-1", {
      商品链接: {
        text: "https://www.ebay.com/itm/123456",
        link: "https://www.ebay.com/itm/123456",
      },
    });
  });

  it("rejects missing record id", async () => {
    const response = await PATCH(request({ fields: { 选品阶段: "询价中" } }));

    expect(response.status).toBe(400);
    expect(lark.updateLarkRecord).not.toHaveBeenCalled();
  });
});
