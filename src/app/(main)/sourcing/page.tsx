"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { callAIStructured } from "@/lib/ai";
import { SOURCING_SYSTEM_PROMPT, buildSourcingUserMessage } from "@/lib/prompts";
import { toast } from "sonner";
import { ScanSearch } from "lucide-react";

// ============================================================
// 选品助手
// ============================================================

interface SourcingAIResult {
  researchStatus: "blocked" | "verified";
  researchNotice: string;
  opportunityScore: number;
  fitmentAnalysis: string;
  usMarketShareAnalysis: string;
  diyAssessment: string;
  ebayFeasibility: string;
  ebaySalesEvidence: {
    period: string;
    averageSellingPrice: number;
    salesActivity: string;
    evidenceSummary: string;
  };
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
    maxPurchasePriceRmb: number;
  };
  riskFlags: string[];
  recommendation: string;
  operationsStrategy: string;
  suggestedKeywords: string[];
  competitorReferences: string[];
  sources: Array<{
    title: string;
    url: string;
    accessedAt: string;
    summary: string;
  }>;
}

const SCORE_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-red-100 text-red-700",
};

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeSourcingResult(value: Partial<SourcingAIResult>): SourcingAIResult {
  const sales: Partial<SourcingAIResult["ebaySalesEvidence"]> = value.ebaySalesEvidence || {};
  const profit: Partial<SourcingAIResult["profitEstimate"]> = value.profitEstimate || {};
  return {
    researchStatus: value.researchStatus === "verified" ? "verified" : "blocked",
    researchNotice: value.researchNotice || "联网证据不足，请缩小关键词范围后重试。",
    opportunityScore: toNumber(value.opportunityScore),
    fitmentAnalysis: value.fitmentAnalysis || "",
    usMarketShareAnalysis: value.usMarketShareAnalysis || "",
    diyAssessment: value.diyAssessment || "",
    ebayFeasibility: value.ebayFeasibility || "",
    ebaySalesEvidence: {
      period: sales.period || "缺少可核验时间范围",
      averageSellingPrice: toNumber(sales.averageSellingPrice),
      salesActivity: sales.salesActivity || "",
      evidenceSummary: sales.evidenceSummary || "",
    },
    marketAnalysis: value.marketAnalysis || "",
    competitionAnalysis: value.competitionAnalysis || "",
    profitEstimate: {
      estimatedCost: toNumber(profit.estimatedCost),
      suggestedPrice: toNumber(profit.suggestedPrice),
      ebayFees: toNumber(profit.ebayFees),
      shippingFees: toNumber(profit.shippingFees),
      adBudget: toNumber(profit.adBudget),
      netProfit: toNumber(profit.netProfit),
      profitRate: toNumber(profit.profitRate),
      maxPurchasePriceRmb: toNumber(profit.maxPurchasePriceRmb),
    },
    riskFlags: toStringArray(value.riskFlags),
    recommendation: value.recommendation || "",
    operationsStrategy: value.operationsStrategy || "",
    suggestedKeywords: toStringArray(value.suggestedKeywords),
    competitorReferences: toStringArray(value.competitorReferences),
    sources: Array.isArray(value.sources)
      ? value.sources.filter((source) => source && source.url).map((source) => ({
          title: source.title || source.url,
          url: source.url,
          accessedAt: source.accessedAt || "",
          summary: source.summary || "",
        }))
      : [],
  };
}

function getScoreColor(score: number): string {
  if (score >= 7) return SCORE_COLORS.high;
  if (score >= 4) return SCORE_COLORS.medium;
  return SCORE_COLORS.low;
}

function getScoreLabel(score: number): string {
  if (score >= 8) return "强烈推荐";
  if (score >= 6) return "值得尝试";
  if (score >= 4) return "谨慎评估";
  return "不推荐";
}

export default function SourcingPage() {
  const [category, setCategory] = useState("");
  const [oemCode, setOemCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SourcingAIResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/ai/search-status")
      .then((response) => response.json())
      .then((data) => setSearchEnabled(data.configured === true))
      .catch(() => setSearchEnabled(false));
  }, []);

  const runAnalysis = async () => {
    const normalizedOemCode = oemCode.trim();
    if (!normalizedOemCode) {
      toast.error("请输入 OEM 码");
      return;
    }

    setLoading(true);
    const userMessage = buildSourcingUserMessage({
      category: category.trim(),
      oemCode: normalizedOemCode,
    });

    const aiResult = await callAIStructured<SourcingAIResult>({
      systemPrompt: SOURCING_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 4096,
      researchMode: "sourcing",
      researchInput: {
        category: category.trim(),
        oemCode: normalizedOemCode,
      },
    });

    if (aiResult.success && aiResult.data) {
      const normalizedResult = normalizeSourcingResult(aiResult.data);
      setResult(normalizedResult);
      toast.success("选品分析完成", {
        description: `机会评分: ${normalizedResult.opportunityScore}/10`,
      });
    } else {
      toast.error("AI 分析失败", { description: aiResult.error });
    }
    setLoading(false);
  };

  // 保存到飞书 16_选品池
  const saveToFeishu = async () => {
    if (!result) { toast.error("请先运行 AI 分析"); return; }
    if (result.researchStatus !== "verified") {
      toast.error("缺少联网核验数据，不能保存为正式选品结论");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/lark/save-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "sourcing",
          fields: {
            品类关键词: `${category.trim() || "未分类"} — OEM: ${oemCode.trim()}`,
            机会评分: result.opportunityScore,
            预估利润率: result.profitEstimate.profitRate,
            预估采购价: result.profitEstimate.estimatedCost,
            建议售价: result.profitEstimate.suggestedPrice,
            AI分析摘要: `${result.recommendation}\n\n${result.operationsStrategy}`,
            竞品链接: result.competitorReferences.join("\n"),
            状态: "待评估",
            生成时间: new Date().toISOString().slice(0, 10).replace(/-/g, "/"),
          },
        }),
      });
      const json = await res.json();
      if (json.success) toast.success("已保存到飞书 16_选品池");
      else toast.error("保存失败", { description: json.error });
    } catch {
      toast.error("保存失败，网络错误");
    }
    setSaving(false);
  };

  return (
    <div className="app-page max-w-6xl">
      <div>
        <p className="page-kicker">Product Research</p>
        <h1 className="page-title">选品助手</h1>
        <p className="page-description">美区汽摩配及工业品选品研究：适配、市场、eBay 动销、利润红线和运营策略</p>
      </div>

      <Card className={searchEnabled ? "border-green-200 bg-green-50" : "border-amber-300 bg-amber-50"}>
        <CardContent className="p-4">
          <p className={`text-sm font-semibold ${searchEnabled ? "text-green-700" : "text-amber-800"}`}>
            {searchEnabled ? "Tavily 实时网页检索已接入" : "Tavily 实时网页检索待配置"}
          </p>
          <p className={`text-sm mt-1 ${searchEnabled ? "text-green-700" : "text-amber-700"}`}>
            {searchEnabled
              ? "分析时会以 OEM 码为主要检索依据，自动核验适配、美国市场、eBay 动销、平台政策和成本风险来源，再交给 DeepSeek V4 Pro 生成报告。"
              : "请在本地环境中配置 TAVILY_API_KEY。未配置前，系统不会生成未经联网核验的市场结论。"}
          </p>
        </CardContent>
      </Card>

      {/* 输入行 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <label className="text-sm text-gray-500 mb-1 block">品类（选填）</label>
              <Input
                placeholder="如 Brake Pads / 制动片"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
            <div className="flex-[2]">
              <label className="text-sm text-gray-500 mb-1 block">OEM 码 *</label>
              <Input
                placeholder="如 04465-0E010"
                value={oemCode}
                onChange={(e) => setOemCode(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={runAnalysis} disabled={loading} className="whitespace-nowrap">
                {loading ? "分析中..." : "AI 分析"}
              </Button>
              {result?.researchStatus === "verified" && (
                <Button variant="outline" onClick={saveToFeishu} disabled={saving} className="whitespace-nowrap">
                  {saving ? "保存中..." : "保存到飞书"}
                </Button>
              )}
            </div>
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
          <Card className={result.researchStatus === "verified" ? "border-green-200" : "border-amber-300 bg-amber-50"}>
            <CardContent className="p-5">
              <p className={`text-sm font-semibold ${result.researchStatus === "verified" ? "text-green-700" : "text-amber-800"}`}>
                {result.researchStatus === "verified" ? "已完成实时联网核验" : "需要接入联网搜索服务"}
              </p>
              <p className="text-sm text-gray-700 mt-1 leading-relaxed">{result.researchNotice}</p>
            </CardContent>
          </Card>

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

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* 利润估算 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">利润估算</CardTitle>
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
                  { label: "最高进价红线", value: `¥${result.profitEstimate.maxPurchasePriceRmb.toFixed(2)}`, highlight: true },
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
            <Card className="lg:col-span-2">
              <CardContent className="p-5 space-y-4">
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">市场分析</p>
                  <p className="text-sm text-gray-700">{result.marketAnalysis}</p>
                </div>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">竞争分析</p>
                  <p className="text-sm text-gray-700">{result.competitionAnalysis}</p>
                </div>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-2">风险提示</p>
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">六步选品研究</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: "1. 适配车型 / 设备", value: result.fitmentAnalysis },
                { label: "1. 美国市场份额与保有量", value: result.usMarketShareAnalysis },
                { label: "2. 易损件属性与 DIY 评估", value: result.diyAssessment },
                { label: "3. eBay 销售可行性", value: result.ebayFeasibility },
                { label: "4. eBay 近 3 个月真实销售", value: `${result.ebaySalesEvidence.period}\nASP: $${result.ebaySalesEvidence.averageSellingPrice.toFixed(2)}\n${result.ebaySalesEvidence.salesActivity}\n${result.ebaySalesEvidence.evidenceSummary}` },
                { label: "6. 综合运营策略", value: result.operationsStrategy },
              ].map((section) => (
                <div key={section.label}>
                  <p className="text-sm font-medium text-gray-500 mb-1">{section.label}</p>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{section.value}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* 综合建议 */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-500 mb-1">综合建议</p>
                <p className="text-sm text-gray-700 leading-relaxed">{result.recommendation}</p>
              </div>
              <Separator />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">建议关键词</p>
                  <div className="flex flex-wrap gap-1">
                    {result.suggestedKeywords.map((kw, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{kw}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">参考竞品</p>
                  <ul className="space-y-0.5">
                    {result.competitorReferences.map((ref, i) => (
                      <li key={i} className="text-sm text-blue-600 truncate">{ref}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <Separator />
              <div>
                <p className="text-sm font-medium text-gray-500 mb-1">联网证据来源</p>
                {result.sources.length > 0 ? (
                  <ul className="space-y-1">
                    {result.sources.map((source, i) => (
                      <li key={`${source.url}-${i}`} className="text-sm">
                        <a href={source.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                          {source.title}
                        </a>
                        <span className="text-gray-400 ml-2">{source.accessedAt}</span>
                        <p className="text-gray-600">{source.summary}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-amber-700">暂无可核验的实时来源。</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 空状态 */}
      {!result && !loading && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <ScanSearch className="mx-auto mb-4 h-9 w-9 text-slate-300" />
            <p className="text-gray-500 text-lg mb-2">输入 OEM 码开始选品分析</p>
            <p className="text-gray-400 text-sm">
              系统主要依据 OEM 码进行检索，品类仅作为辅助参考。<br />
              分析必须基于可核验的最新联网数据。<br />
              当前未接入搜索服务时，系统会明确提示无法完成实时研究。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
