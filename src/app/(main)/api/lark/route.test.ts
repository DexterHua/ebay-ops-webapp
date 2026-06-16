import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lark = vi.hoisted(() => ({
  getLarkReadLimit: vi.fn(),
  listLarkRecords: vi.fn(),
}));

vi.mock("@/lib/lark-server", () => ({
  getLarkReadLimit: lark.getLarkReadLimit,
  listLarkRecords: lark.listLarkRecords,
}));

import { GET } from "./route";

beforeEach(() => {
  lark.getLarkReadLimit.mockReset();
  lark.getLarkReadLimit.mockReturnValue(5000);
  lark.listLarkRecords.mockReset();
  lark.listLarkRecords.mockResolvedValue({
    records: [{ recordId: "rec-1", fields: { OEM码: "84306-0E010", 选品阶段: "初选待处理" } }],
    hasMore: false,
  });
});

describe("lark read api", () => {
  it("reads sourcing records through the generic table endpoint", async () => {
    const response = await GET(new NextRequest("https://internal.test/api/lark?table=sourcing"));
    const json = await response.json() as { success?: boolean; table?: string; data?: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      table: "sourcing",
      data: [{ recordId: "rec-1", OEM码: "84306-0E010", 选品阶段: "初选待处理" }],
    });
    expect(lark.listLarkRecords).toHaveBeenCalledWith("sourcing", 5000);
  });
});
