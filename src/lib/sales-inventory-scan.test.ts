import { describe, expect, it } from "vitest";
import type { InventoryTransactionRecord } from "@/lib/inventory-batch-server";
import type { InventoryDetail } from "@/lib/inventory-flow";
import type { LarkRecord } from "@/lib/lark-server";
import {
  allocateSellableInventory,
  buildSalesTransactionId,
  buildScanLogId,
  buildWarningId,
  calculateInventoryWarning,
  calculateSalesMetrics,
  parseSalesDailyRecord,
  runSalesInventoryScan,
  type InventoryScanLogRecord,
  type InventoryWarningRecord,
  type SalesInventoryScanInput,
  type SalesInventoryScanRepository,
  type SkuInventorySnapshot,
  type SkuStockStrategy,
} from "@/lib/sales-inventory-scan";

const NOW = Date.parse("2026-06-05T09:00:00+08:00");

function sale(
  recordId: string,
  sku: string,
  quantity: unknown,
  date = Date.parse("2026-06-05T00:00:00+08:00"),
): LarkRecord {
  return {
    recordId,
    fields: {
      SKU: sku,
      售出数量: quantity,
      日期: date,
      店铺: "测试店铺",
      销售额: 99,
    },
  };
}

function sellableDetail(
  detailId: string,
  quantity: number,
  updatedAt: number,
  version = 1,
): InventoryDetail {
  return {
    明细编号: detailId,
    SKU: "SKU-1",
    原始数量: quantity,
    当前数量: quantity,
    当前状态: "橙联可售",
    版本号: version,
    最近更新时间: updatedAt,
  };
}

class MemorySalesInventoryScanRepository implements SalesInventoryScanRepository {
  sales: LarkRecord[] = [];
  salesHasMore = false;
  transactions = new Map<string, InventoryTransactionRecord>();
  summaries = new Map<string, SkuInventorySnapshot>();
  strategies = new Map<string, SkuStockStrategy>();
  details = new Map<string, InventoryDetail>();
  stockFlows = new Map<string, LarkRecord>();
  exceptions = new Map<string, Record<string, unknown>>();
  warnings = new Map<string, InventoryWarningRecord>();
  scanLogs = new Map<string, InventoryScanLogRecord>();
  alerts: Array<{ chatId: string; text: string }> = [];
  failSummaryUpdates = 0;
  failAlerts = 0;

  async listSalesRecords() {
    return { records: this.sales, hasMore: this.salesHasMore };
  }

  async listTransactions(transactionIds: string[]) {
    const wanted = new Set(transactionIds);
    return new Map([...this.transactions].filter(([id]) => wanted.has(id)));
  }

  async listSkuSummaries(skus: string[]) {
    const wanted = new Set(skus);
    return new Map([...this.summaries].filter(([sku]) => wanted.has(sku)));
  }

  async listStockStrategies(skus: string[]) {
    const wanted = new Set(skus);
    return new Map([...this.strategies].filter(([sku]) => wanted.has(sku)));
  }

  async listSellableDetails(skus: string[]) {
    const wanted = new Set(skus);
    return [...this.details.values()].filter((detail) => (
      wanted.has(detail.SKU)
      && detail.当前状态 === "橙联可售"
    ));
  }

  async listStockFlows(transactionIds: string[]) {
    const wanted = new Set(transactionIds);
    return [...this.stockFlows.values()].filter((record) => (
      wanted.has(String(record.fields.流转事务号 || ""))
    ));
  }

  async getWarning(warningId: string) {
    return this.warnings.get(warningId);
  }

  async saveTransaction(record: InventoryTransactionRecord) {
    this.transactions.set(record.transactionId, record);
  }

  async updateInventoryDetail(detailId: string, detail: InventoryDetail) {
    this.details.set(detailId, detail);
  }

  async upsertStockFlow(flowId: string, fields: Record<string, unknown>) {
    this.stockFlows.set(flowId, {
      recordId: flowId,
      fields: { ...this.stockFlows.get(flowId)?.fields, ...fields },
    });
  }

  async updateSkuSummary(sku: string, fields: Record<string, unknown>) {
    if (this.failSummaryUpdates > 0) {
      this.failSummaryUpdates -= 1;
      throw new Error("模拟汇总更新失败");
    }
    const existing = this.summaries.get(sku);
    if (!existing) throw new Error(`测试汇总不存在: ${sku}`);
    this.summaries.set(sku, { ...existing, ...fields });
  }

  async upsertSalesException(record: Parameters<SalesInventoryScanRepository["upsertSalesException"]>[0]) {
    this.exceptions.set(record.异常编号, { ...record });
  }

  async upsertWarning(record: InventoryWarningRecord) {
    this.warnings.set(record.warningId, record);
  }

  async upsertScanLog(record: InventoryScanLogRecord) {
    this.scanLogs.set(record.warningId, record);
  }

  async sendAlert(chatId: string, text: string) {
    if (this.failAlerts > 0) {
      this.failAlerts -= 1;
      throw new Error("模拟通知失败");
    }
    this.alerts.push({ chatId, text });
    return `message-${this.alerts.length}`;
  }
}

function scanInput(overrides: Partial<SalesInventoryScanInput> = {}): SalesInventoryScanInput {
  return {
    scanId: "SCAN-20260605-0900-test0001",
    mode: "manual",
    limit: 200,
    operator: "管理员",
    now: NOW,
    ...overrides,
  };
}

function seedInventory(
  repo: MemorySalesInventoryScanRepository,
  quantities = [10],
) {
  quantities.forEach((quantity, index) => {
    const detail = sellableDetail(
      `LOT-${index + 1}`,
      quantity,
      NOW - (quantities.length - index) * 1000,
    );
    repo.details.set(detail.明细编号!, detail);
  });
  repo.summaries.set("SKU-1", {
    recordId: "summary-1",
    sku: "SKU-1",
    本地库存: 0,
    国内集货仓: 0,
    橙联在途: 0,
    橙联可售: quantities.reduce((sum, quantity) => sum + quantity, 0),
    异常暂存: 0,
  });
  repo.strategies.set("SKU-1", {
    sku: "SKU-1",
    安全库存: 1,
    补货周期天数: 30,
  });
}

describe("sales inventory domain rules", () => {
  it("严格解析销售日报并规范化 SKU", () => {
    expect(parseSalesDailyRecord(sale("sales-1", " sku-1 ", 3))).toEqual({
      recordId: "sales-1",
      sku: "SKU-1",
      soldQuantity: 3,
      saleDate: Date.parse("2026-06-05T00:00:00+08:00"),
      store: "测试店铺",
      salesAmount: 99,
    });
  });

  it.each([
    sale("sales-1", "", 1),
    sale("sales-1", "SKU-1", 0),
    sale("sales-1", "SKU-1", -1),
    sale("sales-1", "SKU-1", 1.5),
    sale("sales-1", "SKU-1", "abc"),
  ])("拒绝非法销售事实 %#", (record) => {
    expect(() => parseSalesDailyRecord(record)).toThrow();
  });

  it("生成稳定事务、预警和扫描汇总 ID", () => {
    expect(buildSalesTransactionId(" sales-1 ", " sku-1 ")).toBe("SALE-sales-1-SKU-1");
    expect(buildWarningId(NOW, " sku-1 ")).toBe("WARN-20260605-SKU-1");
    expect(buildScanLogId("SCAN-1")).toBe("SCANLOG-SCAN-1");
  });

  it("从完整销售记录计算累计与近 7 日日均", () => {
    const parsed = [
      parseSalesDailyRecord(sale("sales-1", "SKU-1", 7, NOW)),
      parseSalesDailyRecord(sale("sales-2", "SKU-1", 14, NOW - 6 * 86400000)),
      parseSalesDailyRecord(sale("sales-3", "SKU-1", 5, NOW - 8 * 86400000)),
      parseSalesDailyRecord(sale("sales-4", "SKU-2", 100, NOW)),
    ];

    expect(calculateSalesMetrics(parsed, "SKU-1", NOW)).toEqual({
      cumulativeSales: 26,
      recentDailySales: 3,
    });
  });

  it.each([
    {
      name: "不足 7 天为紧急",
      input: { sellable: 6, totalAvailable: 100, dailySales: 1, safetyStock: 1, replenishCycleDays: 30 },
      expected: "紧急",
    },
    {
      name: "等于 7 天不紧急但进入需采购",
      input: { sellable: 7, totalAvailable: 100, dailySales: 1, safetyStock: 1, replenishCycleDays: 30 },
      expected: "需采购",
    },
    {
      name: "低于补货周期为需采购",
      input: { sellable: 14, totalAvailable: 100, dailySales: 1, safetyStock: 1, replenishCycleDays: 15 },
      expected: "需采购",
    },
    {
      name: "无销量时仍能判断低库存",
      input: { sellable: 20, totalAvailable: 20, dailySales: 0, safetyStock: 20, replenishCycleDays: 15 },
      expected: "低库存",
    },
    {
      name: "无风险",
      input: { sellable: 30, totalAvailable: 30, dailySales: 0, safetyStock: 20, replenishCycleDays: 15 },
      expected: undefined,
    },
  ])("$name", ({ input, expected }) => {
    expect(calculateInventoryWarning(input).level).toBe(expected);
  });

  it("建议采购量覆盖补货周期和 15 天缓冲", () => {
    expect(calculateInventoryWarning({
      sellable: 10,
      totalAvailable: 10,
      dailySales: 2,
      safetyStock: 1,
      replenishCycleDays: 20,
    }).suggestedPurchaseQuantity).toBe(60);
  });

  it("按更新时间和明细编号 FIFO 分配可售库存", () => {
    const allocations = allocateSellableInventory([
      sellableDetail("LOT-B", 4, 1000),
      sellableDetail("LOT-C", 10, 2000),
      sellableDetail("LOT-A", 3, 1000),
    ], 8);

    expect(allocations).toEqual([
      { detailId: "LOT-A", quantity: 3, expectedVersion: 1 },
      { detailId: "LOT-B", quantity: 4, expectedVersion: 1 },
      { detailId: "LOT-C", quantity: 1, expectedVersion: 1 },
    ]);
  });
});

describe("sales inventory scan orchestration", () => {
  it("扣减批次明细、写订单出库流水并刷新汇总", async () => {
    const repo = new MemorySalesInventoryScanRepository();
    repo.sales = [sale("sales-1", "SKU-1", 3)];
    seedInventory(repo);

    const result = await runSalesInventoryScan(repo, scanInput());

    expect(result).toMatchObject({
      processed: 1,
      deducted: 1,
      exceptions: 0,
      notificationStatus: "未配置",
    });
    expect(repo.details.get("LOT-1")).toMatchObject({
      当前数量: 7,
      最近流转事务号: "SALE-sales-1-SKU-1",
      版本号: 2,
    });
    expect([...repo.stockFlows.values()][0].fields).toMatchObject({
      SKU: "SKU-1",
      库存位置: "橙联可售",
      数量变动: -3,
      操作类型: "订单出库",
      流转事务号: "SALE-sales-1-SKU-1",
    });
    expect(repo.summaries.get("SKU-1")).toMatchObject({
      橙联可售: 7,
      总可用库存: 7,
      账面总量: 7,
    });
    expect(repo.transactions.get("SALE-sales-1-SKU-1")).toMatchObject({
      status: "completed",
    });
  });

  it("完全售罄时保留数量为 0 的批次明细", async () => {
    const repo = new MemorySalesInventoryScanRepository();
    repo.sales = [sale("sales-1", "SKU-1", 10)];
    seedInventory(repo);

    await runSalesInventoryScan(repo, scanInput());

    expect(repo.details.get("LOT-1")).toMatchObject({
      当前数量: 0,
      最近流转事务号: "SALE-sales-1-SKU-1",
    });
    expect(repo.summaries.get("SKU-1")).toMatchObject({
      橙联可售: 0,
      总可用库存: 0,
      账面总量: 0,
    });
  });

  it("completed 事务重复扫描不会再次扣减", async () => {
    const repo = new MemorySalesInventoryScanRepository();
    repo.sales = [sale("sales-1", "SKU-1", 3)];
    seedInventory(repo);
    await runSalesInventoryScan(repo, scanInput());

    await runSalesInventoryScan(repo, scanInput({
      scanId: "SCAN-20260605-1700-test0002",
      now: Date.parse("2026-06-05T17:00:00+08:00"),
    }));

    expect(repo.details.get("LOT-1")).toMatchObject({ 当前数量: 7 });
    expect(repo.stockFlows).toHaveLength(1);
  });

  it("汇总失败后 pending 重试不会重复扣减或写流水", async () => {
    const repo = new MemorySalesInventoryScanRepository();
    repo.sales = [sale("sales-1", "SKU-1", 3)];
    seedInventory(repo);
    repo.failSummaryUpdates = 1;

    await expect(runSalesInventoryScan(repo, scanInput())).rejects.toThrow("模拟汇总更新失败");
    expect(repo.details.get("LOT-1")).toMatchObject({ 当前数量: 7 });
    expect(repo.stockFlows).toHaveLength(1);
    expect(repo.transactions.get("SALE-sales-1-SKU-1")).toMatchObject({ status: "pending" });

    await runSalesInventoryScan(repo, scanInput({
      scanId: "SCAN-20260605-0901-test0002",
      now: NOW + 60_000,
    }));

    expect(repo.details.get("LOT-1")).toMatchObject({ 当前数量: 7 });
    expect(repo.stockFlows).toHaveLength(1);
    expect(repo.summaries.get("SKU-1")).toMatchObject({ 橙联可售: 7 });
    expect(repo.transactions.get("SALE-sales-1-SKU-1")).toMatchObject({ status: "completed" });
  });

  it("pending 后销售事实被修改时摘要冲突且不继续改库存", async () => {
    const repo = new MemorySalesInventoryScanRepository();
    repo.sales = [sale("sales-1", "SKU-1", 3)];
    seedInventory(repo);
    repo.failSummaryUpdates = 1;
    await expect(runSalesInventoryScan(repo, scanInput())).rejects.toThrow();

    repo.sales = [sale("sales-1", "SKU-1", 4)];

    await expect(runSalesInventoryScan(repo, scanInput({
      scanId: "SCAN-20260605-0901-test0002",
      now: NOW + 60_000,
    }))).rejects.toThrow("销售记录在扣减开始后被修改");
    expect(repo.details.get("LOT-1")).toMatchObject({ 当前数量: 7 });
    expect(repo.stockFlows).toHaveLength(1);
  });

  it("库存不足记录正差异异常且不扣减", async () => {
    const repo = new MemorySalesInventoryScanRepository();
    repo.sales = [sale("sales-1", "SKU-1", 3)];
    seedInventory(repo, [2]);

    const result = await runSalesInventoryScan(repo, scanInput());

    expect(result.exceptions).toBe(1);
    expect(repo.details.get("LOT-1")).toMatchObject({ 当前数量: 2 });
    expect(repo.stockFlows).toHaveLength(0);
    expect([...repo.exceptions.values()][0]).toMatchObject({
      SKU: "SKU-1",
      异常类型: "销售扣减库存不足",
      预期数量: 3,
      实收数量: 2,
      差异数量: 1,
    });
    expect(repo.transactions.get("SALE-sales-1-SKU-1")).toMatchObject({ status: "pending" });
  });

  it("库存不足补货后重试按完整销售数量重新分配", async () => {
    const repo = new MemorySalesInventoryScanRepository();
    repo.sales = [sale("sales-1", "SKU-1", 3)];
    seedInventory(repo, [2]);

    await runSalesInventoryScan(repo, scanInput());

    const replenished = sellableDetail("LOT-2", 3, NOW + 1000);
    repo.details.set(replenished.明细编号!, replenished);
    await runSalesInventoryScan(repo, scanInput({
      scanId: "SCAN-20260605-1700-test0002",
      now: Date.parse("2026-06-05T17:00:00+08:00"),
    }));

    expect(repo.details.get("LOT-1")).toMatchObject({ 当前数量: 0 });
    expect(repo.details.get("LOT-2")).toMatchObject({ 当前数量: 2 });
    expect(repo.stockFlows).toHaveLength(2);
    expect(repo.summaries.get("SKU-1")).toMatchObject({ 橙联可售: 2 });
    expect(repo.transactions.get("SALE-sales-1-SKU-1")).toMatchObject({
      status: "completed",
      failureReason: undefined,
    });
  });

  it("跳过非法销售日报行并继续处理有效记录", async () => {
    const repo = new MemorySalesInventoryScanRepository();
    repo.sales = [
      sale("sales-invalid", "SKU-1", 0),
      sale("sales-1", "SKU-1", 3),
    ];
    seedInventory(repo);

    const result = await runSalesInventoryScan(repo, scanInput());

    expect(result).toMatchObject({
      processed: 1,
      deducted: 1,
      skipped: 1,
    });
    expect(repo.details.get("LOT-1")).toMatchObject({ 当前数量: 7 });
    expect(repo.transactions.has("SALE-sales-invalid-SKU-1")).toBe(false);
  });

  it("销售表分页未完整时在任何写入前失败", async () => {
    const repo = new MemorySalesInventoryScanRepository();
    repo.sales = [sale("sales-1", "SKU-1", 1)];
    repo.salesHasMore = true;
    seedInventory(repo);

    await expect(runSalesInventoryScan(repo, scanInput()))
      .rejects.toThrow("飞书记录未完整读取");
    expect(repo.transactions).toHaveLength(0);
    expect(repo.stockFlows).toHaveLength(0);
    expect(repo.scanLogs).toHaveLength(0);
  });

  it("同日同 SKU 更新稳定预警 ID并为每次扫描写独立汇总", async () => {
    const repo = new MemorySalesInventoryScanRepository();
    repo.sales = [sale("sales-1", "SKU-1", 1)];
    seedInventory(repo, [8]);
    repo.strategies.set("SKU-1", {
      sku: "SKU-1",
      安全库存: 1,
      补货周期天数: 60,
    });

    await runSalesInventoryScan(repo, scanInput({ scanId: "SCAN-A" }));
    repo.sales = [
      sale("sales-1", "SKU-1", 1),
      sale("sales-2", "SKU-1", 2),
    ];
    await runSalesInventoryScan(repo, scanInput({
      scanId: "SCAN-B",
      now: Date.parse("2026-06-05T17:00:00+08:00"),
    }));

    expect([...repo.warnings.keys()]).toEqual(["WARN-20260605-SKU-1"]);
    expect(repo.scanLogs.has("SCANLOG-SCAN-A")).toBe(true);
    expect(repo.scanLogs.has("SCANLOG-SCAN-B")).toBe(true);
  });

  it.each(["已转采购", "已关闭"] as const)("保留人工处理状态 %s", async (status) => {
    const repo = new MemorySalesInventoryScanRepository();
    repo.sales = [sale("sales-1", "SKU-1", 1)];
    seedInventory(repo, [8]);
    repo.strategies.set("SKU-1", {
      sku: "SKU-1",
      安全库存: 1,
      补货周期天数: 60,
    });
    repo.warnings.set("WARN-20260605-SKU-1", {
      warningId: "WARN-20260605-SKU-1",
      recordType: "库存预警",
      scanId: "OLDER",
      sku: "SKU-1",
      level: "需采购",
      triggerReason: "历史预警",
      sellable: 9,
      totalAvailable: 9,
      dailySales: 1,
      safetyStock: 1,
      replenishCycleDays: 60,
      suggestedPurchaseQuantity: 1,
      status,
      createdAt: NOW - 1000,
      updatedAt: NOW - 1000,
    });

    await runSalesInventoryScan(repo, scanInput());

    expect(repo.warnings.get("WARN-20260605-SKU-1")).toMatchObject({ status });
  });

  it("通知失败不回滚库存并写入扫描汇总", async () => {
    const repo = new MemorySalesInventoryScanRepository();
    repo.sales = [sale("sales-1", "SKU-1", 3)];
    seedInventory(repo);
    repo.failAlerts = 1;

    const result = await runSalesInventoryScan(repo, scanInput({
      alertChatId: "chat-1",
    }));

    expect(result).toMatchObject({
      deducted: 1,
      notificationStatus: "发送失败",
      notificationError: "模拟通知失败",
    });
    expect(repo.details.get("LOT-1")).toMatchObject({ 当前数量: 7 });
    expect(repo.transactions.get("SALE-sales-1-SKU-1")).toMatchObject({ status: "completed" });
    expect(repo.scanLogs.get("SCANLOG-SCAN-20260605-0900-test0001")).toMatchObject({
      failureReason: "模拟通知失败",
    });
  });
});
