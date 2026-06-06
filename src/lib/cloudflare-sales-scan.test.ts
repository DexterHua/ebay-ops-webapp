import { describe, expect, it, vi } from "vitest";
import { invokeScheduledSalesInventoryScan } from "../../cloudflare-sales-scan.mjs";

const SECRET = "test-inventory-sales-scan-secret-32-chars";

function controller(cron = "0 1 * * *") {
  return { cron, scheduledTime: Date.now(), noRetry: vi.fn() };
}

function context() {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
}

describe("Cloudflare scheduled sales scan helper", () => {
  it.each([
    {},
    { INVENTORY_SALES_SCAN_SECRET: "short" },
  ])("密钥缺失或过短时不调用 OpenNext Worker", async (env) => {
    const openNextWorker = { fetch: vi.fn() };

    await expect(invokeScheduledSalesInventoryScan(
      openNextWorker,
      controller(),
      env,
      context(),
    )).rejects.toThrow("INVENTORY_SALES_SCAN_SECRET");
    expect(openNextWorker.fetch).not.toHaveBeenCalled();
  });

  it("通过 OpenNext fetch 发送只包含 limit 的内部请求", async () => {
    const env = { INVENTORY_SALES_SCAN_SECRET: SECRET };
    const ctx = context();
    const openNextWorker = {
      fetch: vi.fn(async () => Response.json({
        success: true,
        scanId: "SCAN-1",
        processed: 1,
        deducted: 1,
        skipped: 0,
        exceptions: 0,
        warnings: 1,
      })),
    };

    const result = await invokeScheduledSalesInventoryScan(
      openNextWorker,
      controller("0 9 * * *"),
      env,
      ctx,
    );

    expect(result).toMatchObject({ success: true, scanId: "SCAN-1" });
    expect(openNextWorker.fetch).toHaveBeenCalledTimes(1);
    const [request, calledEnv, calledCtx] = openNextWorker.fetch.mock.calls[0];
    expect(request).toBeInstanceOf(Request);
    expect(request.url).toBe("https://internal/api/inventory/sales-scan");
    expect(request.method).toBe("POST");
    expect(request.headers.get("Authorization")).toBe(`Bearer ${SECRET}`);
    expect(request.headers.get("X-Cloudflare-Cron")).toBe("0 9 * * *");
    await expect(request.json()).resolves.toEqual({ limit: 200 });
    expect(calledEnv).toBe(env);
    expect(calledCtx).toBe(ctx);
  });

  it("非 2xx 错误包含状态和截断摘要但不泄露密钥", async () => {
    const longError = `${SECRET}:${"x".repeat(400)}`;
    const openNextWorker = {
      fetch: vi.fn(async () => new Response(longError, { status: 503 })),
    };

    let error: unknown;
    try {
      await invokeScheduledSalesInventoryScan(
        openNextWorker,
        controller(),
        { INVENTORY_SALES_SCAN_SECRET: SECRET },
        context(),
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("503");
    expect((error as Error).message).not.toContain(SECRET);
    expect((error as Error).message.length).toBeLessThan(380);
  });

  it("无效 JSON 成功响应会报告可排查错误", async () => {
    const openNextWorker = {
      fetch: vi.fn(async () => new Response("not-json", { status: 200 })),
    };

    await expect(invokeScheduledSalesInventoryScan(
      openNextWorker,
      controller(),
      { INVENTORY_SALES_SCAN_SECRET: SECRET },
      context(),
    )).rejects.toThrow("响应不是有效 JSON");
  });
});
