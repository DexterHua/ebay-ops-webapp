"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { callAIStructured } from "@/lib/ai";
import { REVIEWS_SYSTEM_PROMPT, buildReviewsUserMessage } from "@/lib/prompts";
import { toast } from "sonner";
import { Copy, MessageSquareText, Search, Sparkles, X } from "lucide-react";

interface ReviewReplyOption {
  english: string;
  chinese: string;
}

interface ReplyAIResult {
  replies: ReviewReplyOption[];
}

interface SkuOption {
  recordId?: string;
  SKU?: unknown;
  中文品名?: unknown;
  商品名称?: unknown;
  类目?: unknown;
  [key: string]: unknown;
}

function displayText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(displayText).filter(Boolean).join("、");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return displayText(record.text ?? record.value ?? record.name ?? record.id ?? "");
  }
  return "";
}

export default function ReviewsPage() {
  const [skuList, setSkuList] = useState<SkuOption[]>([]);
  const [skuLoading, setSkuLoading] = useState(true);
  const [skuQuery, setSkuQuery] = useState("");
  const [showSkuMatches, setShowSkuMatches] = useState(false);
  const [selectedSku, setSelectedSku] = useState<SkuOption | null>(null);
  const [rating, setRating] = useState("5");
  const [reviewContent, setReviewContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReplyAIResult | null>(null);

  const ratingValue = Number.parseInt(rating, 10) || 5;
  const selectedSkuCode = selectedSku ? displayText(selectedSku.SKU) : skuQuery.trim();
  const selectedProductName = selectedSku ? displayText(selectedSku.中文品名 ?? selectedSku.商品名称) : "";
  const selectedCategory = selectedSku ? displayText(selectedSku.类目) : "";

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    fetch("/api/lark?table=sku&limit=500", { signal: controller.signal })
      .then((response) => response.json())
      .then((json: { success?: boolean; data?: SkuOption[] }) => {
        if (!cancelled && json.success) setSkuList(json.data || []);
      })
      .catch(() => {
        if (!cancelled) toast.warning("SKU 主数据加载较慢，仍可手动输入 SKU");
      })
      .finally(() => {
        clearTimeout(timer);
        if (!cancelled) setSkuLoading(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const matchedSkus = skuQuery.trim()
    ? skuList.filter((sku) => {
      const keyword = skuQuery.trim().toLowerCase();
      return displayText(sku.SKU).toLowerCase().includes(keyword)
        || displayText(sku.中文品名 ?? sku.商品名称).toLowerCase().includes(keyword)
        || displayText(sku.类目).toLowerCase().includes(keyword);
    }).slice(0, 20)
    : [];

  const ratingColor = (value: number) => {
    if (value >= 4) return "bg-green-100 text-green-700 hover:bg-green-100";
    if (value >= 3) return "bg-yellow-100 text-yellow-700 hover:bg-yellow-100";
    return "bg-red-100 text-red-700 hover:bg-red-100";
  };

  const selectSku = (sku: SkuOption) => {
    const skuCode = displayText(sku.SKU);
    const productName = displayText(sku.中文品名 ?? sku.商品名称);
    setSelectedSku(sku);
    setSkuQuery(productName ? `${skuCode} / ${productName}` : skuCode);
    setShowSkuMatches(false);
    setResult(null);
  };

  const clearSku = () => {
    setSelectedSku(null);
    setSkuQuery("");
    setResult(null);
  };

  const generateReplies = async () => {
    const content = reviewContent.trim();
    if (!content) {
      toast.error("请填写买家评论内容");
      return;
    }

    setLoading(true);
    setResult(null);
    const aiResult = await callAIStructured<ReplyAIResult>({
      systemPrompt: REVIEWS_SYSTEM_PROMPT,
      userMessage: buildReviewsUserMessage({
        content,
        rating: ratingValue,
        sku: selectedSkuCode,
        productName: selectedProductName,
        category: selectedCategory,
      }),
      maxTokens: 1600,
      temperature: 0.55,
    });

    if (aiResult.success && aiResult.data?.replies?.length) {
      setResult({ replies: aiResult.data.replies.slice(0, 2) });
      toast.success("已生成 2 条英文回复草稿");
    } else {
      toast.error("AI 生成失败", { description: aiResult.error || "未返回有效回复" });
    }
    setLoading(false);
  };

  const copyReply = async (reply: string) => {
    try {
      await navigator.clipboard.writeText(reply);
      toast.success("英文回复已复制");
    } catch {
      toast.error("复制失败，请手动选择文本复制");
    }
  };

  return (
    <div className="app-page max-w-5xl">
      <div>
        <p className="page-kicker">Customer Service</p>
        <h1 className="page-title">评论回复生成器</h1>
        <p className="page-description">输入 SKU、评分和买家评论内容，生成两条礼貌积极、用词地道、符合平台政策的英文回复。</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareText className="size-4" />
              评价内容
            </CardTitle>
            <CardDescription>选择 SKU 后会参考品类和商品信息</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <label className="mb-1 block text-xs text-gray-400">SKU</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-300" />
                <Input
                  className="pl-9 pr-9"
                  placeholder={skuLoading ? "输入 SKU、品名或品类（正在加载联想）" : "输入 SKU、品名或品类"}
                  value={skuQuery}
                  onChange={(event) => {
                    setSkuQuery(event.target.value);
                    setSelectedSku(null);
                    setShowSkuMatches(true);
                    setResult(null);
                  }}
                  onFocus={() => { if (skuQuery) setShowSkuMatches(true); }}
                  onBlur={() => setTimeout(() => setShowSkuMatches(false), 160)}
                />
                {skuQuery && (
                  <button
                    type="button"
                    aria-label="清空 SKU"
                    className="absolute right-2 top-1/2 rounded p-1 text-slate-300 transition hover:bg-slate-100 hover:text-slate-500"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={clearSku}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
              {showSkuMatches && matchedSkus.length > 0 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
                  <ScrollArea className="max-h-56">
                    {matchedSkus.map((sku, index) => (
                      <button
                        key={sku.recordId || `${displayText(sku.SKU)}-${index}`}
                        type="button"
                        className="w-full border-b border-slate-50 px-3 py-2 text-left last:border-b-0 hover:bg-orange-50"
                        onMouseDown={() => selectSku(sku)}
                      >
                        <span className="block text-sm font-medium text-slate-900">{displayText(sku.SKU)}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-400">
                          {displayText(sku.中文品名 ?? sku.商品名称) || "未填写品名"}
                          {displayText(sku.类目) ? ` · ${displayText(sku.类目)}` : ""}
                        </span>
                      </button>
                    ))}
                  </ScrollArea>
                </div>
              )}
              {showSkuMatches && skuQuery && !skuLoading && matchedSkus.length === 0 && (
                <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white p-2 text-center text-sm text-slate-400">未匹配，可继续手动输入</div>
              )}
              {selectedSku && (
                <div className="mt-2 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2">
                  <p className="text-sm font-medium text-emerald-800">{selectedSkuCode}</p>
                  <p className="mt-0.5 truncate text-xs text-emerald-700">
                    {selectedProductName || "未填写品名"}{selectedCategory ? ` · ${selectedCategory}` : ""}
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-400">评分</label>
              <Select value={rating} onValueChange={(value) => setRating(value || "5")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[5, 4, 3, 2, 1].map((value) => (
                    <SelectItem key={value} value={String(value)}>{value} 星</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-400">买家评论内容</label>
              <Textarea
                placeholder="粘贴买家的评价内容..."
                value={reviewContent}
                onChange={(event) => {
                  setReviewContent(event.target.value);
                  setResult(null);
                }}
                rows={9}
                className="text-sm"
              />
            </div>

            <Button onClick={generateReplies} disabled={loading} className="w-full">
              {loading ? "AI 生成中..." : <><Sparkles /> 生成两条回复</>}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">AI 回复草稿</CardTitle>
                <CardDescription>结合评分、品类和评论内容生成，每条英文回复下方附中文翻译</CardDescription>
              </div>
              <Badge className={ratingColor(ratingValue)}>{ratingValue} 星</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {loading && (
              <div className="space-y-4">
                {[1, 2].map((item) => (
                  <div key={item} className="rounded-md border border-slate-100 p-4">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="mt-3 h-4 w-full" />
                    <Skeleton className="mt-2 h-4 w-4/5" />
                    <Skeleton className="mt-5 h-4 w-24" />
                    <Skeleton className="mt-3 h-4 w-11/12" />
                  </div>
                ))}
              </div>
            )}

            {!loading && result?.replies?.length ? (
              <div className="space-y-4">
                {result.replies.map((reply, index) => (
                  <div key={`${reply.english}-${index}`} className="rounded-md border border-slate-100 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-700">回复 {index + 1}</p>
                      <Button type="button" variant="outline" size="sm" onClick={() => copyReply(reply.english)}>
                        <Copy className="size-3.5" />
                        复制英文
                      </Button>
                    </div>
                    <div className="mt-3 rounded-md bg-slate-50 px-3 py-3">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-900">{reply.english}</p>
                    </div>
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <p className="text-xs font-medium text-slate-400">中文翻译</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{reply.chinese}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {!loading && !result && (
              <div className="py-16 text-center text-gray-400">
                <MessageSquareText className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                <p className="text-sm">选择 SKU 并填写评分、买家评论后生成回复草稿</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
