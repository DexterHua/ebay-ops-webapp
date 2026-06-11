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
  operationType?: string;
  operator?: string;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  failureReason?: string;
  recoveryContext?: string;
  remark?: string;
}

export type InventoryExceptionType = "清点差异" | "集货仓签收差异" | "海外仓签收差异" | "上架差异" | "报损" | "其他";
export type SalesInventoryExceptionType = "销售扣减库存不足";
export type InventoryExceptionStatus = "待处理" | "处理中" | "已补回" | "已报损" | "已关闭";
export type InventoryExceptionAction = "补回库存" | "确认报损" | "关闭异常";

export interface InventoryExceptionRecord {
  异常编号: string;
  来源明细编号: string;
  SKU: string;
  异常类型: InventoryExceptionType | SalesInventoryExceptionType;
  责任节点: InventoryState;
  预期数量: number;
  实收数量: number;
  差异数量: number;
  处理状态: InventoryExceptionStatus;
  负责人?: string;
  创建时间: number;
  关闭时间?: number;
  备注?: string;
}

export interface InventoryBatchRepository {
  getTransaction(transactionId: string): Promise<InventoryTransactionRecord | undefined>;
  saveTransaction(record: InventoryTransactionRecord): Promise<void>;
  upsertPurchaseBatch(batchNo: string, fields: Record<string, unknown>): Promise<void>;
  upsertShipmentBatch(batchNo: string, fields: Record<string, unknown>): Promise<void>;
  upsertInventoryDetail(detail: InventoryDetail): Promise<void>;
  getInventoryDetails(detailIds: string[]): Promise<InventoryDetail[]>;
  updateInventoryDetail(detailId: string, detail: InventoryDetail): Promise<void>;
  upsertInventoryException(exception: InventoryExceptionRecord): Promise<void>;
  getInventoryException(exceptionId: string): Promise<InventoryExceptionRecord | undefined>;
  updateInventoryException(exceptionId: string, fields: Partial<InventoryExceptionRecord>): Promise<void>;
  upsertStockFlow(flowId: string, fields: Record<string, unknown>): Promise<void>;
  listInventoryDetailsBySku(skus: string[]): Promise<InventoryDetail[]>;
  listInventoryDetailsByState(state: InventoryState): Promise<InventoryDetail[]>;
  updateSkuSummary(sku: string, fields: Record<string, unknown>): Promise<void>;
}

export interface PurchaseReceiptInput {
  transactionId: string;
  purchaseBatchNo: string;
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
    actualQuantity?: number;
    expectedVersion: number;
    nextState: InventoryState;
    exceptionType?: InventoryExceptionType;
  }>;
}

export interface ShipmentBatchInput {
  transactionId: string;
  shipmentBatchNo: string;
  carrier: string;
  trackingNo: string;
  shippedAt: number;
  operator: string;
  now: number;
  bindings: Array<{
    detailId: string;
    expectedVersion: number;
    quantity?: number;
  }>;
  autoTransition: boolean;
}

export interface ResolveInventoryExceptionInput {
  transactionId: string;
  exceptionId: string;
  action: InventoryExceptionAction;
  targetState?: InventoryState;
  operator: string;
  now: number;
  remark?: string;
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

function exceptionId(transactionId: string, detailId: string): string {
  return `EX-${transactionId}-${detailId}`;
}

const LOCATION_BY_STATE: Record<InventoryState, "本地仓" | "国内集货仓" | "橙联在途" | "橙联可售"> = {
  本地仓待清点: "本地仓",
  待包装: "本地仓",
  已发往国内集货仓: "国内集货仓",
  国内集货仓待发: "国内集货仓",
  橙联在途: "橙联在途",
  海外仓待上架: "橙联在途",
  橙联可售: "橙联可售",
};

function hasAppliedTransition(detail: InventoryDetail, input: {
  transactionId: string;
  nextState: InventoryState;
  expectedVersion: number;
}): boolean {
  return detail.最近流转事务号 === input.transactionId
    && detail.当前状态 === input.nextState
    && (detail.版本号 ?? 0) === input.expectedVersion + 1;
}

function hasAppliedShortage(detail: InventoryDetail, input: {
  transactionId: string;
  expectedVersion: number;
  shortageQuantity: number;
}): boolean {
  return input.shortageQuantity > 0
    && detail.最近流转事务号 === input.transactionId
    && (detail.版本号 ?? 0) === input.expectedVersion + 1
    && (detail.异常数量 ?? 0) >= input.shortageQuantity;
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
    assertPositiveSafeInteger(item.quantity, "流转数量");
    const actualQuantity = item.actualQuantity ?? item.quantity;
    if (!Number.isSafeInteger(actualQuantity) || actualQuantity < 0) {
      throw new Error("实收数量必须为非负安全整数");
    }
    if (actualQuantity > item.quantity) throw new Error("实收数量不能大于预期数量");
    const shortageQuantity = item.quantity - actualQuantity;
    const retryingAppliedTransition = hasAppliedTransition(detail, {
      transactionId: input.transactionId,
      nextState: item.nextState,
      expectedVersion: item.expectedVersion,
    });
    const retryingAppliedShortage = hasAppliedShortage(detail, {
      transactionId: input.transactionId,
      expectedVersion: item.expectedVersion,
      shortageQuantity,
    });
    if (!retryingAppliedTransition && !retryingAppliedShortage && (detail.版本号 ?? 0) !== item.expectedVersion) {
      throw new Error(`明细 ${item.detailId} 版本不匹配`);
    }
    const movedId = movedDetailId(item.detailId, input.transactionId);
    const sourceForPlanning = retryingAppliedTransition
      ? inferPreTransitionDetail(detail, item)
      : retryingAppliedShortage
        ? {
          ...detail,
          当前数量: detail.当前数量 + item.quantity,
          异常数量: (detail.异常数量 ?? 0) - shortageQuantity,
          版本号: item.expectedVersion,
        }
      : detail;
    const shouldCreateException = shortageQuantity > 0;
    const planned = planDetailTransition({
      detail: sourceForPlanning,
      quantity: actualQuantity > 0 ? actualQuantity : item.quantity,
      nextState: item.nextState,
      movedDetailId: movedId,
      transactionId: input.transactionId,
      operator: input.operator,
      now: input.now,
    });
    if (shouldCreateException && actualQuantity === 0) {
      planned.sourceUpdate = {
        ...sourceForPlanning,
        当前数量: sourceForPlanning.当前数量 - item.quantity,
        异常数量: (sourceForPlanning.异常数量 ?? 0) + shortageQuantity,
        最近操作人: input.operator,
        最近更新时间: input.now,
        最近流转事务号: input.transactionId,
        版本号: (sourceForPlanning.版本号 ?? 0) + 1,
      };
      planned.movedCreate = undefined;
    } else if (shouldCreateException) {
      planned.sourceUpdate = {
        ...planned.sourceUpdate,
        当前数量: sourceForPlanning.当前数量 - item.quantity,
        异常数量: (sourceForPlanning.异常数量 ?? 0) + shortageQuantity,
      };
    }
    if (!detail.明细编号) throw new Error("明细编号不能为空");
    if (!retryingAppliedTransition && !retryingAppliedShortage && item.nextState === "橙联在途" && !detail.当前物流批次) {
      throw new Error("进入橙联在途前必须绑定物流批次");
    }
    if (!retryingAppliedTransition && !retryingAppliedShortage) {
      await repo.updateInventoryDetail(detail.明细编号, planned.sourceUpdate);
    }
    const flowDetail = planned.movedCreate || planned.sourceUpdate;
    if (planned.movedCreate) await repo.upsertInventoryDetail(planned.movedCreate);

    const ledgers = actualQuantity > 0 ? buildLocationLedger(sourceForPlanning.当前状态, item.nextState, actualQuantity) : [];
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
    if (shouldCreateException) {
      const id = exceptionId(input.transactionId, item.detailId);
      await repo.upsertInventoryException({
        异常编号: id,
        来源明细编号: item.detailId,
        SKU: detail.SKU,
        异常类型: item.exceptionType || "其他",
        责任节点: sourceForPlanning.当前状态,
        预期数量: item.quantity,
        实收数量: actualQuantity,
        差异数量: actualQuantity - item.quantity,
        处理状态: "待处理",
        创建时间: input.now,
      });
      await repo.upsertStockFlow(`${input.transactionId}-${item.detailId}-ABNORMAL-OUT`, {
        流转事务号: input.transactionId,
        来源明细编号: item.detailId,
        SKU: detail.SKU,
        前状态: sourceForPlanning.当前状态,
        后状态: sourceForPlanning.当前状态,
        库存位置: LOCATION_BY_STATE[sourceForPlanning.当前状态],
        数量变动: -shortageQuantity,
        操作人: input.operator,
        操作时间: input.now,
        操作类型: "差异暂存",
      });
      await repo.upsertStockFlow(`${input.transactionId}-${item.detailId}-ABNORMAL-IN`, {
        流转事务号: input.transactionId,
        来源明细编号: item.detailId,
        SKU: detail.SKU,
        前状态: sourceForPlanning.当前状态,
        后状态: sourceForPlanning.当前状态,
        库存位置: "异常暂存",
        数量变动: shortageQuantity,
        操作人: input.operator,
        操作时间: input.now,
        操作类型: "差异暂存",
      });
    }
    touchedSkus.add(detail.SKU);
  }

  await rebuildSummaries(repo, touchedSkus);
  await completeTransaction(repo, input.transactionId, digest);
  return { transactionId: input.transactionId, replayed: false };
}

export async function resolveInventoryException(
  repo: InventoryBatchRepository,
  input: ResolveInventoryExceptionInput,
): Promise<{ transactionId: string; replayed: boolean }> {
  const digest = digestInput("resolve-exception", input);
  const transaction = await beginTransaction(repo, input.transactionId, digest);
  if (transaction.replayed) return { transactionId: input.transactionId, replayed: true };

  const exception = await repo.getInventoryException(input.exceptionId);
  if (!exception) throw new Error(`未找到异常 ${input.exceptionId}`);
  if (exception.异常类型 === "销售扣减库存不足") {
    throw new Error("销售扣减库存不足不能通过差异补回处理，请补录库存或修正销售日报后重新扫描");
  }
  if (!["待处理", "处理中"].includes(exception.处理状态)) {
    throw new Error(`异常 ${input.exceptionId} 已处理，不能重复关闭`);
  }

  const quantity = Math.abs(exception.差异数量);
  assertPositiveSafeInteger(quantity, "异常处理数量");
  const [detail] = await repo.getInventoryDetails([exception.来源明细编号]);
  if (!detail?.明细编号) throw new Error(`未找到异常来源明细 ${exception.来源明细编号}`);
  const abnormalQuantity = detail.异常数量 ?? 0;
  if (abnormalQuantity < quantity) throw new Error("来源明细异常数量不足，无法处理异常");

  const nextDetail: InventoryDetail = {
    ...detail,
    异常数量: abnormalQuantity - quantity,
    最近操作人: input.operator,
    最近更新时间: input.now,
    最近流转事务号: input.transactionId,
    版本号: (detail.版本号 ?? 0) + 1,
  };

  if (input.action === "补回库存") {
    if (!input.targetState) throw new Error("补回库存必须提供目标状态");
    nextDetail.当前状态 = input.targetState;
    nextDetail.当前数量 = detail.当前数量 + quantity;
  }

  await repo.updateInventoryDetail(detail.明细编号, nextDetail);

  const flowBase = {
    流转事务号: input.transactionId,
    来源明细编号: exception.来源明细编号,
    SKU: exception.SKU,
    操作人: input.operator,
    操作时间: input.now,
  };

  if (input.action === "补回库存") {
    await repo.upsertStockFlow(`${input.transactionId}-${input.exceptionId}-ABNORMAL-OUT`, {
      ...flowBase,
      库存位置: "异常暂存",
      数量变动: -quantity,
      操作类型: "异常释放",
    });
    await repo.upsertStockFlow(`${input.transactionId}-${input.exceptionId}-RETURN-IN`, {
      ...flowBase,
      库存位置: LOCATION_BY_STATE[input.targetState!],
      数量变动: quantity,
      操作类型: "异常释放",
    });
  } else if (input.action === "确认报损") {
    await repo.upsertStockFlow(`${input.transactionId}-${input.exceptionId}-LOSS`, {
      ...flowBase,
      库存位置: "异常暂存",
      数量变动: -quantity,
      操作类型: "报损",
    });
  }

  await repo.updateInventoryException(input.exceptionId, {
    处理状态: input.action === "补回库存" ? "已补回" : input.action === "确认报损" ? "已报损" : "已关闭",
    关闭时间: input.now,
    负责人: input.operator,
    备注: input.remark || exception.备注,
  });
  await rebuildSummaries(repo, [exception.SKU]);
  await completeTransaction(repo, input.transactionId, digest);
  return { transactionId: input.transactionId, replayed: false };
}

function bindSplitDetailId(detailId: string, transactionId: string): string {
  return `${detailId}-BIND-${transactionId}`;
}

function moveFromBindDetailId(bindDetailId: string, transactionId: string): string {
  return `${bindDetailId}-MOVE-${transactionId}`;
}

function isShipmentRegistryPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("RolePermNotAllow") || message.includes("1254302");
}

export async function createAndBindShipment(
  repo: InventoryBatchRepository,
  input: ShipmentBatchInput,
): Promise<{ transactionId: string; replayed: boolean }> {
  const digest = digestInput("shipment", input);
  const transaction = await beginTransaction(repo, input.transactionId, digest);
  if (transaction.replayed) return { transactionId: input.transactionId, replayed: true };

  try {
    await repo.upsertShipmentBatch(input.shipmentBatchNo, {
      物流批次号: input.shipmentBatchNo,
      承运商: input.carrier,
      跟踪号: input.trackingNo,
      发货日期: input.shippedAt,
      批次状态: "处理中",
      操作人: input.operator,
      创建时间: input.now,
    });
  } catch (error) {
    if (input.bindings.length === 0 || !isShipmentRegistryPermissionError(error)) {
      throw error;
    }
  }

  const touchedSkus = new Set<string>();
  const boundDetailRefs: Array<{ detailId: string; sku: string }> = [];

  if (input.bindings.length > 0) {
    const details = await repo.getInventoryDetails(input.bindings.map((b) => b.detailId));
    const detailById = new Map(details.map((d) => [d.明细编号, d]));

    for (const binding of input.bindings) {
      const detail = detailById.get(binding.detailId);
      if (!detail) throw new Error(`未找到明细 ${binding.detailId}`);
      if (detail.当前状态 !== "国内集货仓待发") {
        throw new Error(`明细 ${binding.detailId} 当前状态不是国内集货仓待发，无法绑定物流批次`);
      }
      if ((detail.版本号 ?? 0) !== binding.expectedVersion) {
        throw new Error(`明细 ${binding.detailId} 版本不匹配`);
      }

      const bindQuantity = binding.quantity ?? detail.当前数量;
      assertPositiveSafeInteger(bindQuantity, "绑定数量");
      if (bindQuantity > detail.当前数量) throw new Error(`明细 ${binding.detailId} 绑定数量超限`);

      const nextVersion = (detail.版本号 ?? 0) + 1;

      if (bindQuantity === detail.当前数量) {
        const updated: InventoryDetail = {
          ...detail,
          当前物流批次: input.shipmentBatchNo,
          版本号: nextVersion,
          最近操作人: input.operator,
          最近更新时间: input.now,
          最近流转事务号: input.transactionId,
        };
        await repo.updateInventoryDetail(detail.明细编号!, updated);
        boundDetailRefs.push({ detailId: detail.明细编号!, sku: detail.SKU });
      } else {
        const movedId = bindSplitDetailId(detail.明细编号!, input.transactionId);
        // 源明细原始数量保持不变，用于标识留置库存
        await repo.updateInventoryDetail(detail.明细编号!, {
          ...detail,
          当前数量: detail.当前数量 - bindQuantity,
          版本号: nextVersion,
          最近操作人: input.operator,
          最近更新时间: input.now,
          最近流转事务号: input.transactionId,
        });
        const movedDetail: InventoryDetail = {
          ...detail,
          明细编号: movedId,
          当前物流批次: input.shipmentBatchNo,
          原始数量: bindQuantity,
          当前数量: bindQuantity,
          异常数量: 0,
          版本号: nextVersion,
          最近操作人: input.operator,
          最近更新时间: input.now,
          最近流转事务号: input.transactionId,
        };
        await repo.upsertInventoryDetail(movedDetail);
        boundDetailRefs.push({ detailId: movedId, sku: detail.SKU });
      }

      await repo.upsertStockFlow(`${input.transactionId}-${binding.detailId}-BIND`, {
        流转事务号: input.transactionId,
        来源明细编号: binding.detailId,
        SKU: detail.SKU,
        前状态: detail.当前状态,
        后状态: detail.当前状态,
        库存位置: "国内集货仓",
        数量变动: bindQuantity,
        物流批次号: input.shipmentBatchNo,
        操作人: input.operator,
        操作时间: input.now,
        操作类型: bindQuantity === detail.当前数量 ? "物流绑定" : "拆分绑定",
      });

      touchedSkus.add(detail.SKU);
    }
  }

  if (input.autoTransition && boundDetailRefs.length > 0) {
    const transitionDetailIds = boundDetailRefs.map((r) => r.detailId);
    const boundDetails = await repo.getInventoryDetails(transitionDetailIds);
    const boundById = new Map(boundDetails.map((d) => [d.明细编号, d]));

    for (const ref of boundDetailRefs) {
      const detail = boundById.get(ref.detailId);
      if (!detail) throw new Error(`未找到已绑定明细 ${ref.detailId}`);

      const planned = planDetailTransition({
        detail,
        quantity: detail.当前数量,
        nextState: "橙联在途",
        movedDetailId: moveFromBindDetailId(ref.detailId, input.transactionId),
        transactionId: input.transactionId,
        operator: input.operator,
        now: input.now,
      });

      await repo.updateInventoryDetail(detail.明细编号!, planned.sourceUpdate);
      if (planned.movedCreate) await repo.upsertInventoryDetail(planned.movedCreate);

      const flowDetail = planned.movedCreate || planned.sourceUpdate;
      const ledgers = buildLocationLedger(detail.当前状态, "橙联在途", detail.当前数量);
      for (const [index, ledger] of ledgers.entries()) {
        await repo.upsertStockFlow(`${input.transactionId}-${flowDetail.明细编号}-${index + 1}`, {
          流转事务号: input.transactionId,
          来源明细编号: flowDetail.明细编号,
          SKU: detail.SKU,
          前状态: detail.当前状态,
          后状态: "橙联在途",
          库存位置: ledger.库存位置,
          数量变动: ledger.数量变动,
          操作人: input.operator,
          操作时间: input.now,
          操作类型: planned.movedCreate ? "拆分推进" : "物流发出",
        });
      }
      touchedSkus.add(detail.SKU);
    }
  }

  await rebuildSummaries(repo, touchedSkus);
  await completeTransaction(repo, input.transactionId, digest);
  return { transactionId: input.transactionId, replayed: false };
}
