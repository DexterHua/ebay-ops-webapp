export const INVENTORY_STATES = [
  "本地仓待清点",
  "待包装",
  "已发往国内集货仓",
  "国内集货仓待发",
  "橙联在途",
  "海外仓待上架",
  "橙联可售",
] as const;

export type InventoryState = typeof INVENTORY_STATES[number];
export type InventoryLocation = "本地仓" | "国内集货仓" | "橙联在途" | "橙联可售" | "异常暂存";

export interface InventoryDetail {
  明细编号?: string;
  来源采购批次?: string;
  当前物流批次?: string;
  SKU: string;
  中文品名快照?: string;
  原始数量?: number;
  当前数量: number;
  异常数量?: number;
  当前状态: InventoryState;
  版本号?: number;
  最近操作人?: string;
  最近更新时间?: number;
  最近流转事务号?: string;
  备注?: string;
}

const LOCATION_BY_STATE: Record<InventoryState, Exclude<InventoryLocation, "异常暂存">> = {
  本地仓待清点: "本地仓",
  待包装: "本地仓",
  已发往国内集货仓: "国内集货仓",
  国内集货仓待发: "国内集货仓",
  橙联在途: "橙联在途",
  海外仓待上架: "橙联在途",
  橙联可售: "橙联可售",
};

const SUMMARY_FIELD_BY_LOCATION = {
  本地仓: "本地库存",
  国内集货仓: "国内集货仓",
  橙联在途: "橙联在途",
  橙联可售: "橙联可售",
} as const;

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function safeAdd(...values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("汇总结果超过安全整数");
  return total;
}

function copyDetailForCreate(detail: InventoryDetail): InventoryDetail {
  return {
    明细编号: detail.明细编号,
    来源采购批次: detail.来源采购批次,
    当前物流批次: detail.当前物流批次,
    SKU: detail.SKU,
    中文品名快照: detail.中文品名快照,
    原始数量: detail.原始数量,
    当前数量: detail.当前数量,
    异常数量: detail.异常数量,
    当前状态: detail.当前状态,
    版本号: detail.版本号,
    最近操作人: detail.最近操作人,
    最近更新时间: detail.最近更新时间,
    最近流转事务号: detail.最近流转事务号,
    备注: detail.备注,
  };
}

export function validateNextState(current: InventoryState, next: InventoryState): boolean {
  const currentIndex = INVENTORY_STATES.indexOf(current);
  const nextIndex = INVENTORY_STATES.indexOf(next);
  return currentIndex >= 0 && nextIndex >= 0 && nextIndex === currentIndex + 1;
}

export function buildLocationLedger(current: InventoryState, next: InventoryState, quantity: number) {
  if (!validateNextState(current, next)) throw new Error("非法状态推进");
  if (!isPositiveSafeInteger(quantity)) throw new Error("流水数量必须为正安全整数");
  const from = LOCATION_BY_STATE[current];
  const to = LOCATION_BY_STATE[next];
  return from === to ? [] : [
    { 库存位置: from, 数量变动: -quantity },
    { 库存位置: to, 数量变动: quantity },
  ];
}

function toInventoryText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(toInventoryText).find(Boolean) || "";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["text", "value", "name", "number"]) {
      if (key in record) {
        const text = toInventoryText(record[key]);
        if (text) return text;
      }
    }
  }
  return "";
}

export function toInventoryNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/,/g, "");
    if (!normalized) return 0;
    const parsed = Number(normalized.endsWith("%") ? normalized.slice(0, -1) : normalized);
    if (!Number.isFinite(parsed)) return 0;
    return normalized.endsWith("%") ? parsed / 100 : parsed;
  }
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + toInventoryNumber(item), 0);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "text", "number"]) {
      if (key in record) return toInventoryNumber(record[key]);
    }
  }
  return 0;
}

export function normalizeInventoryDetailForSummary(row: {
  SKU?: unknown;
  当前数量?: unknown;
  当前状态?: unknown;
}): Pick<InventoryDetail, "SKU" | "当前数量" | "当前状态"> | undefined {
  const sku = toInventoryText(row.SKU).trim();
  if (!sku) return undefined;
  return {
    SKU: sku,
    当前数量: toInventoryNumber(row.当前数量),
    当前状态: toInventoryText(row.当前状态) as InventoryState,
  };
}

export function countSellableValidSkus(
  skuRows: Array<{ SKU?: unknown; 中文品名?: unknown }>,
  summaryRows: Array<{ SKU?: unknown; 橙联可售?: unknown }>,
): number {
  const normalizeSku = (value: unknown) => toInventoryText(value).trim().toUpperCase();
  const validSkus = new Set(
    skuRows
      .filter((row) => normalizeSku(row.SKU) && toInventoryText(row.中文品名).trim())
      .map((row) => normalizeSku(row.SKU)),
  );
  const sellableSkus = new Set<string>();

  for (const row of summaryRows) {
    const sku = normalizeSku(row.SKU);
    if (validSkus.has(sku) && toInventoryNumber(row.橙联可售) > 0) {
      sellableSkus.add(sku);
    }
  }

  return sellableSkus.size;
}

export function countUniqueInventorySkusByState(
  details: Array<Pick<InventoryDetail, "SKU" | "当前数量" | "当前状态">>,
  state: InventoryState,
): number {
  const skus = new Set<string>();
  for (const detail of details) {
    if (detail.当前状态 === state && detail.当前数量 > 0) {
      skus.add(detail.SKU);
    }
  }
  return skus.size;
}

export function sumInventoryQuantityByState(
  details: Array<Pick<InventoryDetail, "当前数量" | "当前状态">>,
  state: InventoryState,
): number {
  let quantity = 0;
  for (const detail of details) {
    if (detail.当前状态 === state && detail.当前数量 > 0) {
      quantity = safeAdd(quantity, detail.当前数量);
    }
  }
  return quantity;
}

export function summarizeInventoryQuantityByState(
  details: Array<Pick<InventoryDetail, "SKU" | "当前数量" | "当前状态">>,
  state: InventoryState,
): Array<{ SKU: string; quantity: number }> {
  const summaryBySku = new Map<string, number>();
  for (const detail of details) {
    if (detail.当前状态 === state && detail.当前数量 > 0) {
      summaryBySku.set(detail.SKU, safeAdd(summaryBySku.get(detail.SKU) || 0, detail.当前数量));
    }
  }
  return [...summaryBySku.entries()].map(([SKU, quantity]) => ({ SKU, quantity }));
}

const NON_TRANSIT_SKU_STATES = new Set<InventoryState>(["本地仓待清点", "待包装", "橙联可售"]);

function isTransitInventoryDetail(detail: Pick<InventoryDetail, "当前数量" | "当前状态">): boolean {
  return detail.当前数量 > 0 && !NON_TRANSIT_SKU_STATES.has(detail.当前状态);
}

export function countInTransitInventorySkus(
  details: Array<Pick<InventoryDetail, "SKU" | "当前数量" | "当前状态">>,
): number {
  const skus = new Set<string>();
  for (const detail of details) {
    if (isTransitInventoryDetail(detail)) {
      skus.add(detail.SKU);
    }
  }
  return skus.size;
}

export function sumInTransitInventoryQuantity(
  details: Array<Pick<InventoryDetail, "当前数量" | "当前状态">>,
): number {
  let quantity = 0;
  for (const detail of details) {
    if (isTransitInventoryDetail(detail)) {
      quantity = safeAdd(quantity, detail.当前数量);
    }
  }
  return quantity;
}

export function summarizeInTransitInventoryBySku(
  details: Array<Pick<InventoryDetail, "SKU" | "当前数量" | "当前状态">>,
): Array<{ SKU: string; quantity: number }> {
  const summaryBySku = new Map<string, number>();
  for (const detail of details) {
    if (isTransitInventoryDetail(detail)) {
      summaryBySku.set(detail.SKU, safeAdd(summaryBySku.get(detail.SKU) || 0, detail.当前数量));
    }
  }
  return [...summaryBySku.entries()].map(([SKU, quantity]) => ({ SKU, quantity }));
}

export function planDetailTransition(input: {
  detail: InventoryDetail;
  quantity: number;
  nextState: InventoryState;
  movedDetailId: string;
  transactionId: string;
  operator: string;
  now: number;
}) {
	  if (!validateNextState(input.detail.当前状态, input.nextState)) throw new Error("非法状态推进");
	  if (!isPositiveSafeInteger(input.detail.当前数量)) {
	    throw new Error("源明细当前数量必须为正安全整数");
	  }
	  if (!isPositiveSafeInteger(input.quantity)) {
	    throw new Error("流转数量必须为正安全整数");
	  }
	  if (input.quantity > input.detail.当前数量) {
	    throw new Error("流转数量超限");
	  }
	  const originalQuantity = input.detail.原始数量 ?? input.detail.当前数量;
	  if (!isNonNegativeSafeInteger(originalQuantity) || originalQuantity < input.quantity) {
	    throw new Error("源明细原始数量必须是不小于流转数量的非负安全整数");
	  }
	  const abnormalQuantity = input.detail.异常数量 ?? 0;
	  if (!isNonNegativeSafeInteger(abnormalQuantity)) throw new Error("源明细异常数量必须是非负安全整数");
	  const version = input.detail.版本号 ?? 0;
	  if (!isNonNegativeSafeInteger(version) || version >= Number.MAX_SAFE_INTEGER) {
	    throw new Error("源明细版本号必须是可递增的非负安全整数");
	  }
	  if (!isNonNegativeSafeInteger(input.now)) throw new Error("更新时间必须是非负安全整数");
	  const common = {
    最近操作人: input.operator,
    最近更新时间: input.now,
    最近流转事务号: input.transactionId,
    版本号: version + 1,
  };
  if (input.quantity === input.detail.当前数量) {
    return {
      sourceUpdate: { ...input.detail, ...common, 当前状态: input.nextState },
      movedCreate: undefined,
    };
  }
  return {
    sourceUpdate: {
      ...input.detail,
      ...common,
      // 原始数量保持不变，用于标识留置库存（原始数量 > 当前数量 = 曾拆分留出）
      当前数量: input.detail.当前数量 - input.quantity,
    },
	    movedCreate: {
	      ...copyDetailForCreate(input.detail),
	      ...common,
	      明细编号: input.movedDetailId,
      原始数量: input.quantity,
      当前数量: input.quantity,
      异常数量: 0,
      当前状态: input.nextState,
    },
  };
}

export function createOpeningDetails(
  summary: { SKU: string; 中文品名?: string; 本地库存?: number; 橙联在途?: number; 橙联可售?: number },
  suffix: string,
): InventoryDetail[] {
  const openingStates = [
    ["本地库存", "本地仓待清点"],
    ["橙联在途", "橙联在途"],
    ["橙联可售", "橙联可售"],
  ] as const;
	  for (const [field] of openingStates) {
	    const quantity = summary[field] ?? 0;
	    if (quantity < 0) throw new Error("期初库存不能为负数");
	    if (!isNonNegativeSafeInteger(quantity)) throw new Error("期初库存必须是非负安全整数");
	  }
  return openingStates.flatMap(([field, state], index) => {
    const quantity = summary[field] ?? 0;
	    return quantity > 0 ? [{
	      明细编号: `OPEN-${suffix}-${summary.SKU}-${index + 1}`,
	      SKU: summary.SKU,
	      中文品名快照: summary.中文品名,
	      原始数量: quantity,
	      当前数量: quantity,
	      当前状态: state,
	      版本号: 1,
	      备注: "期初库存导入",
	    }] : [];
  });
}

export function summarizeDetails(
  details: Array<Pick<InventoryDetail, "SKU" | "当前数量" | "当前状态" | "异常数量">>,
) {
  const result = Object.create(null) as Record<string, {
    本地库存: number;
    国内集货仓: number;
    橙联在途: number;
    橙联可售: number;
    异常暂存: number;
    总可用库存: number;
    账面总量: number;
  }>;
	  for (const detail of details) {
	    if (!isNonNegativeSafeInteger(detail.当前数量)) throw new Error("汇总明细当前数量必须是非负安全整数");
	    const abnormalQuantity = detail.异常数量 ?? 0;
	    if (!isNonNegativeSafeInteger(abnormalQuantity)) throw new Error("汇总明细异常数量必须是非负安全整数");
	    if (!Object.prototype.hasOwnProperty.call(LOCATION_BY_STATE, detail.当前状态)) {
	      throw new Error("汇总明细状态非法");
	    }
	    const location = LOCATION_BY_STATE[detail.当前状态 as InventoryState];
    const summary = result[detail.SKU] ||= {
      本地库存: 0,
      国内集货仓: 0,
      橙联在途: 0,
      橙联可售: 0,
      异常暂存: 0,
      总可用库存: 0,
      账面总量: 0,
    };
	    const field = SUMMARY_FIELD_BY_LOCATION[location];
	    summary[field] = safeAdd(summary[field], detail.当前数量);
	    summary.异常暂存 = safeAdd(summary.异常暂存, abnormalQuantity);
	    summary.总可用库存 = safeAdd(summary.本地库存, summary.国内集货仓, summary.橙联在途, summary.橙联可售);
	    summary.账面总量 = safeAdd(summary.总可用库存, summary.异常暂存);
	  }
  return result;
}
