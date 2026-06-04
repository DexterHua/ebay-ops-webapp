import crypto from "node:crypto";
import type {
  InventoryExceptionAction,
  InventoryExceptionType,
  PurchaseReceiptInput,
  ResolveInventoryExceptionInput,
  TransitionInventoryInput,
} from "@/lib/inventory-batch-server";
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
  orderedAt?: unknown;
  items?: unknown;
}

export interface TransitionRequestItem {
  detailId?: unknown;
  version?: unknown;
  quantity?: unknown;
  actualQuantity?: unknown;
  exceptionType?: unknown;
}

export interface TransitionRequestBody {
  transactionId?: unknown;
  nextState?: unknown;
  items?: unknown;
}

export interface ExceptionResolutionRequestBody {
  transactionId?: unknown;
  exceptionId?: unknown;
  action?: unknown;
  targetState?: unknown;
  remark?: unknown;
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

function toOptionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  return toNonNegativeInteger(value, label);
}

function parseInventoryState(value: unknown): InventoryState {
  const state = toText(value) as InventoryState;
  if (!INVENTORY_STATES.includes(state)) throw new Error("目标状态无效");
  return state;
}

function parseOptionalInventoryState(value: unknown): InventoryState | undefined {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  return parseInventoryState(value);
}

const INVENTORY_EXCEPTION_TYPES = ["清点差异", "集货仓签收差异", "海外仓签收差异", "上架差异", "报损", "其他"] as const;
const INVENTORY_EXCEPTION_ACTIONS = ["补回库存", "确认报损", "关闭异常"] as const;

function parseExceptionType(value: unknown): InventoryExceptionType | undefined {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const text = toText(value) as InventoryExceptionType;
  if (!INVENTORY_EXCEPTION_TYPES.includes(text)) throw new Error("异常类型无效");
  return text;
}

function parseExceptionAction(value: unknown): InventoryExceptionAction {
  const text = toText(value) as InventoryExceptionAction;
  if (!INVENTORY_EXCEPTION_ACTIONS.includes(text)) throw new Error("异常处理动作无效");
  return text;
}

export function parsePurchaseBatchRequest(
  body: PurchaseBatchRequestBody,
  session: Pick<SessionUser, "name">,
  now = Date.now(),
): PurchaseReceiptInput {
  const purchaseBatchNo = toText(body.purchaseBatchNo);
  if (!purchaseBatchNo) throw new Error("采购批次号不能为空");
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
    purchaser: session.name,
    orderedAt: parseDate(body.orderedAt),
    now,
    lines,
  };
}

export interface ShipmentBindItem {
  detailId?: unknown;
  version?: unknown;
  quantity?: unknown;
}

export interface ShipmentBatchRequestBody {
  shipmentBatchNo?: unknown;
  carrier?: unknown;
  trackingNo?: unknown;
  shippedAt?: unknown;
  bindings?: unknown;
  autoTransition?: unknown;
}

export interface ShipmentBatchParsedInput {
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

export function parseShipmentBatchRequest(
  body: ShipmentBatchRequestBody,
  session: Pick<SessionUser, "name">,
  now = Date.now(),
): ShipmentBatchParsedInput {
  const shipmentBatchNo = toText(body.shipmentBatchNo);
  const carrier = toText(body.carrier);
  if (!shipmentBatchNo) throw new Error("物流批次号不能为空");
  if (!carrier) throw new Error("承运商不能为空");

  const bindings: ShipmentBatchParsedInput["bindings"] = [];
  if (Array.isArray(body.bindings) && body.bindings.length > 0) {
    const seenDetailIds = new Set<string>();
    for (const raw of body.bindings) {
      const item = raw as ShipmentBindItem;
      const detailId = toText(item.detailId);
      if (!detailId) throw new Error("绑定明细编号不能为空");
      if (seenDetailIds.has(detailId)) throw new Error(`同一次绑定中明细重复：${detailId}`);
      seenDetailIds.add(detailId);
      const binding: ShipmentBatchParsedInput["bindings"][number] = {
        detailId,
        expectedVersion: toNonNegativeInteger(item.version, "版本号"),
      };
      if (item.quantity !== undefined && item.quantity !== null && String(item.quantity).trim() !== "") {
        binding.quantity = toPositiveInteger(item.quantity);
      }
      bindings.push(binding);
    }
  }

  const autoTransition = body.autoTransition === true || body.autoTransition === "true";

  return {
    transactionId: `SHIP-${crypto.randomUUID()}`,
    shipmentBatchNo,
    carrier,
    trackingNo: toText(body.trackingNo),
    shippedAt: parseDate(body.shippedAt),
    operator: session.name,
    now,
    bindings,
    autoTransition,
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
    const quantity = toPositiveInteger(item.quantity);
    const actualQuantity = toOptionalNonNegativeInteger(item.actualQuantity, "实收数量");
    if (actualQuantity !== undefined && actualQuantity > quantity) throw new Error("实收数量不能大于推进数量");
    return {
      detailId,
      expectedVersion: toNonNegativeInteger(item.version, "版本号"),
      quantity,
      actualQuantity,
      nextState,
      exceptionType: parseExceptionType(item.exceptionType),
    };
  });

  return {
    transactionId: toText(body.transactionId) || `MOVE-${crypto.randomUUID()}`,
    operator: session.name,
    now,
    items,
  };
}

export function parseExceptionResolutionRequest(
  body: ExceptionResolutionRequestBody,
  session: Pick<SessionUser, "name">,
  now = Date.now(),
): ResolveInventoryExceptionInput {
  const exceptionId = toText(body.exceptionId);
  if (!exceptionId) throw new Error("异常编号不能为空");
  const action = parseExceptionAction(body.action);
  const targetState = parseOptionalInventoryState(body.targetState);
  if (action === "补回库存" && !targetState) throw new Error("补回库存必须选择目标状态");

  return {
    transactionId: toText(body.transactionId) || `EX-${crypto.randomUUID()}`,
    exceptionId,
    action,
    targetState,
    operator: session.name,
    now,
    remark: toText(body.remark),
  };
}
