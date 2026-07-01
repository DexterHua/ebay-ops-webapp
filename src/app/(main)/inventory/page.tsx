"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { callAIStructured } from "@/lib/ai";
import {
  buildReplenishmentExcelHtml,
  buildReplenishmentExportRows,
  buildRuleBasedInventoryAnalysis,
  hydrateInventoryAnalysisFromSource,
  isRecoverableInventoryAiError,
  type InventoryAnalysisInput,
  type InventoryAnalysisResult,
} from "@/lib/inventory-analysis";
import {
  countInTransitInventorySkus,
  countUniqueInventorySkusByState,
  normalizeInventoryDetailForSummary,
  summarizeInventoryQuantityByState,
  summarizeInTransitInventoryBySku,
  sumInventoryQuantityByState,
  sumInTransitInventoryQuantity,
} from "@/lib/inventory-flow";
import { INVENTORY_SYSTEM_PROMPT, buildInventoryUserMessage } from "@/lib/prompts";
import { toast } from "sonner";
import { Download, PackageSearch, Sparkles } from "lucide-react";

// ============================================================
// 库存监控与智能补货 — 飞书真实数据版
// ============================================================

// 从飞书读取的原始记录格式
interface LarkSkuRecord {
  recordId: string;
  SKU?: string;
  中文品名?: string;
  英文标题关键词?: string;
  类目?: string | string[];
  采购价?: unknown;
  建议售价?: unknown;
  "头程成本|件"?: unknown;
  橙联可售?: unknown;
  橙联在途?: unknown;
  本地库存?: unknown;
  近7日日均销量?: unknown;
  "日均销量(自动)"?: unknown; // 公式字段：优先销售日报自动汇总，无数据用人工值
  可售天数?: string;          // 公式字段：自动计算
  安全库存?: unknown;
  补货点?: unknown;           // 公式字段：自动计算
  补货周期天数?: unknown;
  SKU状态?: string | string[];
  补货状态?: string;          // 公式字段：自动判定
  负责人?: string;
  供应商?: string | string[];
  预估毛利率?: unknown;       // 公式字段：自动计算
  预估毛利?: unknown;         // 公式字段：自动计算
  单件总成本?: unknown;       // 公式字段：自动计算
  总可用库存?: unknown;       // 公式字段：自动计算
  累计销量?: unknown;         // lookup：从07_销售日报自动汇总
  销售记录天数?: unknown;     // lookup：从07_销售日报自动计数
  风险标签?: string | string[];
  广告费率?: unknown;
  eBay费率?: unknown;
  "橙联履约预估|件"?: unknown;
  OEM?: string;
  "商品毛重（g）"?: unknown;
  "商品尺寸（含包装）（cm）"?: string;
  [key: string]: unknown;
}

function toLarkNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  if (typeof value === "string") {
    const normalized = value.trim().replace(/,/g, "");
    if (!normalized) return 0;

    const isPercentage = normalized.endsWith("%");
    const parsed = Number(isPercentage ? normalized.slice(0, -1) : normalized);
    if (!Number.isFinite(parsed)) return 0;
    return isPercentage ? parsed / 100 : parsed;
  }

  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + toLarkNumber(item), 0);
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "text", "number"]) {
      if (key in record) return toLarkNumber(record[key]);
    }
  }

  return 0;
}

const inventoryCountFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

// AI 分析用的精简结构
type SkuForAI = InventoryAnalysisInput;

export default function InventoryPage() {
  const [skus, setSkus] = useState<SkuForAI[]>([]);
  const [pendingCountingSkuCount, setPendingCountingSkuCount] = useState(0);
  const [inTransitSkuCount, setInTransitSkuCount] = useState(0);
  const [inTransitQuantity, setInTransitQuantity] = useState(0);
  const [sellableQuantity, setSellableQuantity] = useState(0);
  const [skusLoading, setSkusLoading] = useState(true);
  const [skusError, setSkusError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<InventoryAnalysisResult | null>(null);
  const [savingReplenish, setSavingReplenish] = useState(false);

  // 页面加载时组合读取 SKU 静态资料、库存策略与运营汇总。
  const fetchSkus = useCallback(async () => {
    try {
      const [skuRes, strategyRes, summaryRes, inventoryDetailRes] = await Promise.all([
        fetch("/api/lark?table=sku&limit=200"),
        fetch("/api/lark?table=strategy&limit=200"),
        fetch("/api/lark?table=summary&limit=200"),
        fetch("/api/inventory-flow/data?resource=details"),
      ]);
      const [skuJson, strategyJson, summaryJson, inventoryDetailJson] = await Promise.all([
        skuRes.json(),
        strategyRes.json(),
        summaryRes.json(),
        inventoryDetailRes.json(),
      ]);
      if (!skuJson.success || !strategyJson.success || !summaryJson.success || !inventoryDetailJson.success) {
        setSkusError(skuJson.error || strategyJson.error || summaryJson.error || inventoryDetailJson.error || "读取飞书数据失败");
        return;
      }

      const strategyBySku = new Map(
        (strategyJson.data as LarkSkuRecord[]).map((row) => [row.SKU, row]),
      );
      const summaryBySku = new Map(
        (summaryJson.data as LarkSkuRecord[]).map((row) => [row.SKU, row]),
      );
      const inventoryDetails = (inventoryDetailJson.data as Array<Record<string, unknown>>)
        .map(normalizeInventoryDetailForSummary)
        .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail));
      const inTransitBySku = new Map(
        summarizeInTransitInventoryBySku(inventoryDetails).map((item) => [item.SKU, item.quantity]),
      );
      const sellableBySku = new Map(
        summarizeInventoryQuantityByState(inventoryDetails, "橙联可售").map((item) => [item.SKU, item.quantity]),
      );
      const converted = (skuJson.data as LarkSkuRecord[])
        .filter((r) => r.SKU && r.中文品名) // 至少要有 SKU 和品名
        .map((r) => {
          const strategy = strategyBySku.get(r.SKU);
          const summary = summaryBySku.get(r.SKU);
          const dailySales = toLarkNumber(summary?.近7日日均销量);
          const totalSales = toLarkNumber(summary?.累计销量);
          const hasSalesData = totalSales > 0;
          return {
            sku: r.SKU || "",
            productName: r.中文品名 || "",
            available: sellableBySku.get(r.SKU || "") || 0,
            inTransit: inTransitBySku.get(r.SKU || "") || 0,
            local: toLarkNumber(summary?.本地库存),
            dailySales,
            salesTrend: hasSalesData ? "已有销售数据" : dailySales > 0 ? "人工估算" : "尚无销售数据",
            replenishCycle: toLarkNumber(strategy?.补货周期天数) || 30,
            profitMargin: toLarkNumber(r.预估毛利率),
            safetyStock: toLarkNumber(strategy?.安全库存),
            cost: toLarkNumber(r.采购价),
            category: Array.isArray(r.类目) ? r.类目[0] : (r.类目 || "未分类"),
            status: Array.isArray(r.SKU状态) ? r.SKU状态[0] : (r.SKU状态 || "未知"),
            totalSales,
            autoDailySales: dailySales,
          };
        });

      setSkus(converted);
      setPendingCountingSkuCount(countUniqueInventorySkusByState(inventoryDetails, "本地仓待清点"));
      setInTransitSkuCount(countInTransitInventorySkus(inventoryDetails));
      setInTransitQuantity(sumInTransitInventoryQuantity(inventoryDetails));
      setSellableQuantity(sumInventoryQuantityByState(inventoryDetails, "橙联可售"));
      toast.success(`已加载 ${converted.length} 个 SKU`, {
        description: "数据来源：01_SKU主数据 + 18_SKU库存策略 + 19_SKU运营汇总 + 22_SKU批次库存明细",
      });
    } catch {
      setSkusError("网络请求失败");
    } finally {
      setSkusLoading(false);
    }
  }, []);

  const refreshSkus = () => {
    setSkusLoading(true);
    setSkusError("");
    void fetchSkus();
  };

  useEffect(() => {
    const timer = setTimeout(() => { void fetchSkus(); }, 0);
    return () => clearTimeout(timer);
  }, [fetchSkus]);

  // 运行 AI 补货分析
  const runAnalysis = async () => {
    if (skus.length === 0) {
      toast.error("请先加载 SKU 数据");
      return;
    }

    setAnalyzing(true);
    const userMessage = buildInventoryUserMessage(skus);
    const result = await callAIStructured<InventoryAnalysisResult>({
      systemPrompt: INVENTORY_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 16384,
    });

    if (result.success && result.data) {
      const hydrated = hydrateInventoryAnalysisFromSource(result.data, skus);
      setAnalysis(hydrated);
      toast.success(`分析完成，${hydrated.summary.urgentCount}个紧急补货`, {
        description: `Token 用量: ${result.tokensUsed}，分析了 ${skus.length} 个 SKU`,
      });
    } else if (isRecoverableInventoryAiError(result.error)) {
      const fallback = buildRuleBasedInventoryAnalysis(skus);
      setAnalysis(fallback);
      toast.warning("AI 输出不完整，已使用智能规则完成分析", {
        description: `已分析 ${skus.length} 个 SKU，可先按结果执行补货判断`,
      });
    } else {
      toast.error("AI分析失败", { description: result.error });
    }
    setAnalyzing(false);
  };

  const exportReplenishmentExcel = () => {
    if (!analysis) {
      toast.error("请先运行 AI 补货分析");
      return;
    }

    const rows = buildReplenishmentExportRows(analysis);
    if (rows.length === 0) {
      toast.info("当前没有需要补货的商品");
      return;
    }

    const html = buildReplenishmentExcelHtml(rows);
    const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `需补货商品清单-${date}.xls`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success("Excel 已生成", { description: `已导出 ${rows.length} 条需补货商品` });
  };

  // 保存补货建议到飞书 10_补货采购建议
  const saveReplenishToFeishu = async () => {
    if (!analysis || analysis.analysis.length === 0) {
      toast.error("请先运行 AI 补货分析");
      return;
    }

    setSavingReplenish(true);
    const priorityMap: Record<string, string> = {
      urgent: "紧急", this_week: "本周", this_month: "本月", normal: "正常",
    };

    const items = analysis.analysis.map((a) => {
      const skuData = skus.find((s) => s.sku === a.sku);
      return {
        SKU: a.sku,
        商品名称: a.productName,
        橙联可售: a.currentStock.available,
        橙联在途: a.currentStock.inTransit,
        近7日日均销量: a.dailySales,
        补货点: String(skuData?.safetyStock || 0),
        建议采购量: a.suggestedOrderQty,
        预计断货日期: a.suggestedOrderDate === "N/A" ? "待定" : a.suggestedOrderDate,
        采购优先级: priorityMap[a.priority] || "正常",
        描述: a.aiSummary,
      };
    });

    try {
      const res = await fetch("/api/lark/save-replenish-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`已保存 ${json.written}/${json.total} 条补货建议到飞书`, {
          description: "写入表：10_补货采购建议",
        });
      } else {
        toast.error("保存失败", { description: json.error });
      }
    } catch {
      toast.error("保存失败，网络错误");
    }
    setSavingReplenish(false);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent": return "destructive" as const;
      case "this_week": return "default" as const;
      case "this_month": return "secondary" as const;
      default: return "outline" as const;
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case "urgent": return "紧急";
      case "this_week": return "本周";
      case "this_month": return "本月";
      default: return "正常";
    }
  };

  const totalInTransit = inTransitQuantity;
  const totalLocal = skus.reduce((sum, s) => sum + s.local, 0);
  const totalAvailable = sellableQuantity;

  return (
    <div className="app-page max-w-6xl">
      {/* 页面标题 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="page-kicker">Inventory Intelligence</p>
          <h1 className="page-title">库存监控与智能补货</h1>
          <p className="page-description">
            实时读取飞书多维表格 · AI预测断货时间 · 智能补货建议
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button variant="outline" onClick={refreshSkus} disabled={skusLoading}>
            {skusLoading ? "加载中..." : "刷新数据"}
          </Button>
          <Button onClick={runAnalysis} disabled={analyzing || skus.length === 0} size="lg">
            {analyzing ? "AI 分析中..." : "运行 AI 补货分析"}
          </Button>
          {analysis && analysis.analysis.length > 0 && (
            <>
              <Button
                variant="outline"
                onClick={exportReplenishmentExcel}
              >
                <Download className="h-4 w-4" />
                导出需补货清单
              </Button>
              <Button
                variant="outline"
                onClick={saveReplenishToFeishu}
                disabled={savingReplenish}
              >
                {savingReplenish ? "保存中..." : "保存补货建议到飞书"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* SKU 加载错误 */}
      {skusError && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="p-4 text-red-700">
            <p className="font-medium">飞书数据读取失败</p>
            <p className="text-sm mt-1">{skusError}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={refreshSkus}>
              重试
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 数据概览卡片 */}
      {!skusLoading && skus.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-gray-400">总 SKU</p>
              <p className="text-2xl font-bold">{skus.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-gray-400">橙联可售</p>
              <p className="text-2xl font-bold text-green-600">
                {inventoryCountFormatter.format(totalAvailable)}
                <span className="ml-1 text-xs font-normal text-gray-400">件</span>
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-gray-400">在途商品数量</p>
              <p className="text-2xl font-bold text-blue-600">
                {inventoryCountFormatter.format(totalInTransit)}
                <span className="ml-1 text-xs font-normal text-gray-400">件</span>
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-gray-400">本地库存</p>
              <p className="text-2xl font-bold text-orange-600">
                {inventoryCountFormatter.format(totalLocal)}
                <span className="ml-1 text-xs font-normal text-gray-400">件</span>
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-gray-400">在途 SKU</p>
              <p className="text-2xl font-bold text-blue-600">
                {inTransitSkuCount}
                <span className="text-xs font-normal text-gray-400 ml-1">个SKU</span>
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-gray-400">待清点 SKU</p>
              <p className="text-2xl font-bold text-yellow-600">
                {pendingCountingSkuCount}
                <span className="text-xs font-normal text-gray-400 ml-1">个SKU</span>
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 加载骨架 */}
      {skusLoading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardContent className="p-3">
                <Skeleton className="h-3 w-12 mx-auto mb-2" />
                <Skeleton className="h-8 w-16 mx-auto" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* AI 分析摘要 */}
      {analysis && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">紧急补货</p>
              <p className="text-3xl font-bold text-red-600">{analysis.summary.urgentCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">需关注</p>
              <p className="text-3xl font-bold text-yellow-600">{analysis.summary.warningCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">库存正常</p>
              <p className="text-3xl font-bold text-green-600">{analysis.summary.normalCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 leading-relaxed">{analysis.summary.overallAdvice}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 分析中骨架 */}
      {analyzing && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-2/3 mb-3" />
                <Skeleton className="h-3 w-full mb-2" />
                <Skeleton className="h-3 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 分析结果列表 */}
      {analysis && !analyzing && (
        <ScrollArea className="h-[calc(100vh-400px)]">
          <div className="space-y-4 pr-4">
            {analysis.analysis
              .sort((a, b) => {
                const order: Record<string, number> = { urgent: 0, this_week: 1, this_month: 2, normal: 3 };
                return (order[a.priority] || 3) - (order[b.priority] || 3);
              })
              .map((item) => (
                <Card key={item.sku} className={item.priority === "urgent" ? "border-red-300 bg-red-50/30" : ""}>
                  <CardHeader className="pb-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {item.productName}
                          <span className="text-sm text-gray-400 font-normal">{item.sku}</span>
                        </CardTitle>
                        <CardDescription>{item.trendExplanation}</CardDescription>
                      </div>
                      <Badge variant={getPriorityColor(item.priority)}>
                        {getPriorityLabel(item.priority)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
                      <div>
                        <p className="text-xs text-gray-400">橙联可售</p>
                        <p className="text-lg font-bold text-gray-900">{item.currentStock.available}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">在途</p>
                        <p className="text-lg font-bold text-blue-600">{item.currentStock.inTransit}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">日均销量</p>
                        <p className="text-lg font-bold text-gray-900">{item.dailySales}/天</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">预计断货</p>
                        <p className={`text-lg font-bold ${item.daysUntilStockout < 7 ? "text-red-600" : "text-gray-900"}`}>
                          {item.daysUntilStockout}天
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">建议采购</p>
                        <p className="text-lg font-bold text-green-600">{item.suggestedOrderQty}件</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">最晚下单</p>
                        <p className="text-lg font-bold text-orange-600">{item.suggestedOrderDate}</p>
                      </div>
                    </div>
                    <Separator className="my-3" />
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-medium text-gray-500 whitespace-nowrap mt-0.5">AI 分析：</span>
                      <p className="text-sm text-gray-700">{item.aiSummary}</p>
                    </div>
                    {item.riskNote && (
                      <div className="mt-2 flex items-start gap-2">
                        <span className="text-xs font-medium text-red-500 whitespace-nowrap mt-0.5">风险：</span>
                        <p className="text-sm text-red-600">{item.riskNote}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
          </div>
        </ScrollArea>
      )}

      {/* 空状态 */}
      {!analysis && !analyzing && !skusLoading && skus.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <PackageSearch className="mx-auto mb-4 h-9 w-9 text-slate-300" />
            <p className="text-gray-500 text-lg mb-2">尚未加载 SKU 数据</p>
            <p className="text-gray-400 text-sm mb-4">
              请先在飞书多维表格的「01_SKU主数据」中录入商品信息
            </p>
            <Button onClick={refreshSkus}>重新加载</Button>
          </CardContent>
        </Card>
      )}

      {!analysis && !analyzing && !skusLoading && skus.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Sparkles className="mx-auto mb-4 h-9 w-9 text-orange-400" />
            <p className="text-gray-500 text-lg mb-2">
              已加载 <span className="font-bold text-gray-900">{skus.length}</span> 个 SKU，共{" "}
              <span className="font-bold text-blue-600">{inventoryCountFormatter.format(totalInTransit)}</span> 件在途
            </p>
            <p className="text-gray-400 text-sm">
              点击「运行 AI 补货分析」，AI 将从飞书实时数据出发，<br />
              分析库存结构、预测断货风险、给出补货建议
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
