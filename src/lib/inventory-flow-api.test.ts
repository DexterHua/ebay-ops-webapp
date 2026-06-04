import { describe, expect, it } from "vitest";
import {
  parseExceptionResolutionRequest,
  parsePurchaseBatchRequest,
  parseShipmentBatchRequest,
  parseTransitionRequest,
  resolveInventoryFlowResource,
} from "@/lib/inventory-flow-api";

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
      orderedAt: "2026-06-03",
      items: [
        { sku: " sku-1 ", productName: "方向游丝", quantity: "10" },
      ],
    }, { name: "采购员" }, 1780400000000);

    expect(input).toMatchObject({
      purchaseBatchNo: "PO-202606-001",
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
      items: [
        { sku: "SKU-1", quantity: 1 },
        { sku: "sku-1", quantity: 2 },
      ],
    }, { name: "采购员" })).toThrow("重复");
  });

  it("拒绝非法数量", () => {
    expect(() => parsePurchaseBatchRequest({
      purchaseBatchNo: "PO-1",
      items: [{ sku: "SKU-1", quantity: 0 }],
    }, { name: "采购员" })).toThrow("数量必须为正整数");
  });

  it("解析状态推进请求", () => {
    const input = parseTransitionRequest({
      transactionId: "MOVE-1",
      nextState: "待包装",
      items: [{ detailId: "LOT-1", version: 1, quantity: 8, actualQuantity: 7, exceptionType: "清点差异" }],
    }, { name: "运营" }, 1780400000000);

    expect(input).toEqual({
      transactionId: "MOVE-1",
      operator: "运营",
      now: 1780400000000,
      items: [{
        detailId: "LOT-1",
        expectedVersion: 1,
        quantity: 8,
        actualQuantity: 7,
        nextState: "待包装",
        exceptionType: "清点差异",
      }],
    });
  });

  it("拒绝实收数量大于推进数量", () => {
    expect(() => parseTransitionRequest({
      nextState: "待包装",
      items: [{ detailId: "LOT-1", version: 1, quantity: 8, actualQuantity: 9 }],
    }, { name: "运营" })).toThrow("实收数量不能大于推进数量");
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

  it("解析物流批次请求（含绑定明细）", () => {
    const input = parseShipmentBatchRequest({
      shipmentBatchNo: " SHIP-001 ",
      carrier: " DHL ",
      trackingNo: " TRK-123 ",
      shippedAt: "2026-06-03",
      bindings: [
        { detailId: "LOT-1", version: 3, quantity: "10" },
        { detailId: "LOT-2", version: 5 },
      ],
      autoTransition: true,
    }, { name: "运营" }, 1780400000000);

    expect(input).toMatchObject({
      shipmentBatchNo: "SHIP-001",
      carrier: "DHL",
      trackingNo: "TRK-123",
      shippedAt: 1780416000000,
      operator: "运营",
      now: 1780400000000,
      autoTransition: true,
      bindings: [
        { detailId: "LOT-1", expectedVersion: 3, quantity: 10 },
        { detailId: "LOT-2", expectedVersion: 5 },
      ],
    });
    expect(input.transactionId).toMatch(/^SHIP-/);
  });

  it("解析物流批次请求（无绑定明细，仅创建批次）", () => {
    const input = parseShipmentBatchRequest({
      shipmentBatchNo: "SHIP-002",
      carrier: "UPS",
    }, { name: "采购员" }, 1780400000000);

    expect(input.bindings).toEqual([]);
    expect(input.autoTransition).toBe(false);
    expect(input.shipmentBatchNo).toBe("SHIP-002");
  });

  it("拒绝空物流批次号", () => {
    expect(() => parseShipmentBatchRequest({
      shipmentBatchNo: "  ",
      carrier: "承运商",
    }, { name: "运营" })).toThrow("物流批次号不能为空");
  });

  it("拒绝空承运商", () => {
    expect(() => parseShipmentBatchRequest({
      shipmentBatchNo: "SHIP-001",
      carrier: "",
    }, { name: "运营" })).toThrow("承运商不能为空");
  });

  it("拒绝绑定明细中重复的明细编号", () => {
    expect(() => parseShipmentBatchRequest({
      shipmentBatchNo: "SHIP-001",
      carrier: "承运商",
      bindings: [
        { detailId: "LOT-1", version: 1 },
        { detailId: "LOT-1", version: 1 },
      ],
    }, { name: "运营" })).toThrow("明细重复");
  });

  it("拒绝绑定明细中空明细编号", () => {
    expect(() => parseShipmentBatchRequest({
      shipmentBatchNo: "SHIP-001",
      carrier: "承运商",
      bindings: [{ detailId: "", version: 1 }],
    }, { name: "运营" })).toThrow("绑定明细编号不能为空");
  });

  it("autoTransition 字符串 true 也会识别", () => {
    const input = parseShipmentBatchRequest({
      shipmentBatchNo: "SHIP-001",
      carrier: "承运商",
      autoTransition: "true",
    }, { name: "运营" });
    expect(input.autoTransition).toBe(true);
  });

  it("解析异常补回请求", () => {
    const input = parseExceptionResolutionRequest({
      transactionId: "EX-1",
      exceptionId: "EX-MOVE-1-LOT-1",
      action: "补回库存",
      targetState: "国内集货仓待发",
      remark: "集货仓补回",
    }, { name: "管理员" }, 1780400000000);

    expect(input).toEqual({
      transactionId: "EX-1",
      exceptionId: "EX-MOVE-1-LOT-1",
      action: "补回库存",
      targetState: "国内集货仓待发",
      operator: "管理员",
      now: 1780400000000,
      remark: "集货仓补回",
    });
  });

  it("补回库存必须提供目标状态", () => {
    expect(() => parseExceptionResolutionRequest({
      exceptionId: "EX-1",
      action: "补回库存",
    }, { name: "管理员" })).toThrow("补回库存必须选择目标状态");
  });

  it("解析异常报损请求", () => {
    const input = parseExceptionResolutionRequest({
      exceptionId: "EX-1",
      action: "确认报损",
      remark: "短少报损",
    }, { name: "管理员" }, 1780400000000);

    expect(input.action).toBe("确认报损");
    expect(input.targetState).toBeUndefined();
    expect(input.transactionId).toMatch(/^EX-/);
  });
});
