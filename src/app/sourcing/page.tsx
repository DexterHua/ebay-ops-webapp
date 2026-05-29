"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { callAIStructured } from "@/lib/ai";
import { SOURCING_SYSTEM_PROMPT, buildSourcingUserMessage } from "@/lib/prompts";
import { toast } from "sonner";

// ============================================================
// 🎯 选品助手
// ============================================================

interface SourcingAIResult {
  opportunityScore: number;
  marketAnalysis: string;
  competitionAnalysis: string;
  profitEstimate: {
    estimatedCost: number;
    suggestedPrice: number;
    ebayFees: number;
    shippingFees: number;
    adBudget: number;
    netProfit: number;
    profitRate: number;
  };
  riskFlags: string[];
  recommendation: string;
  suggestedKeywords: string[];
  competitorReferences: string[];
}

const SCORE_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-red-100 text-red-700",
};

function getScoreColor(score: number): string {
  if (score >= 7) return SCORE_COLORS.high;
  if (score >= 4) return SCORE_COLORS.medium;
  return SCORE_COLORS.low;
}

function getScoreLabel(score: number): string {
  if (score >= 8) return "🌟 强烈推荐";
  if (score >= 6) return "👍 值得尝试";
  if (score >= 4) return "🤔 谨慎评估";
  return "⚠️ 不推荐";
}

export default function SourcingPage() {
  const [category, setCategory] = useState("");
  const [keywords, setKeywords] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SourcingAIResult | null>(null);

  const runAnalysis = async () => {
    if (!keywords) {
      toast.error("请至少输入品类关键词");
      return;
    }

    setLoading(true);
    const userMessage = buildSourcingUserMessage({
      category: category || "待定",
      keywords,
      budgetMin: parseFloat(budgetMin) || undefined,
      budgetMax: parseFloat(budgetMax) || undefined,
    });

    const aiResult = await callAIStructured<SourcingAIResult>({
      systemPrompt: SOURCING_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 4096,
    });

    if (aiResult.success && aiResult.data) {
      setResult(aiResult.data);
      toast.success("选品分析完成", {
        description: `机会评分: ${aiResult.data.opportunityScore}/10`,
      });
    } else {
      toast.error("AI 分析失败", { description: aiResult.error });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">🎯 选品助手</h1>
        <p className="text-gray-500 mt-1">AI 分析品类机会，给出市场评分、利润预估和风险提示</p>
      </div>

      {/* 输入行 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-sm text-gray-500 mb-1 block">eBay 类目</label>
              <Input
                placeholder="如 Cell Phone Cases"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
            <div className="flex-[2]">
              <label className="text-sm text-gray-500 mb-1 block">品类关键词 *</label>
              <Input
                placeholder="如 iPhone 16 Pro Case Silicone"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="text-sm text-gray-500 mb-1 block">预算区间 (¥)</label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="最低"
                  type="number"
                  value={budgetMin}
                  onChange={(e) => setBudgetMin(e.target.value)}
                />
                <span className="text-gray-400">-</span>
                <Input
                  placeholder="最高"
                  type="number"
                  value={budgetMax}
                  onChange={(e) => setBudgetMax(e.target.value)}
                />
              </div>
            </div>
            <Button onClick={runAnalysis} disabled={loading} className="whitespace-nowrap">
              {loading ? "⏳ 分析中..." : "🔍 AI 分析"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 加载状态 */}
      {loading && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <Skeleton className="h-8 w-1/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      )}

      {/* 分析结果 */}
      {result && !loading && (
        <div className="space-y-4">
          {/* 评分卡 */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`text-4xl font-bold px-4 py-3 rounded-xl ${getScoreColor(result.opportunityScore)}`}>
                    {result.opportunityScore}
                    <span className="text-lg font-normal">/10</span>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-gray-900">{getScoreLabel(result.opportunityScore)}</p>
                    <p className="text-sm text-gray-500">品类机会评分</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-3 gap-4">
            {/* 利润估算 */}
            <Card className="col-span-1">
              <CardHeader>
                <CardTitle className="text-base">💰 利润估算</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { label: "预估采购价", value: `¥${result.profitEstimate.estimatedCost.toFixed(2)}` },
                  { label: "建议售价", value: `$${result.profitEstimate.suggestedPrice.toFixed(2)}` },
                  { label: "eBay 费用", value: `$${result.profitEstimate.ebayFees.toFixed(2)}` },
                  { label: "物流费(件)", value: `$${result.profitEstimate.shippingFees.toFixed(2)}` },
                  { label: "广告预算(件)", value: `$${result.profitEstimate.adBudget.toFixed(2)}` },
                  { label: "净利润(件)", value: `$${result.profitEstimate.netProfit.toFixed(2)}`, highlight: true },
                  { label: "净利润率", value: `${(result.profitEstimate.profitRate * 100).toFixed(1)}%`, highlight: true },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between text-sm">
                    <span className="text-gray-500">{row.label}</span>
                    <span className={row.highlight ? "font-bold text-green-600" : "text-gray-900"}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* 分析和风险 */}
            <Card className="col-span-2">
              <CardContent className="p-5 space-y-4">
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">📊 市场分析</p>
                  <p className="text-sm text-gray-700">{result.marketAnalysis}</p>
                </div>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">🏪 竞争分析</p>
                  <p className="text-sm text-gray-700">{result.competitionAnalysis}</p>
                </div>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-2">⚠️ 风险提示</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.riskFlags.map((flag, i) => (
                      <Badge key={i} variant="destructive" className="text-xs font-normal">
                        {flag}
                      </Badge>
                    ))}
                    {result.riskFlags.length === 0 && (
                      <span className="text-sm text-green-600">暂无明显风险</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 综合建议 */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-500 mb-1">💡 综合建议</p>
                <p className="text-sm text-gray-700 leading-relaxed">{result.recommendation}</p>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">🔑 建议关键词</p>
                  <div className="flex flex-wrap gap-1">
                    {result.suggestedKeywords.map((kw, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{kw}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">🔗 参考竞品</p>
                  <ul className="space-y-0.5">
                    {result.competitorReferences.map((ref, i) => (
                      <li key={i} className="text-sm text-blue-600 truncate">{ref}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 空状态 */}
      {!result && !loading && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <p className="text-5xl mb-4">🔍</p>
            <p className="text-gray-500 text-lg mb-2">输入品类关键词开始选品分析</p>
            <p className="text-gray-400 text-sm">
              AI 将分析市场需求、竞争格局、利润空间，<br />
              并给出机会评分和具体建议
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
