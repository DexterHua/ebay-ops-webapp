import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROFIT_ASSUMPTIONS } from "@/lib/profit-calculator";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireAdmin: vi.fn(),
  getProfitSettings: vi.fn(),
  saveProfitSettings: vi.fn(),
}));

vi.mock("@/lib/session-server", () => ({
  requireSession: mocks.requireSession,
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/lib/profit-settings", () => ({
  getProfitSettings: mocks.getProfitSettings,
  saveProfitSettings: mocks.saveProfitSettings,
}));

import { GET, PUT } from "@/app/(main)/api/profit-settings/route";

const settings = {
  assumptions: DEFAULT_PROFIT_ASSUMPTIONS,
  updatedAt: null,
  updatedBy: null,
};

function putRequest(body: unknown) {
  return new NextRequest("https://internal/api/profit-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.requireSession.mockReset();
  mocks.requireSession.mockResolvedValue({
    name: "运营",
    role: "operator",
    isAdmin: false,
    sessionVersion: 0,
  });
  mocks.requireAdmin.mockReset();
  mocks.requireAdmin.mockResolvedValue({
    name: "车泉",
    role: "admin",
    isAdmin: true,
    sessionVersion: 0,
  });
  mocks.getProfitSettings.mockReset();
  mocks.getProfitSettings.mockResolvedValue(settings);
  mocks.saveProfitSettings.mockReset();
  mocks.saveProfitSettings.mockImplementation(async (assumptions, updatedBy) => ({
    assumptions,
    updatedAt: "2026-06-20T10:00:00.000Z",
    updatedBy,
  }));
});

describe("GET /api/profit-settings", () => {
  it("允许任意已登录用户读取全局成本参数", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.requireSession).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({ ok: true, settings });
  });

  it("未登录时返回 401", async () => {
    mocks.requireSession.mockRejectedValue(new Error("未登录"));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getProfitSettings).not.toHaveBeenCalled();
  });
});

describe("PUT /api/profit-settings", () => {
  it("管理员可以保存成本参数且不传输利润测算结果", async () => {
    const assumptions = { ...DEFAULT_PROFIT_ASSUMPTIONS, exchangeRate: 7 };
    const response = await PUT(putRequest({
      assumptions,
      sku: "SP-001",
      salePriceUsd: 99,
      profit: 20,
    }));

    expect(response.status).toBe(200);
    expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.saveProfitSettings).toHaveBeenCalledWith(assumptions, "车泉");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      settings: { assumptions, updatedBy: "车泉" },
    });
  });

  it("普通用户绕过界面直接请求时仍返回 403", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("权限不足"));

    const response = await PUT(putRequest({ assumptions: DEFAULT_PROFIT_ASSUMPTIONS }));

    expect(response.status).toBe(403);
    expect(mocks.saveProfitSettings).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ ok: false, error: "仅管理员可修改成本参数" });
  });

  it("参数校验失败时返回 400 并保留服务端错误", async () => {
    mocks.saveProfitSettings.mockRejectedValue(new Error("汇率必须大于 0"));

    const response = await PUT(putRequest({
      assumptions: { ...DEFAULT_PROFIT_ASSUMPTIONS, exchangeRate: 0 },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "汇率必须大于 0" });
  });

  it("存储异常时返回不暴露内部信息的 500", async () => {
    mocks.saveProfitSettings.mockRejectedValue(new TypeError("secret storage detail"));

    const response = await PUT(putRequest({ assumptions: DEFAULT_PROFIT_ASSUMPTIONS }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "成本参数存储暂时不可用，请稍后重试" });
  });
});
