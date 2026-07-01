"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Boxes,
  CircleCheckBig,
  DollarSign,
  LineChart,
  PackageSearch,
  RefreshCw,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import {
  normalizeInventoryDetailForSummary,
  summarizeInventoryQuantityByState,
  summarizeInTransitInventoryBySku,
  sumInventoryQuantityByState,
  sumInTransitInventoryQuantity,
} from "@/lib/inventory-flow";
import { STORES } from "@/types";

const FALLBACK_USD_CNY_RATE = 7.2;
const FIRST_MILE_RMB_PER_ITEM = 20;
const COST_COLORS = ["#334155", "#f97316", "#0ea5e9", "#14b8a6", "#a855f7"];
const PERIODS = [7, 30, 90] as const;
const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2 } as const;
const STORE_LINK_STYLES: Record<string, string> = {
  NP: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
  VG: "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100",
  TR: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  SP: "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
  NM: "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100",
};

type PeriodDays = typeof PERIODS[number];
type Priority = keyof typeof PRIORITY_ORDER;

interface SkuData {
  SKU?: string;
  中文品名?: string;
  商品名称?: string;
  类目?: string[] | string;
  SKU状态?: string[] | string;
  橙联在途?: number | string;
  橙联可售?: number | string;
  本地库存?: number | string;
  国内集货仓?: number | string;
  总可用库存?: number | string;
  安全库存?: number | string;
  补货周期天数?: number | string;
  采购价?: number | string;
  单品采购价_RMB?: number | string;
  预估毛利率?: number | string;
  近7日日均销量?: number | string;
  近30天销量?: number | string;
  近30天净销售额_USD?: number | string;
  近30天净利润_USD?: number | string;
  库存预警状态?: string;
  滞销状态?: string;
  无销售天数?: number | string;
  可售天数?: number | string;
  负责人?: string;
  [key: string]: unknown;
}

interface IssueData {
  SKU?: string;
  异常类型?: string;
  店铺?: string;
  状态?: string;
  优先级?: string;
  [key: string]: unknown;
}

interface SalesData {
  店铺?: string;
  SKU?: string;
  商品名称?: string;
  售出数量?: number | string;
  销售额?: number | string;
  销售额_USD?: number | string;
  退款金额?: number | string;
  退款金额_USD?: number | string;
  净销售额_USD?: number | string;
  采购成本_USD?: number | string;
  采购成本_RMB?: number | string;
  商品成本?: number | string;
  订单手续费?: number | string;
  订单手续费_USD?: number | string;
  eBay费用?: number | string;
  橙联履约费?: number | string;
  橙联履约费_USD?: number | string;
  头程费用_USD?: number | string;
  其他费用_USD?: number | string;
  总费用_USD?: number | string;
  总成本_USD?: number | string;
  净利润_USD?: number | string;
  USD_CNY汇率?: number | string;
  日期?: number | string;
  [key: string]: unknown;
}

interface SaleMetric {
  store: string;
  sku: string;
  productName: string;
  dateMs: number;
  day: string;
  quantity: number;
  grossSales: number;
  refund: number;
  netSales: number;
  purchaseCost: number;
  orderFee: number;
  fulfillmentFee: number;
  firstMile: number;
  otherFee: number;
  totalFee: number;
  totalCost: number;
  netProfit: number;
}

interface Summary {
  orders: number;
  quantity: number;
  activeSkus: number;
  grossSales: number;
  refund: number;
  netSales: number;
  purchaseCost: number;
  orderFee: number;
  fulfillmentFee: number;
  firstMile: number;
  otherFee: number;
  totalFee: number;
  totalCost: number;
  netProfit: number;
  profitMargin: number;
  costRate: number;
  feeRate: number;
  refundRate: number;
}

interface CompareMetric {
  label: string;
  value: number;
  previous: number;
  lastYear: number;
  format: "usd" | "rmb" | "percent" | "number";
  icon: ComponentType<{ className?: string }>;
  tone: "blue" | "green" | "orange" | "slate" | "red";
  sub: string;
}

interface RankRow {
  sku: string;
  name: string;
  value: number;
  subValue: number;
  helper: string;
}

interface ExceptionRow {
  id: string;
  priority: Priority;
  sku: string;
  name: string;
  issue: string;
  metric: string;
  action: string;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return toNumber(record.value ?? record.text ?? record.number ?? record.name);
  }
  return 0;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(",");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return text(record.text ?? record.value ?? record.name ?? "");
  }
  return "";
}

function firstNumber(row: Record<string, unknown>, fields: string[], fallback = 0): number {
  for (const field of fields) {
    const value = toNumber(row[field]);
    if (value !== 0) return value;
  }
  return fallback;
}

function parseDateMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const normalized = value.includes("/") ? value.replace(/\//g, "-") : value;
    const parsed = Date.parse(normalized.length <= 10 ? `${normalized}T00:00:00+08:00` : normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function dayKey(dateMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(dateMs));
}

function formatUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000) return `$${(value / 10000).toFixed(1)}万`;
  if (abs >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function formatRmb(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000) return `¥${(value / 10000).toFixed(1)}万`;
  if (abs >= 1000) return `¥${(value / 1000).toFixed(1)}k`;
  return `¥${value.toFixed(0)}`;
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return `${Math.round(value)}`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0.0%";
  return `${(value * 100).toFixed(1)}%`;
}

function formatMetric(value: number, format: CompareMetric["format"]): string {
  if (format === "usd") return formatUsd(value);
  if (format === "rmb") return formatRmb(value);
  if (format === "percent") return formatPercent(value);
  return formatNumber(value);
}

function delta(current: number, base: number): number | undefined {
  if (!Number.isFinite(base) || base === 0) return undefined;
  return (current - base) / Math.abs(base);
}

function skuName(sku: SkuData | undefined): string {
  return text(sku?.中文品名 ?? sku?.商品名称) || "-";
}

function skuPurchasePriceRmb(sku: SkuData | undefined): number {
  return firstNumber((sku ?? {}) as Record<string, unknown>, ["单品采购价_RMB", "采购价"]);
}

function normalizeSale(row: SalesData, skuMap: Map<string, SkuData>): SaleMetric | undefined {
  const sku = text(row.SKU).toUpperCase();
  const dateMs = parseDateMs(row.日期);
  if (!sku || !dateMs) return undefined;

  const skuSnapshot = skuMap.get(sku);
  const quantity = firstNumber(row as Record<string, unknown>, ["售出数量"], 1);
  const rate = firstNumber(row as Record<string, unknown>, ["USD_CNY汇率"], FALLBACK_USD_CNY_RATE);
  const grossSales = firstNumber(row as Record<string, unknown>, ["销售额_USD", "销售额"]);
  const refund = firstNumber(row as Record<string, unknown>, ["退款金额_USD", "退款金额"]);
  const netSales = firstNumber(row as Record<string, unknown>, ["净销售额_USD"], grossSales - refund);
  const purchaseCostRmb = firstNumber(
    row as Record<string, unknown>,
    ["采购成本_RMB", "商品成本"],
    skuPurchasePriceRmb(skuSnapshot) * quantity,
  );
  const purchaseCost = firstNumber(
    row as Record<string, unknown>,
    ["采购成本_USD"],
    rate > 0 ? purchaseCostRmb / rate : 0,
  );
  const orderFee = firstNumber(row as Record<string, unknown>, ["订单手续费_USD", "订单手续费", "eBay费用"]);
  const fulfillmentFee = firstNumber(row as Record<string, unknown>, ["橙联履约费_USD", "橙联履约费"]);
  const firstMile = firstNumber(
    row as Record<string, unknown>,
    ["头程费用_USD"],
    rate > 0 ? (quantity * FIRST_MILE_RMB_PER_ITEM) / rate : 0,
  );
  const otherFee = firstNumber(row as Record<string, unknown>, ["其他费用_USD"]);
  const totalFee = firstNumber(row as Record<string, unknown>, ["总费用_USD"], orderFee + fulfillmentFee + firstMile + otherFee);
  const totalCost = firstNumber(row as Record<string, unknown>, ["总成本_USD"], purchaseCost + totalFee);
  const netProfit = firstNumber(row as Record<string, unknown>, ["净利润_USD"], netSales - totalCost);

  return {
    store: text(row.店铺) || "未知店铺",
    sku,
    productName: text(row.商品名称) || skuName(skuSnapshot),
    dateMs,
    day: dayKey(dateMs),
    quantity,
    grossSales,
    refund,
    netSales,
    purchaseCost,
    orderFee,
    fulfillmentFee,
    firstMile,
    otherFee,
    totalFee,
    totalCost,
    netProfit,
  };
}

function emptySummary(): Summary {
  return {
    orders: 0,
    quantity: 0,
    activeSkus: 0,
    grossSales: 0,
    refund: 0,
    netSales: 0,
    purchaseCost: 0,
    orderFee: 0,
    fulfillmentFee: 0,
    firstMile: 0,
    otherFee: 0,
    totalFee: 0,
    totalCost: 0,
    netProfit: 0,
    profitMargin: 0,
    costRate: 0,
    feeRate: 0,
    refundRate: 0,
  };
}

function summarizeSales(sales: SaleMetric[]): Summary {
  const activeSkus = new Set<string>();
  const summary = sales.reduce((acc, sale) => {
    activeSkus.add(sale.sku);
    acc.orders += 1;
    acc.quantity += sale.quantity;
    acc.grossSales += sale.grossSales;
    acc.refund += sale.refund;
    acc.netSales += sale.netSales;
    acc.purchaseCost += sale.purchaseCost;
    acc.orderFee += sale.orderFee;
    acc.fulfillmentFee += sale.fulfillmentFee;
    acc.firstMile += sale.firstMile;
    acc.otherFee += sale.otherFee;
    acc.totalFee += sale.totalFee;
    acc.totalCost += sale.totalCost;
    acc.netProfit += sale.netProfit;
    return acc;
  }, emptySummary());

  summary.activeSkus = activeSkus.size;
  summary.profitMargin = summary.netSales > 0 ? summary.netProfit / summary.netSales : 0;
  summary.costRate = summary.netSales > 0 ? summary.totalCost / summary.netSales : 0;
  summary.feeRate = summary.netSales > 0 ? summary.totalFee / summary.netSales : 0;
  summary.refundRate = summary.grossSales > 0 ? summary.refund / summary.grossSales : 0;
  return summary;
}

function inRange(sale: SaleMetric, start: number, end: number): boolean {
  return sale.dateMs >= start && sale.dateMs <= end;
}

function addDays(dateMs: number, days: number): number {
  return dateMs + days * 24 * 60 * 60 * 1000;
}

export default function DashboardPage() {
  const [skus, setSkus] = useState<SkuData[]>([]);
  const [issues, setIssues] = useState<IssueData[]>([]);
  const [sales, setSales] = useState<SalesData[]>([]);
  const [inTransitQuantity, setInTransitQuantity] = useState(0);
  const [sellableQuantity, setSellableQuantity] = useState(0);
  const [loading, setLoading] = useState(true);
  const [periodDays, setPeriodDays] = useState<PeriodDays>(30);
  const [fallbackNow] = useState(() => Date.now());

  useEffect(() => {
    Promise.all([
      fetch("/api/lark?table=sku&limit=500").then((r) => r.json()),
      fetch("/api/lark?table=summary&limit=500").then((r) => r.json()),
      fetch("/api/lark?table=strategy&limit=500").then((r) => r.json()),
      fetch("/api/lark?table=issues&limit=500").then((r) => r.json()),
      fetch("/api/lark?table=sales&limit=1000").then((r) => r.json()),
      fetch("/api/inventory-flow/data?resource=details").then((r) => r.json()),
    ])
      .then(([skuResult, summaryResult, strategyResult, issueResult, salesResult, detailResult]) => {
        if (skuResult.success && summaryResult.success && strategyResult.success && detailResult.success) {
          const summaryBySku = new Map((summaryResult.data || []).map((row: SkuData) => [row.SKU, row]));
          const strategyBySku = new Map((strategyResult.data || []).map((row: SkuData) => [row.SKU, row]));
          const inventoryDetails = (detailResult.data || [])
            .map(normalizeInventoryDetailForSummary)
            .filter((detail: ReturnType<typeof normalizeInventoryDetailForSummary>): detail is NonNullable<typeof detail> => Boolean(detail));
          const inTransitBySku = new Map(
            summarizeInTransitInventoryBySku(inventoryDetails).map((item) => [item.SKU, item.quantity]),
          );
          const sellableBySku = new Map(
            summarizeInventoryQuantityByState(inventoryDetails, "橙联可售").map((item) => [item.SKU, item.quantity]),
          );

          setInTransitQuantity(sumInTransitInventoryQuantity(inventoryDetails));
          setSellableQuantity(sumInventoryQuantityByState(inventoryDetails, "橙联可售"));
          setSkus((skuResult.data || [])
            .filter((row: SkuData) => row.SKU && (row.中文品名 || row.商品名称))
            .map((row: SkuData) => {
              const sku = row.SKU || "";
              return {
                ...row,
                ...(summaryBySku.get(row.SKU) || {}),
                ...(strategyBySku.get(row.SKU) || {}),
                橙联在途: inTransitBySku.get(sku) || 0,
                橙联可售: sellableBySku.get(sku) || 0,
              };
            }));
        } else {
          toast.error("SKU 或库存数据加载失败");
        }

        if (issueResult.success) setIssues(issueResult.data || []);
        if (salesResult.success) setSales(salesResult.data || []);
      })
      .catch(() => toast.error("数据加载失败"))
      .finally(() => setLoading(false));
  }, []);

  const skuMap = useMemo(() => new Map(skus.map((sku) => [text(sku.SKU).toUpperCase(), sku])), [skus]);
  const normalizedSales = useMemo(() => sales
    .map((row) => normalizeSale(row, skuMap))
    .filter((sale): sale is SaleMetric => Boolean(sale)), [sales, skuMap]);
  const activeStores = useMemo(() => STORES.filter((store) => store.active), []);

  const anchorDate = useMemo(() => {
    const maxDate = normalizedSales.reduce((max, sale) => Math.max(max, sale.dateMs), 0);
    return maxDate || fallbackNow;
  }, [normalizedSales, fallbackNow]);
  const periodEnd = anchorDate;
  const currentStart = addDays(periodEnd, -(periodDays - 1));
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -(periodDays - 1));
  const lastYearStart = Date.parse(`${dayKey(currentStart).slice(0, 4)}-01-01T00:00:00+08:00`) > 0
    ? addDays(currentStart, -365)
    : 0;
  const lastYearEnd = addDays(periodEnd, -365);

  const currentSales = useMemo(() => normalizedSales.filter((sale) => inRange(sale, currentStart, periodEnd)), [normalizedSales, currentStart, periodEnd]);
  const previousSales = useMemo(() => normalizedSales.filter((sale) => inRange(sale, previousStart, previousEnd)), [normalizedSales, previousStart, previousEnd]);
  const lastYearSales = useMemo(() => normalizedSales.filter((sale) => inRange(sale, lastYearStart, lastYearEnd)), [normalizedSales, lastYearStart, lastYearEnd]);
  const currentSummary = useMemo(() => summarizeSales(currentSales), [currentSales]);
  const previousSummary = useMemo(() => summarizeSales(previousSales), [previousSales]);
  const lastYearSummary = useMemo(() => summarizeSales(lastYearSales), [lastYearSales]);

  const inventory = useMemo(() => {
    const local = skus.reduce((sum, sku) => sum + toNumber(sku.本地库存), 0);
    const domesticHub = skus.reduce((sum, sku) => sum + toNumber(sku.国内集货仓), 0);
    const sellable = sellableQuantity;
    const inTransit = inTransitQuantity;
    const totalUnits = local + domesticHub + sellable + inTransit;
    const valueRmb = skus.reduce((sum, sku) => {
      const units = toNumber(sku.本地库存) + toNumber(sku.国内集货仓) + toNumber(sku.橙联可售) + toNumber(sku.橙联在途);
      return sum + units * skuPurchasePriceRmb(sku);
    }, 0);
    return { local, domesticHub, sellable, inTransit, totalUnits, valueRmb };
  }, [skus, sellableQuantity, inTransitQuantity]);

  const lowStock = useMemo(() => skus
    .filter((sku) => {
      const available = toNumber(sku.橙联可售) || toNumber(sku.总可用库存);
      const safety = toNumber(sku.安全库存);
      const status = text(sku.库存预警状态);
      return status.includes("缺货") || status.includes("低于") || available === 0 || (safety > 0 && available <= safety);
    })
    .sort((a, b) => (toNumber(a.橙联可售) || toNumber(a.总可用库存)) - (toNumber(b.橙联可售) || toNumber(b.总可用库存))), [skus]);

  const stagnantSkus = useMemo(() => skus
    .filter((sku) => {
      const status = text(sku.滞销状态);
      const days = toNumber(sku.无销售天数);
      const stock = toNumber(sku.橙联可售) + toNumber(sku.本地库存) + toNumber(sku.国内集货仓);
      return stock > 0 && (status.includes("滞销") || status.includes("关注") || days >= 30);
    })
    .sort((a, b) => toNumber(b.无销售天数) - toNumber(a.无销售天数)), [skus]);

  const skuSalesRows = useMemo(() => {
    const map = new Map<string, SaleMetric[]>();
    currentSales.forEach((sale) => {
      const rows = map.get(sale.sku) || [];
      rows.push(sale);
      map.set(sale.sku, rows);
    });

    return Array.from(map.entries()).map(([sku, rows]) => ({
      sku,
      snapshot: skuMap.get(sku),
      summary: summarizeSales(rows),
      name: skuName(skuMap.get(sku)) || rows[0]?.productName || "-",
    }));
  }, [currentSales, skuMap]);

  const bestSellers = useMemo<RankRow[]>(() => skuSalesRows
    .map((row) => ({
      sku: row.sku,
      name: row.name,
      value: row.summary.quantity,
      subValue: row.summary.netSales,
      helper: `${formatUsd(row.summary.netSales)} · ${formatPercent(row.summary.profitMargin)}`,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10), [skuSalesRows]);

  const profitRanking = useMemo<RankRow[]>(() => skuSalesRows
    .map((row) => ({
      sku: row.sku,
      name: row.name,
      value: row.summary.netProfit,
      subValue: row.summary.profitMargin,
      helper: `${formatPercent(row.summary.profitMargin)} · ${row.summary.quantity}件`,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10), [skuSalesRows]);

  const profitExceptions = useMemo(() => skuSalesRows
    .filter((row) => row.summary.netSales > 0 && (row.summary.netProfit < 0 || row.summary.profitMargin < 0.12 || row.summary.feeRate > 0.45))
    .sort((a, b) => a.summary.netProfit - b.summary.netProfit), [skuSalesRows]);

  const exceptions = useMemo<ExceptionRow[]>(() => {
    const rows: ExceptionRow[] = [];

    profitExceptions.slice(0, 14).forEach((row) => {
      rows.push({
        id: `profit-${row.sku}`,
        priority: row.summary.netProfit < 0 ? "P0" : "P1",
        sku: row.sku,
        name: row.name,
        issue: row.summary.netProfit < 0 ? "负利润" : row.summary.feeRate > 0.45 ? "费用率过高" : "利润率偏低",
        metric: `${formatUsd(row.summary.netProfit)} · ${formatPercent(row.summary.profitMargin)}`,
        action: "复核售价、订单手续费与履约费",
      });
    });

    lowStock.slice(0, 12).forEach((sku) => {
      const available = toNumber(sku.橙联可售) || toNumber(sku.总可用库存);
      rows.push({
        id: `stock-${text(sku.SKU)}`,
        priority: available <= 0 ? "P0" : "P1",
        sku: text(sku.SKU),
        name: skuName(sku),
        issue: available <= 0 ? "缺货" : "低于安全库存",
        metric: `${available}件可售`,
        action: "确认补货、调拨或暂停推广",
      });
    });

    stagnantSkus.slice(0, 10).forEach((sku) => {
      rows.push({
        id: `stagnant-${text(sku.SKU)}`,
        priority: toNumber(sku.无销售天数) >= 60 ? "P1" : "P2",
        sku: text(sku.SKU),
        name: skuName(sku),
        issue: text(sku.滞销状态) || "滞销风险",
        metric: `${toNumber(sku.无销售天数) || "--"}天无销售`,
        action: "评估降价、组合销售或清仓",
      });
    });

    issues
      .filter((issue) => issue.优先级 === "高" || issue.状态 === "待处理")
      .slice(0, 8)
      .forEach((issue, index) => {
        rows.push({
          id: `issue-${index}-${text(issue.SKU)}`,
          priority: issue.优先级 === "高" ? "P1" : "P2",
          sku: text(issue.SKU) || "-",
          name: text(issue.异常类型) || "售后异常",
          issue: text(issue.店铺) || "售后待处理",
          metric: text(issue.状态) || "未关闭",
          action: "客服闭环并回写原因",
        });
      });

    return rows.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]).slice(0, 28);
  }, [profitExceptions, lowStock, stagnantSkus, issues]);

  const trendData = useMemo(() => {
    const days = new Map<string, Summary>();
    for (let cursor = currentStart; cursor <= periodEnd; cursor = addDays(cursor, 1)) {
      days.set(dayKey(cursor), emptySummary());
    }
    currentSales.forEach((sale) => {
      const summary = days.get(sale.day) || emptySummary();
      days.set(sale.day, summarizeSales([...Array(summary.orders).fill(null).map(() => sale).slice(0, 0), sale]));
    });

    const grouped = new Map<string, SaleMetric[]>();
    currentSales.forEach((sale) => {
      const rows = grouped.get(sale.day) || [];
      rows.push(sale);
      grouped.set(sale.day, rows);
    });

    return Array.from(days.keys()).map((day) => {
      const summary = summarizeSales(grouped.get(day) || []);
      return {
        day: day.slice(5),
        收入: Math.round(summary.netSales),
        利润: Math.round(summary.netProfit),
        成本: Math.round(summary.totalCost),
        订单: summary.orders,
      };
    });
  }, [currentSales, currentStart, periodEnd]);

  const costData = useMemo(() => [
    { name: "采购成本", value: currentSummary.purchaseCost },
    { name: "订单手续费", value: currentSummary.orderFee },
    { name: "橙联履约", value: currentSummary.fulfillmentFee },
    { name: "头程", value: currentSummary.firstMile },
    { name: "其他", value: currentSummary.otherFee },
  ].filter((item) => item.value > 0), [currentSummary]);

  const storeData = useMemo(() => {
    const map = new Map<string, SaleMetric[]>();
    currentSales.forEach((sale) => {
      const rows = map.get(sale.store) || [];
      rows.push(sale);
      map.set(sale.store, rows);
    });
    return Array.from(map.entries()).map(([store, rows]) => {
      const summary = summarizeSales(rows);
      return {
        store,
        收入: Math.round(summary.netSales),
        利润: Math.round(summary.netProfit),
        利润率: summary.profitMargin,
      };
    });
  }, [currentSales]);

  const inventoryData = useMemo(() => [
    { name: "橙联可售", value: inventory.sellable, color: "#059669" },
    { name: "橙联在途", value: inventory.inTransit, color: "#2563eb" },
    { name: "国内集货仓", value: inventory.domesticHub, color: "#f59e0b" },
    { name: "本地库存", value: inventory.local, color: "#64748b" },
  ], [inventory]);

  const metrics = useMemo<CompareMetric[]>(() => [
    {
      label: "销售收入",
      value: currentSummary.netSales,
      previous: previousSummary.netSales,
      lastYear: lastYearSummary.netSales,
      format: "usd",
      icon: ShoppingBag,
      tone: "blue",
      sub: `${currentSummary.orders} 单 · ${currentSummary.quantity} 件`,
    },
    {
      label: "净利润",
      value: currentSummary.netProfit,
      previous: previousSummary.netProfit,
      lastYear: lastYearSummary.netProfit,
      format: "usd",
      icon: DollarSign,
      tone: currentSummary.netProfit < 0 ? "red" : "green",
      sub: `利润率 ${formatPercent(currentSummary.profitMargin)}`,
    },
    {
      label: "总成本",
      value: currentSummary.totalCost,
      previous: previousSummary.totalCost,
      lastYear: lastYearSummary.totalCost,
      format: "usd",
      icon: WalletCards,
      tone: "orange",
      sub: `成本率 ${formatPercent(currentSummary.costRate)}`,
    },
    {
      label: "库存货值",
      value: inventory.valueRmb,
      previous: inventory.valueRmb,
      lastYear: inventory.valueRmb,
      format: "rmb",
      icon: Boxes,
      tone: "slate",
      sub: `${inventory.totalUnits} 件 · 可售 ${inventory.sellable}`,
    },
    {
      label: "费用率",
      value: currentSummary.feeRate,
      previous: previousSummary.feeRate,
      lastYear: lastYearSummary.feeRate,
      format: "percent",
      icon: LineChart,
      tone: currentSummary.feeRate > 0.45 ? "red" : "slate",
      sub: `总费用 ${formatUsd(currentSummary.totalFee)}`,
    },
    {
      label: "异常 SKU",
      value: exceptions.length,
      previous: 0,
      lastYear: 0,
      format: "number",
      icon: AlertTriangle,
      tone: exceptions.length > 0 ? "red" : "green",
      sub: `${lowStock.length} 库存 · ${profitExceptions.length} 利润`,
    },
  ], [currentSummary, previousSummary, lastYearSummary, inventory, exceptions.length, lowStock.length, profitExceptions.length]);

  if (loading) {
    return (
      <div className="app-page">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((item) => <Skeleton key={item} className="h-32" />)}
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_0.55fr]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="app-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-kicker">Business Overview</p>
          <h1 className="page-title">全店铺经营总览</h1>
          <p className="page-description">
            全部店铺 · {periodDays} 天 · 截止 {dayKey(periodEnd)} · SKU {skus.length} · 销售记录 {currentSummary.orders}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((days) => (
            <Button
              key={days}
              type="button"
              variant={periodDays === days ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriodDays(days)}
            >
              近{days}天
            </Button>
          ))}
          {activeStores.map((store) => (
            <Link
              key={store.id}
              href={`/store/${store.id}`}
              className={`inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium shadow-sm transition-colors ${STORE_LINK_STYLES[store.id] || STORE_LINK_STYLES.SP}`}
              title={`进入 ${store.name} 店铺看板`}
            >
              {store.name}
            </Link>
          ))}
          <Button type="button" variant="outline" size="icon-sm" onClick={() => window.location.reload()} aria-label="刷新仪表盘">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_0.55fr]">
        <Card className="border-slate-200 bg-white">
          <CardHeader className="pb-0">
            <CardTitle className="text-base">收入、利润、成本趋势</CardTitle>
            <CardDescription className="text-xs">所有店铺合计，按日汇总</CardDescription>
          </CardHeader>
          <CardContent>
            {currentSales.length === 0 ? (
              <EmptyPanel text="暂无销售趋势数据" />
            ) : (
              <ResponsiveContainer width="100%" height={330}>
                <AreaChart data={trendData} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="day" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => `$${Number(value).toFixed(0)}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="收入" stroke="#2563eb" fill="url(#revenueFill)" strokeWidth={2.5} />
                  <Area type="monotone" dataKey="利润" stroke="#059669" fill="url(#profitFill)" strokeWidth={2.5} />
                  <Area type="monotone" dataKey="成本" stroke="#f97316" fill="transparent" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white">
          <CardHeader className="pb-0">
            <CardTitle className="text-base">成本构成</CardTitle>
            <CardDescription className="text-xs">费用含平台费与广告投入</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {costData.length === 0 ? (
              <EmptyPanel text="暂无成本数据" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={costData} cx="50%" cy="50%" innerRadius={46} outerRadius={74} dataKey="value">
                      {costData.map((_, index) => <Cell key={index} fill={COST_COLORS[index % COST_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value) => [formatUsd(Number(value)), "金额"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2.5">
                  {costData.map((item, index) => (
                    <CostRow key={item.name} item={item} total={Math.max(currentSummary.totalCost, 1)} color={COST_COLORS[index % COST_COLORS.length]} />
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-0">
            <CardTitle className="text-base">店铺贡献</CardTitle>
            <CardDescription className="text-xs">按当前周期汇总收入与利润</CardDescription>
          </CardHeader>
          <CardContent>
            {storeData.length === 0 ? (
              <EmptyPanel text="暂无店铺销售数据" />
            ) : (
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={storeData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="store" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value, name) => name === "利润率" ? formatPercent(Number(value)) : formatUsd(Number(value))} />
                  <Bar dataKey="收入" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="利润" fill="#059669" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-base">库存结构</CardTitle>
            <CardDescription className="text-xs">数量与货值合计</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">总库存货值</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{formatRmb(inventory.valueRmb)}</p>
              <p className="mt-1 text-xs text-slate-500">总库存 {inventory.totalUnits} 件 · 可售 {inventory.sellable} 件</p>
            </div>
            <div className="space-y-3">
              {inventoryData.map((item) => (
                <InventoryRow key={item.name} item={item} total={Math.max(inventory.totalUnits, 1)} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <RankingCard title="畅销品 TOP10" rows={bestSellers} valueLabel="销量" formatValue={(value) => `${formatNumber(value)}件`} />
        <RankingCard title="滞销品 TOP10" rows={stagnantSkus.slice(0, 10).map((sku) => ({
          sku: text(sku.SKU),
          name: skuName(sku),
          value: toNumber(sku.无销售天数),
          subValue: toNumber(sku.橙联可售) + toNumber(sku.本地库存),
          helper: `库存 ${formatNumber(toNumber(sku.橙联可售) + toNumber(sku.本地库存))}件`,
        }))} valueLabel="天数" formatValue={(value) => `${formatNumber(value)}天`} />
        <RankingCard title="利润排行榜" rows={profitRanking} valueLabel="利润" formatValue={formatUsd} positive />
        <RankingCard title="利润异常" rows={profitExceptions.slice(0, 10).map((row) => ({
          sku: row.sku,
          name: row.name,
          value: row.summary.netProfit,
          subValue: row.summary.profitMargin,
          helper: `${formatPercent(row.summary.profitMargin)} · 费用率${formatPercent(row.summary.feeRate)}`,
        }))} valueLabel="利润" formatValue={formatUsd} />
      </div>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-base">经营异常清单</CardTitle>
          <CardDescription className="text-xs">负利润、高费用率、低库存、滞销与售后高风险</CardDescription>
        </CardHeader>
        <CardContent>
          {exceptions.length === 0 ? (
            <div className="py-12 text-center">
              <CircleCheckBig className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
              <p className="text-sm font-medium text-slate-700">当前没有高优先级异常</p>
              <p className="text-xs text-slate-400">继续关注利润率、费用率和库存安全线</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[62rem] w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">优先级</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium">异常</th>
                    <th className="px-3 py-2 font-medium text-right">指标</th>
                    <th className="px-3 py-2 font-medium">建议动作</th>
                  </tr>
                </thead>
                <tbody>
                  {exceptions.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-orange-50/40">
                      <td className="px-3 py-2"><PriorityBadge priority={row.priority} /></td>
                      <td className="px-3 py-2">
                        <p className="font-mono font-semibold text-slate-900">{row.sku}</p>
                        <p className="max-w-[18rem] truncate text-[11px] text-slate-500">{row.name}</p>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{row.issue}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-900">{row.metric}</td>
                      <td className="px-3 py-2 text-slate-700">{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ metric }: { metric: CompareMetric }) {
  const Icon = metric.icon;
  const colors = {
    blue: "text-blue-700 bg-blue-50 border-blue-100",
    green: "text-emerald-700 bg-emerald-50 border-emerald-100",
    orange: "text-orange-700 bg-orange-50 border-orange-100",
    slate: "text-slate-700 bg-slate-50 border-slate-100",
    red: "text-red-700 bg-red-50 border-red-100",
  }[metric.tone];

  return (
    <Card className="border-slate-200 bg-white">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-slate-500">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{formatMetric(metric.value, metric.format)}</p>
          </div>
          <div className={`rounded-xl border p-2 ${colors}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">{metric.sub}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <DeltaPill label="环比" value={delta(metric.value, metric.previous)} />
          <DeltaPill label="同比" value={delta(metric.value, metric.lastYear)} muted={metric.lastYear === 0} />
        </div>
      </CardContent>
    </Card>
  );
}

function DeltaPill({ label, value, muted = false }: { label: string; value: number | undefined; muted?: boolean }) {
  if (muted || value === undefined) {
    return <div className="rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-400">{label} 暂无</div>;
  }
  const positive = value >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <div className={positive ? "flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700" : "flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700"}>
      <Icon className="h-3 w-3" />
      {label} {positive ? "+" : ""}{formatPercent(value)}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-slate-900">{label}</p>
      {payload.map((item) => (
        <p key={item.name} className="text-slate-600">
          {item.name}: <span className="font-medium text-slate-900">{item.name === "订单" ? formatNumber(Number(item.value)) : formatUsd(Number(item.value))}</span>
        </p>
      ))}
    </div>
  );
}

function CostRow({ item, total, color }: { item: { name: string; value: number }; total: number; color: string }) {
  const pct = item.value / total;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-600">{item.name}</span>
        <span className="font-medium text-slate-900">{formatUsd(item.value)} · {formatPercent(pct)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full" style={{ width: `${Math.max(pct * 100, item.value > 0 ? 4 : 0)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function InventoryRow({ item, total }: { item: { name: string; value: number; color: string }; total: number }) {
  const pct = item.value / total;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-600">{item.name}</span>
        <span className="font-medium text-slate-900">{formatNumber(item.value)}件</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full" style={{ width: `${Math.max(pct * 100, item.value > 0 ? 4 : 0)}%`, backgroundColor: item.color }} />
      </div>
    </div>
  );
}

function RankingCard({
  title,
  rows,
  valueLabel,
  formatValue,
  positive = false,
}: {
  title: string;
  rows: RankRow[];
  valueLabel: string;
  formatValue: (value: number) => string;
  positive?: boolean;
}) {
  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-xs">{valueLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyPanel text="暂无数据" />
        ) : (
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div key={`${title}-${row.sku}`} className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-2.5 py-2">
                <span className="text-xs font-medium text-slate-400">{index + 1}</span>
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs font-semibold text-slate-900">{row.sku}</p>
                  <p className="truncate text-[11px] text-slate-500">{row.name}</p>
                </div>
                <div className="text-right">
                  <p className={positive ? "text-sm font-semibold text-emerald-600" : row.value < 0 ? "text-sm font-semibold text-red-600" : "text-sm font-semibold text-slate-900"}>
                    {formatValue(row.value)}
                  </p>
                  <p className="text-[11px] text-slate-400">{row.helper}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const className = {
    P0: "border-red-200 bg-red-50 text-red-700",
    P1: "border-amber-200 bg-amber-50 text-amber-700",
    P2: "border-slate-200 bg-slate-50 text-slate-600",
  }[priority];

  return <span className={`inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-semibold ${className}`}>{priority}</span>;
}

function EmptyPanel({ text: message }: { text: string }) {
  return (
    <div className="py-10 text-center">
      <PackageSearch className="mx-auto mb-3 h-7 w-7 text-slate-300" />
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}
