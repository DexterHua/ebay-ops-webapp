"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { buildSkuDetails, searchSkuDetails, type SkuDetailRecord, type SkuDetails } from "@/lib/sku-details";
import {
  Clipboard,
  ExternalLink,
  PackageCheck,
  RefreshCw,
  ScanSearch,
  Search,
} from "lucide-react";
import { toast } from "sonner";

type LarkResponse = {
  success?: boolean;
  error?: string;
  data?: SkuDetailRecord[];
};

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatNumber(value: number | null | undefined, suffix = "") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${numberFormatter.format(value)}${suffix}`;
}

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return priceFormatter.format(value);
}

function textOrDash(value: string) {
  return value || "--";
}

function DetailItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-100 bg-white px-3 py-2">
      <p className="text-[11px] leading-5 text-slate-400">{label}</p>
      <p className={cn("mt-0.5 break-words text-sm font-medium text-slate-800", highlight && "text-orange-700")}>{value}</p>
    </div>
  );
}

function MetricItem({ label, value, tone }: { label: string; value: string; tone?: "green" | "blue" | "orange" | "red" }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
      <p className="text-[11px] leading-5 text-slate-400">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold text-slate-900",
          tone === "green" && "text-emerald-600",
          tone === "blue" && "text-blue-600",
          tone === "orange" && "text-orange-600",
          tone === "red" && "text-red-600",
        )}
      >
        {value}
      </p>
    </div>
  );
}

async function fetchLarkTable(table: "sku" | "strategy" | "summary"): Promise<SkuDetailRecord[]> {
  const response = await fetch(`/api/lark?table=${table}`);
  const json = await response.json() as LarkResponse;
  if (!response.ok || !json.success) throw new Error(json.error || `${table} 读取失败`);
  return json.data || [];
}

export default function SkuDetailsPage() {
  const [items, setItems] = useState<SkuDetails[]>([]);
  const [query, setQuery] = useState("");
  const [selectedSku, setSelectedSku] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => items.find((item) => item.sku === selectedSku) || null,
    [items, selectedSku],
  );
  const matches = useMemo(() => searchSkuDetails(items, query, 8), [items, query]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [skuRows, strategyRows, summaryRows] = await Promise.all([
        fetchLarkTable("sku"),
        fetchLarkTable("strategy"),
        fetchLarkTable("summary"),
      ]);
      const nextItems = buildSkuDetails({ skuRows, strategyRows, summaryRows });
      setItems(nextItems);
      setSelectedSku((current) => nextItems.some((item) => item.sku === current) ? current : "");
      toast.success(`已加载 ${nextItems.length} 个 SKU`, {
        description: "数据来源：01_SKU主数据 + 18_SKU库存策略 + 19_SKU运营汇总",
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "飞书数据读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const chooseSku = (item: SkuDetails) => {
    setSelectedSku(item.sku);
    setQuery(item.sku);
  };

  const copyImageUrl = async () => {
    if (!selected?.imageUrl) return;
    await navigator.clipboard.writeText(selected.imageUrl);
    toast.success("图片链接已复制");
  };

  return (
    <div className="app-page max-w-7xl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="page-kicker">SKU Lookup</p>
          <h1 className="page-title">SKU 详情</h1>
          <p className="page-description">按 SKU、品名、英文关键词、OEM、供应商或状态快速定位商品资料与库存快照</p>
        </div>
        <Button variant="outline" onClick={loadData} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          {loading ? "刷新中" : "刷新数据"}
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex flex-col gap-3 py-4 text-red-700 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">飞书数据读取失败</p>
              <p className="mt-1 text-sm">{error}</p>
            </div>
            <Button variant="outline" onClick={loadData}>
              重试
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4 text-orange-500" />
                SKU 联想
              </CardTitle>
              <CardDescription>共 {numberFormatter.format(items.length)} 个 SKU</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="SKU / 品名 / OEM / 供应商"
                  className="h-9 pl-8"
                />
              </div>

              {loading && (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map((item) => (
                    <Skeleton key={item} className="h-14 w-full" />
                  ))}
                </div>
              )}

              {!loading && items.length === 0 && !error && (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                  暂无 SKU 数据
                </div>
              )}

              {!loading && items.length > 0 && matches.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                  没有匹配的 SKU
                </div>
              )}

              {!loading && matches.length > 0 && (
                <div className="space-y-2">
                  {matches.map((item) => {
                    const active = item.sku === selectedSku;
                    return (
                      <button
                        key={item.sku}
                        type="button"
                        onClick={() => chooseSku(item)}
                        className={cn(
                          "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                          active
                            ? "border-orange-200 bg-orange-50"
                            : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50",
                        )}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900">{item.sku}</span>
                          {item.status && <Badge variant={active ? "default" : "secondary"}>{item.status}</Badge>}
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">{item.productName || item.englishKeywords || "--"}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-400">{item.oem || item.supplier || item.category || "--"}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <MetricItem label="橙联可售" value={formatNumber(selected?.available, " 件")} tone="green" />
            <MetricItem label="橙联在途" value={formatNumber(selected?.inTransit, " 件")} tone="blue" />
          </div>
        </div>

        {!selected && (
          <Card className="min-h-[30rem] border-dashed">
            <CardContent className="flex min-h-[30rem] flex-col items-center justify-center py-16 text-center">
              <ScanSearch className="mb-4 h-10 w-10 text-slate-300" />
              <p className="text-lg font-medium text-slate-600">请选择一个 SKU</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">从左侧联想结果中选择后，这里会展示商品资料、规格价格、图片和库存销售快照。</p>
            </CardContent>
          </Card>
        )}

        {selected && (
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <CardTitle className="break-words text-xl">{selected.productName || selected.sku}</CardTitle>
                    <CardDescription className="mt-1 break-words">{selected.englishKeywords || selected.sku}</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{selected.sku}</Badge>
                    {selected.status && <Badge>{selected.status}</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <DetailItem label="OEM" value={textOrDash(selected.oem)} highlight />
                  <DetailItem label="类目" value={textOrDash(selected.category)} />
                  <DetailItem label="供应商" value={textOrDash(selected.supplier)} />
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-5">
                <Card>
                  <CardHeader>
                    <CardTitle>规格价格</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <DetailItem label="最低售价" value={formatPrice(selected.lowestPrice)} highlight />
                      <DetailItem label="商品毛重" value={formatNumber(selected.grossWeightG, " g")} />
                      <DetailItem label="商品尺寸（含包装）" value={textOrDash(selected.packedSizeCm)} />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <PackageCheck className="h-4 w-4 text-orange-500" />
                      库存销售
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <MetricItem label="橙联可售" value={formatNumber(selected.available, " 件")} tone="green" />
                      <MetricItem label="橙联在途" value={formatNumber(selected.inTransit, " 件")} tone="blue" />
                      <MetricItem label="本地库存" value={formatNumber(selected.localStock, " 件")} tone="orange" />
                      <MetricItem label="国内集货仓" value={formatNumber(selected.domesticWarehouse, " 件")} />
                      <MetricItem label="总可用库存" value={formatNumber(selected.totalAvailable, " 件")} />
                      <MetricItem label="近 7 日日均销量" value={formatNumber(selected.dailySales7d, " 件/天")} />
                      <MetricItem
                        label="预计可售天数"
                        value={selected.sellableDays === null ? "--" : formatNumber(selected.sellableDays, " 天")}
                        tone={selected.sellableDays !== null && selected.sellableDays < 7 ? "red" : undefined}
                      />
                      <MetricItem label="安全库存" value={formatNumber(selected.safetyStock, " 件")} />
                      <MetricItem label="补货周期" value={formatNumber(selected.replenishCycleDays, " 天")} />
                      <MetricItem label="补货状态" value={textOrDash(selected.replenishStatus)} />
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>商品图片</CardTitle>
                  <CardDescription className="break-all">
                    {selected.imageUrl ? (
                      <a
                        href={selected.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-500 underline-offset-4 hover:text-orange-700 hover:underline"
                      >
                        {selected.imageUrl}
                      </a>
                    ) : (
                      "暂无图片链接"
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={copyImageUrl} disabled={!selected.imageUrl}>
                      <Clipboard className="h-4 w-4" />
                      复制链接
                    </Button>
                    {selected.imageUrl && (
                      <a
                        href={selected.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(buttonVariants({ variant: "outline" }))}
                      >
                        <ExternalLink className="h-4 w-4" />
                        打开链接
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
