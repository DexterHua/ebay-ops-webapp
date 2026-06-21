import { describe, expect, it } from "vitest";
import {
  buildLocationLedger,
  countInTransitInventorySkus,
  countSellableValidSkus,
  countUniqueInventorySkusByState,
  createOpeningDetails,
  normalizeInventoryDetailForSummary,
  planDetailTransition,
  summarizeInventoryQuantityByState,
  summarizeInTransitInventoryBySku,
  sumInventoryQuantityByState,
  sumInTransitInventoryQuantity,
  summarizeDetails,
  type InventoryState,
  validateNextState,
} from "@/lib/inventory-flow";

describe("inventory flow", () => {
  it("只允许按顺序推进", () => {
    expect(validateNextState("本地仓待清点", "待包装")).toBe(true);
    expect(validateNextState("待包装", "已发往国内集货仓")).toBe(true);
    expect(validateNextState("已发往国内集货仓", "国内集货仓待发")).toBe(true);
    expect(validateNextState("国内集货仓待发", "橙联在途")).toBe(true);
    expect(validateNextState("橙联在途", "海外仓待上架")).toBe(true);
    expect(validateNextState("海外仓待上架", "橙联可售")).toBe(true);
    expect(validateNextState("本地仓待清点", "橙联可售")).toBe(false);
    expect(validateNextState("待包装", "本地仓待清点")).toBe(false);
  });

  it("显式拒绝运行时未知状态", () => {
    expect(validateNextState("未知" as InventoryState, "本地仓待清点")).toBe(false);
    expect(validateNextState("本地仓待清点", "未知" as InventoryState)).toBe(false);
  });

  it("跨仓推进生成一减一增成对流水", () => {
    expect(buildLocationLedger("待包装", "已发往国内集货仓", 80)).toEqual([
      { 库存位置: "本地仓", 数量变动: -80 },
      { 库存位置: "国内集货仓", 数量变动: 80 },
    ]);
  });

  it("同一仓内状态推进不产生库存扣增", () => {
    expect(buildLocationLedger("本地仓待清点", "待包装", 80)).toEqual([]);
  });

  it("按批次库存明细状态统计待清点 SKU 并去重", () => {
    expect(countUniqueInventorySkusByState([
      { SKU: "SKU-1", 当前数量: 10, 当前状态: "本地仓待清点" },
      { SKU: "SKU-1", 当前数量: 5, 当前状态: "本地仓待清点" },
      { SKU: "SKU-2", 当前数量: 8, 当前状态: "待包装" },
      { SKU: "SKU-3", 当前数量: 0, 当前状态: "本地仓待清点" },
    ], "本地仓待清点")).toBe(1);
  });

  it("首页橙联可售 SKU 只统计有效主数据中的唯一 SKU", () => {
    const validSkuRows = [
      { SKU: "SKU-1", 中文品名: "商品一" },
      { SKU: "SKU-2", 中文品名: "商品二" },
      { SKU: "SKU-3", 中文品名: "" },
    ];
    const summaryRows = [
      { SKU: "SKU-1", 橙联可售: 10 },
      { SKU: "SKU-1", 橙联可售: 5 },
      { SKU: "SKU-2", 橙联可售: 0 },
      { SKU: "STALE-SKU", 橙联可售: 20 },
    ];

    expect(countSellableValidSkus(validSkuRows, summaryRows)).toBe(1);
  });

  it("在途 SKU 统计排除本地待清点、待包装和橙联可售并去重", () => {
    expect(countInTransitInventorySkus([
      { SKU: "SKU-1", 当前数量: 10, 当前状态: "本地仓待清点" },
      { SKU: "SKU-2", 当前数量: 8, 当前状态: "待包装" },
      { SKU: "SKU-3", 当前数量: 7, 当前状态: "已发往国内集货仓" },
      { SKU: "SKU-3", 当前数量: 2, 当前状态: "国内集货仓待发" },
      { SKU: "SKU-4", 当前数量: 6, 当前状态: "橙联在途" },
      { SKU: "SKU-5", 当前数量: 5, 当前状态: "海外仓待上架" },
      { SKU: "SKU-6", 当前数量: 4, 当前状态: "橙联可售" },
      { SKU: "SKU-7", 当前数量: 0, 当前状态: "橙联在途" },
    ])).toBe(3);
  });

  it("在途商品数量统计排除本地待清点、待包装和橙联可售", () => {
    const details = [
      { SKU: "SKU-1", 当前数量: 25, 当前状态: "本地仓待清点" as const },
      { SKU: "SKU-2", 当前数量: 15, 当前状态: "待包装" as const },
      { SKU: "SKU-A", 当前数量: 250, 当前状态: "已发往国内集货仓" as const },
      { SKU: "SKU-B", 当前数量: 250, 当前状态: "国内集货仓待发" as const },
      { SKU: "SKU-C", 当前数量: 251, 当前状态: "橙联在途" as const },
      { SKU: "SKU-D", 当前数量: 251, 当前状态: "海外仓待上架" as const },
      { SKU: "SKU-E", 当前数量: 99, 当前状态: "橙联可售" as const },
    ];

    expect(sumInTransitInventoryQuantity(details)).toBe(1002);
    expect(summarizeInTransitInventoryBySku(details)).toEqual([
      { SKU: "SKU-A", quantity: 250 },
      { SKU: "SKU-B", quantity: 250 },
      { SKU: "SKU-C", quantity: 251 },
      { SKU: "SKU-D", quantity: 251 },
    ]);
  });

  it("在途商品数量不依赖 SKU 主数据是否存在", () => {
    const masterSkus = new Set(["SKU-C"]);
    const details = [
      { SKU: "TEST1234567", 当前数量: 500, 当前状态: "橙联在途" as const },
      { SKU: "TEST7654321", 当前数量: 500, 当前状态: "橙联在途" as const },
      { SKU: "SKU-C", 当前数量: 1, 当前状态: "橙联在途" as const },
      { SKU: "1", 当前数量: 1, 当前状态: "橙联在途" as const },
    ];

    expect(sumInTransitInventoryQuantity(details)).toBe(1002);
    expect(summarizeInTransitInventoryBySku(details)
      .filter((item) => masterSkus.has(item.SKU))
      .reduce((sum, item) => sum + item.quantity, 0)).toBe(1);
  });

  it("橙联可售商品数量直接按批次明细状态汇总，不依赖 SKU 主数据", () => {
    const details = [
      { SKU: "KNOWN-1", 当前数量: 1585, 当前状态: "橙联可售" as const },
      { SKU: "TEST1234567", 当前数量: 500, 当前状态: "橙联可售" as const },
      { SKU: "TEST7654321", 当前数量: 500, 当前状态: "橙联可售" as const },
      { SKU: "SP80292SDA407B001", 当前数量: 1, 当前状态: "橙联可售" as const },
      { SKU: "1", 当前数量: 1, 当前状态: "橙联可售" as const },
      { SKU: "LOCAL-1", 当前数量: 30, 当前状态: "本地仓待清点" as const },
    ];

    expect(sumInventoryQuantityByState(details, "橙联可售")).toBe(2587);
    expect(summarizeInventoryQuantityByState(details, "橙联可售")).toEqual([
      { SKU: "KNOWN-1", quantity: 1585 },
      { SKU: "TEST1234567", quantity: 500 },
      { SKU: "TEST7654321", quantity: 500 },
      { SKU: "SP80292SDA407B001", quantity: 1 },
      { SKU: "1", quantity: 1 },
    ]);
  });

  it("可从飞书字段格式规范化在途明细数量和状态", () => {
    const details = [
      normalizeInventoryDetailForSummary({ SKU: "SKU-A", 当前数量: { value: "250" }, 当前状态: ["已发往国内集货仓"] }),
      normalizeInventoryDetailForSummary({ SKU: "SKU-B", 当前数量: ["251"], 当前状态: { text: "橙联在途" } }),
      normalizeInventoryDetailForSummary({ SKU: "SKU-C", 当前数量: { number: 501 }, 当前状态: "海外仓待上架" }),
      normalizeInventoryDetailForSummary({ SKU: "SKU-D", 当前数量: "99", 当前状态: "待包装" }),
      normalizeInventoryDetailForSummary({ SKU: "", 当前数量: "1", 当前状态: "橙联在途" }),
    ].filter((detail): detail is NonNullable<typeof detail> => Boolean(detail));

    expect(sumInTransitInventoryQuantity(details)).toBe(1002);
    expect(summarizeInTransitInventoryBySku(details)).toEqual([
      { SKU: "SKU-A", quantity: 250 },
      { SKU: "SKU-B", quantity: 251 },
      { SKU: "SKU-C", quantity: 501 },
    ]);
  });

  it("流水构造拒绝非法状态和数量", () => {
    expect(() => buildLocationLedger("本地仓待清点", "橙联可售", 80)).toThrow("非法状态推进");
    expect(() => buildLocationLedger("未知" as InventoryState, "本地仓待清点", 80)).toThrow("非法状态推进");
    for (const quantity of [0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => buildLocationLedger("待包装", "已发往国内集货仓", quantity))
        .toThrow("流水数量必须为正安全整数");
    }
  });

  it("部分数量推进会保留剩余明细并记录操作元数据", () => {
    const result = planDetailTransition({
      detail: { 明细编号: "LOT-1", SKU: "SKU-1", 当前数量: 100, 当前状态: "待包装", 版本号: 1 },
      quantity: 80,
      nextState: "已发往国内集货仓",
      movedDetailId: "LOT-2",
      transactionId: "MOVE-1",
      operator: "车泉",
      now: 1780400000000,
    });
    expect(result.sourceUpdate).toMatchObject({
      明细编号: "LOT-1",
      当前数量: 20,
      当前状态: "待包装",
      最近操作人: "车泉",
      最近更新时间: 1780400000000,
      最近流转事务号: "MOVE-1",
      版本号: 2,
    });
    expect(result.movedCreate).toMatchObject({
      明细编号: "LOT-2",
      当前数量: 80,
      当前状态: "已发往国内集货仓",
      最近操作人: "车泉",
      最近更新时间: 1780400000000,
      最近流转事务号: "MOVE-1",
      版本号: 2,
    });
  });

  it("拆分新建明细不会继承源行的额外字段", () => {
    const result = planDetailTransition({
      detail: {
        明细编号: "LOT-1",
        SKU: "SKU-1",
        当前数量: 100,
        当前状态: "待包装",
        版本号: 1,
        recordId: "rec-1",
      } as never,
      quantity: 80,
      nextState: "已发往国内集货仓",
      movedDetailId: "LOT-2",
      transactionId: "MOVE-1",
      operator: "车泉",
      now: 1780400000000,
    });
    expect(result.sourceUpdate).toHaveProperty("recordId", "rec-1");
    expect(result.movedCreate).not.toHaveProperty("recordId");
  });

  it("部分拆分后异常数量守恒", () => {
    const result = planDetailTransition({
      detail: { 明细编号: "LOT-1", SKU: "SKU-1", 当前数量: 100, 异常数量: 3, 当前状态: "待包装", 版本号: 1 },
      quantity: 80,
      nextState: "已发往国内集货仓",
      movedDetailId: "LOT-2",
      transactionId: "MOVE-1",
      operator: "车泉",
      now: 1780400000000,
    });
    expect(result.sourceUpdate.异常数量).toBe(3);
    expect(result.movedCreate?.异常数量).toBe(0);
    expect((result.sourceUpdate.异常数量 || 0) + (result.movedCreate?.异常数量 || 0)).toBe(3);
  });

  it("部分拆分后源明细保留原始数量以标记留置库存", () => {
    const input = {
      detail: { 明细编号: "LOT-1", SKU: "SKU-1", 当前数量: 100, 原始数量: 100, 当前状态: "待包装" as const, 版本号: 1 },
      quantity: 80,
      nextState: "已发往国内集货仓" as const,
      movedDetailId: "LOT-2",
      transactionId: "MOVE-1",
      operator: "车泉",
      now: 1780400000000,
    };
    const result = planDetailTransition(input);
    // 源明细原始数量保持 100 不变，用于 UI 识别留置库存（原始数量 > 当前数量）
    expect(result.sourceUpdate.原始数量).toBe(100);
    expect(result.sourceUpdate.当前数量).toBe(20);
    expect(result.movedCreate?.原始数量).toBe(80);
    expect(result.movedCreate?.当前数量).toBe(80);
    // 留置标记：源原始(100) > 源当前(20) → 已拆出 80
    expect((result.sourceUpdate.原始数量 || 0)).toBeGreaterThan(result.sourceUpdate.当前数量);

    // 无原始数量字段时回退为当前数量，源保留 undefined/回退值
    const missingOriginal = planDetailTransition({ ...input, detail: { ...input.detail, 原始数量: undefined } });
    expect(missingOriginal.sourceUpdate.原始数量).toBeUndefined();
    expect(missingOriginal.movedCreate?.原始数量).toBe(80);
  });

  it("整行推进只更新原明细不创建重复明细", () => {
    const result = planDetailTransition({
      detail: { 明细编号: "LOT-1", SKU: "SKU-1", 当前数量: 100, 当前状态: "待包装", 版本号: 1 },
      quantity: 100,
      nextState: "已发往国内集货仓",
      movedDetailId: "LOT-2",
      transactionId: "MOVE-2",
      operator: "车泉",
      now: 1780400000000,
    });
    expect(result.sourceUpdate).toMatchObject({
      明细编号: "LOT-1",
      当前数量: 100,
      当前状态: "已发往国内集货仓",
      最近操作人: "车泉",
      最近更新时间: 1780400000000,
      最近流转事务号: "MOVE-2",
      版本号: 2,
    });
    expect(result.movedCreate).toBeUndefined();
  });

  it("拒绝非法推进和超限数量", () => {
    const input = {
      detail: { 明细编号: "LOT-1", SKU: "SKU-1", 当前数量: 100, 当前状态: "待包装" as const, 版本号: 1 },
      quantity: 80,
      nextState: "已发往国内集货仓" as const,
      movedDetailId: "LOT-2",
      transactionId: "MOVE-1",
      operator: "车泉",
      now: 1780400000000,
    };
    expect(() => planDetailTransition({ ...input, nextState: "橙联可售" })).toThrow("非法状态推进");
    expect(() => planDetailTransition({ ...input, quantity: 0 })).toThrow("流转数量必须为正安全整数");
    expect(() => planDetailTransition({ ...input, quantity: 0.1 })).toThrow("流转数量必须为正安全整数");
    expect(() => planDetailTransition({ ...input, quantity: 101 })).toThrow("流转数量超限");
  });

  it("拒绝非有限流转数量", () => {
    const input = {
      detail: { 明细编号: "LOT-1", SKU: "SKU-1", 当前数量: 100, 当前状态: "待包装" as const, 版本号: 1 },
      quantity: 80,
      nextState: "已发往国内集货仓" as const,
      movedDetailId: "LOT-2",
      transactionId: "MOVE-1",
      operator: "车泉",
      now: 1780400000000,
    };
    expect(() => planDetailTransition({ ...input, quantity: Number.NaN })).toThrow("流转数量必须为正安全整数");
    expect(() => planDetailTransition({ ...input, quantity: Number.POSITIVE_INFINITY })).toThrow("流转数量必须为正安全整数");
    expect(() => planDetailTransition({ ...input, quantity: Number.NEGATIVE_INFINITY })).toThrow("流转数量必须为正安全整数");
  });

  it("流转拒绝非法源明细当前数量", () => {
    const input = {
      detail: { 明细编号: "LOT-1", SKU: "SKU-1", 当前数量: 100, 当前状态: "待包装" as const, 版本号: 1 },
      quantity: 80,
      nextState: "已发往国内集货仓" as const,
      movedDetailId: "LOT-2",
      transactionId: "MOVE-1",
      operator: "车泉",
      now: 1780400000000,
    };
    for (const 当前数量 of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planDetailTransition({ ...input, detail: { ...input.detail, 当前数量 } }))
        .toThrow("源明细当前数量必须为正安全整数");
    }
    expect(() => planDetailTransition({ ...input, detail: { ...input.detail, 当前数量: 0.1 } }))
      .toThrow("源明细当前数量必须为正安全整数");
  });

  it("流转拒绝非法源明细原始数量和异常数量", () => {
    const input = {
      detail: {
        明细编号: "LOT-1",
        SKU: "SKU-1",
        当前数量: 100,
        原始数量: 100,
        异常数量: 0,
        当前状态: "待包装" as const,
        版本号: 1,
      },
      quantity: 80,
      nextState: "已发往国内集货仓" as const,
      movedDetailId: "LOT-2",
      transactionId: "MOVE-1",
      operator: "车泉",
      now: 1780400000000,
    };
    for (const 原始数量 of [-1, 79, 80.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planDetailTransition({ ...input, detail: { ...input.detail, 原始数量 } }))
        .toThrow("源明细原始数量必须是不小于流转数量的非负安全整数");
    }
    for (const 异常数量 of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planDetailTransition({ ...input, detail: { ...input.detail, 异常数量 } }))
        .toThrow("源明细异常数量必须是非负安全整数");
    }
  });

  it("流转拒绝非法版本号和更新时间", () => {
    const input = {
      detail: { 明细编号: "LOT-1", SKU: "SKU-1", 当前数量: 100, 当前状态: "待包装" as const, 版本号: 1 },
      quantity: 80,
      nextState: "已发往国内集货仓" as const,
      movedDetailId: "LOT-2",
      transactionId: "MOVE-1",
      operator: "车泉",
      now: 1780400000000,
    };
    for (const 版本号 of [-1, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planDetailTransition({ ...input, detail: { ...input.detail, 版本号 } }))
        .toThrow("源明细版本号必须是可递增的非负安全整数");
    }
    for (const now of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planDetailTransition({ ...input, now })).toThrow("更新时间必须是非负安全整数");
    }
    expect(planDetailTransition({ ...input, detail: { ...input.detail, 版本号: undefined } }).sourceUpdate.版本号).toBe(1);
  });

  it("期初余额按三个已有位置创建非零明细", () => {
    expect(createOpeningDetails({
      SKU: "SKU-1",
      中文品名: "方向游丝",
      本地库存: 10,
      橙联在途: 20,
      橙联可售: 30,
    }, "20260602")).toEqual([
      {
        明细编号: "OPEN-20260602-SKU-1-1",
        SKU: "SKU-1",
        中文品名快照: "方向游丝",
        原始数量: 10,
        当前数量: 10,
        当前状态: "本地仓待清点",
        版本号: 1,
        备注: "期初库存导入",
      },
      {
        明细编号: "OPEN-20260602-SKU-1-2",
        SKU: "SKU-1",
        中文品名快照: "方向游丝",
        原始数量: 20,
        当前数量: 20,
        当前状态: "橙联在途",
        版本号: 1,
        备注: "期初库存导入",
      },
      {
        明细编号: "OPEN-20260602-SKU-1-3",
        SKU: "SKU-1",
        中文品名快照: "方向游丝",
        原始数量: 30,
        当前数量: 30,
        当前状态: "橙联可售",
        版本号: 1,
        备注: "期初库存导入",
      },
    ]);
  });

  it("期初余额跳过零库存位置", () => {
    expect(createOpeningDetails({
      SKU: "SKU-1",
      本地库存: 0,
      橙联在途: 20,
      橙联可售: 0,
    }, "20260602")).toHaveLength(1);
  });

  it("期初余额拒绝任何负库存", () => {
    const summary = {
      SKU: "SKU-1",
      本地库存: 10,
      橙联在途: 20,
      橙联可售: 30,
    };
    expect(() => createOpeningDetails({ ...summary, 本地库存: -1 }, "20260602")).toThrow("期初库存不能为负数");
    expect(() => createOpeningDetails({ ...summary, 橙联在途: -1 }, "20260602")).toThrow("期初库存不能为负数");
    expect(() => createOpeningDetails({ ...summary, 橙联可售: -1 }, "20260602")).toThrow("期初库存不能为负数");
  });

  it("期初余额拒绝非有限库存", () => {
    const summary = {
      SKU: "SKU-1",
      本地库存: 10,
      橙联在途: 20,
      橙联可售: 30,
    };
    expect(() => createOpeningDetails({ ...summary, 本地库存: 0.1 }, "20260602")).toThrow("期初库存必须是非负安全整数");
    expect(() => createOpeningDetails({ ...summary, 本地库存: Number.NaN }, "20260602")).toThrow("期初库存必须是非负安全整数");
    expect(() => createOpeningDetails({ ...summary, 橙联在途: Number.POSITIVE_INFINITY }, "20260602")).toThrow("期初库存必须是非负安全整数");
    expect(() => createOpeningDetails({ ...summary, 橙联可售: Number.MAX_SAFE_INTEGER + 1 }, "20260602")).toThrow("期初库存必须是非负安全整数");
  });

  it("汇总拒绝非法数量", () => {
    const base = { SKU: "SKU-1", 当前数量: 10, 异常数量: 0, 当前状态: "待包装" as const };
    for (const 当前数量 of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => summarizeDetails([{ ...base, 当前数量 }])).toThrow("汇总明细当前数量必须是非负安全整数");
    }
    for (const 异常数量 of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => summarizeDetails([{ ...base, 异常数量 }])).toThrow("汇总明细异常数量必须是非负安全整数");
    }
  });

  it("汇总拒绝累加后超过安全整数", () => {
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
    expect(() => summarizeDetails([
      { SKU: "SKU-1", 当前数量: half, 异常数量: 0, 当前状态: "待包装" },
      { SKU: "SKU-1", 当前数量: half, 异常数量: 0, 当前状态: "本地仓待清点" },
    ])).toThrow("汇总结果超过安全整数");
    expect(() => summarizeDetails([
      { SKU: "SKU-1", 当前数量: Number.MAX_SAFE_INTEGER, 异常数量: 1, 当前状态: "橙联可售" },
    ])).toThrow("汇总结果超过安全整数");
  });

  it("汇总拒绝运行时未知状态", () => {
    expect(() => summarizeDetails([
      { SKU: "SKU-1", 当前数量: 10, 异常数量: 0, 当前状态: "未知" as InventoryState },
    ])).toThrow("汇总明细状态非法");
    for (const 当前状态 of ["__proto__", "constructor", "toString"] as const) {
      expect(() => summarizeDetails([
        { SKU: "SKU-1", 当前数量: 10, 异常数量: 0, 当前状态: 当前状态 as InventoryState },
      ])).toThrow("汇总明细状态非法");
    }
  });

  it("特殊 SKU 不污染汇总对象", () => {
    const result = summarizeDetails([
      { SKU: "toString", 当前数量: 10, 异常数量: 0, 当前状态: "待包装" },
      { SKU: "__proto__", 当前数量: 20, 异常数量: 2, 当前状态: "橙联在途" },
    ]);
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(result.toString).toEqual({
      本地库存: 10,
      国内集货仓: 0,
      橙联在途: 0,
      橙联可售: 0,
      异常暂存: 0,
      总可用库存: 10,
      账面总量: 10,
    });
    expect(result.__proto__).toEqual({
      本地库存: 0,
      国内集货仓: 0,
      橙联在途: 20,
      橙联可售: 0,
      异常暂存: 2,
      总可用库存: 20,
      账面总量: 22,
    });
  });

  it("从明细按 SKU 重算汇总", () => {
    expect(summarizeDetails([
      { SKU: "SKU-1", 当前数量: 10, 异常数量: 0, 当前状态: "待包装" },
      { SKU: "SKU-1", 当前数量: 15, 异常数量: 0, 当前状态: "国内集货仓待发" },
      { SKU: "SKU-1", 当前数量: 20, 异常数量: 0, 当前状态: "橙联在途" },
      { SKU: "SKU-1", 当前数量: 7, 异常数量: 0, 当前状态: "海外仓待上架" },
      { SKU: "SKU-1", 当前数量: 30, 异常数量: 2, 当前状态: "橙联可售" },
    ])).toEqual({
      "SKU-1": {
        本地库存: 10,
        国内集货仓: 15,
        橙联在途: 27,
        橙联可售: 30,
        异常暂存: 2,
        总可用库存: 82,
        账面总量: 84,
      },
    });
  });
});
