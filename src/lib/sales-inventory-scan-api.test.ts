import { describe, expect, it } from "vitest";
import {
  createSalesScanId,
  parseSalesScanRequest,
  verifyScheduledScanAuthorization,
} from "@/lib/sales-inventory-scan-api";

const SECRET = "test-inventory-sales-scan-secret-32-chars";

describe("sales inventory scan api", () => {
  it("默认 limit 为 200", () => {
    expect(parseSalesScanRequest({})).toEqual({ limit: 200 });
  });

  it("接受 1 到 500 的整数 limit", () => {
    expect(parseSalesScanRequest({ limit: 1 })).toEqual({ limit: 1 });
    expect(parseSalesScanRequest({ limit: 500 })).toEqual({ limit: 500 });
  });

  it.each([0, -1, 1.5, 501, "200", null])("拒绝非法 limit: %p", (limit) => {
    expect(() => parseSalesScanRequest({ limit })).toThrow("limit 必须是 1 到 500 的整数");
  });

  it.each([
    null,
    [],
    "bad",
  ])("拒绝非对象请求体: %p", (body) => {
    expect(() => parseSalesScanRequest(body)).toThrow("请求体");
  });

  it("拒绝客户端提交 mode", () => {
    expect(() => parseSalesScanRequest({ mode: "scheduled", limit: 200 }))
      .toThrow("请求体不允许指定 mode");
  });

  it("接受精确 Bearer 密钥", () => {
    expect(() => verifyScheduledScanAuthorization(`Bearer ${SECRET}`, SECRET)).not.toThrow();
  });

  it.each([
    ["", SECRET],
    ["Basic anything", SECRET],
    [`Bearer ${SECRET}-extra`, SECRET],
    [`Bearer ${SECRET}`, undefined],
  ])("拒绝非法计划任务鉴权", (authorization, expectedSecret) => {
    expect(() => verifyScheduledScanAuthorization(authorization, expectedSecret))
      .toThrow("计划任务密钥");
  });

  it("按 Asia/Shanghai 生成稳定扫描 ID", () => {
    expect(createSalesScanId(
      Date.parse("2026-06-05T09:00:00+08:00"),
      "abcdef12-0000-0000-0000-000000000000",
    )).toBe("SCAN-20260605-0900-abcdef12");
  });
});
