"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callAIStructured } from "@/lib/ai";
import { REVIEWS_SYSTEM_PROMPT, buildReviewsUserMessage } from "@/lib/prompts";
import { toast } from "sonner";

// ============================================================
// 📝 评论回复生成器 v2 — 飞书联动 + 消息推送
// ============================================================

interface IssueFromLark {
  recordId: string;
  SKU?: string;
  异常类型?: string;
  问题描述?: string | string[];
  订单号?: string;
  店铺?: string;
  优先级?: string;
  状态?: string;
  责任人?: string;
  描述?: string;
  处理动作?: string | string[];
  备注?: string;
  [key: string]: unknown;
}

interface ReplyAIResult {
  reply: string;
  tone: string;
  keyPoints: string[];
  followupAction: string | null;
  internalNote: string;
}

const TONE_EMOJI: Record<string, string> = {
  "感谢": "🙏",
  "解释": "💬",
  "道歉补救": "🔧",
};

const PRIORITY_COLORS: Record<string, string> = {
  "高": "bg-red-100 text-red-700",
  "中": "bg-yellow-100 text-yellow-700",
  "低": "bg-blue-100 text-blue-700",
};

const RATING_FROM_TYPE: Record<string, number> = {
  "差评风险": 1,
  "纠纷Case": 1,
  "退款": 2,
  "退货": 2,
  "取消请求": 3,
  "商品质量": 2,
  "买家消息": 4,
  "物流异常": 3,
  "账号风险": 3,
};

export default function ReviewsPage() {
  // 飞书待处理列表
  const [issues, setIssues] = useState<IssueFromLark[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(true);
  const [selectedIssue, setSelectedIssue] = useState<IssueFromLark | null>(null);

  // 表单
  const [reviewContent, setReviewContent] = useState("");
  const [rating, setRating] = useState("5");
  const [buyerName, setBuyerName] = useState("");
  const [productName, setProductName] = useState("");
  const [language, setLanguage] = useState("en");

  // AI 生成
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReplyAIResult | null>(null);
  const [saving, setSaving] = useState(false);

  // 加载飞书待处理售后
  const loadIssues = async () => {
    try {
      const res = await fetch("/api/lark?table=issues&limit=200");
      const json = await res.json();
      if (json.success) {
        setIssues(json.data as IssueFromLark[]);
      } else {
        toast.error("飞书数据加载失败");
      }
    } catch {
      toast.error("网络请求失败");
    }
    setIssuesLoading(false);
  };

  const refreshIssues = () => {
    setIssuesLoading(true);
    void loadIssues();
  };

  useEffect(() => {
    const timer = setTimeout(() => { void loadIssues(); }, 0);
    return () => clearTimeout(timer);
  }, []);

  // 筛选待处理项
  const pendingIssues = useMemo(() => {
    return issues.filter((i) => {
      const status = Array.isArray(i.状态) ? i.状态[0] : (i.状态 || "");
      const type = i.异常类型 || "";
      return (status === "待办" || status === "进行中") &&
        ["买家消息", "差评风险", "纠纷Case", "退货", "退款", "取消请求"].includes(type);
    });
  }, [issues]);

  const urgentIssues = pendingIssues.filter((i) => i.优先级 === "高");
  const normalIssues = pendingIssues.filter((i) => i.优先级 !== "高");

  // 点击飞书待处理项 → 自动填表
  const selectIssue = (issue: IssueFromLark) => {
    setSelectedIssue(issue);
    setReviewContent(issue.描述 || "");
    setProductName(issue.SKU || "");
    setBuyerName("");
    const type = issue.异常类型 || "";
    setRating(String(RATING_FROM_TYPE[type] || 4));
    setLanguage("en");
    setResult(null);
    toast.success(`已加载: ${issue.SKU} · ${issue.异常类型}`);
  };

  // 手动清空表单
  const clearForm = () => {
    setSelectedIssue(null);
    setReviewContent("");
    setProductName("");
    setBuyerName("");
    setRating("5");
    setResult(null);
  };

  // AI 生成回复
  const generateReply = async () => {
    if (!reviewContent || !productName) {
      toast.error("请至少填写评价内容和产品名称（可从左侧飞书待办加载）");
      return;
    }
    setLoading(true);
    const aiResult = await callAIStructured<ReplyAIResult>({
      systemPrompt: REVIEWS_SYSTEM_PROMPT,
      userMessage: buildReviewsUserMessage({
        content: reviewContent,
        rating: parseInt(rating),
        buyerName: buyerName || "Buyer",
        productName,
        language: language === "en" ? "English" : "zh",
      }),
      maxTokens: 2048,
    });

    if (aiResult.success && aiResult.data) {
      setResult(aiResult.data);
      toast.success(`回复草稿生成 · ${aiResult.data.tone}`);
    } else {
      toast.error("AI 生成失败", { description: aiResult.error });
    }
    setLoading(false);
  };

  // 保存到飞书
  const saveToFeishu = async () => {
    if (!result || !selectedIssue) {
      toast.error("请先选择飞书待办项并生成回复");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/lark/save-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: selectedIssue.recordId,
          replyText: result.reply,
          issueType: selectedIssue.异常类型,
          priority: selectedIssue.优先级,
          sku: selectedIssue.SKU,
          orderNo: selectedIssue.订单号,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.pushSent
          ? "已保存 + 已推送管理人审核"
          : "已保存到飞书");
        refreshIssues(); // 刷新列表
      } else {
        toast.error("保存失败", { description: json.error });
      }
    } catch {
      toast.error("保存失败");
    }
    setSaving(false);
  };

  const ratingColor = (r: number) => {
    if (r >= 4) return "bg-green-100 text-green-700";
    if (r >= 3) return "bg-yellow-100 text-yellow-700";
    return "bg-red-100 text-red-700";
  };

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📝 评论回复生成器</h1>
          <p className="text-gray-500 mt-1">
            从飞书读取待处理售后 → AI 生成回复 → 保存回写
            {pendingIssues.length > 0 && <span className="ml-2 text-orange-500 font-medium">{pendingIssues.length} 条待处理</span>}
          </p>
        </div>
        <Button variant="outline" onClick={refreshIssues} disabled={issuesLoading}>
          {issuesLoading ? "⏳" : "🔄"} 刷新
        </Button>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* ====== 左侧：飞书待处理列表 ====== */}
        <Card className="col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              飞书待处理
              {issuesLoading && <Skeleton className="h-4 w-8" />}
            </CardTitle>
            <CardDescription className="text-xs">08_客服售后异常 · 待办/进行中</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {issuesLoading ? (
              <div className="p-3 space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : pendingIssues.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">
                <p className="text-2xl mb-2">✅</p>
                <p>暂无待处理项</p>
                <p className="text-xs mt-1">可以手动填写表单生成回复</p>
              </div>
            ) : (
              <ScrollArea className="max-h-[calc(100vh-260px)]">
                {/* 高优先级 */}
                {urgentIssues.length > 0 && (
                  <div>
                    <p className="px-3 py-1.5 text-xs font-medium text-red-500 bg-red-50">⚠️ 高优先级</p>
                    {urgentIssues.map((issue) => issueCard(issue, true))}
                  </div>
                )}
                {normalIssues.map((issue) => issueCard(issue, false))}
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* ====== 中间：输入表单 ====== */}
        <Card className="col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              回复草稿
              {selectedIssue && (
                <Button variant="ghost" size="sm" className="h-6 text-xs text-gray-400" onClick={clearForm}>
                  清空
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedIssue && (
              <div className="bg-blue-50 rounded p-2.5 text-xs space-y-1">
                <div className="flex items-center gap-1.5">
                  <Badge variant="default" className="text-[10px]">{selectedIssue.SKU}</Badge>
                  <Badge variant="outline" className="text-[10px]">{selectedIssue.异常类型}</Badge>
                  {selectedIssue.优先级 && (
                    <Badge className={`text-[10px] ${PRIORITY_COLORS[selectedIssue.优先级] || ""}`}>{selectedIssue.优先级}</Badge>
                  )}
                </div>
                {selectedIssue.订单号 && <p className="text-gray-600">订单: {selectedIssue.订单号}</p>}
              </div>
            )}

            <div>
              <label className="text-xs text-gray-400 mb-1 block">评分</label>
              <Select value={rating} onValueChange={(v) => setRating(v || "5")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[5, 4, 3, 2, 1].map((r) => (
                    <SelectItem key={r} value={String(r)}>{"⭐".repeat(r)} {r}星</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input placeholder="买家名称" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className="text-sm" />
            <Input placeholder="SKU / 产品名称 *" value={productName} onChange={(e) => setProductName(e.target.value)} className="text-sm" />

            <div>
              <label className="text-xs text-gray-400 mb-1 block">回复语言</label>
              <Select value={language} onValueChange={(v) => setLanguage(v || "en")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English — 英文</SelectItem>
                  <SelectItem value="de">Deutsch — 德文</SelectItem>
                  <SelectItem value="zh">中文</SelectItem>
                  <SelectItem value="auto">自动匹配买家语言</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Textarea
              placeholder="买家消息 / 评价内容 *"
              value={reviewContent}
              onChange={(e) => setReviewContent(e.target.value)}
              rows={5}
              className="text-sm"
            />

            <div className="flex gap-2">
              <Button onClick={generateReply} disabled={loading} className="flex-1">
                {loading ? "⏳ AI 生成中..." : "💬 生成回复"}
              </Button>
              {result && selectedIssue && (
                <Button variant="outline" onClick={saveToFeishu} disabled={saving}>
                  {saving ? "💾..." : "💾 保存"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ====== 右侧：AI 回复结果 ====== */}
        <Card className="col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">AI 回复草稿</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}

            {result && !loading && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge className={ratingColor(parseInt(rating))}>⭐ {rating} 星</Badge>
                  <Badge variant="secondary">{TONE_EMOJI[result.tone] || ""} {result.tone}</Badge>
                  {selectedIssue?.优先级 === "高" && (
                    <Badge className="bg-red-100 text-red-700 text-xs">⚠️ 需管理人审核</Badge>
                  )}
                </div>

                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <p className="text-gray-900 whitespace-pre-wrap leading-relaxed text-sm">{result.reply}</p>
                </div>

                {result.keyPoints.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1.5">回复要点</p>
                    <ul className="space-y-1">
                      {result.keyPoints.map((point, i) => (
                        <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                          <span className="text-green-500">✓</span> {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.followupAction && (
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                    <p className="text-xs font-medium text-blue-700 mb-0.5">📋 后续行动</p>
                    <p className="text-xs text-blue-600">{result.followupAction}</p>
                  </div>
                )}

                {result.internalNote && (
                  <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-100">
                    <p className="text-xs font-medium text-yellow-700 mb-0.5">🔒 内部备注</p>
                    <p className="text-xs text-yellow-600">{result.internalNote}</p>
                  </div>
                )}
              </div>
            )}

            {!result && !loading && (
              <div className="py-12 text-center text-gray-400">
                <p className="text-3xl mb-2">💬</p>
                <p className="text-sm">
                  {pendingIssues.length > 0
                    ? "从左侧选择一条待处理项，或手动填写表单后点击生成"
                    : "填写评价内容后点击生成回复草稿"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  // 子组件：待处理卡片
  function issueCard(issue: IssueFromLark, urgent: boolean) {
    const isActive = selectedIssue?.recordId === issue.recordId;
    return (
      <button
        key={issue.recordId}
        className={`w-full text-left px-3 py-2.5 border-b border-gray-50 transition-colors ${
          isActive ? "bg-blue-50 border-l-2 border-l-blue-500" : "hover:bg-gray-50"
        }`}
        onClick={() => selectIssue(issue)}
      >
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-xs font-medium text-gray-900 truncate">{issue.SKU || "?"}</span>
          <Badge variant={urgent ? "destructive" : "outline"} className="text-[10px] shrink-0">
            {issue.异常类型}
          </Badge>
          {issue.优先级 === "高" && <span className="text-[10px]">🔴</span>}
        </div>
        {issue.描述 && (
          <p className="text-xs text-gray-500 truncate">{issue.描述.slice(0, 60)}</p>
        )}
        {issue.订单号 && <p className="text-[10px] text-gray-400 mt-0.5">订单: {issue.订单号}</p>}
      </button>
    );
  }
}
