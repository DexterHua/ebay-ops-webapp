import { describe, expect, it } from "vitest";
import {
  SKU_CHANGE_EDITABLE_FIELDS,
  buildSkuChangePatch,
  buildSkuChangeRequestFields,
  normalizeSkuChangeRequest,
} from "@/lib/sku-change-request";

describe("SKU change request domain", () => {
  it("builds a patch containing only changed editable fields", () => {
    const result = buildSkuChangePatch({
      original: {
        SKU: "SP-001",
        中文品名: "旧名称",
        OEM: "A",
        SKU状态: "待清点",
      },
      updates: {
        SKU: "SP-001",
        中文品名: "新名称",
        OEM: "A",
        SKU状态: "已上架",
      },
    });

    expect(result.patch).toEqual({ 中文品名: "新名称", SKU状态: "已上架" });
    expect(result.changedFields).toEqual(["中文品名", "SKU状态"]);
  });

  it("ignores immutable and unknown fields", () => {
    const result = buildSkuChangePatch({
      original: { SKU: "SP-001", 负责人: "张三", 中文品名: "方向游丝" },
      updates: {
        SKU: "SP-002",
        负责人: "李四",
        中文品名: "方向游丝",
        未知字段: "不应写入",
      },
    });

    expect(result.patch).toEqual({});
    expect(result.changedFields).toEqual([]);
    expect(SKU_CHANGE_EDITABLE_FIELDS).not.toContain("SKU");
    expect(SKU_CHANGE_EDITABLE_FIELDS).not.toContain("负责人");
  });

  it("serializes a pending request with original snapshot and patch", () => {
    const fields = buildSkuChangeRequestFields({
      sku: "SP-001",
      skuRecordId: "rec-sku-1",
      original: { SKU: "SP-001", 中文品名: "旧名称" },
      patch: { 中文品名: "新名称" },
      changedFields: ["中文品名"],
      submitter: "运营",
      submitterRole: "operator",
      submittedAt: 1782892800000,
    });

    expect(fields).toMatchObject({
      SKU: "SP-001",
      SKU记录ID: "rec-sku-1",
      修改字段: "中文品名",
      提交人: "运营",
      提交角色: "operator",
      提交时间: 1782892800000,
      审核状态: "待审核",
    });
    expect(JSON.parse(String(fields.原始数据JSON))).toEqual({ SKU: "SP-001", 中文品名: "旧名称" });
    expect(JSON.parse(String(fields.修改内容JSON))).toEqual({ 中文品名: "新名称" });
  });

  it("normalizes request records and parses JSON fields", () => {
    const normalized = normalizeSkuChangeRequest({
      recordId: "rec-request-1",
      fields: {
        SKU: "SP-001",
        SKU记录ID: "rec-sku-1",
        原始数据JSON: "{\"中文品名\":\"旧名称\"}",
        修改内容JSON: "{\"中文品名\":\"新名称\"}",
        修改字段: "中文品名",
        提交人: "运营",
        提交角色: "operator",
        提交时间: 1782892800000,
        审核状态: "待审核",
      },
    });

    expect(normalized).toMatchObject({
      recordId: "rec-request-1",
      sku: "SP-001",
      skuRecordId: "rec-sku-1",
      original: { 中文品名: "旧名称" },
      patch: { 中文品名: "新名称" },
      changedFields: ["中文品名"],
      submitter: "运营",
      submitterRole: "operator",
      status: "待审核",
    });
  });
});
