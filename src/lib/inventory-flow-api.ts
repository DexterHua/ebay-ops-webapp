import crypto from "node:crypto";
import type { PurchaseReceiptInput, TransitionInventoryInput } from "@/lib/inventory-batch-server";
import { INVENTORY_STATES, type InventoryState } from "@/lib/inventory-flow";
import type { LarkTable } from "@/lib/lark-server";
import type { SessionUser } from "@/lib/session-server";

export interface PurchaseBatchRequestItem {
  sku?: unknown;
  productName?: unknown;
  quantity?: unknown;
}

export interface PurchaseBatchRequestBody {
  purchaseBatchNo?: unknown;
  supplier?: unknown;
  orderedAt?: unknown;
  items?: unknown;
}

export interface TransitionRequestItem {
  detailId?: unknown;
  version?: unknown;
  quantity?: unknown;
}

export interface TransitionRequestBody {
  transactionId?: unknown;
  nextState?: unknown;
  items?: unknown;
}

const INVENTORY_FLOW_RESOURCE_TABLE = {
  purchases: "purchaseBatch",
  shipments: "shipmentBatch",
  details: "inventoryDetail",
  exceptions: "inventoryException",
} as const satisfies Record<string, LarkTable>;

export type InventoryFlowResource = keyof typeof INVENTORY_FLOW_RESOURCE_TABLE;

export function resolveInventoryFlowResource(value: string | null): {
  resource: InventoryFlowResource;
  table: LarkTable;
} {
  const resource = (value || "details") as InventoryFlowResource;
  const table = INVENTORY_FLOW_RESOURCE_TABLE[resource];
  if (!table) {
    throw new Error(`未知库存流转资源：${value || ""}，可选：${Object.keys(INVENTORY_FLOW_RESOURCE_TABLE).join(", ")}`);
  }
  return { resource, table };
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseDate(value: unknown): number {
  const text = toText(value);
  if (!text) return Date.now();
  const normalized = text.replace(/\//g, "-");
  const timestamp = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? `${normalized}T00:00:00+08:00`
      : normalized,
  );
  if (Number.isNaN(timestamp)) throw new Error("下单日期格式无效");
  return timestamp;
}

function toPositiveInteger(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("数量必须为正整数");
  return parsed;
}

function toNonNegativeInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label}必须为非负整数`);
  return parsed;
}

function parseInventoryState(value: unknown): InventoryState {
  const state = toText(value) as InventoryState;
  if (!INVENTORY_STATES.includes(state)) throw new Error("目标状态无效");
  return state;
}

export function parsePurchaseBatchRequest(
  body: PurchaseBatchRequestBody,
  session: Pick<SessionUser, "name">,
  now = Date.now(),
): PurchaseReceiptInput {
  const purchaseBatchNo = toText(body.purchaseBatchNo);
  const supplier = toText(body.supplier);
  if (!purchaseBatchNo) throw new Error("采购批次号不能为空");
  if (!supplier) throw new Error("供应商不能为空");
  if (!Array.isArray(body.items) || body.items.length === 0) throw new Error("明细不能为空");

  const seenSkus = new Set<string>();
  const lines = body.items.map((raw) => {
    const item = raw as PurchaseBatchRequestItem;
    const sku = toText(item.sku).toUpperCase();
    const productName = toText(item.productName);
    if (!sku) throw new Error("SKU 不能为空");
    if (seenSkus.has(sku)) throw new Error(`同一批次内 SKU 重复：${sku}`);
    seenSkus.add(sku);
    return {
      sku,
      productName,
      quantity: toPositiveInteger(item.quantity),
    };
  });

  return {
    transactionId: `PO-${crypto.randomUUID()}`,
    purchaseBatchNo,
    supplier,
    purchaser: session.name,
    orderedAt: parseDate(body.orderedAt),
    now,
    lines,
  };
}

export function parseTransitionRequest(
  body: TransitionRequestBody,
  session: Pick<SessionUser, "name">,
  now = Date.now(),
): TransitionInventoryInput {
  const nextState = parseInventoryState(body.nextState);
  if (!Array.isArray(body.items) || body.items.length === 0) throw new Error("推进明细不能为空");

  const seenDetailIds = new Set<string>();
  const items = body.items.map((raw) => {
    const item = raw as TransitionRequestItem;
    const detailId = toText(item.detailId);
    if (!detailId) throw new Error("明细编号不能为空");
    if (seenDetailIds.has(detailId)) throw new Error(`同一次推进中明细重复：${detailId}`);
    seenDetailIds.add(detailId);
    return {
      detailId,
      expectedVersion: toNonNegativeInteger(item.version, "版本号"),
      quantity: toPositiveInteger(item.quantity),
      nextState,
    };
  });

  return {
    transactionId: toText(body.transactionId) || `MOVE-${crypto.randomUUID()}`,
    operator: session.name,
    now,
    items,
  };
}
