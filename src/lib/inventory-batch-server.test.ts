import { describe, expect, it } from "vitest";
import {
  createAndBindShipment,
  createPurchaseReceipt,
  reconcileInventorySummaries,
  resolveInventoryException,
  transitionInventoryDetails,
  type InventoryBatchRepository,
  type InventoryExceptionRecord,
  type InventoryTransactionRecord,
  type PurchaseReceiptInput,
  type ShipmentBatchInput,
} from "@/lib/inventory-batch-server";
import type { InventoryDetail } from "@/lib/inventory-flow";

class MemoryInventoryRepo implements InventoryBatchRepository {
  transactions = new Map<string, InventoryTransactionRecord>();
  purchaseBatches = new Map<string, Record<string, unknown>>();
  shipmentBatches = new Map<string, Record<string, unknown>>();
  details = new Map<string, InventoryDetail>();
  exceptions = new Map<string, InventoryExceptionRecord>();
  stockFlows = new Map<string, Record<string, unknown>>();
  summaries = new Map<string, Record<string, unknown>>();
  failStockFlowIds = new Set<string>();
  dropStockFlowIds = new Set<string>();
  failSummarySkus = new Set<string>();
  failShipmentBatchWith = "";

  async getTransaction(transactionId: string) {
    return this.transactions.get(transactionId);
  }

  async saveTransaction(record: InventoryTransactionRecord) {
    this.transactions.set(record.transactionId, record);
  }

  async upsertPurchaseBatch(batchNo: string, fields: Record<string, unknown>) {
    this.purchaseBatches.set(batchNo, { ...(this.purchaseBatches.get(batchNo) || {}), ...fields });
  }

  async upsertShipmentBatch(batchNo: string, fields: Record<string, unknown>) {
    if (this.failShipmentBatchWith) throw new Error(this.failShipmentBatchWith);
    this.shipmentBatches.set(batchNo, { ...(this.shipmentBatches.get(batchNo) || {}), ...fields });
  }

  async upsertInventoryDetail(detail: InventoryDetail) {
    if (!detail.明细编号) throw new Error("测试明细缺少编号");
    this.details.set(detail.明细编号, { ...(this.details.get(detail.明细编号) || {}), ...detail });
  }

  async getInventoryDetails(detailIds: string[]) {
    return detailIds.map((id) => this.details.get(id)).filter((detail): detail is InventoryDetail => Boolean(detail));
  }

  async listInventoryDetails() {
    return [...this.details.values()];
  }

  async updateInventoryDetail(detailId: string, detail: InventoryDetail) {
    this.details.set(detailId, { ...(this.details.get(detailId) || {}), ...detail });
  }

  async upsertInventoryException(exception: InventoryExceptionRecord) {
    this.exceptions.set(exception.异常编号, { ...(this.exceptions.get(exception.异常编号) || {}), ...exception });
  }

  async getInventoryException(exceptionId: string) {
    return this.exceptions.get(exceptionId);
  }

  async updateInventoryException(exceptionId: string, fields: Partial<InventoryExceptionRecord>) {
    const existing = this.exceptions.get(exceptionId);
    if (!existing) throw new Error(`未找到异常 ${exceptionId}`);
    this.exceptions.set(exceptionId, { ...existing, ...fields });
  }

  async upsertStockFlow(flowId: string, fields: Record<string, unknown>) {
    if (this.failStockFlowIds.has(flowId)) throw new Error(`模拟流水写入失败：${flowId}`);
    if (this.dropStockFlowIds.has(flowId)) return;
    this.stockFlows.set(flowId, { ...(this.stockFlows.get(flowId) || {}), ...fields });
  }

  async listStockFlowsByTransaction(transactionId: string) {
    return [...this.stockFlows.values()].filter((flow) => flow.流转事务号 === transactionId);
  }

  async listInventoryDetailsBySku(skus: string[]) {
    const wanted = new Set(skus);
    return [...this.details.values()].filter((detail) => wanted.has(detail.SKU));
  }

  async listInventoryDetailsByState(state: string) {
    return [...this.details.values()].filter((detail) => detail.当前状态 === state);
  }

  async updateSkuSummary(sku: string, fields: Record<string, unknown>) {
    if (this.failSummarySkus.has(sku)) throw new Error(`模拟汇总写入失败：${sku}`);
    this.summaries.set(sku, { SKU: sku, ...fields });
  }
}

function purchaseInput(overrides: Partial<PurchaseReceiptInput> = {}): PurchaseReceiptInput {
  return {
    transactionId: "TX-PO-1",
    purchaseBatchNo: "PO-202606-001",
    purchaser: "采购员",
    orderedAt: 1780400000000,
    now: 1780400000001,
    lines: [
      { sku: "SKU-1", productName: "方向游丝", quantity: 10 },
      { sku: "SKU-2", productName: "门锁", quantity: 20 },
    ],
    ...overrides,
  };
}

describe("inventory batch server", () => {
  it("采购入库创建批次、明细、流水并从明细重算汇总", async () => {
    const repo = new MemoryInventoryRepo();

    const result = await createPurchaseReceipt(repo, purchaseInput());

    expect(result).toEqual({ transactionId: "TX-PO-1", replayed: false });
    expect(repo.purchaseBatches.get("PO-202606-001")).toMatchObject({ 采购批次号: "PO-202606-001", 采购员: "采购员" });
    expect(repo.details.get("LOT-PO-202606-001-SKU-1-1")).toMatchObject({
      SKU: "SKU-1",
      原始数量: 10,
      当前数量: 10,
      当前状态: "本地仓待清点",
    });
    expect(repo.stockFlows.get("TX-PO-1-LOT-PO-202606-001-SKU-1-1-IN")).toMatchObject({
      SKU: "SKU-1",
      库存位置: "本地仓",
      数量变动: 10,
      操作类型: "新增入库",
    });
    expect(repo.summaries.get("SKU-1")).toMatchObject({ 本地库存: 10, 总可用库存: 10, 账面总量: 10 });
    expect(repo.summaries.get("SKU-2")).toMatchObject({ 本地库存: 20, 总可用库存: 20, 账面总量: 20 });
    expect(repo.transactions.get("TX-PO-1")).toMatchObject({ status: "completed" });
  });

  it("相同事务重试直接返回 replayed，不重复写流水", async () => {
    const repo = new MemoryInventoryRepo();
    await createPurchaseReceipt(repo, purchaseInput());

    const result = await createPurchaseReceipt(repo, purchaseInput());

    expect(result.replayed).toBe(true);
    expect(repo.stockFlows).toHaveLength(2);
  });

  it("相同事务但请求内容不同会拒绝，避免事务号复用污染账本", async () => {
    const repo = new MemoryInventoryRepo();
    await createPurchaseReceipt(repo, purchaseInput());

    await expect(createPurchaseReceipt(repo, purchaseInput({ purchaseBatchNo: "PO-202606-002" }))).rejects.toThrow("事务号已被不同请求使用");
  });

  it("事务部分成功后重试会补齐缺失明细和流水", async () => {
    const repo = new MemoryInventoryRepo();
    repo.failStockFlowIds.add("TX-PO-1-LOT-PO-202606-001-SKU-2-2-IN");

    await expect(createPurchaseReceipt(repo, purchaseInput())).rejects.toThrow("模拟流水写入失败");
    expect(repo.transactions.get("TX-PO-1")).toMatchObject({ status: "pending" });
    expect(repo.purchaseBatches.get("PO-202606-001")).toMatchObject({ 采购批次号: "PO-202606-001" });

    repo.failStockFlowIds.clear();
    await createPurchaseReceipt(repo, purchaseInput());

    expect(repo.details).toHaveLength(2);
    expect(repo.stockFlows).toHaveLength(2);
    expect(repo.transactions.get("TX-PO-1")).toMatchObject({ status: "completed" });
  });

  it("pending 事务不同请求重试会拒绝，不能接管同一事务号", async () => {
    const repo = new MemoryInventoryRepo();
    repo.failStockFlowIds.add("TX-PO-1-LOT-PO-202606-001-SKU-2-2-IN");

    await expect(createPurchaseReceipt(repo, purchaseInput())).rejects.toThrow("模拟流水写入失败");

    await expect(createPurchaseReceipt(repo, purchaseInput({ purchaseBatchNo: "PO-202606-002" }))).rejects.toThrow("事务号已被不同请求使用");
  });

  it("部分数量推进会拆分明细、写跨仓成对流水并重算汇总", async () => {
    const repo = new MemoryInventoryRepo();
    await createPurchaseReceipt(repo, purchaseInput({ lines: [{ sku: "SKU-1", productName: "方向游丝", quantity: 100 }] }));

    await transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-1",
      operator: "运营",
      now: 1780400001000,
      items: [
        { detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 80, expectedVersion: 1, nextState: "待包装" },
      ],
    });
    await transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-2",
      operator: "运营",
      now: 1780400002000,
      items: [
        { detailId: "LOT-PO-202606-001-SKU-1-1-MOVE-TX-MOVE-1", quantity: 80, expectedVersion: 2, nextState: "已发往国内集货仓" },
      ],
    });

    expect(repo.details.get("LOT-PO-202606-001-SKU-1-1")).toMatchObject({ 当前数量: 20, 当前状态: "本地仓待清点" });
    expect(repo.details.get("LOT-PO-202606-001-SKU-1-1-MOVE-TX-MOVE-1")).toMatchObject({
      当前数量: 80,
      当前状态: "已发往国内集货仓",
    });
    expect(repo.stockFlows.get("TX-MOVE-2-LOT-PO-202606-001-SKU-1-1-MOVE-TX-MOVE-1-1")).toMatchObject({
      库存位置: "本地仓",
      数量变动: -80,
    });
    expect(repo.stockFlows.get("TX-MOVE-2-LOT-PO-202606-001-SKU-1-1-MOVE-TX-MOVE-1-2")).toMatchObject({
      库存位置: "国内集货仓",
      数量变动: 80,
    });
    expect(repo.summaries.get("SKU-1")).toMatchObject({ 本地库存: 20, 国内集货仓: 80, 总可用库存: 100 });
  });

  it("版本不匹配时拒绝推进", async () => {
    const repo = new MemoryInventoryRepo();
    await createPurchaseReceipt(repo, purchaseInput({ lines: [{ sku: "SKU-1", quantity: 10 }] }));

    await expect(transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-1",
      operator: "运营",
      now: 1780400001000,
      items: [{ detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 10, expectedVersion: 99, nextState: "待包装" }],
    })).rejects.toThrow("版本不匹配");
  });

  it("进入橙联在途前必须绑定物流批次", async () => {
    const repo = new MemoryInventoryRepo();
    await createPurchaseReceipt(repo, purchaseInput({ lines: [{ sku: "SKU-1", quantity: 10 }] }));
    await transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-1",
      operator: "运营",
      now: 1780400001000,
      items: [{ detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 10, expectedVersion: 1, nextState: "待包装" }],
    });
    await transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-2",
      operator: "运营",
      now: 1780400002000,
      items: [{ detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 10, expectedVersion: 2, nextState: "已发往国内集货仓" }],
    });
    await transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-3",
      operator: "运营",
      now: 1780400003000,
      items: [{ detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 10, expectedVersion: 3, nextState: "国内集货仓待发" }],
    });

    await expect(transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-4",
      operator: "运营",
      now: 1780400004000,
      items: [{ detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 10, expectedVersion: 4, nextState: "橙联在途" }],
    })).rejects.toThrow("进入橙联在途前必须绑定物流批次");
  });

  describe("createAndBindShipment", () => {
    async function advanceToDomesticReady(repo: MemoryInventoryRepo, detailId: string) {
      const d1 = repo.details.get(detailId);
      if (!d1) throw new Error("明细不存在");
      const qty = d1.当前数量;
      const ver = d1.版本号 ?? 0;
      await transitionInventoryDetails(repo, {
        transactionId: `TX-MOVE-${detailId}-1`,
        operator: "运营",
        now: 1780400001000,
        items: [{ detailId, quantity: qty, expectedVersion: ver, nextState: "待包装" }],
      });
      const d1After = repo.details.get(detailId);
      await transitionInventoryDetails(repo, {
        transactionId: `TX-MOVE-${detailId}-2`,
        operator: "运营",
        now: 1780400002000,
        items: [{ detailId, quantity: qty, expectedVersion: d1After?.版本号 ?? ver + 1, nextState: "已发往国内集货仓" }],
      });
      const d2After = repo.details.get(detailId);
      await transitionInventoryDetails(repo, {
        transactionId: `TX-MOVE-${detailId}-3`,
        operator: "运营",
        now: 1780400003000,
        items: [{ detailId, quantity: qty, expectedVersion: d2After?.版本号 ?? ver + 2, nextState: "国内集货仓待发" }],
      });
    }

    it("创建物流批次并绑定明细，可推进至橙联在途", async () => {
      const repo = new MemoryInventoryRepo();
      await createPurchaseReceipt(repo, purchaseInput({
        transactionId: "TX-PO-1",
        lines: [{ sku: "SKU-1", productName: "门锁", quantity: 10 }],
      }));
      await advanceToDomesticReady(repo, "LOT-PO-202606-001-SKU-1-1");

      const result = await createAndBindShipment(repo, {
        transactionId: "TX-SHIP-1",
        shipmentBatchNo: "SHIP-001",
        carrier: "DHL",
        trackingNo: "TRK-123",
        shippedAt: 1780500000000,
        operator: "运营",
        now: 1780500001000,
        bindings: [
          { detailId: "LOT-PO-202606-001-SKU-1-1", expectedVersion: 4 },
        ],
        autoTransition: true,
      });

      expect(result.replayed).toBe(false);
      expect(repo.shipmentBatches.get("SHIP-001")).toMatchObject({
        物流批次号: "SHIP-001",
        承运商: "DHL",
      });

      const updatedDetail = repo.details.get("LOT-PO-202606-001-SKU-1-1");
      expect(updatedDetail?.当前物流批次).toBe("SHIP-001");
      expect(updatedDetail?.当前状态).toBe("橙联在途");

      expect(repo.stockFlows.get("TX-SHIP-1-LOT-PO-202606-001-SKU-1-1-BIND")).toMatchObject({
        操作类型: "物流绑定",
        物流批次号: "SHIP-001",
      });

      expect(repo.summaries.get("SKU-1")).toMatchObject({
        橙联在途: 10,
        本地库存: 0,
      });
    });

    it("物流批次登记表无写权限时仍可绑定并推进至橙联在途", async () => {
      const repo = new MemoryInventoryRepo();
      repo.failShipmentBatchWith = "飞书 API 调用失败（1254302）：RolePermNotAllow";
      await createPurchaseReceipt(repo, purchaseInput({
        transactionId: "TX-PO-1",
        lines: [{ sku: "SKU-1", productName: "门锁", quantity: 10 }],
      }));
      await advanceToDomesticReady(repo, "LOT-PO-202606-001-SKU-1-1");

      await createAndBindShipment(repo, {
        transactionId: "TX-SHIP-PERM-1",
        shipmentBatchNo: "SHIP-PERM-001",
        carrier: "DHL",
        trackingNo: "TRK-123",
        shippedAt: 1780500000000,
        operator: "运营",
        now: 1780500001000,
        bindings: [
          { detailId: "LOT-PO-202606-001-SKU-1-1", expectedVersion: 4 },
        ],
        autoTransition: true,
      });

      expect(repo.shipmentBatches.has("SHIP-PERM-001")).toBe(false);
      const updatedDetail = repo.details.get("LOT-PO-202606-001-SKU-1-1");
      expect(updatedDetail?.当前物流批次).toBe("SHIP-PERM-001");
      expect(updatedDetail?.当前状态).toBe("橙联在途");
      expect(repo.stockFlows.get("TX-SHIP-PERM-1-LOT-PO-202606-001-SKU-1-1-BIND")).toMatchObject({
        操作类型: "物流绑定",
        物流批次号: "SHIP-PERM-001",
      });
      expect(repo.summaries.get("SKU-1")).toMatchObject({
        国内集货仓: 0,
        橙联在途: 10,
      });
    });

    it("仅绑定不自动推进，明细保持在 国内集货仓待发", async () => {
      const repo = new MemoryInventoryRepo();
      await createPurchaseReceipt(repo, purchaseInput({
        transactionId: "TX-PO-1",
        lines: [{ sku: "SKU-1", quantity: 10 }],
      }));
      await advanceToDomesticReady(repo, "LOT-PO-202606-001-SKU-1-1");

      await createAndBindShipment(repo, {
        transactionId: "TX-SHIP-2",
        shipmentBatchNo: "SHIP-002",
        carrier: "UPS",
        trackingNo: "",
        shippedAt: 1780500000000,
        operator: "运营",
        now: 1780500001000,
        bindings: [
          { detailId: "LOT-PO-202606-001-SKU-1-1", expectedVersion: 4 },
        ],
        autoTransition: false,
      });

      const detail = repo.details.get("LOT-PO-202606-001-SKU-1-1");
      expect(detail?.当前物流批次).toBe("SHIP-002");
      expect(detail?.当前状态).toBe("国内集货仓待发");

      expect(repo.summaries.get("SKU-1")).toMatchObject({
        国内集货仓: 10,
        橙联在途: 0,
      });
    });

    it("拒绝非国内集货仓待发状态的明细绑定", async () => {
      const repo = new MemoryInventoryRepo();
      await createPurchaseReceipt(repo, purchaseInput({
        transactionId: "TX-PO-1",
        lines: [{ sku: "SKU-1", quantity: 10 }],
      }));

      await expect(createAndBindShipment(repo, {
        transactionId: "TX-SHIP-3",
        shipmentBatchNo: "SHIP-003",
        carrier: "承运商",
        trackingNo: "",
        shippedAt: 1780500000000,
        operator: "运营",
        now: 1780500001000,
        bindings: [
          { detailId: "LOT-PO-202606-001-SKU-1-1", expectedVersion: 1 },
        ],
        autoTransition: false,
      })).rejects.toThrow("不是国内集货仓待发");
    });

    it("拒绝版本不匹配的绑定", async () => {
      const repo = new MemoryInventoryRepo();
      await createPurchaseReceipt(repo, purchaseInput({
        transactionId: "TX-PO-1",
        lines: [{ sku: "SKU-1", quantity: 10 }],
      }));
      await advanceToDomesticReady(repo, "LOT-PO-202606-001-SKU-1-1");

      await expect(createAndBindShipment(repo, {
        transactionId: "TX-SHIP-4",
        shipmentBatchNo: "SHIP-004",
        carrier: "承运商",
        trackingNo: "",
        shippedAt: 1780500000000,
        operator: "运营",
        now: 1780500001000,
        bindings: [
          { detailId: "LOT-PO-202606-001-SKU-1-1", expectedVersion: 99 },
        ],
        autoTransition: false,
      })).rejects.toThrow("版本不匹配");
    });

    it("部分数量绑定拆分明细", async () => {
      const repo = new MemoryInventoryRepo();
      await createPurchaseReceipt(repo, purchaseInput({
        transactionId: "TX-PO-1",
        lines: [{ sku: "SKU-1", productName: "门锁", quantity: 100 }],
      }));
      await advanceToDomesticReady(repo, "LOT-PO-202606-001-SKU-1-1");

      await createAndBindShipment(repo, {
        transactionId: "TX-SHIP-5",
        shipmentBatchNo: "SHIP-005",
        carrier: "承运商",
        trackingNo: "",
        shippedAt: 1780500000000,
        operator: "运营",
        now: 1780500001000,
        bindings: [
          { detailId: "LOT-PO-202606-001-SKU-1-1", expectedVersion: 4, quantity: 30 },
        ],
        autoTransition: false,
      });

      const original = repo.details.get("LOT-PO-202606-001-SKU-1-1");
      expect(original?.当前数量).toBe(70);
      expect(original?.当前状态).toBe("国内集货仓待发");
      expect(original?.当前物流批次).toBeFalsy();

      const moved = [...repo.details.values()].find((d) => d.明细编号?.includes("BIND-TX-SHIP-5"));
      expect(moved).toBeTruthy();
      expect(moved?.当前物流批次).toBe("SHIP-005");
      expect(moved?.当前状态).toBe("国内集货仓待发");
      expect(moved?.当前数量).toBe(30);

      expect(repo.summaries.get("SKU-1")).toMatchObject({
        国内集货仓: 100,
        橙联在途: 0,
      });
    });

    it("绑定后通过 transition 推进至橙联在途成功", async () => {
      const repo = new MemoryInventoryRepo();
      await createPurchaseReceipt(repo, purchaseInput({
        transactionId: "TX-PO-1",
        lines: [{ sku: "SKU-1", quantity: 10 }],
      }));
      await advanceToDomesticReady(repo, "LOT-PO-202606-001-SKU-1-1");

      await createAndBindShipment(repo, {
        transactionId: "TX-SHIP-6",
        shipmentBatchNo: "SHIP-006",
        carrier: "承运商",
        trackingNo: "",
        shippedAt: 1780500000000,
        operator: "运营",
        now: 1780500001000,
        bindings: [
          { detailId: "LOT-PO-202606-001-SKU-1-1", expectedVersion: 4 },
        ],
        autoTransition: false,
      });

      await transitionInventoryDetails(repo, {
        transactionId: "TX-MOVE-橙联",
        operator: "运营",
        now: 1780500002000,
        items: [
          { detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 10, expectedVersion: 5, nextState: "橙联在途" },
        ],
      });

      const detail = repo.details.get("LOT-PO-202606-001-SKU-1-1");
      expect(detail?.当前状态).toBe("橙联在途");
      expect(repo.summaries.get("SKU-1")).toMatchObject({
        橙联在途: 10,
        国内集货仓: 0,
      });
    });

    it("相同事务重试直接返回 replayed", async () => {
      const repo = new MemoryInventoryRepo();
      await createPurchaseReceipt(repo, purchaseInput({
        transactionId: "TX-PO-1",
        lines: [{ sku: "SKU-1", quantity: 10 }],
      }));
      await advanceToDomesticReady(repo, "LOT-PO-202606-001-SKU-1-1");

      const input: ShipmentBatchInput = {
        transactionId: "TX-SHIP-7",
        shipmentBatchNo: "SHIP-007",
        carrier: "承运商",
        trackingNo: "",
        shippedAt: 1780500000000,
        operator: "运营",
        now: 1780500001000,
        bindings: [
          { detailId: "LOT-PO-202606-001-SKU-1-1", expectedVersion: 4 },
        ],
        autoTransition: false,
      };

      await createAndBindShipment(repo, input);
      const result = await createAndBindShipment(repo, input);

      expect(result.replayed).toBe(true);
      expect(repo.stockFlows.size).toBeGreaterThan(0);
    });
  });

  it("状态推进在明细已更新但流水失败后，可用相同事务补齐缺失流水和汇总", async () => {
    const repo = new MemoryInventoryRepo();
    await createPurchaseReceipt(repo, purchaseInput({ lines: [{ sku: "SKU-1", quantity: 100 }] }));
    await transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-1",
      operator: "运营",
      now: 1780400001000,
      items: [{ detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 80, expectedVersion: 1, nextState: "待包装" }],
    });

    repo.failStockFlowIds.add("TX-MOVE-2-LOT-PO-202606-001-SKU-1-1-MOVE-TX-MOVE-1-1");
    await expect(transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-2",
      operator: "运营",
      now: 1780400002000,
      items: [
        { detailId: "LOT-PO-202606-001-SKU-1-1-MOVE-TX-MOVE-1", quantity: 80, expectedVersion: 2, nextState: "已发往国内集货仓" },
      ],
    })).rejects.toThrow("模拟流水写入失败");
    expect(repo.details.get("LOT-PO-202606-001-SKU-1-1-MOVE-TX-MOVE-1")).toMatchObject({
      当前状态: "已发往国内集货仓",
      版本号: 3,
      最近流转事务号: "TX-MOVE-2",
    });

    repo.failStockFlowIds.clear();
    await transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-2",
      operator: "运营",
      now: 1780400002000,
      items: [
        { detailId: "LOT-PO-202606-001-SKU-1-1-MOVE-TX-MOVE-1", quantity: 80, expectedVersion: 2, nextState: "已发往国内集货仓" },
      ],
    });

    expect(repo.stockFlows.get("TX-MOVE-2-LOT-PO-202606-001-SKU-1-1-MOVE-TX-MOVE-1-1")).toMatchObject({
      库存位置: "本地仓",
      数量变动: -80,
    });
    expect(repo.stockFlows.get("TX-MOVE-2-LOT-PO-202606-001-SKU-1-1-MOVE-TX-MOVE-1-2")).toMatchObject({
      库存位置: "国内集货仓",
      数量变动: 80,
    });
    expect(repo.summaries.get("SKU-1")).toMatchObject({ 本地库存: 20, 国内集货仓: 80, 总可用库存: 100 });
    expect(repo.transactions.get("TX-MOVE-2")).toMatchObject({ status: "completed" });
  });

  it("状态推进完成前会校验流水完整性，缺失流水时事务保持 pending 并记录失败原因", async () => {
    const repo = new MemoryInventoryRepo();
    await createPurchaseReceipt(repo, purchaseInput({ lines: [{ sku: "SKU-1", quantity: 100 }] }));
    await transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-1",
      operator: "运营",
      now: 1780400001000,
      items: [{ detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 100, expectedVersion: 1, nextState: "待包装" }],
    });

    repo.dropStockFlowIds.add("TX-MOVE-2-LOT-PO-202606-001-SKU-1-1-1");

    await expect(transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-2",
      operator: "运营",
      now: 1780400002000,
      items: [
        { detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 100, expectedVersion: 2, nextState: "已发往国内集货仓" },
      ],
    })).rejects.toThrow("库存流水缺失");

    expect(repo.transactions.get("TX-MOVE-2")).toMatchObject({
      status: "pending",
      failureReason: expect.stringContaining("库存流水缺失"),
      operationType: "状态推进",
      operator: "运营",
    });
    expect(repo.transactions.get("TX-MOVE-2")?.recoveryContext).toContain("LOT-PO-202606-001-SKU-1-1");
  });

  it("汇总重算失败时事务保持 pending 并记录可重试上下文", async () => {
    const repo = new MemoryInventoryRepo();
    await createPurchaseReceipt(repo, purchaseInput({ lines: [{ sku: "SKU-1", quantity: 100 }] }));
    repo.failSummarySkus.add("SKU-1");

    await expect(transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-SUMMARY-FAIL",
      operator: "运营",
      now: 1780400001000,
      items: [
        { detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 100, expectedVersion: 1, nextState: "待包装" },
      ],
    })).rejects.toThrow("模拟汇总写入失败");

    expect(repo.transactions.get("TX-MOVE-SUMMARY-FAIL")).toMatchObject({
      status: "pending",
      failureReason: expect.stringContaining("模拟汇总写入失败"),
      operationType: "状态推进",
      operator: "运营",
    });
    expect(repo.transactions.get("TX-MOVE-SUMMARY-FAIL")?.recoveryContext).toContain("SKU-1");
  });

  it("可从库存明细重算 SKU 汇总，清除已经不存在的橙联在途数量", async () => {
    const repo = new MemoryInventoryRepo();
    await createPurchaseReceipt(repo, purchaseInput({ lines: [{ sku: "SKU-1", quantity: 100 }] }));
    repo.summaries.set("SKU-1", {
      SKU: "SKU-1",
      本地库存: 0,
      国内集货仓: 0,
      橙联在途: 206,
      橙联可售: 0,
      异常暂存: 0,
      总可用库存: 206,
      账面总量: 206,
    });

    const result = await reconcileInventorySummaries(repo, { skus: ["sku-1"] });

    expect(result).toEqual({ skus: ["SKU-1"], updated: 1 });
    expect(repo.summaries.get("SKU-1")).toMatchObject({
      本地库存: 100,
      橙联在途: 0,
      总可用库存: 100,
      账面总量: 100,
    });
  });

  it("实收少于预期时创建库存异常并转入异常暂存", async () => {
    const repo = new MemoryInventoryRepo();
    await createPurchaseReceipt(repo, purchaseInput({ lines: [{ sku: "SKU-1", productName: "方向游丝", quantity: 100 }] }));
    await transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-1",
      operator: "运营",
      now: 1780400001000,
      items: [{ detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 100, expectedVersion: 1, nextState: "待包装" }],
    });

    await transitionInventoryDetails(repo, {
      transactionId: "TX-DIFF-1",
      operator: "运营",
      now: 1780400002000,
      items: [{
        detailId: "LOT-PO-202606-001-SKU-1-1",
        quantity: 100,
        actualQuantity: 97,
        expectedVersion: 2,
        nextState: "已发往国内集货仓",
        exceptionType: "清点差异",
      }],
    });

    const source = repo.details.get("LOT-PO-202606-001-SKU-1-1");
    const moved = repo.details.get("LOT-PO-202606-001-SKU-1-1-MOVE-TX-DIFF-1");
    const exception = repo.exceptions.get("EX-TX-DIFF-1-LOT-PO-202606-001-SKU-1-1");

    expect(source).toMatchObject({ 当前数量: 0, 异常数量: 3, 当前状态: "待包装" });
    expect(moved).toMatchObject({ 当前数量: 97, 当前状态: "已发往国内集货仓" });
    expect(exception).toMatchObject({
      SKU: "SKU-1",
      来源明细编号: "LOT-PO-202606-001-SKU-1-1",
      异常类型: "清点差异",
      预期数量: 100,
      实收数量: 97,
      差异数量: -3,
      处理状态: "待处理",
    });
    expect(repo.stockFlows.get("TX-DIFF-1-LOT-PO-202606-001-SKU-1-1-ABNORMAL-OUT")).toMatchObject({
      库存位置: "本地仓",
      数量变动: -3,
      操作类型: "差异暂存",
    });
    expect(repo.stockFlows.get("TX-DIFF-1-LOT-PO-202606-001-SKU-1-1-ABNORMAL-IN")).toMatchObject({
      库存位置: "异常暂存",
      数量变动: 3,
      操作类型: "差异暂存",
    });
    expect(repo.summaries.get("SKU-1")).toMatchObject({
      国内集货仓: 97,
      异常暂存: 3,
      总可用库存: 97,
      账面总量: 100,
    });
  });

  it("差异推进在明细已更新但异常流水失败后，可用相同事务补齐", async () => {
    const repo = new MemoryInventoryRepo();
    await createPurchaseReceipt(repo, purchaseInput({ lines: [{ sku: "SKU-1", quantity: 100 }] }));
    await transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-1",
      operator: "运营",
      now: 1780400001000,
      items: [{ detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 100, expectedVersion: 1, nextState: "待包装" }],
    });

    repo.failStockFlowIds.add("TX-DIFF-RETRY-LOT-PO-202606-001-SKU-1-1-ABNORMAL-OUT");
    const input = {
      transactionId: "TX-DIFF-RETRY",
      operator: "运营",
      now: 1780400002000,
      items: [{
        detailId: "LOT-PO-202606-001-SKU-1-1",
        quantity: 100,
        actualQuantity: 97,
        expectedVersion: 2,
        nextState: "已发往国内集货仓" as const,
      }],
    };

    await expect(transitionInventoryDetails(repo, input)).rejects.toThrow("模拟流水写入失败");
    expect(repo.details.get("LOT-PO-202606-001-SKU-1-1")).toMatchObject({
      当前数量: 0,
      异常数量: 3,
      最近流转事务号: "TX-DIFF-RETRY",
    });

    repo.failStockFlowIds.clear();
    await transitionInventoryDetails(repo, input);

    expect(repo.exceptions.get("EX-TX-DIFF-RETRY-LOT-PO-202606-001-SKU-1-1")).toMatchObject({ 差异数量: -3 });
    expect(repo.stockFlows.get("TX-DIFF-RETRY-LOT-PO-202606-001-SKU-1-1-ABNORMAL-OUT")).toMatchObject({
      数量变动: -3,
    });
    expect(repo.summaries.get("SKU-1")).toMatchObject({
      国内集货仓: 97,
      异常暂存: 3,
      账面总量: 100,
    });
    expect(repo.transactions.get("TX-DIFF-RETRY")).toMatchObject({ status: "completed" });
  });

  it("异常补回库存时减少异常暂存并增加目标状态库存", async () => {
    const repo = new MemoryInventoryRepo();
    await createPurchaseReceipt(repo, purchaseInput({ lines: [{ sku: "SKU-1", quantity: 100 }] }));
    await transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-1",
      operator: "运营",
      now: 1780400001000,
      items: [{ detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 100, expectedVersion: 1, nextState: "待包装" }],
    });
    await transitionInventoryDetails(repo, {
      transactionId: "TX-DIFF-1",
      operator: "运营",
      now: 1780400002000,
      items: [{ detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 100, actualQuantity: 97, expectedVersion: 2, nextState: "已发往国内集货仓" }],
    });

    await resolveInventoryException(repo, {
      transactionId: "TX-EX-RETURN",
      exceptionId: "EX-TX-DIFF-1-LOT-PO-202606-001-SKU-1-1",
      action: "补回库存",
      targetState: "已发往国内集货仓",
      operator: "管理员",
      now: 1780400003000,
      remark: "集货仓补签收",
    });

    expect(repo.exceptions.get("EX-TX-DIFF-1-LOT-PO-202606-001-SKU-1-1")).toMatchObject({
      处理状态: "已补回",
      关闭时间: 1780400003000,
    });
    expect(repo.details.get("LOT-PO-202606-001-SKU-1-1")).toMatchObject({
      当前数量: 3,
      异常数量: 0,
      当前状态: "已发往国内集货仓",
    });
    expect(repo.stockFlows.get("TX-EX-RETURN-EX-TX-DIFF-1-LOT-PO-202606-001-SKU-1-1-ABNORMAL-OUT")).toMatchObject({
      库存位置: "异常暂存",
      数量变动: -3,
      操作类型: "异常释放",
    });
    expect(repo.stockFlows.get("TX-EX-RETURN-EX-TX-DIFF-1-LOT-PO-202606-001-SKU-1-1-RETURN-IN")).toMatchObject({
      库存位置: "国内集货仓",
      数量变动: 3,
      操作类型: "异常释放",
    });
    expect(repo.summaries.get("SKU-1")).toMatchObject({
      国内集货仓: 100,
      异常暂存: 0,
      账面总量: 100,
    });
  });

  it("异常确认报损时减少异常暂存且不增加可用库存", async () => {
    const repo = new MemoryInventoryRepo();
    await createPurchaseReceipt(repo, purchaseInput({ lines: [{ sku: "SKU-1", quantity: 100 }] }));
    await transitionInventoryDetails(repo, {
      transactionId: "TX-MOVE-1",
      operator: "运营",
      now: 1780400001000,
      items: [{ detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 100, expectedVersion: 1, nextState: "待包装" }],
    });
    await transitionInventoryDetails(repo, {
      transactionId: "TX-DIFF-1",
      operator: "运营",
      now: 1780400002000,
      items: [{ detailId: "LOT-PO-202606-001-SKU-1-1", quantity: 100, actualQuantity: 97, expectedVersion: 2, nextState: "已发往国内集货仓" }],
    });

    await resolveInventoryException(repo, {
      transactionId: "TX-EX-LOSS",
      exceptionId: "EX-TX-DIFF-1-LOT-PO-202606-001-SKU-1-1",
      action: "确认报损",
      operator: "管理员",
      now: 1780400003000,
      remark: "确认短少",
    });

    expect(repo.exceptions.get("EX-TX-DIFF-1-LOT-PO-202606-001-SKU-1-1")).toMatchObject({ 处理状态: "已报损" });
    expect(repo.details.get("LOT-PO-202606-001-SKU-1-1")).toMatchObject({ 当前数量: 0, 异常数量: 0 });
    expect(repo.stockFlows.get("TX-EX-LOSS-EX-TX-DIFF-1-LOT-PO-202606-001-SKU-1-1-LOSS")).toMatchObject({
      库存位置: "异常暂存",
      数量变动: -3,
      操作类型: "报损",
    });
    expect(repo.summaries.get("SKU-1")).toMatchObject({
      国内集货仓: 97,
      异常暂存: 0,
      账面总量: 97,
    });
  });
});
