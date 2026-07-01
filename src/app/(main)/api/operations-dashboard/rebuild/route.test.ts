import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lark = vi.hoisted(() => ({
  assertLarkWriteEnabled: vi.fn(),
}));

const session = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

const repository = vi.hoisted(() => ({
  createRepository: vi.fn(() => ({ kind: "operations-dashboard-repo" })),
}));

const rebuild = vi.hoisted(() => ({
  runOperationsDashboardRebuild: vi.fn(),
}));

vi.mock("@/lib/lark-server", () => ({
  assertLarkWriteEnabled: lark.assertLarkWriteEnabled,
}));

vi.mock("@/lib/session-server", () => ({
  requireRole: session.requireRole,
}));

vi.mock("@/lib/operations-dashboard-lark-repository", () => ({
  createLarkOperationsDashboardRepository: repository.createRepository,
}));

vi.mock("@/lib/operations-dashboard-rebuild", () => ({
  runOperationsDashboardRebuild: rebuild.runOperationsDashboardRebuild,
}));

import { POST } from "@/app/(main)/api/operations-dashboard/rebuild/route";

function request(headers?: HeadersInit): NextRequest {
  return new NextRequest("https://internal.test/api/operations-dashboard/rebuild", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  lark.assertLarkWriteEnabled.mockReset();
  session.requireRole.mockReset();
  session.requireRole.mockResolvedValue({ name: "管理员", role: "admin", isAdmin: true, sessionVersion: 0 });
  repository.createRepository.mockClear();
  rebuild.runOperationsDashboardRebuild.mockReset();
  rebuild.runOperationsDashboardRebuild.mockResolvedValue({
    salesRows: 1,
    skuSummaryRows: 1,
    daySummaries: 1,
    periodSummaries: 2,
    skuPeriodSummaries: 2,
    profitBreakdowns: 16,
    skuSummaryPatches: 1,
  });
});

describe("POST /api/operations-dashboard/rebuild", () => {
  it("allows admin users to rebuild manually", async () => {
    const response = await POST(request());
    const json = await response.json() as { success?: boolean; mode?: string; daySummaries?: number };

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ success: true, mode: "manual", daySummaries: 1 });
    expect(lark.assertLarkWriteEnabled).toHaveBeenCalledOnce();
    expect(session.requireRole).toHaveBeenCalledWith(["admin"]);
    expect(rebuild.runOperationsDashboardRebuild).toHaveBeenCalledWith({ kind: "operations-dashboard-repo" }, expect.any(Object));
  });

  it("allows scheduled rebuilds with bearer secret", async () => {
    vi.stubEnv("OPERATIONS_DASHBOARD_REBUILD_SECRET", "secret-1");

    const response = await POST(request({ authorization: "Bearer secret-1" }));
    const json = await response.json() as { success?: boolean; mode?: string };

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ success: true, mode: "scheduled" });
    expect(session.requireRole).not.toHaveBeenCalled();
    expect(rebuild.runOperationsDashboardRebuild).toHaveBeenCalledOnce();
  });

  it("rejects scheduled rebuilds with invalid bearer secret", async () => {
    vi.stubEnv("OPERATIONS_DASHBOARD_REBUILD_SECRET", "secret-1");

    const response = await POST(request({ authorization: "Bearer wrong" }));
    const json = await response.json() as { success?: boolean; error?: string };

    expect(response.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.error).toContain("重建密钥无效");
    expect(rebuild.runOperationsDashboardRebuild).not.toHaveBeenCalled();
  });
});
