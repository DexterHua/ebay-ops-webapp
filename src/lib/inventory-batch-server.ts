import crypto from "node:crypto";
import {
  buildLocationLedger,
  INVENTORY_STATES,
  planDetailTransition,
  summarizeDetails,
  type InventoryDetail,
  type InventoryState,
} from "@/lib/inventory-flow";

export interface InventoryTransactionRecord {
  transactionId: string;
  digest: string;
  status: "pending" | "completed";
}

export interface InventoryBatchRepository {
  getTransaction(transactionId: string): Promise<InventoryTransactionRecord | undefined>;
  saveTransaction(record: InventoryTransactionRecord): Promise<void>;
  upsertPurchaseBatch(batchNo: string, fields: Record<string, unknown>): Promise<void>;
  upsertInventoryDetail(detail: InventoryDetail): Promise<void>;
  getInventoryDetails(detailIds: string[]): Promise<InventoryDetail[]>;
  updateInventoryDetail(detailId: string, detail: InventoryDetail): Promise<void>;
  upsertStockFlow(flowId: string, fields: Record<string, unknown>): Promise<void>;
  listInventoryDetailsBySku(skus: string[]): Promise<InventoryDetail[]>;
  updateSkuSummary(sku: string, fields: Record<string, unknown>): Promise<void>;
}

export interface PurchaseReceiptInput {
  transactionId: string;
  purchaseBatchNo: string;
  supplier?: string;
  purchaser: string;
  orderedAt: number;
  now: number;
  lines: Array<{ sku: string; productName?: string; quantity: number }>;
}

export interface TransitionInventoryInput {
  transactionId: string;
  operator: string;
  now: number;
  items: Array<{
    detailId: string;
    quantity: number;
    expectedVersion: number;
    nextState: InventoryState;
  }>;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestInput(kind: string, input: unknown): string {
  return crypto.createHash("sha256").update(`${kind}:${stableStringify(input)}`).digest("hex");
}

async function beginTransaction(
  repo: InventoryBatchRepository,
  transactionId: string,
  digest: string,
): Promise<{ replayed: boolean }> {
  const existing = await repo.getTransaction(transactionId);
  if (existing?.status === "completed") {
    if (existing.digest !== digest) throw new Error("事务号已被不同请求使用");
    return { replayed: true };
  }
  if (existing && existing.digest !== digest) {
    throw new Error("事务号已被不同请求使用");
  }
  await repo.saveTransaction({ transactionId, digest, status: "pending" });
  return { replayed: false };
}

async function completeTransaction(
  repo: InventoryBatchRepository,
  transactionId: string,
  digest: string,
): Promise<void> {
  await repo.saveTransaction({ transactionId, digest, status: "completed" });
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须为正安全整数`);
}

function deterministicDetailId(batchNo: string, sku: string, index: number): string {
  return `LOT-${batchNo}-${sku}-${index + 1}`;
}

function movedDetailId(detailId: string, transactionId: string): string {
  return `${detailId}-MOVE-${transactionId}`;
}

function hasAppliedTransition(detail: InventoryDetail, input: {
  transactionId: string;
  nextState: InventoryState;
  expectedVersion: number;
}): boolean {
  return detail.最近流转事务号 === input.transactionId
    && detail.当前状态 === input.nextState
    && (detail.版本号 ?? 0) === input.expectedVersion + 1;
}

function inferPreTransitionDetail(detail: InventoryDetail, input: {
  detailId: string;
  quantity: number;
  expectedVersion: number;
  nextState: InventoryState;
}): InventoryDetail {
  const nextStateIndex = INVENTORY_STATES.indexOf(input.nextState);
  const previousState = INVENTORY_STATES[nextStateIndex - 1];
  if (!previousState) throw new Error(`明细 ${input.detailId} 无法反推推进前状态`);
  if (detail.当前数量 === input.quantity) {
    return {
      ...detail,
      明细编号: input.detailId,
      当前状态: previousState,
      版本号: input.expectedVersion,
    };
  }
  return {
    ...detail,
    明细编号: input.detailId,
    当前数量: input.quantity,
    当前状态: previousState,
    原始数量: detail.原始数量 ?? input.quantity,
    版本号: input.expectedVersion,
  };
}

async function rebuildSummaries(repo: InventoryBatchRepository, skus: Iterable<string>): Promise<void> {
  const uniqueSkus = [...new Set(skus)];
  if (uniqueSkus.length === 0) return;
  const details = await repo.listInventoryDetailsBySku(uniqueSkus);
  const summaries = summarizeDetails(details.map((detail) => ({
    SKU: detail.SKU,
    当前数量: detail.当前数量,
    当前状态: detail.当前状态,
    异常数量: detail.异常数量,
  })));
  for (const sku of uniqueSkus) {
    await repo.updateSkuSummary(sku, summaries[sku] || {
      本地库存: 0,
      国内集货仓: 0,
      橙联在途: 0,
      橙联可售: 0,
      异常暂存: 0,
      总可用库存: 0,
      账面总量: 0,
    });
  }
}

export async function createPurchaseReceipt(
  repo: InventoryBatchRepository,
  input: PurchaseReceiptInput,
): Promise<{ transactionId: string; replayed: boolean }> {
  const digest = digestInput("purchase-receipt", input);
  const transaction = await beginTransaction(repo, input.transactionId, digest);
  if (transaction.replayed) return { transactionId: input.transactionId, replayed: true };

  await repo.upsertPurchaseBatch(input.purchaseBatchNo, {
    采购批次号: input.purchaseBatchNo,
    供应商: input.supplier || "",
    采购员: input.purchaser,
    下单日期: input.orderedAt,
    批次状态: "处理中",
  });

  const touchedSkus: string[] = [];
  for (const [index, line] of input.lines.entries()) {
    const sku = line.sku.trim();
    if (!sku) throw new Error("SKU 不能为空");
    assertPositiveSafeInteger(line.quantity, "采购数量");
    touchedSkus.push(sku);
    const detailId = deterministicDetailId(input.purchaseBatchNo, sku, index);
    const detail: InventoryDetail = {
      明细编号: detailId,
      来源采购批次: input.purchaseBatchNo,
      SKU: sku,
      中文品名快照: line.productName,
      原始数量: line.quantity,
      当前数量: line.quantity,
      异常数量: 0,
      当前状态: "本地仓待清点",
      版本号: 1,
      最近操作人: input.purchaser,
      最近更新时间: input.now,
      最近流转事务号: input.transactionId,
    };
    await repo.upsertInventoryDetail(detail);
    await repo.upsertStockFlow(`${input.transactionId}-${detailId}-IN`, {
      流转事务号: input.transactionId,
      来源明细编号: detailId,
      来源采购批次: input.purchaseBatchNo,
      SKU: sku,
      库存位置: "本地仓",
      数量变动: line.quantity,
      操作人: input.purchaser,
      操作时间: input.now,
      操作类型: "新增入库",
    });
  }

  await rebuildSummaries(repo, touchedSkus);
  await completeTransaction(repo, input.transactionId, digest);
  return { transactionId: input.transactionId, replayed: false };
}

export async function transitionInventoryDetails(
  repo: InventoryBatchRepository,
  input: TransitionInventoryInput,
): Promise<{ transactionId: string; replayed: boolean }> {
  const digest = digestInput("transition", input);
  const transaction = await beginTransaction(repo, input.transactionId, digest);
  if (transaction.replayed) return { transactionId: input.transactionId, replayed: true };

  const details = await repo.getInventoryDetails(input.items.map((item) => item.detailId));
  const detailById = new Map(details.map((detail) => [detail.明细编号, detail]));
  const touchedSkus = new Set<string>();

  for (const item of input.items) {
    const detail = detailById.get(item.detailId);
    if (!detail) throw new Error(`未找到明细 ${item.detailId}`);
    const retryingAppliedTransition = hasAppliedTransition(detail, {
      transactionId: input.transactionId,
      nextState: item.nextState,
      expectedVersion: item.expectedVersion,
    });
    if (!retryingAppliedTransition && (detail.版本号 ?? 0) !== item.expectedVersion) {
      throw new Error(`明细 ${item.detailId} 版本不匹配`);
    }
    assertPositiveSafeInteger(item.quantity, "流转数量");
    const movedId = movedDetailId(item.detailId, input.transactionId);
    const sourceForPlanning = retryingAppliedTransition
      ? inferPreTransitionDetail(detail, item)
      : detail;
    const planned = planDetailTransition({
      detail: sourceForPlanning,
      quantity: item.quantity,
      nextState: item.nextState,
      movedDetailId: movedId,
      transactionId: input.transactionId,
      operator: input.operator,
      now: input.now,
    });
    if (!detail.明细编号) throw new Error("明细编号不能为空");
    if (!retryingAppliedTransition && item.nextState === "橙联在途" && !detail.当前物流批次) {
      throw new Error("进入橙联在途前必须绑定物流批次");
    }
    if (!retryingAppliedTransition) {
      await repo.updateInventoryDetail(detail.明细编号, planned.sourceUpdate);
    }
    const flowDetail = planned.movedCreate || planned.sourceUpdate;
    if (planned.movedCreate) await repo.upsertInventoryDetail(planned.movedCreate);

    const ledgers = buildLocationLedger(sourceForPlanning.当前状态, item.nextState, item.quantity);
    for (const [index, ledger] of ledgers.entries()) {
      await repo.upsertStockFlow(`${input.transactionId}-${flowDetail.明细编号}-${index + 1}`, {
        流转事务号: input.transactionId,
        来源明细编号: flowDetail.明细编号,
        SKU: detail.SKU,
        前状态: sourceForPlanning.当前状态,
        后状态: item.nextState,
        库存位置: ledger.库存位置,
        数量变动: ledger.数量变动,
        操作人: input.operator,
        操作时间: input.now,
        操作类型: planned.movedCreate ? "拆分推进" : "状态推进",
      });
    }
    touchedSkus.add(detail.SKU);
  }

  await rebuildSummaries(repo, touchedSkus);
  await completeTransaction(repo, input.transactionId, digest);
  return { transactionId: input.transactionId, replayed: false };
}
