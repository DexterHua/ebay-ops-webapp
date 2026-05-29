"use client";

import { useState, useEffect } from "react";
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
// 📦 库存监控与智能补货页 — 第一优先开发
// ============================================================

// 模拟数据（实际应从飞书多维表格读取）
const MOCK_SKUS = [
  { sku: "PH-01A", productName: "iPhone 16 Pro Case 硅胶款", available: 15, inTransit: 200, local: 50, dailySales: 5.2, salesTrend: "rising", replenishCycle: 25, profitMargin: 0.45, safetyStock: 30 },
  { sku: "CH-03B", productName: "USB-C Fast Charging Cable 2M", available: 8, inTransit: 0, local: 20, dailySales: 3.1, salesTrend: "stable", replenishCycle: 20, profitMargin: 0.55, safetyStock: 20 },
  { sku: "TR-07C", productName: "Travel Neck Pillow Memory Foam", available: 32, inTransit: 100, local: 0, dailySales: 8.0, salesTrend: "stable", replenishCycle: 20, profitMargin: 0.38, safetyStock: 40 },
  { sku: "PH-09D", productName: "Screen Protector iPhone 16 (3-Pack)", available: 120, inTransit: 0, local: 200, dailySales: 10.5, salesTrend: "rising", replenishCycle: 15, profitMargin: 0.65, safetyStock: 80 },
  { sku: "CA-12E", productName: "Car Phone Mount Dashboard", available: 3, inTransit: 50, local: 0, dailySales: 2.0, salesTrend: "declining", replenishCycle: 30, profitMargin: 0.30, safetyStock: 15 },
];

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
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    const userMessage = buildInventoryUserMessage(MOCK_SKUS);
    const result = await callAIStructured<AIAnalysisResult>({
      systemPrompt: INVENTORY_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 4096,
    });

    if (result.success && result.data) {
      setAnalysis(result.data);
      toast.success(`分析完成，${result.data.summary.urgentCount}个紧急补货`, {
        description: `Token 用量: ${result.tokensUsed}`,
      });
    } else {
      toast.error("AI分析失败", { description: result.error });
    }
    setLoading(false);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent": return "destructive";
      case "this_week": return "default";
      case "this_month": return "secondary";
      default: return "outline";
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

  return (
    <div className="space-y-6 max-w-6xl">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📦 库存监控与智能补货</h1>
          <p className="text-gray-500 mt-1">实时监控橙联库存，AI预测断货时间，给出补货建议</p>
        </div>
        <Button onClick={runAnalysis} disabled={loading} size="lg">
          {loading ? "⏳ AI 分析中..." : "🚀 运行 AI 补货分析"}
        </Button>
      </div>

      {/* 摘要卡片 */}
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
          <Card className="col-span-1">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 leading-relaxed">{analysis.summary.overallAdvice}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 加载骨架 */}
      {loading && (
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
      {analysis && !loading && (
        <ScrollArea className="h-[calc(100vh-340px)]">
          <div className="space-y-4 pr-4">
            {analysis.analysis
              .sort((a, b) => {
                const order = { urgent: 0, this_week: 1, this_month: 2, normal: 3 };
                return (order[a.priority as keyof typeof order] || 3) - (order[b.priority as keyof typeof order] || 3);
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
                      <Badge variant={getPriorityColor(item.priority) as "destructive" | "default" | "secondary" | "outline"}>
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
      {!analysis && !loading && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <p className="text-5xl mb-4">📦</p>
            <p className="text-gray-500 text-lg mb-2">尚未运行库存分析</p>
            <p className="text-gray-400 text-sm">
              点击「运行 AI 补货分析」，AI 将从多维表格读取库存数据，<br />
              结合销售趋势给出智能补货建议
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
