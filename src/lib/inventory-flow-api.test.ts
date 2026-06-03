import { describe, expect, it } from "vitest";
import { parsePurchaseBatchRequest, parseTransitionRequest, resolveInventoryFlowResource } from "@/lib/inventory-flow-api";

describe("inventory flow api", () => {
  it("解析库存流转数据资源", () => {
    expect(resolveInventoryFlowResource(null)).toEqual({ resource: "details", table: "inventoryDetail" });
    expect(resolveInventoryFlowResource("purchases")).toEqual({ resource: "purchases", table: "purchaseBatch" });
    expect(resolveInventoryFlowResource("shipments")).toEqual({ resource: "shipments", table: "shipmentBatch" });
    expect(resolveInventoryFlowResource("exceptions")).toEqual({ resource: "exceptions", table: "inventoryException" });
  });

  it("拒绝未知库存流转数据资源", () => {
    expect(() => resolveInventoryFlowResource("bad")).toThrow("未知库存流转资源");
  });

  it("解析采购批次保存请求", () => {
    const input = parsePurchaseBatchRequest({
      purchaseBatchNo: " PO-202606-001 ",
      supplier: " 供应商A ",
      orderedAt: "2026-06-03",
      items: [
        { sku: " sku-1 ", productName: "方向游丝", quantity: "10" },
      ],
    }, { name: "采购员" }, 1780400000000);

    expect(input).toMatchObject({
      purchaseBatchNo: "PO-202606-001",
      supplier: "供应商A",
      purchaser: "采购员",
      orderedAt: 1780416000000,
      now: 1780400000000,
      lines: [{ sku: "SKU-1", productName: "方向游丝", quantity: 10 }],
    });
    expect(input.transactionId).toMatch(/^PO-/);
  });

  it("拒绝重复 SKU", () => {
    expect(() => parsePurchaseBatchRequest({
      purchaseBatchNo: "PO-1",
      supplier: "供应商A",
      items: [
        { sku: "SKU-1", quantity: 1 },
        { sku: "sku-1", quantity: 2 },
      ],
    }, { name: "采购员" })).toThrow("重复");
  });

  it("拒绝非法数量", () => {
    expect(() => parsePurchaseBatchRequest({
      purchaseBatchNo: "PO-1",
      supplier: "供应商A",
      items: [{ sku: "SKU-1", quantity: 0 }],
    }, { name: "采购员" })).toThrow("数量必须为正整数");
  });

  it("解析状态推进请求", () => {
    const input = parseTransitionRequest({
      transactionId: "MOVE-1",
      nextState: "待包装",
      items: [{ detailId: "LOT-1", version: 1, quantity: 8 }],
    }, { name: "运营" }, 1780400000000);

    expect(input).toEqual({
      transactionId: "MOVE-1",
      operator: "运营",
      now: 1780400000000,
      items: [{ detailId: "LOT-1", expectedVersion: 1, quantity: 8, nextState: "待包装" }],
    });
  });

  it("拒绝重复推进明细", () => {
    expect(() => parseTransitionRequest({
      nextState: "待包装",
      items: [
        { detailId: "LOT-1", version: 1, quantity: 1 },
        { detailId: "LOT-1", version: 1, quantity: 1 },
      ],
    }, { name: "运营" })).toThrow("明细重复");
  });
});
