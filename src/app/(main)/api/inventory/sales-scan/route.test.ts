import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertLarkWriteEnabled: vi.fn(),
  createRepository: vi.fn(() => ({ kind: "repo" })),
  runScan: vi.fn(),
}));

vi.mock("@/lib/session-server", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("@/lib/lark-server", () => ({
  assertLarkWriteEnabled: mocks.assertLarkWriteEnabled,
}));

vi.mock("@/lib/sales-inventory-lark-repository", () => ({
  createLarkSalesInventoryScanRepository: mocks.createRepository,
}));

vi.mock("@/lib/sales-inventory-scan", () => ({
  runSalesInventoryScan: mocks.runScan,
}));

import { POST } from "@/app/(main)/api/inventory/sales-scan/route";

const SECRET = "test-inventory-sales-scan-secret-32-chars";
const RESULT = {
  scanId: "SCAN-20260605-0900-abcdef12",
  mode: "manual",
  processed: 10,
  deducted: 8,
  skipped: 1,
  exceptions: 1,
  warnings: 2,
  notificationStatus: "未配置",
};

function request(body: unknown = {}, authorization?: string) {
  return new NextRequest("https://internal/api/inventory/sales-scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("INVENTORY_SALES_SCAN_SECRET", SECRET);
  vi.stubEnv("LARK_INVENTORY_ALERT_CHAT_ID", "");
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({
    name: "管理员",
    role: "admin",
    isAdmin: true,
    sessionVersion: 0,
  });
  mocks.assertLarkWriteEnabled.mockReset();
  mocks.createRepository.mockClear();
  mocks.runScan.mockReset();
  mocks.runScan.mockResolvedValue(RESULT);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/inventory/sales-scan", () => {
  it("管理员手动触发使用会话姓名和默认 limit", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith(["admin"]);
    expect(mocks.runScan).toHaveBeenCalledWith(
      { kind: "repo" },
      expect.objectContaining({
        scanId: expect.stringMatching(/^SCAN-\d{8}-\d{4}-[a-f0-9]{8}$/),
        mode: "manual",
        operator: "管理员",
        limit: 200,
        now: expect.any(Number),
        alertChatId: undefined,
      }),
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ success: true, ...RESULT });
  });

  it("合法定时密钥跳过用户会话并使用系统操作人", async () => {
    mocks.runScan.mockResolvedValue({ ...RESULT, mode: "scheduled" });

    const response = await POST(request({ limit: 200 }, `Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(mocks.requireRole).not.toHaveBeenCalled();
    expect(mocks.runScan).toHaveBeenCalledWith(
      { kind: "repo" },
      expect.objectContaining({
        mode: "scheduled",
        operator: "系统自动扫描",
        limit: 200,
      }),
    );
  });

  it("出现错误 Authorization 时返回 401 且不回退管理员会话", async () => {
    const response = await POST(request({ limit: 200 }, "Bearer wrong-secret"));

    expect(response.status).toBe(401);
    expect(mocks.requireRole).not.toHaveBeenCalled();
    expect(mocks.runScan).not.toHaveBeenCalled();
  });

  it("未登录的手动请求返回 401", async () => {
    mocks.requireRole.mockRejectedValue(new Error("未登录"));

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.runScan).not.toHaveBeenCalled();
  });

  it("非管理员手动请求返回 403", async () => {
    mocks.requireRole.mockRejectedValue(new Error("权限不足"));

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.runScan).not.toHaveBeenCalled();
  });

  it("拒绝客户端通过 body 伪造 scheduled 模式", async () => {
    const response = await POST(request({ mode: "scheduled", limit: 200 }));

    expect(response.status).toBe(400);
    expect(mocks.runScan).not.toHaveBeenCalled();
  });

  it.each([0, 501, 1.5, "200"])("非法 limit %p 返回 400", async (limit) => {
    const response = await POST(request({ limit }));

    expect(response.status).toBe(400);
    expect(mocks.runScan).not.toHaveBeenCalled();
  });

  it("非法 JSON 返回 400", async () => {
    const badRequest = new NextRequest("https://internal/api/inventory/sales-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    const response = await POST(badRequest);

    expect(response.status).toBe(400);
    expect(mocks.runScan).not.toHaveBeenCalled();
  });

  it("销售记录摘要冲突返回 409", async () => {
    mocks.runScan.mockRejectedValue(new Error("销售记录在扣减开始后被修改"));

    const response = await POST(request());

    expect(response.status).toBe(409);
  });

  it("飞书错误返回 500 并保留可排查信息", async () => {
    mocks.runScan.mockRejectedValue(new Error("飞书记录未完整读取，拒绝执行销售库存扫描"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("飞书记录未完整读取"),
    });
  });

  it("写入开关关闭时不创建仓库", async () => {
    mocks.assertLarkWriteEnabled.mockImplementation(() => {
      throw new Error("飞书写入已关闭");
    });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.runScan).not.toHaveBeenCalled();
  });

  it("响应包含通知结果字段", async () => {
    mocks.runScan.mockResolvedValue({
      ...RESULT,
      notificationStatus: "发送失败",
      notificationError: "飞书消息发送失败",
    });

    const response = await POST(request());

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      notificationStatus: "发送失败",
      notificationError: "飞书消息发送失败",
    });
  });
});
