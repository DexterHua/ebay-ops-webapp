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
import { sanitizeHtmlFragment } from "@/lib/sanitize-html";
import { toast } from "sonner";
import { FileText } from "lucide-react";

// ============================================================
// 详情页生成器 v2 — 保存到飞书 + 批量模式 + HTML 预览
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
  "商品毛重（g）"?: number;
  "商品尺寸（含包装）（cm）"?: string;
  SKU状态?: string[] | string;
  [key: string]: unknown;
}

interface ListingAIResult {
  titles: string[];
  descriptionHTML: string;
  itemSpecs: Record<string, string>;
  seoAnalysis: string;
}

interface ListingRecord {
  sku: string;
  productName: string;
  result: ListingAIResult;
  timestamp: string;
  saved: boolean;
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
  const [selectedSkuMeta, setSelectedSkuMeta] = useState<SkuFromLark | null>(null);

  // AI 生成
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ListingAIResult | null>(null);
  const [selectedTitle, setSelectedTitle] = useState(0);
  const [saving, setSaving] = useState(false);

  // 批量模式
  const [batchMode, setBatchMode] = useState(false);
  const [batchSkus, setBatchSkus] = useState<SkuFromLark[]>([]);
  const [batchResults, setBatchResults] = useState<ListingRecord[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const sanitizedPreviewHtml = useMemo(
    () => sanitizeHtmlFragment(result?.descriptionHTML || ""),
    [result?.descriptionHTML],
  );

  // 页面加载
  useEffect(() => {
    fetch("/api/lark?table=sku&limit=200")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setSkuList(json.data as SkuFromLark[]);
        else toast.error("SKU 加载失败");
      })
      .catch(() => toast.error("网络请求失败"))
      .finally(() => setSkuLoading(false));
  }, []);

  // 搜索过滤
  const filteredSkus = useMemo(() => {
    if (!skuSearch.trim()) return [];
    const q = skuSearch.toLowerCase();
    return skuList.filter(
      (s) =>
        s.SKU?.toLowerCase().includes(q) ||
        s.中文品名?.toLowerCase().includes(q) ||
        s.英文标题关键词?.toLowerCase().includes(q)
    );
  }, [skuList, skuSearch]);

  // 选择 SKU
  const selectSku = (item: SkuFromLark) => {
    if (batchMode) {
      // 批量模式：加入队列
      if (batchSkus.find((s) => s.SKU === item.SKU)) {
        setBatchSkus(batchSkus.filter((s) => s.SKU !== item.SKU));
        toast.info(`已移除 ${item.SKU}`);
      } else {
        setBatchSkus([...batchSkus, item]);
        toast.success(`已加入 ${item.SKU}，共 ${batchSkus.length + 1} 个待生成`);
      }
      setSkuSearch("");
      setShowDropdown(false);
      return;
    }

    // 单选模式：填充表单
    const catStr = Array.isArray(item.类目) ? item.类目[0] : (item.类目 || "");
    setSku(item.SKU || "");
    setChineseName(item.中文品名 || "");
    setEnglishKeywords(item.英文标题关键词 || "");
    setCategory(catStr);
    setSpecifications(
      [
        item.OEM ? `OEM: ${item.OEM}` : "",
        item["商品毛重（g）"] ? `${item["商品毛重（g）"]}g` : "",
        item["商品尺寸（含包装）（cm）"] ? `${item["商品尺寸（含包装）（cm）"]}cm` : "",
      ].filter(Boolean).join(" | ")
    );
    setPurchasePrice(item.采购价 ? String(item.采购价) : "");
    setSuggestedPrice(item.建议售价 ? String(item.建议售价) : "");
    setSelectedSkuMeta(item);
    setResult(null);
    setShowDropdown(false);
    setSkuSearch("");

    toast.success(`已选择 ${item.SKU} · ${item.中文品名}`);
  };

  const clearSelection = () => {
    setSku(""); setSelectedSkuMeta(null); setResult(null);
  };

  // 生成详情页
  const generateListing = async () => {
    if (batchMode) {
      if (batchSkus.length === 0) { toast.error("请先添加 SKU 到批量队列"); return; }
      runBatch();
      return;
    }
    if (!chineseName || !englishKeywords) { toast.error("请至少填写中文品名和英文关键词"); return; }

    setLoading(true);
    const userMessage = buildListingUserMessage({
      sku, chineseName, englishKeywords, category, specifications,
      purchasePrice: parseFloat(purchasePrice) || 0,
      suggestedPrice: parseFloat(suggestedPrice) || 0,
      features,
    });

    const aiResult = await callAIStructured<ListingAIResult>({
      systemPrompt: LISTING_SYSTEM_PROMPT, userMessage, maxTokens: 4096,
    });

    if (aiResult.success && aiResult.data) {
      setResult(aiResult.data);
      toast.success(`生成了 ${aiResult.data.titles.length} 个标题备选`);
    } else {
      toast.error("AI 生成失败", { description: aiResult.error });
    }
    setLoading(false);
  };

  // 批量生成
  const runBatch = async () => {
    setBatchRunning(true);
    setBatchResults([]);
    setBatchProgress({ done: 0, total: batchSkus.length });
    const results: ListingRecord[] = [];

    for (let i = 0; i < batchSkus.length; i++) {
      const item = batchSkus[i];
      setBatchProgress({ done: i + 1, total: batchSkus.length });

      const catStr = Array.isArray(item.类目) ? item.类目[0] : (item.类目 || "");
      const specs = [item.OEM ? `OEM: ${item.OEM}` : "", item["商品毛重（g）"] ? `${item["商品毛重（g）"]}g` : ""].filter(Boolean).join(" | ");

      const userMessage = buildListingUserMessage({
        sku: item.SKU || "",
        chineseName: item.中文品名 || "",
        englishKeywords: item.英文标题关键词 || "",
        category: catStr,
        specifications: specs,
        purchasePrice: item.采购价 || 0,
        suggestedPrice: item.建议售价 || 0,
        features: "",
      });

      const aiResult = await callAIStructured<ListingAIResult>({
        systemPrompt: LISTING_SYSTEM_PROMPT, userMessage, maxTokens: 4096,
      });

      results.push({
        sku: item.SKU || "",
        productName: item.中文品名 || "",
        result: aiResult.data || { titles: [], descriptionHTML: "", itemSpecs: {}, seoAnalysis: "" },
        timestamp: new Date().toISOString(),
        saved: false,
      });

      setBatchResults([...results]);
      await new Promise((r) => setTimeout(r, 500)); // 节流
    }

    setBatchRunning(false);
    const ok = results.filter((r) => r.result.titles.length > 0).length;
    toast.success(`批量生成完成: ${ok}/${batchSkus.length} 成功`);
  };

  // 保存到飞书
  const saveToFeishu = async () => {
    if (!result || !sku) return;
    setSaving(true);
    try {
      const res = await fetch("/api/lark/save-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku,
          titleV1: result.titles[0] || "",
          titleV2: result.titles[1] || "",
          titleV3: result.titles[2] || "",
          descriptionHTML: result.descriptionHTML,
          itemSpecs: JSON.stringify(result.itemSpecs),
        }),
      });
      const json = await res.json();
      if (json.success) toast.success("已保存到飞书 15_详情页内容库");
      else toast.error("保存失败", { description: json.error });
    } catch {
      toast.error("保存失败，网络错误");
    }
    setSaving(false);
  };

  // 批量保存
  const saveBatchToFeishu = async () => {
    const unsaved = batchResults.filter((r) => !r.saved && r.result.titles.length > 0);
    if (unsaved.length === 0) { toast.error("没有可保存的结果"); return; }
    setSaving(true);
    let done = 0;
    for (const record of unsaved) {
      try {
        const res = await fetch("/api/lark/save-listing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sku: record.sku,
            titleV1: record.result.titles[0] || "",
            titleV2: record.result.titles[1] || "",
            titleV3: record.result.titles[2] || "",
            descriptionHTML: record.result.descriptionHTML,
            itemSpecs: JSON.stringify(record.result.itemSpecs),
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) continue;
        record.saved = true;
        done++;
      } catch { /* skip */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    setBatchResults([...batchResults]);
    setSaving(false);
    toast.success(`已保存 ${done}/${unsaved.length} 条到飞书`);
  };

  // 移除批量队列中的某个 SKU
  const removeBatchSku = (item: SkuFromLark) => {
    setBatchSkus(batchSkus.filter((s) => s.SKU !== item.SKU));
  };

  const statusLabel = selectedSkuMeta && (Array.isArray(selectedSkuMeta.SKU状态) ? selectedSkuMeta.SKU状态[0] : selectedSkuMeta.SKU状态);

  if (batchMode) return renderBatchMode();
  return renderSingleMode();

  // ==============================================================
  //  单选模式
  // ==============================================================
  function renderSingleMode() {
    return (
      <div className="app-page max-w-6xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="page-kicker">Listing Studio</p>
            <h1 className="page-title">详情页生成器</h1>
            <p className="page-description">搜索选择 SKU → 自动填表 → AI 生成 → 保存到飞书</p>
          </div>
          <Button variant="outline" onClick={() => setBatchMode(true)}>
            切换到批量模式
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-6">
          {/* 左侧表单 */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">产品信息</CardTitle>
              <CardDescription>从飞书选择 SKU 或手动填写</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <label className="text-xs text-gray-400 mb-1 block">从飞书搜索 SKU</label>
                {skuLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : selectedSkuMeta ? (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
                      <Badge variant="default" className="text-xs">{selectedSkuMeta.SKU}</Badge>
                      {statusLabel && <Badge variant="outline" className="text-xs">{statusLabel}</Badge>}
                      <Button variant="ghost" size="sm" className="h-6 text-xs text-gray-400 hover:text-red-500 ml-auto" onClick={clearSelection}>清除</Button>
                    </div>
                    <p className="text-sm font-medium text-gray-900">{selectedSkuMeta.中文品名}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      采购 ¥{selectedSkuMeta.采购价 || "-"}{selectedSkuMeta["商品毛重（g）"] ? ` · ${selectedSkuMeta["商品毛重（g）"]}g` : ""}
                    </p>
                  </div>
                ) : (
                  <div>
                    <Input
                      placeholder="输入 SKU 编码或品名搜索..."
                      value={skuSearch}
                      onChange={(e) => { setSkuSearch(e.target.value); setShowDropdown(true); }}
                      onFocus={() => { if (skuSearch) setShowDropdown(true); }}
                      onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                    />
                    {showDropdown && filteredSkus.length > 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-hidden">
                        <ScrollArea className="max-h-60">
                          {filteredSkus.map((item) => (
                            <button key={item._idx} className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-b-0" onMouseDown={() => selectSku(item)}>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">{item.SKU}</span>
                                <span className="text-xs text-gray-400 truncate">{item.中文品名}</span>
                              </div>
                            </button>
                          ))}
                        </ScrollArea>
                      </div>
                    )}
                    {showDropdown && skuSearch && filteredSkus.length === 0 && (
                      <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-center text-sm text-gray-400">未找到匹配的 SKU</div>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              <Input placeholder="中文品名 *" value={chineseName} onChange={(e) => setChineseName(e.target.value)} />
              <Input placeholder="英文标题关键词 *" value={englishKeywords} onChange={(e) => setEnglishKeywords(e.target.value)} />
              <Input placeholder="eBay 类目" value={category} onChange={(e) => setCategory(e.target.value)} />
              <Input placeholder="规格（OEM/重量/尺寸）" value={specifications} onChange={(e) => setSpecifications(e.target.value)} />
              <Textarea placeholder="卖点说明 — 产品独特优势、兼容车型" value={features} onChange={(e) => setFeatures(e.target.value)} rows={3} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input placeholder="采购价 (¥)" type="number" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
                <Input placeholder="建议售价 ($)" type="number" value={suggestedPrice} onChange={(e) => setSuggestedPrice(e.target.value)} />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={generateListing} disabled={loading} className="flex-1">
                  {loading ? "AI 生成中..." : "生成详情页"}
                </Button>
                {result && (
                  <Button variant="outline" onClick={saveToFeishu} disabled={saving}>
                    {saving ? "保存中..." : "保存到飞书"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 右侧结果 */}
          <Card className="lg:col-span-3">
            <CardHeader><CardTitle className="text-base">生成结果</CardTitle></CardHeader>
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
                  <TabsList className="mb-4 max-w-full justify-start overflow-x-auto">
                    <TabsTrigger value="titles">标题 ({result.titles.length})</TabsTrigger>
                    <TabsTrigger value="description">描述 HTML</TabsTrigger>
                    <TabsTrigger value="preview">预览</TabsTrigger>
                    <TabsTrigger value="specs">Item Specs</TabsTrigger>
                    <TabsTrigger value="seo">SEO</TabsTrigger>
                  </TabsList>

                  <TabsContent value="titles" className="space-y-3">
                    {result.titles.map((title, idx) => (
                      <div key={idx}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedTitle === idx ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-400"}`}
                        onClick={() => setSelectedTitle(idx)}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <Badge variant={selectedTitle === idx ? "default" : "outline"} className="text-xs">版本 {idx + 1}</Badge>
                          <span className={`text-xs ${title.length > 80 ? "text-red-500 font-bold" : "text-gray-400"}`}>
                            {title.length}/80 {title.length > 80 && ""}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-900">{title}</p>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="description">
                    <div className="bg-gray-100 rounded-lg p-4 max-h-96 overflow-auto">
                      <pre className="text-xs whitespace-pre-wrap font-mono text-gray-700">{result.descriptionHTML}</pre>
                    </div>
                  </TabsContent>

                  <TabsContent value="preview">
                    <div className="border rounded-lg h-96 overflow-auto bg-white">
                      <div className="py-4">
                        <div dangerouslySetInnerHTML={{ __html: sanitizedPreviewHtml }} />
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-2 text-center">预览仅供参考，实际效果以 eBay 渲染为准</p>
                  </TabsContent>

                  <TabsContent value="specs">
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="min-w-[32rem] w-full text-sm">
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
                    <Card><CardContent className="p-4">
                      <p className="text-sm text-gray-700 leading-relaxed">{result.seoAnalysis}</p>
                    </CardContent></Card>
                  </TabsContent>
                </Tabs>
              )}

              {!result && !loading && (
                <div className="py-12 text-center text-gray-400">
                  <FileText className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                  <p>{skuList.length > 0 ? `已加载 ${skuList.length} 个 SKU，搜索并选择一个开始生成` : "正在加载 SKU..."}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ==============================================================
  //  批量模式
  // ==============================================================
  function renderBatchMode() {
    return (
      <div className="app-page max-w-6xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="page-kicker">Listing Studio</p>
            <h1 className="page-title">批量详情页生成</h1>
            <p className="page-description">多选 SKU → 依次生成 → 结果审阅 → 批量保存到飞书</p>
          </div>
          <Button variant="outline" onClick={() => { setBatchMode(false); setBatchSkus([]); setBatchResults([]); }}>
            切换到单选模式
          </Button>
        </div>

        {/* SKU 选择 + 队列 */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">选择 SKU</CardTitle></CardHeader>
            <CardContent>
              <Input
                placeholder="搜索 SKU 编码或品名..."
                value={skuSearch}
                onChange={(e) => { setSkuSearch(e.target.value); setShowDropdown(true); }}
                onFocus={() => { if (skuSearch) setShowDropdown(true); }}
                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              />
              <p className="text-xs text-gray-400 mt-2">输入关键词后从结果中点击 SKU 加入队列（可多次添加）</p>
              {showDropdown && filteredSkus.length > 0 && (
                <div className="relative z-20 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-hidden">
                  <ScrollArea className="max-h-48">
                    {filteredSkus.map((item) => (
                      <button key={item._idx} className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-b-0" onMouseDown={() => selectSku(item)}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">{item.SKU}</span>
                          <span className="text-xs text-gray-400 truncate">{item.中文品名}</span>
                          {batchSkus.find((s) => s.SKU === item.SKU) && <Badge className="text-[10px] bg-green-100 text-green-700 border-0">已选</Badge>}
                        </div>
                      </button>
                    ))}
                  </ScrollArea>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">待生成队列 ({batchSkus.length})</CardTitle>
                <CardDescription>{batchSkus.length === 0 ? "尚未添加 SKU" : "点击下方按钮开始批量生成"}</CardDescription>
              </div>
              <div className="flex gap-2">
                {batchResults.length > 0 && (
                  <Button size="sm" variant="outline" onClick={saveBatchToFeishu} disabled={saving}>
                    {saving ? "..." : "全部保存"}
                  </Button>
                )}
                <Button size="sm" onClick={generateListing} disabled={batchRunning || batchSkus.length === 0}>
                  {batchRunning ? `${batchProgress.done}/${batchProgress.total}` : `批量生成 (${batchSkus.length})`}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {batchSkus.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">左侧搜索并点击 SKU 加入队列</p>
              ) : (
                <ScrollArea className="max-h-64">
                  <div className="space-y-1">
                    {batchSkus.map((item, i) => (
                      <div key={item.SKU} className="flex items-center justify-between gap-2 rounded bg-gray-50 px-3 py-1.5 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-gray-400 text-xs w-5">{i + 1}.</span>
                          <span className="font-medium text-gray-900">{item.SKU}</span>
                          <span className="max-w-[120px] truncate text-gray-500 sm:max-w-[200px]">{item.中文品名}</span>
                          {batchResults.find((r) => r.sku === item.SKU) && (
                            <Badge className="text-[10px] bg-green-100 text-green-700 border-0">完成</Badge>
                          )}
                        </div>
                        <button className="text-xs text-gray-400 hover:text-red-500" onClick={() => removeBatchSku(item)}>移除</button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 结果列表 */}
        {batchResults.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">生成结果 ({batchResults.filter(r => r.result.titles.length > 0).length}/{batchResults.length})</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-4 pr-4">
                  {batchResults.map((record) => (
                    <Card key={record.sku}>
                      <CardHeader className="pb-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <Badge variant="default" className="text-xs">{record.sku}</Badge>
                            <span className="text-sm font-medium">{record.productName}</span>
                            {record.saved && <Badge className="text-xs bg-green-100 text-green-700 border-0">已保存</Badge>}
                          </div>
                          {record.result.titles.length > 0 && (
                            <span className="text-xs text-green-600 font-medium">{record.result.titles[0].length} 字符</span>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        {record.result.titles.length > 0 ? (
                          <div className="space-y-1">
                            {record.result.titles.map((t, i) => (
                              <p key={i} className={`text-sm ${i === 0 ? "font-medium text-gray-900" : "text-gray-500"}`}>
                                {i + 1}. {t}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-red-500">生成失败</p>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }
}
