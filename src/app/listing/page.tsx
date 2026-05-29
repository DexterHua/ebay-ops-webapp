"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { callAIStructured } from "@/lib/ai";
import { LISTING_SYSTEM_PROMPT, buildListingUserMessage } from "@/lib/prompts";
import { toast } from "sonner";

// ============================================================
// 🖼️ 详情页生成器 — 第二优先
// ============================================================

interface ListingAIResult {
  titles: string[];
  descriptionHTML: string;
  itemSpecs: Record<string, string>;
  seoAnalysis: string;
}

export default function ListingPage() {
  const [sku, setSku] = useState("");
  const [chineseName, setChineseName] = useState("");
  const [englishKeywords, setEnglishKeywords] = useState("");
  const [category, setCategory] = useState("");
  const [specifications, setSpecifications] = useState("");
  const [features, setFeatures] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [suggestedPrice, setSuggestedPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ListingAIResult | null>(null);
  const [selectedTitle, setSelectedTitle] = useState(0);

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
        <p className="text-gray-500 mt-1">输入产品信息，AI 生成 eBay 标题（≤80字符）、HTML描述、ItemSpecs</p>
      </div>

      <div className="grid grid-cols-5 gap-6">
        {/* 左侧输入表单 */}
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle className="text-base">产品信息</CardTitle>
            <CardDescription>填写关键信息，越详细效果越好</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="SKU 编码" value={sku} onChange={(e) => setSku(e.target.value)} />
            <Input placeholder="中文品名 *" value={chineseName} onChange={(e) => setChineseName(e.target.value)} />
            <Input placeholder="英文标题关键词 *" value={englishKeywords} onChange={(e) => setEnglishKeywords(e.target.value)} />
            <Input placeholder="eBay 类目（如 Cell Phone Cases）" value={category} onChange={(e) => setCategory(e.target.value)} />
            <Input placeholder="规格（如 颜色/尺寸/材质）" value={specifications} onChange={(e) => setSpecifications(e.target.value)} />
            <Textarea placeholder="卖点说明（与其他产品的区别、核心优势）" value={features} onChange={(e) => setFeatures(e.target.value)} rows={3} />
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="采购价 (¥)" type="number" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
              <Input placeholder="建议售价 ($)" type="number" value={suggestedPrice} onChange={(e) => setSuggestedPrice(e.target.value)} />
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
                        <Badge variant={selectedTitle === idx ? "default" : "outline"} className="text-xs">
                          版本 {idx + 1}
                        </Badge>
                        <span className={`text-xs ${title.length > 80 ? "text-red-500 font-bold" : "text-gray-400"}`}>
                          {title.length}/80 字符 {title.length > 80 && "⚠️ 超限"}
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
                            <td className="px-4 py-2 bg-gray-50 font-medium text-gray-600 w-1/2">{key}</td>
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
                <p>填写左侧产品信息后点击生成</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
