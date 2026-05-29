"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { callAIStructured } from "@/lib/ai";
import { INVENTORY_SYSTEM_PROMPT, buildInventoryUserMessage } from "@/lib/prompts";
import { toast } from "sonner";

// ============================================================
// 📦 库存监控与智能补货 — 飞书真实数据版
// ============================================================

// 从飞书读取的原始记录格式
interface LarkSkuRecord {
  recordId: string;
  SKU?: string;
  中文品名?: string;
  英文标题关键词?: string;
  类目?: string;
  采购价?: number;
  建议售价?: number;
  头程成本件?: number;
  橙联可售?: number;
  橙联在途?: number;
  本地库存?: number;
  近7日日均销量?: number;
  可售天数?: string;
  安全库存?: number;
  补货点?: number;
  补货周期天数?: number;
  SKU状态?: string;
  补货状态?: string;
  负责人?: string;
  供应商?: string;
  预估毛利率?: number;
  风险标签?: string;
  广告费率?: number;
  [key: string]: unknown;
}

// AI 分析用的精简结构
interface SkuForAI {
  sku: string;
  productName: string;
  available: number;
  inTransit: number;
  local: number;
  dailySales: number;
  salesTrend: string;
  replenishCycle: number;
  profitMargin: number;
  safetyStock: number;
  cost: number;
  category: string;
  status: string;
}

interface AIAnalysisResult {
  analysis: Array<{
    sku: string;
    productName: string;
    currentStock: { available: number; inTransit: number; local: number };
    dailySales: number;
    salesTrend: string;
    trendExplanation: string;
    daysUntilStockout: number;
    suggestedOrderQty: number;
    suggestedOrderDate: string;
    priority: string;
    priorityReason: string;
    riskNote: string;
    aiSummary: string;
  }>;
  summary: {
    urgentCount: number;
    warningCount: number;
    normalCount: number;
    overallAdvice: string;
  };
}

export default function InventoryPage() {
  const [skus, setSkus] = useState<SkuForAI[]>([]);
  const [skusLoading, setSkusLoading] = useState(true);
  const [skusError, setSkusError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);

  // 页面加载时从飞书读取 SKU 数据
  const fetchSkus = useCallback(async () => {
    setSkusLoading(true);
    setSkusError("");
    try {
      const res = await fetch("/api/lark?table=sku&limit=200");
      const json = await res.json();
      if (!json.success) {
        setSkusError(json.error || "读取飞书数据失败");
        return;
      }

      // 转换为 AI 分析的输入格式
      const converted = (json.data as LarkSkuRecord[])
        .filter((r) => r.SKU && r.中文品名) // 至少要有 SKU 和品名
        .map((r) => ({
          sku: r.SKU || "",
          productName: r.中文品名 || "",
          available: r.橙联可售 || 0,
          inTransit: r.橙联在途 || 0,
          local: r.本地库存 || 0,
          dailySales: r.近7日日均销量 || 0,
          salesTrend: "尚无销售数据",
          replenishCycle: r.补货周期天数 || 30,
          profitMargin: r.预估毛利率 || 0,
          safetyStock: r.安全库存 || 0,
          cost: r.采购价 || 0,
          category: r.类目 || "未分类",
          status: Array.isArray(r.SKU状态) ? r.SKU状态[0] : (r.SKU状态 || "未知"),
        }));

      setSkus(converted);
      toast.success(`已加载 ${converted.length} 个 SKU`, {
        description: `数据来源：飞书多维表格 01_SKU主数据`,
      });
    } catch {
      setSkusError("网络请求失败");
    } finally {
      setSkusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkus();
  }, [fetchSkus]);

  // 运行 AI 补货分析
  const runAnalysis = async () => {
    if (skus.length === 0) {
      toast.error("请先加载 SKU 数据");
      return;
    }

    setAnalyzing(true);
    const userMessage = buildInventoryUserMessage(skus);
    const result = await callAIStructured<AIAnalysisResult>({
      systemPrompt: INVENTORY_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 8192,
    });

    if (result.success && result.data) {
      setAnalysis(result.data);
      toast.success(`分析完成，${result.data.summary.urgentCount}个紧急补货`, {
        description: `Token 用量: ${result.tokensUsed}，分析了 ${skus.length} 个 SKU`,
      });
    } else {
      toast.error("AI分析失败", { description: result.error });
    }
    setAnalyzing(false);
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
      case "urgent": return "🔴 紧急";
      case "this_week": return "🟡 本周";
      case "this_month": return "🟢 本月";
      default: return "⚪ 正常";
    }
  };

  // 统计各状态的 SKU 数量
  const statusCounts = skus.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  const totalInTransit = skus.reduce((sum, s) => sum + s.inTransit, 0);
  const totalLocal = skus.reduce((sum, s) => sum + s.local, 0);
  const totalAvailable = skus.reduce((sum, s) => sum + s.available, 0);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📦 库存监控与智能补货</h1>
          <p className="text-gray-500 mt-1">
            实时读取飞书多维表格 · AI预测断货时间 · 智能补货建议
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={fetchSkus} disabled={skusLoading}>
            {skusLoading ? "⏳ 加载中..." : "🔄 刷新数据"}
          </Button>
          <Button onClick={runAnalysis} disabled={analyzing || skus.length === 0} size="lg">
            {analyzing ? "⏳ AI 分析中..." : "🚀 运行 AI 补货分析"}
          </Button>
        </div>
      </div>

      {/* SKU 加载错误 */}
      {skusError && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="p-4 text-red-700">
            <p className="font-medium">飞书数据读取失败</p>
            <p className="text-sm mt-1">{skusError}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={fetchSkus}>
              重试
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 数据概览卡片 */}
      {!skusLoading && skus.length > 0 && (
        <div className="grid grid-cols-6 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-gray-400">总 SKU</p>
              <p className="text-2xl font-bold">{skus.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-gray-400">橙联可售</p>
              <p className="text-2xl font-bold text-green-600">{totalAvailable}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-gray-400">橙联在途</p>
              <p className="text-2xl font-bold text-blue-600">{totalInTransit}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-gray-400">本地库存</p>
              <p className="text-2xl font-bold text-orange-600">{totalLocal}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-gray-400">橙联在途</p>
              <p className="text-2xl font-bold text-blue-600">
                {statusCounts["橙联在途"] || 0}
                <span className="text-xs font-normal text-gray-400 ml-1">个SKU</span>
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-gray-400">待清点</p>
              <p className="text-2xl font-bold text-yellow-600">
                {statusCounts["待清点"] || 0}
                <span className="text-xs font-normal text-gray-400 ml-1">个SKU</span>
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 加载骨架 */}
      {skusLoading && (
        <div className="grid grid-cols-6 gap-3">
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
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">🔴 紧急补货</p>
              <p className="text-3xl font-bold text-red-600">{analysis.summary.urgentCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">🟡 需关注</p>
              <p className="text-3xl font-bold text-yellow-600">{analysis.summary.warningCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">🟢 库存正常</p>
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
                    <div className="flex items-center justify-between">
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
                    <div className="grid grid-cols-6 gap-4 mb-3">
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
                        <span className="text-xs font-medium text-red-500 whitespace-nowrap mt-0.5">⚠️ 风险：</span>
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
            <p className="text-5xl mb-4">📦</p>
            <p className="text-gray-500 text-lg mb-2">尚未加载 SKU 数据</p>
            <p className="text-gray-400 text-sm mb-4">
              请先在飞书多维表格的「01_SKU主数据」中录入商品信息
            </p>
            <Button onClick={fetchSkus}>🔄 重新加载</Button>
          </CardContent>
        </Card>
      )}

      {!analysis && !analyzing && !skusLoading && skus.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-5xl mb-4">🤖</p>
            <p className="text-gray-500 text-lg mb-2">
              已加载 <span className="font-bold text-gray-900">{skus.length}</span> 个 SKU，共{" "}
              <span className="font-bold text-blue-600">{totalInTransit}</span> 件在途
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
