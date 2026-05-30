"use client";

import { useState, useEffect, useMemo, use } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { STORES } from "@/types";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

const COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#6366f1"];
const STORE_COLORS: Record<string, string> = { NP: "#3b82f6", VG: "#f59e0b", TR: "#10b981" };

interface SkuData { SKU?: string; 中文品名?: string; 类目?: string[]; SKU状态?: string[]; 橙联可售?: number; 采购价?: number; 建议售价?: number; 预估毛利率?: number; 预估毛利?: number; 单件总成本?: number; 商品毛重g?: number; [key: string]: unknown; }

export default function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const store = STORES.find(s => s.id === id);
  const color = STORE_COLORS[id] || "#6b7280";

  const [skus, setSkus] = useState<SkuData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/lark?table=sku&limit=200").then(r => r.json()),
      fetch("/api/lark?table=sales&limit=500").then(r => r.json()),
      fetch("/api/lark?table=issues&limit=200").then(r => r.json()),
    ]).then(([s, sales, issues]) => {
      if (s.success) {
        const idx = ["NP", "VG", "TR"].indexOf(id);
        const filtered = (s.data as SkuData[]).filter((_, i) => i % 3 === idx);
        setSkus(filtered);
      } else toast.error("数据加载失败");
    }).catch(() => toast.error("网络错误"))
      .finally(() => setLoading(false));
  }, [id]);

  // ---- 销售数据（开卖后从API真实拉取） ----
  const salesData = useMemo(() => {
    return { hasData: false, 日均订单: "--", 周GMV: "--", 月售件数: "--", 客单价: "--" };
  }, []);

  // ---- 商品定价分析 ----
  const priced = useMemo(() => skus.filter(s => (s.建议售价 || 0) > 0), [skus]);
  const unpriced = useMemo(() => skus.filter(s => !s.建议售价 || s.建议售价 <= 0), [skus]);

  const priceRanges = useMemo(() => {
    const bins = [
      { name: "待定价", min: -1, max: 0, count: unpriced.length, color: "#9ca3af" },
      { name: "<$10", min: 0.01, max: 10, count: 0, color: "#06b6d4" },
      { name: "$10-20", min: 10, max: 20, count: 0, color: "#10b981" },
      { name: "$20-30", min: 20, max: 30, count: 0, color: "#3b82f6" },
      { name: "$30-50", min: 30, max: 50, count: 0, color: "#8b5cf6" },
      { name: ">$50", min: 50, max: 9999, count: 0, color: "#f59e0b" },
    ];
    priced.forEach(s => {
      const p = s.建议售价 || 0;
      for (let i = 1; i < bins.length; i++) { if (p >= bins[i].min && p < bins[i].max) { bins[i].count++; break; } }
    });
    return bins.filter(b => b.count > 0);
  }, [priced, unpriced]);

  // 毛利率分布
  const marginBins = useMemo(() => {
    const bins = [
      { name: "未定价", min: -1, max: -0.5, count: unpriced.length },
      { name: "<10%", min: 0, max: 0.1, count: 0 },
      { name: "10-30%", min: 0.1, max: 0.3, count: 0 },
      { name: "30-50%", min: 0.3, max: 0.5, count: 0 },
      { name: ">50%", min: 0.5, max: 999, count: 0 },
    ];
    skus.forEach(s => { const m = s.预估毛利率; if (!m || m <= 0) return; for (let i = 1; i < bins.length; i++) { if (m >= bins[i].min && m < bins[i].max) { bins[i].count++; break; } } });
    return bins;
  }, [skus, unpriced]);

  // 品类分布
  const categoryDist = useMemo(() => {
    const m: Record<string, number> = {};
    skus.forEach(s => { const c = Array.isArray(s.类目) ? s.类目[0] : (s.类目 || "未分类"); m[c] = (m[c] || 0) + 1; });
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [skus]);

  // 商品利润排名 TOP10
  const profitRank = useMemo(() =>
    [...skus].filter(s => (s.预估毛利 || 0) > 0).sort((a, b) => (b.预估毛利 || 0) - (a.预估毛利 || 0)).slice(0, 10).map(s => ({
      name: s.SKU || "?", 品名: s.中文品名 || "", 毛利: s.预估毛利 || 0, 毛利率: s.预估毛利率 ? `${(s.预估毛利率 * 100).toFixed(0)}%` : "--", 售价: s.建议售价 || 0,
    })), [skus]);

  // SKU 列表（按售价排序）
  const skuList = useMemo(() => [...skus].sort((a, b) => (b.建议售价 || 0) - (a.建议售价 || 0)), [skus]);

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><div className="grid grid-cols-5 gap-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-64" /></div>;
  if (!store) return <div className="text-center py-20 text-gray-400">店铺不存在</div>;

  return (
    <div className="space-y-5 max-w-7xl">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: color }}>
              {store.label}
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{store.name}</h1>
              <p className="text-xs text-gray-400">{store.description} · {skus.length} SKU · {priced.length} 已定价 · {unpriced.length} 待定价</p>
            </div>
          </div>
        </div>
        <Badge variant="outline" className="text-xs">飞书实时数据</Badge>
      </div>

      {/* 销售概览卡片 */}
      <div>
        <p className="text-[11px] text-gray-400 uppercase tracking-wider font-medium mb-3">销售概况 {!salesData.hasData && "(开卖后展示真实数据)"}</p>
        <div className="grid grid-cols-5 gap-3">
          <StatCard label="SKU 数量" value={skus.length} sub={`已定价 ${priced.length}`} color="text-gray-800" />
          <StatCard label="日均订单" value={salesData.日均订单} sub="开卖后统计" color="text-blue-600" />
          <StatCard label="周 GMV" value={salesData.周GMV} sub="近7天累计" color="text-emerald-600" />
          <StatCard label="月售件数" value={salesData.月售件数} sub="近30天" color="text-amber-600" />
          <StatCard label="客单价" value={salesData.客单价} sub="均值" color="text-purple-600" />
        </div>
      </div>

      {/* 定价 & 利润 图表行 */}
      <div className="grid grid-cols-3 gap-4">
        <ChartCard title="💲 售价区间分布">
          {priceRanges.length === 0 ? <Empty text="暂无已定价商品" /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={priceRanges}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                <XAxis dataKey="name" fontSize={10} />
                <YAxis fontSize={10} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" name="SKU数" radius={[3, 3, 0, 0]}>
                  {priceRanges.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="💰 毛利率分布">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={marginBins}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
              <XAxis dataKey="name" fontSize={10} />
              <YAxis fontSize={10} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} name="SKU数" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="🏷️ 品类构成">
          {categoryDist.length === 0 ? <Empty text="暂无数据" /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={categoryDist} cx="50%" cy="50%" innerRadius={40} outerRadius={75} dataKey="value" label={({ name, value }) => `${name} ${value}`}>
                  {categoryDist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* 利润排名 + 待定价清单 */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="🏆 单品利润 TOP10">
          {profitRank.length === 0 ? (
            <Empty text="暂无已定价商品，无法计算利润排名" />
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={profitRank} layout="vertical" margin={{ top: 0, right: 20, left: 90, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                <XAxis type="number" fontSize={10} tickFormatter={(v) => `¥${v}`} />
                <YAxis dataKey="name" type="category" fontSize={10} width={85} tickLine={false} />
                <Tooltip formatter={(v) => [`¥${v}`, "单件毛利"]} labelFormatter={(l) => { const s = profitRank.find(d => d.name === String(l)); return `${s?.品名 || l} · 毛利率${s?.毛利率}`; }} />
                <Bar dataKey="毛利" fill={color} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm">📋 待定价商品</CardTitle><CardDescription className="text-[11px]">建议售价为空，需要定价后上架</CardDescription></CardHeader>
          <CardContent>
            {unpriced.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">✅ 所有商品已定价</div>
            ) : (
              <ScrollArea className="max-h-[340px]">
                <div className="space-y-2">
                  {unpriced.map(s => (
                    <div key={s.SKU} className="p-2.5 bg-amber-50 rounded-lg border border-amber-100 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{s.SKU} <span className="text-xs text-gray-400">{s.中文品名}</span></p>
                        <p className="text-xs text-gray-500">采购价 ¥{s.采购价 || "--"}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">待定价</Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* SKU 商品明细表（定价视角） */}
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">📋 商品明细清单</CardTitle><CardDescription className="text-[11px]">按建议售价降序 · 共 {skuList.length} 个 SKU</CardDescription></CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[500px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="py-2 px-2 font-medium w-8">#</th>
                  <th className="py-2 px-2 font-medium">SKU</th>
                  <th className="py-2 px-2 font-medium">品名</th>
                  <th className="py-2 px-2 font-medium text-right">采购价(¥)</th>
                  <th className="py-2 px-2 font-medium text-right">成本(¥)</th>
                  <th className="py-2 px-2 font-medium text-right">售价($)</th>
                  <th className="py-2 px-2 font-medium text-right">毛利(¥)</th>
                  <th className="py-2 px-2 font-medium text-right">毛利率</th>
                  <th className="py-2 px-2 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {skuList.map((s, i) => {
                  const status = Array.isArray(s.SKU状态) ? s.SKU状态[0] : (s.SKU状态 || "");
                  const margin = s.预估毛利率 ? `${(s.预估毛利率 * 100).toFixed(0)}%` : "--";
                  return (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2 px-2 text-gray-400">{i + 1}</td>
                      <td className="py-2 px-2 font-mono text-gray-900">{s.SKU}</td>
                      <td className="py-2 px-2 text-gray-700 max-w-[160px] truncate">{s.中文品名}</td>
                      <td className="py-2 px-2 text-right">¥{s.采购价 || "--"}</td>
                      <td className="py-2 px-2 text-right">¥{s.单件总成本 || "--"}</td>
                      <td className="py-2 px-2 text-right font-medium">${s.建议售价 || "--"}</td>
                      <td className="py-2 px-2 text-right font-medium text-emerald-600">{s.预估毛利 ? `¥${s.预估毛利.toFixed(1)}` : "--"}</td>
                      <td className="py-2 px-2 text-right">{margin}</td>
                      <td className="py-2 px-2"><Badge variant="outline" className="text-[10px]">{status}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- 子组件 ----
function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <Card><CardContent className="p-3.5 text-center">
      <p className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </CardContent></Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader className="pb-1"><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>;
}

function Empty({ text }: { text: string }) {
  return <div className="py-12 text-center text-[11px] text-gray-400">{text}</div>;
}
