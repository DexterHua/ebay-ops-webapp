"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { callAIStructured } from "@/lib/ai";
import { LISTING_SYSTEM_PROMPT, buildListingUserMessage } from "@/lib/prompts";
import { toast } from "sonner";

// ============================================================
// 🖼️ 详情页生成器 — 飞书SKU选择器 + AI 生成
// ============================================================

interface SkuFromLark {
  _idx: number;
  SKU?: string;
  中文品名?: string;
  英文标题关键词?: string;
  类目?: string[] | string;
  OEM?: string;
  采购价?: number;
  建议售价?: number;
  头程成本件?: number;
  橙联可售?: number;
  橙联在途?: number;
  本地库存?: number;
  商品毛重g?: number;
  商品尺寸含包装cm?: string;
  补货周期天数?: number;
  SKU状态?: string[] | string;
  供应商?: string[] | string;
  [key: string]: unknown;
}

interface ListingAIResult {
  titles: string[];
  descriptionHTML: string;
  itemSpecs: Record<string, string>;
  seoAnalysis: string;
}

export default function ListingPage() {
  // SKU 列表
  const [skuList, setSkuList] = useState<SkuFromLark[]>([]);
  const [skuLoading, setSkuLoading] = useState(true);
  const [skuSearch, setSkuSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  // 表单字段
  const [sku, setSku] = useState("");
  const [chineseName, setChineseName] = useState("");
  const [englishKeywords, setEnglishKeywords] = useState("");
  const [category, setCategory] = useState("");
  const [specifications, setSpecifications] = useState("");
  const [features, setFeatures] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [suggestedPrice, setSuggestedPrice] = useState("");

  // 当前选中 SKU 的元数据（用于展示）
  const [selectedSkuMeta, setSelectedSkuMeta] = useState<SkuFromLark | null>(null);

  // AI 生成
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ListingAIResult | null>(null);
  const [selectedTitle, setSelectedTitle] = useState(0);

  // 页面加载时从飞书获取 SKU 列表
  useEffect(() => {
    fetch("/api/lark?table=sku&limit=200")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setSkuList(json.data as SkuFromLark[]);
        } else {
          toast.error("SKU 加载失败", { description: json.error });
        }
      })
      .catch(() => toast.error("网络请求失败"))
      .finally(() => setSkuLoading(false));
  }, []);

  // 搜索过滤
  const filteredSkus = useMemo(() => {
    if (!skuSearch.trim()) return skuList;
    const q = skuSearch.toLowerCase();
    return skuList.filter(
      (s) =>
        s.SKU?.toLowerCase().includes(q) ||
        s.中文品名?.toLowerCase().includes(q) ||
        s.英文标题关键词?.toLowerCase().includes(q)
    );
  }, [skuList, skuSearch]);

  // 选择 SKU → 自动填充表单
  const selectSku = (item: SkuFromLark) => {
    const catStr = Array.isArray(item.类目) ? item.类目[0] : (item.类目 || "");
    const statusStr = Array.isArray(item.SKU状态) ? item.SKU状态[0] : (item.SKU状态 || "");
    const supplierStr = Array.isArray(item.供应商) ? item.供应商[0] : (item.供应商 || "");

    setSku(item.SKU || "");
    setChineseName(item.中文品名 || "");
    setEnglishKeywords(item.英文标题关键词 || "");
    setCategory(catStr);
    setSpecifications(
      [
        item.OEM ? `OEM: ${item.OEM}` : "",
        item.商品毛重g ? `${item.商品毛重g}g` : "",
        item.商品尺寸含包装cm ? `${item.商品尺寸含包装cm}cm` : "",
      ]
        .filter(Boolean)
        .join(" | ")
    );
    setPurchasePrice(item.采购价 ? String(item.采购价) : "");
    setSuggestedPrice(item.建议售价 ? String(item.建议售价) : "");
    setSelectedSkuMeta(item);

    setShowDropdown(false);
    setSkuSearch("");

    toast.success(`已选择 ${item.SKU}`, {
      description: `${item.中文品名} · 在途${item.橙联在途 || 0}件 · ${statusStr}`,
    });
  };

  const clearSelection = () => {
    setSku("");
    setSelectedSkuMeta(null);
  };

  // 获取状态信息
  const skuStatusLabel = selectedSkuMeta
    ? (Array.isArray(selectedSkuMeta.SKU状态)
        ? selectedSkuMeta.SKU状态[0]
        : selectedSkuMeta.SKU状态) || "未知"
    : "";

  const generateListing = async () => {
    if (!chineseName || !englishKeywords) {
      toast.error("请至少填写中文品名和英文关键词");
      return;
    }

    setLoading(true);
    const userMessage = buildListingUserMessage({
      sku,
      chineseName,
      englishKeywords,
      category,
      specifications,
      purchasePrice: parseFloat(purchasePrice) || 0,
      suggestedPrice: parseFloat(suggestedPrice) || 0,
      features,
    });

    const aiResult = await callAIStructured<ListingAIResult>({
      systemPrompt: LISTING_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 4096,
    });

    if (aiResult.success && aiResult.data) {
      setResult(aiResult.data);
      toast.success("详情页生成完成", {
        description: `生成了 ${aiResult.data.titles.length} 个标题备选`,
      });
    } else {
      toast.error("AI 生成失败", { description: aiResult.error });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">🖼️ 详情页生成器</h1>
        <p className="text-gray-500 mt-1">从飞书多维表格选择 SKU → 自动填充 → AI 生成标题 / 描述 / ItemSpecs</p>
      </div>

      <div className="grid grid-cols-5 gap-6">
        {/* 左侧输入表单 */}
        <Card className="col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">产品信息</CardTitle>
            <CardDescription>从飞书选择 SKU 或手动填写</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* SKU 搜索选择器 */}
            <div className="relative">
              <label className="text-xs text-gray-400 mb-1 block">从飞书选择 SKU</label>
              {skuLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : selectedSkuMeta ? (
                /* 已选中 SKU 的摘要卡片 */
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="default" className="text-xs">
                        {selectedSkuMeta.SKU}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {skuStatusLabel}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-gray-400 hover:text-red-500"
                      onClick={clearSelection}
                    >
                      ✕ 清除
                    </Button>
                  </div>
                  <p className="text-sm font-medium text-gray-900">{selectedSkuMeta.中文品名}</p>
                  <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-500">
                    <span>在途 {selectedSkuMeta.橙联在途 || 0}件</span>
                    <span>本地 {selectedSkuMeta.本地库存 || 0}件</span>
                    <span>采购 ¥{selectedSkuMeta.采购价 || "-"}</span>
                    {selectedSkuMeta.商品毛重g && <span>{selectedSkuMeta.商品毛重g}g</span>}
                  </div>
                </div>
              ) : (
                /* 搜索输入框 */
                <div>
                  <Input
                    placeholder="搜索 SKU 编码或品名..."
                    value={skuSearch}
                    onChange={(e) => {
                      setSkuSearch(e.target.value);
                      setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                  />
                  {/* 下拉列表 */}
                  {showDropdown && filteredSkus.length > 0 && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-hidden">
                      <ScrollArea className="max-h-60">
                        {filteredSkus.map((item) => (
                          <button
                            key={item._idx}
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-b-0"
                            onMouseDown={() => selectSku(item)}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900">{item.SKU}</span>
                              <span className="text-xs text-gray-400 truncate">{item.中文品名}</span>
                              {(item.橙联在途 || 0) > 0 && (
                                <Badge variant="outline" className="text-[10px] ml-auto shrink-0">
                                  在途{item.橙联在途}
                                </Badge>
                              )}
                            </div>
                          </button>
                        ))}
                      </ScrollArea>
                    </div>
                  )}
                  {showDropdown && skuSearch && filteredSkus.length === 0 && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-center text-sm text-gray-400">
                      未找到匹配的 SKU
                    </div>
                  )}
                </div>
              )}
            </div>

            <Separator />

            {/* 表单字段 — 可手动编辑 */}
            <Input
              placeholder="中文品名 *"
              value={chineseName}
              onChange={(e) => setChineseName(e.target.value)}
            />
            <Input
              placeholder="英文标题关键词 *"
              value={englishKeywords}
              onChange={(e) => setEnglishKeywords(e.target.value)}
            />
            <Input
              placeholder="eBay 类目"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <Input
              placeholder="规格（OEM / 重量 / 尺寸）"
              value={specifications}
              onChange={(e) => setSpecifications(e.target.value)}
            />
            <Textarea
              placeholder="卖点说明 — 产品的独特优势、与竞品的差异"
              value={features}
              onChange={(e) => setFeatures(e.target.value)}
              rows={3}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="采购价 (¥)"
                type="number"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
              />
              <Input
                placeholder="建议售价 ($)"
                type="number"
                value={suggestedPrice}
                onChange={(e) => setSuggestedPrice(e.target.value)}
              />
            </div>

            <Button onClick={generateListing} disabled={loading} className="w-full">
              {loading ? "⏳ AI 生成中..." : "🤖 生成详情页"}
            </Button>
          </CardContent>
        </Card>

        {/* 右侧生成结果 */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle className="text-base">生成结果</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && (
              <div className="space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-40 w-full" />
              </div>
            )}

            {result && !loading && (
              <Tabs defaultValue="titles">
                <TabsList className="mb-4">
                  <TabsTrigger value="titles">📝 标题 ({result.titles.length}个)</TabsTrigger>
                  <TabsTrigger value="description">📄 描述 HTML</TabsTrigger>
                  <TabsTrigger value="specs">🔧 Item Specs</TabsTrigger>
                  <TabsTrigger value="seo">🔍 SEO分析</TabsTrigger>
                </TabsList>

                <TabsContent value="titles" className="space-y-3">
                  {result.titles.map((title, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedTitle === idx
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-gray-400"
                      }`}
                      onClick={() => setSelectedTitle(idx)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Badge
                          variant={selectedTitle === idx ? "default" : "outline"}
                          className="text-xs"
                        >
                          版本 {idx + 1}
                        </Badge>
                        <span
                          className={`text-xs ${
                            title.length > 80 ? "text-red-500 font-bold" : "text-gray-400"
                          }`}
                        >
                          {title.length}/80 {title.length > 80 && "⚠️ 超限"}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-900">{title}</p>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="description">
                  <div className="bg-gray-100 rounded-lg p-4 max-h-96 overflow-auto">
                    <pre className="text-xs whitespace-pre-wrap font-mono text-gray-700">
                      {result.descriptionHTML}
                    </pre>
                  </div>
                </TabsContent>

                <TabsContent value="specs">
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody>
                        {Object.entries(result.itemSpecs).map(([key, value]) => (
                          <tr key={key} className="border-b last:border-b-0">
                            <td className="px-4 py-2 bg-gray-50 font-medium text-gray-600 w-1/2">
                              {key}
                            </td>
                            <td className="px-4 py-2 text-gray-900">{String(value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>

                <TabsContent value="seo">
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-700 leading-relaxed">{result.seoAnalysis}</p>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            )}

            {!result && !loading && (
              <div className="py-12 text-center text-gray-400">
                <p className="text-4xl mb-3">🤖</p>
                <p>
                  {skuList.length > 0
                    ? `已加载 ${skuList.length} 个 SKU，从上方搜索并选择一个开始生成`
                    : "填写产品信息后点击生成"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
