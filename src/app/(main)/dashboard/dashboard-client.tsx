"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import { CircleCheckBig } from "lucide-react";
import {
  normalizeInventoryDetailForSummary,
  summarizeInventoryQuantityByState,
  summarizeInTransitInventoryBySku,
  sumInventoryQuantityByState,
  sumInTransitInventoryQuantity,
} from "@/lib/inventory-flow";

// ============================================================
// 运营仪表盘
// ============================================================

const CATEGORY_COLORS = ["#f59e0b", "#334155", "#64748b", "#10b981", "#0ea5e9", "#a855f7"];
const STATUS_COLORS: Record<string, string> = {
  "橙联在途": "#3b82f6", "待清点": "#f59e0b", "已上架": "#10b981",
  "待评估": "#6b7280", "停售": "#ef4444",
};

interface SkuData { SKU?: string; 中文品名?: string; 类目?: string[]; SKU状态?: string[]; 橙联在途?: number | string; 橙联可售?: number | string; 本地库存?: number | string; 国内集货仓?: number | string; 总可用库存?: number | string; 账面总量?: number | string; 安全库存?: number | string; 采购价?: number | string; 预估毛利率?: number | string; 负责人?: string; [key: string]: unknown; }
interface IssueData { 异常类型?: string; 店铺?: string; 状态?: string; 优先级?: string; [key: string]: unknown; }
interface SalesData { 店铺?: string; SKU?: string; 售出数量?: number | string; 销售额?: number | string; 日期?: string; [key: string]: unknown; }

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function DashboardPage() {
  const [skus, setSkus] = useState<SkuData[]>([]);
  const [issues, setIssues] = useState<IssueData[]>([]);
  const [sales, setSales] = useState<SalesData[]>([]);
  const [inTransitQuantity, setInTransitQuantity] = useState(0);
  const [sellableQuantity, setSellableQuantity] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/lark?table=sku&limit=200").then(r => r.json()),
      fetch("/api/lark?table=summary&limit=200").then(r => r.json()),
      fetch("/api/lark?table=strategy&limit=200").then(r => r.json()),
      fetch("/api/lark?table=issues&limit=200").then(r => r.json()),
      fetch("/api/lark?table=sales&limit=200").then(r => r.json()),
      fetch("/api/inventory-flow/data?resource=details").then(r => r.json()),
    ]).then(([s, su, st, i, sa, id]) => {
      if (s.success && su.success && st.success && id.success) {
        const summaryBySku = new Map((su.data || []).map((row: SkuData) => [row.SKU, row]));
        const strategyBySku = new Map((st.data || []).map((row: SkuData) => [row.SKU, row]));
        const inventoryDetails = (id.data || [])
          .map(normalizeInventoryDetailForSummary)
          .filter((detail: ReturnType<typeof normalizeInventoryDetailForSummary>): detail is NonNullable<typeof detail> => Boolean(detail));
        const inTransitBySku = new Map(
          summarizeInTransitInventoryBySku(inventoryDetails).map((item) => [item.SKU, item.quantity]),
        );
        const sellableBySku = new Map(
          summarizeInventoryQuantityByState(inventoryDetails, "橙联可售").map((item) => [item.SKU, item.quantity]),
        );
        setInTransitQuantity(sumInTransitInventoryQuantity(inventoryDetails));
        setSellableQuantity(sumInventoryQuantityByState(inventoryDetails, "橙联可售"));
        setSkus((s.data || [])
          .filter((row: SkuData) => row.SKU && row.中文品名)
          .map((row: SkuData) => {
            const sku = row.SKU || "";
            return {
              ...row,
              ...(summaryBySku.get(row.SKU) || {}),
              ...(strategyBySku.get(row.SKU) || {}),
              橙联在途: inTransitBySku.get(sku) || 0,
              橙联可售: sellableBySku.get(sku) || 0,
            };
          }));
      }
      if (i.success) setIssues(i.data);
      if (sa.success) setSales(sa.data);
    }).catch(() => toast.error("数据加载失败"))
      .finally(() => setLoading(false));
  }, []);

  // ---- 聚合计算 ----
  const stats = useMemo(() => ({
    total: skus.length,
    local: skus.reduce((a, s) => a + toNumber(s.本地库存), 0),
    domesticHub: skus.reduce((a, s) => a + toNumber(s.国内集货仓), 0),
    inTransit: inTransitQuantity,
    available: sellableQuantity,
    // 广义在途已包含国内集货仓相关状态，货值汇总避免重复相加。
    totalAllValue: skus.reduce((a, s) => a + toNumber(s.采购价) * (toNumber(s.本地库存) + toNumber(s.橙联在途) + toNumber(s.橙联可售)), 0),
    // 移动货值 = 已离开本地仓的库存价值
    totalBookValue: skus.reduce((a, s) => a + toNumber(s.采购价) * (toNumber(s.橙联在途) + toNumber(s.橙联可售)), 0),
  }), [skus, inTransitQuantity, sellableQuantity]);

  // 分店铺库存（从流程表推算分配：SKU轮流分3店）
  const storeInventory = useMemo(() => {
    const stores = ["NewPower", "VelocityGear", "TitanRig"];
    return stores.map((name, idx) => {
      const items = skus.filter((_, i) => i % 3 === idx);
      return {
        name,
        在途: items.reduce((a, s) => a + toNumber(s.橙联在途), 0),
        可售: items.reduce((a, s) => a + toNumber(s.橙联可售), 0),
        国内集货仓: items.reduce((a, s) => a + toNumber(s.国内集货仓), 0),
        本地: items.reduce((a, s) => a + toNumber(s.本地库存), 0),
        SKU数: items.length,
      };
    });
  }, [skus]);

  // 品类分布
  const categoryDist = useMemo(() => {
    const map: Record<string, number> = {};
    skus.forEach(s => {
      const cat = Array.isArray(s.类目) ? s.类目[0] : (s.类目 || "未分类");
      map[cat] = (map[cat] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [skus]);

  // 在途TOP10
  const inTransitTop = useMemo(() =>
    [...skus].sort((a, b) => toNumber(b.橙联在途) - toNumber(a.橙联在途)).slice(0, 10).map(s => ({
      name: s.SKU || "?", 品名: s.中文品名 || "", value: toNumber(s.橙联在途),
    })), [skus]);

  // 国内集货仓TOP10
  const domesticHubTop = useMemo(() =>
    [...skus]
      .filter(s => toNumber(s.国内集货仓) > 0)
      .sort((a, b) => toNumber(b.国内集货仓) - toNumber(a.国内集货仓))
      .slice(0, 10).map(s => ({
        name: s.SKU || "?", 品名: s.中文品名 || "", value: toNumber(s.国内集货仓),
      })), [skus]);

  // 库存预警
  const lowStock = useMemo(() =>
    skus.filter(s => toNumber(s.安全库存) > 0 && toNumber(s.总可用库存) > 0 && toNumber(s.总可用库存) <= toNumber(s.安全库存) && toNumber(s.总可用库存) < 50)
      .sort((a, b) => toNumber(a.总可用库存) - toNumber(b.总可用库存)),
    [skus]);

  // 状态分布
  const statusDist = useMemo(() => {
    const map: Record<string, number> = {};
    skus.forEach(s => {
      const st = Array.isArray(s.SKU状态) ? s.SKU状态[0] : (s.SKU状态 || "未知");
      map[st] = (map[st] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [skus]);

  // 利润率分布
  const marginBins = useMemo(() => {
    const bins = [
      { name: "<10%", min: 0, max: 0.1, count: 0 },
      { name: "10-30%", min: 0.1, max: 0.3, count: 0 },
      { name: "30-50%", min: 0.3, max: 0.5, count: 0 },
      { name: ">50%", min: 0.5, max: 999, count: 0 },
      { name: "未定价", min: -1, max: -0.5, count: 0 },
    ];
    skus.forEach(s => {
      const m = toNumber(s.预估毛利率);
      if (m <= 0) { bins[4].count++; return; }
      for (let i = 0; i < 4; i++) {
        if (m >= bins[i].min && m < bins[i].max) { bins[i].count++; break; }
      }
    });
    return bins;
  }, [skus]);

  // 售后统计
  const issueStats = useMemo(() => {
    const total = issues.length;
    const byType: Record<string, number> = {};
    const byStore: Record<string, number> = { NewPower: 0, VelocityGear: 0, TitanRig: 0 };
    let highRisk = 0;
    issues.forEach(i => {
      const t = i.异常类型 || "其他"; byType[t] = (byType[t] || 0) + 1;
      if (i.优先级 === "高") highRisk++;
      const store = i.店铺;
      if (store && byStore[store] !== undefined) byStore[store]++;
    });
    return { total, byType, highRisk, byStore };
  }, [issues]);

  // 销售汇总
  const salesSummary = useMemo(() => {
    const byStore: Record<string, { revenue: number; qty: number }> = {};
    let totalRev = 0; let totalQty = 0;
    sales.forEach(s => {
      const st = s.店铺 || "未知";
      if (!byStore[st]) byStore[st] = { revenue: 0, qty: 0 };
      byStore[st].revenue += toNumber(s.销售额);
      byStore[st].qty += toNumber(s.售出数量);
      totalRev += toNumber(s.销售额);
      totalQty += toNumber(s.售出数量);
    });
    return { byStore, totalRev, totalQty };
  }, [sales]);

  if (loading) return (
    <div className="space-y-4 max-w-7xl">
      <Skeleton className="h-10 w-48" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">{[1,2,3,4,5].map(i=><Skeleton key={i} className="h-24"/>)}</div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{[1,2,3,4].map(i=><Skeleton key={i} className="h-64"/>)}</div>
    </div>
  );

  return (
    <div className="app-page">
      <div className="flex items-center justify-between">
        <div>
          <p className="page-kicker">Operations Dashboard</p>
          <h1 className="page-title">运营仪表盘</h1>
          <p className="page-description">
            实时数据概览 · {skus.length} SKU · 总库存 {stats.inTransit + stats.local + stats.available} 件 · 总货值 ¥{(stats.totalAllValue / 10000).toFixed(1)}万
          </p>
        </div>
      </div>

      {/* ---------- 概览卡片 ---------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="SKU总数" value={stats.total} color="text-blue-600" />
        <StatCard label="本地库存" value={`${stats.local}件`} color="text-emerald-600" />
        <StatCard label="国内集货仓" value={`${stats.domesticHub}件`} color="text-cyan-600" />
        <StatCard label="在途商品数量" value={`${stats.inTransit}件`} color="text-blue-600" />
        <StatCard label="橙联可售" value={`${stats.available}件`} sub={stats.available === 0 ? "待入仓上架" : ""} color={stats.available === 0 ? "text-gray-400" : "text-emerald-600"} />
        <StatCard label="总货值" value={`¥${(stats.totalAllValue/10000).toFixed(1)}万`} sub={`移动货值 ¥${(stats.totalBookValue/10000).toFixed(1)}万`} color="text-purple-600" />
      </div>

      {/* ---------- 店铺库存对比 ---------- */}
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-base">各店铺库存分配</CardTitle><CardDescription className="text-xs">按轮流分配规则估算，实际以 05_eBay上架库存分配 为准</CardDescription></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={storeInventory} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Bar dataKey="在途" fill="#334155" radius={[3, 3, 0, 0]} />
              <Bar dataKey="国内集货仓" fill="#06b6d4" radius={[3, 3, 0, 0]} />
              <Bar dataKey="可售" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="本地" fill="#f59e0b" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {storeInventory.map((s) => (
              <div key={s.name} className="text-center p-2 bg-gray-50 rounded">
                <p className="text-xs text-gray-500">{s.name}</p>
                <p className="text-lg font-bold mt-1 text-gray-800">{s.SKU数} <span className="text-xs font-normal text-gray-400">SKU</span></p>
                <p className="text-xs text-gray-400">在途{s.在途}件 · 集货仓{s.国内集货仓}件</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ---------- 第二行图：品类分布 + 状态分布 ---------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="品类分布" subtitle={`${skus.length} SKU，${categoryDist.length} 个品类`}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={categoryDist} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" label={({ name, value }) => `${name} ${value}`}>
                {categoryDist.map((_, i) => <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="SKU 状态分布" subtitle="当前各SKU所在阶段">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statusDist} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" label={({ name, value }) => `${name} ${value}`}>
                {statusDist.map((d) => <Cell key={d.name} fill={STATUS_COLORS[d.name] || "#9ca3af"} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ---------- 在途 TOP10 + 国内集货仓 TOP10 ---------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="在途商品数量 TOP10" subtitle="流转中数量最多的SKU">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={inTransitTop} layout="vertical" margin={{ top: 0, right: 20, left: 60, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" fontSize={11} />
              <YAxis dataKey="name" type="category" fontSize={10} width={90} tickLine={false} />
              <Tooltip formatter={(v) => [`${v}件`, "在途库存"]} labelFormatter={(l) => { const s = inTransitTop.find(d => d.name === String(l)); return s?.品名 || String(l); }} />
              <Bar dataKey="value" fill="#f59e0b" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="国内集货仓 TOP10" subtitle="已发往集货仓待组批发运的SKU">
          {domesticHubTop.length === 0 ? (
            <div className="py-12 text-center">
              <CircleCheckBig className="mx-auto mb-3 h-7 w-7 text-slate-200" />
              <p className="text-sm text-slate-400">暂未发往国内集货仓</p>
              <p className="text-xs text-slate-300">推进明细至「已发往国内集货仓」或「国内集货仓待发」后此处将展示数据</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={domesticHubTop} layout="vertical" margin={{ top: 0, right: 20, left: 60, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" fontSize={11} />
                <YAxis dataKey="name" type="category" fontSize={10} width={90} tickLine={false} />
                <Tooltip formatter={(v) => [`${v}件`, "集货仓库存"]} labelFormatter={(l) => { const s = domesticHubTop.find(d => d.name === String(l)); return s?.品名 || String(l); }} />
                <Bar dataKey="value" fill="#06b6d4" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* ---------- 库存预警 ---------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-1">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-base">库存预警</CardTitle><CardDescription className="text-xs">总可用库存 ≤ 安全库存 且 不足50件</CardDescription></CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">
                <CircleCheckBig className="mx-auto mb-3 h-7 w-7 text-emerald-500" />
                <p>{skus.length > 0 ? "所有 SKU 库存充足，无预警项" : "暂无 SKU 数据"}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-auto">
                {lowStock.map(s => (
                  <div key={s.SKU} className="flex items-center justify-between p-2.5 bg-red-50 rounded-lg border border-red-100">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{s.SKU} <span className="text-xs text-gray-400">{s.中文品名}</span></p>
                      <p className="text-xs text-gray-500">总可用: {s.总可用库存}件 · 安全库存: {s.安全库存}件</p>
                    </div>
                    <Badge variant="destructive" className="text-xs shrink-0">需补货</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------- 利润率分布 ---------- */}
      <ChartCard title="毛利率分布" subtitle="基于预估售价和成本自动计算">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={marginBins} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Bar dataKey="count" fill="#334155" radius={[3, 3, 0, 0]} name="SKU数" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* ---------- Tabs: 销售 / 售后 / 流程 ---------- */}
      <Tabs defaultValue="sales">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="sales">销售看板</TabsTrigger>
          <TabsTrigger value="issues">售后质量</TabsTrigger>
          <TabsTrigger value="flow">流程追踪</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-base">分店铺销售额</CardTitle><CardDescription className="text-xs">来源: 07_销售日报</CardDescription></CardHeader>
              <CardContent>
                {sales.length === 0 ? (
                  <EmptyPanel text="开卖后将自动展示销售数据" />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={Object.entries(salesSummary.byStore).map(([k, v]) => ({ name: k, 销售额: v.revenue, 销量: v.qty }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" fontSize={12} />
                      <YAxis fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="销售额" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-base">销售汇总</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {sales.length === 0 ? (
                  <EmptyPanel text="等待第一笔订单" />
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {["NewPower", "VelocityGear", "TitanRig"].map(st => (
                      <div key={st} className="p-3 bg-gray-50 rounded">
                        <p className="text-xs text-gray-500">{st}</p>
                        <p className="text-xl font-bold mt-1">${(salesSummary.byStore[st]?.revenue || 0).toFixed(0)}</p>
                        <p className="text-xs text-gray-400">{(salesSummary.byStore[st]?.qty || 0)} 件</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="issues" className="mt-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader className="pb-1"><CardTitle className="text-base">售后异常分布</CardTitle><CardDescription className="text-xs">来源: 08_客服售后异常 · 共 {issueStats.total} 条记录</CardDescription></CardHeader>
              <CardContent>
                {issues.length === 0 ? (
                  <EmptyPanel text="暂无售后异常记录" />
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={Object.entries(issueStats.byType).map(([k, v]) => ({ name: k, 数量: v }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" fontSize={11} angle={-30} textAnchor="end" height={60} />
                      <YAxis fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="数量" fill="#ef4444" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-base">售后汇总</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="p-3 bg-red-50 rounded">
                  <p className="text-sm text-red-700 font-medium">高风险事件</p>
                  <p className="text-2xl font-bold text-red-600">{issueStats.highRisk}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <p className="text-sm text-gray-600 font-medium">异常总数</p>
                  <p className="text-2xl font-bold text-gray-800">{issueStats.total}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-2">分店铺</p>
                  {Object.entries(issueStats.byStore).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                      <span className="text-gray-600">{k}</span>
                      <span className="font-medium">{v} 件</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="flow" className="mt-4">
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-base">流程阶段总览</CardTitle><CardDescription className="text-xs">来源: 17_运营流程节点 · 按流程阶段+店铺统计</CardDescription></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={storeInventory} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(v) => [`${v}个`, ""]} />
                  <Bar dataKey="SKU数" fill="#06b6d4" radius={[3, 3, 0, 0]} name="分配SKU数" />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  { label: "本地仓 (清点/包装)", desc: `${stats.local}件`, icon: "📦" },
                  { label: "国内集货仓 (待发运)", desc: `${stats.domesticHub}件`, icon: "🏭" },
                  { label: "在途商品数量", desc: `${stats.inTransit}件`, icon: "🚢" },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                    <div>
                      <span className="text-sm text-gray-700">{item.icon} {item.label}</span>
                      <p className="text-xs text-gray-400">{item.desc}</p>
                    </div>
                    <Badge variant="secondary" className="text-xs">{
                      skus.filter(s => (
                        (item.label.includes("本地") && toNumber(s.本地库存) > 0) ||
                        (item.label.includes("集货仓") && toNumber(s.国内集货仓) > 0) ||
                        (item.label.includes("在途") && toNumber(s.橙联在途) > 0)
                      )).length
                    } SKU</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- 子组件 ----
function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-xs text-gray-400">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
        {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle && <CardDescription className="text-xs">{subtitle}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="py-12 text-center">
      <CircleCheckBig className="mx-auto mb-3 h-7 w-7 text-slate-300" />
      <p className="text-sm text-slate-400">{text}</p>
    </div>
  );
}
