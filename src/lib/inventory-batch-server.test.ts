import { describe, expect, it } from "vitest";
import {
  createPurchaseReceipt,
  transitionInventoryDetails,
  type InventoryBatchRepository,
  type InventoryTransactionRecord,
  type PurchaseReceiptInput,
} from "@/lib/inventory-batch-server";
import type { InventoryDetail } from "@/lib/inventory-flow";

class MemoryInventoryRepo implements InventoryBatchRepository {
  transactions = new Map<string, InventoryTransactionRecord>();
  purchaseBatches = new Map<string, Record<string, unknown>>();
  details = new Map<string, InventoryDetail>();
  stockFlows = new Map<string, Record<string, unknown>>();
  summaries = new Map<string, Record<string, unknown>>();
  failStockFlowIds = new Set<string>();

  async getTransaction(transactionId: string) {
    return this.transactions.get(transactionId);
  }

  async saveTransaction(record: InventoryTransactionRecord) {
    this.transactions.set(record.transactionId, record);
  }

  async upsertPurchaseBatch(batchNo: string, fields: Record<string, unknown>) {
    this.purchaseBatches.set(batchNo, { ...(this.purchaseBatches.get(batchNo) || {}), ...fields });
  }

  async upsertInventoryDetail(detail: InventoryDetail) {
    if (!detail.明细编号) throw new Error("测试明细缺少编号");
    this.details.set(detail.明细编号, { ...(this.details.get(detail.明细编号) || {}), ...detail });
  }

  async getInventoryDetails(detailIds: string[]) {
    return detailIds.map((id) => this.details.get(id)).filter((detail): detail is InventoryDetail => Boolean(detail));
  }

  async updateInventoryDetail(detailId: string, detail: InventoryDetail) {
    this.details.set(detailId, { ...(this.details.get(detailId) || {}), ...detail });
  }

  async upsertStockFlow(flowId: string, fields: Record<string, unknown>) {
    if (this.failStockFlowIds.has(flowId)) throw new Error(`模拟流水写入失败：${flowId}`);
    this.stockFlows.set(flowId, { ...(this.stockFlows.get(flowId) || {}), ...fields });
  }

  async listInventoryDetailsBySku(skus: string[]) {
    const wanted = new Set(skus);
    return [...this.details.values()].filter((detail) => wanted.has(detail.SKU));
  }

  async updateSkuSummary(sku: string, fields: Record<string, unknown>) {
    this.summaries.set(sku, { SKU: sku, ...fields });
  }
}

function purchaseInput(overrides: Partial<PurchaseReceiptInput> = {}): PurchaseReceiptInput {
  return {
    transactionId: "TX-PO-1",
    purchaseBatchNo: "PO-202606-001",
    supplier: "供应商A",
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
    expect(repo.purchaseBatches.get("PO-202606-001")).toMatchObject({ 采购批次号: "PO-202606-001", 供应商: "供应商A" });
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

    await expect(createPurchaseReceipt(repo, purchaseInput({ supplier: "供应商B" }))).rejects.toThrow("事务号已被不同请求使用");
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

    await expect(createPurchaseReceipt(repo, purchaseInput({ supplier: "供应商B" }))).rejects.toThrow("事务号已被不同请求使用");
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
});
