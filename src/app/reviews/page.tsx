"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { callAIStructured } from "@/lib/ai";
import { REVIEWS_SYSTEM_PROMPT, buildReviewsUserMessage } from "@/lib/prompts";
import { toast } from "sonner";

// ============================================================
// 📝 评论回复生成器
// ============================================================

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

const RATING_COLORS: Record<number, string> = {
  1: "bg-red-100 text-red-700",
  2: "bg-orange-100 text-orange-700",
  3: "bg-yellow-100 text-yellow-700",
  4: "bg-green-100 text-green-700",
  5: "bg-green-200 text-green-800",
};

export default function ReviewsPage() {
  const [reviewContent, setReviewContent] = useState("");
  const [rating, setRating] = useState("5");
  const [buyerName, setBuyerName] = useState("");
  const [productName, setProductName] = useState("");
  const [language, setLanguage] = useState("en");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReplyAIResult | null>(null);

  const generateReply = async () => {
    if (!reviewContent || !productName) {
      toast.error("请至少填写评价内容和产品名称");
      return;
    }

    setLoading(true);
    const userMessage = buildReviewsUserMessage({
      content: reviewContent,
      rating: parseInt(rating),
      buyerName: buyerName || "Buyer",
      productName,
      language: language === "en" ? "English" : language === "zh" ? "中文" : language,
    });

    const aiResult = await callAIStructured<ReplyAIResult>({
      systemPrompt: REVIEWS_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 2048,
    });

    if (aiResult.success && aiResult.data) {
      setResult(aiResult.data);
      toast.success("回复草稿生成完成");
    } else {
      toast.error("AI 生成失败", { description: aiResult.error });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">📝 评论回复生成器</h1>
        <p className="text-gray-500 mt-1">输入买家评价，AI 分析情感并生成专业回复草稿</p>
      </div>

      <div className="grid grid-cols-5 gap-6">
        {/* 左侧输入 */}
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle className="text-base">买家评价信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-sm text-gray-500 mb-1.5 block">评分</label>
              <Select value={rating} onValueChange={(v) => setRating(v || "5")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 4, 3, 2, 1].map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {"⭐".repeat(r)} {r}星
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input placeholder="买家名称" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
            <Input placeholder="产品名称 *" value={productName} onChange={(e) => setProductName(e.target.value)} />
            <div>
              <label className="text-sm text-gray-500 mb-1.5 block">回复语言</label>
              <Select value={language} onValueChange={(v) => setLanguage(v || "en")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English — 英文</SelectItem>
                  <SelectItem value="de">Deutsch — 德文</SelectItem>
                  <SelectItem value="zh">中文</SelectItem>
                  <SelectItem value="auto">自动匹配买家语言</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              placeholder="粘贴买家评价内容 *"
              value={reviewContent}
              onChange={(e) => setReviewContent(e.target.value)}
              rows={6}
            />
            <Button onClick={generateReply} disabled={loading} className="w-full">
              {loading ? "⏳ AI 生成中..." : "💬 生成回复草稿"}
            </Button>
          </CardContent>
        </Card>

        {/* 右侧结果 */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle className="text-base">回复草稿</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-20 w-full" />
              </div>
            )}

            {result && !loading && (
              <div className="space-y-4">
                {/* 语气标签 */}
                <div className="flex items-center gap-2">
                  <Badge className={RATING_COLORS[parseInt(rating)]}>
                    ⭐ {rating} 星
                  </Badge>
                  <Badge variant="secondary">
                    {TONE_EMOJI[result.tone] || ""} {result.tone}
                  </Badge>
                </div>

                {/* 回复内容 */}
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <p className="text-gray-900 whitespace-pre-wrap leading-relaxed">{result.reply}</p>
                </div>

                {/* 要点 */}
                {result.keyPoints.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-500 mb-1.5">回复要点：</p>
                    <ul className="space-y-1">
                      {result.keyPoints.map((point, i) => (
                        <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                          <span className="text-green-500 mt-0.5">✓</span>
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 后续行动 */}
                {result.followupAction && (
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                    <p className="text-sm font-medium text-blue-700 mb-0.5">📋 后续行动建议：</p>
                    <p className="text-sm text-blue-600">{result.followupAction}</p>
                  </div>
                )}

                {/* 内部备注 */}
                {result.internalNote && (
                  <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-100">
                    <p className="text-sm font-medium text-yellow-700 mb-0.5">🔒 内部备注：</p>
                    <p className="text-sm text-yellow-600">{result.internalNote}</p>
                  </div>
                )}
              </div>
            )}

            {!result && !loading && (
              <div className="py-12 text-center text-gray-400">
                <p className="text-4xl mb-3">💬</p>
                <p>填写评价信息后点击生成回复草稿</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
