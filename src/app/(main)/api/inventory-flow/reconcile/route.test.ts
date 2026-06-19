import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertLarkWriteEnabled: vi.fn(),
  createRepository: vi.fn(() => ({ kind: "inventory-repo" })),
  reconcile: vi.fn(),
}));

vi.mock("@/lib/session-server", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("@/lib/lark-server", () => ({
  assertLarkWriteEnabled: mocks.assertLarkWriteEnabled,
}));

vi.mock("@/lib/inventory-lark-repository", () => ({
  createLarkInventoryBatchRepository: mocks.createRepository,
}));

vi.mock("@/lib/inventory-batch-server", () => ({
  reconcileInventorySummaries: mocks.reconcile,
}));

import { POST } from "@/app/(main)/api/inventory-flow/reconcile/route";

function request(body: unknown = {}) {
  return new NextRequest("https://internal/api/inventory-flow/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({
    name: "运营",
    role: "operator",
    isAdmin: false,
    sessionVersion: 0,
  });
  mocks.assertLarkWriteEnabled.mockReset();
  mocks.createRepository.mockClear();
  mocks.reconcile.mockReset();
  mocks.reconcile.mockResolvedValue({ skus: ["SKU-1"], updated: 1 });
});

describe("POST /api/inventory-flow/reconcile", () => {
  it("允许管理员或运营按 SKU 重算库存汇总", async () => {
    const response = await POST(request({ skus: [" sku-1 "] }));

    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith(["admin", "operator"]);
    expect(mocks.reconcile).toHaveBeenCalledWith({ kind: "inventory-repo" }, { skus: ["sku-1"] });
    await expect(response.json()).resolves.toEqual({
      success: true,
      skus: ["SKU-1"],
      updated: 1,
    });
  });

  it("不传 SKU 时触发全量重算", async () => {
    mocks.reconcile.mockResolvedValue({ skus: ["SKU-1", "SKU-2"], updated: 2 });

    const response = await POST(request({}));

    expect(response.status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledWith({ kind: "inventory-repo" }, {});
    await expect(response.json()).resolves.toMatchObject({ success: true, updated: 2 });
  });

  it("拒绝非法 SKU 参数", async () => {
    const response = await POST(request({ skus: "SKU-1" }));

    expect(response.status).toBe(400);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("权限不足时不创建仓库", async () => {
    mocks.requireRole.mockRejectedValue(new Error("权限不足"));

    const response = await POST(request({}));

    expect(response.status).toBe(403);
    expect(mocks.createRepository).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
