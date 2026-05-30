"use client";

import { useState, useEffect, useMemo } from "react";
import { use } from "react";
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

interface SkuData { SKU?: string; 中文品名?: string; 类目?: string[]; SKU状态?: string[]; 橙联在途?: number; 橙联可售?: number; 本地库存?: number; 总可用库存?: number; 安全库存?: number; 采购价?: number; 预估毛利率?: number; 预估毛利?: number; 建议售价?: number; 单件总成本?: number; 商品毛重g?: number; [key: string]: unknown; }

export default function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const store = STORES.find(s => s.id === id);
  const color = STORE_COLORS[id] || "#6b7280";

  const [skus, setSkus] = useState<SkuData[]>([]);
  const [allSkus, setAllSkus] = useState<SkuData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/lark?table=sku&limit=200")
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          setAllSkus(json.data);
          // 按轮替规则筛选本店SKU
          const idx = ["NP", "VG", "TR"].indexOf(id);
          const filtered = (json.data as SkuData[]).filter((_, i) => i % 3 === idx);
          setSkus(filtered);
        } else toast.error("数据加载失败");
      })
      .catch(() => toast.error("网络错误"))
      .finally(() => setLoading(false));
  }, [id]);

  // ---- 汇总 ----
  const stats = useMemo(() => ({
    count: skus.length,
    inTransit: skus.reduce((a, s) => a + (s.橙联在途 || 0), 0),
    available: skus.reduce((a, s) => a + (s.橙联可售 || 0), 0),
    local: skus.reduce((a, s) => a + (s.本地库存 || 0), 0),
    total: skus.reduce((a, s) => a + (s.总可用库存 || 0), 0),
    value: skus.reduce((a, s) => a + (s.采购价 || 0) * (s.橙联在途 || 0), 0),
    avgMargin: skus.filter(s => (s.预估毛利率 || 0) > 0).length > 0
      ? skus.filter(s => (s.预估毛利率 || 0) > 0).reduce((a, s) => a + (s.预估毛利率 || 0), 0) / skus.filter(s => (s.预估毛利率 || 0) > 0).length
      : 0,
  }), [skus]);

  // 品类分布
  const categoryDist = useMemo(() => {
    const m: Record<string, number> = {};
    skus.forEach(s => { const c = Array.isArray(s.类目) ? s.类目[0] : (s.类目 || "未分类"); m[c] = (m[c] || 0) + 1; });
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [skus]);

  // 状态分布
  const statusDist = useMemo(() => {
    const m: Record<string, number> = {};
    skus.forEach(s => { const st = Array.isArray(s.SKU状态) ? s.SKU状态[0] : (s.SKU状态 || "未知"); m[st] = (m[st] || 0) + 1; });
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [skus]);

  // 毛利率分布
  const marginBins = useMemo(() => {
    const bins = [{ name: "未定价", min: -1, max: -0.5, count: 0 }, { name: "<10%", min: 0, max: 0.1, count: 0 }, { name: "10-30%", min: 0.1, max: 0.3, count: 0 }, { name: "30-50%", min: 0.3, max: 0.5, count: 0 }, { name: ">50%", min: 0.5, max: 999, count: 0 }];
    skus.forEach(s => { const m = s.预估毛利率; if (!m || m <= 0) { bins[0].count++; return; } for (let i = 1; i < bins.length; i++) { if (m >= bins[i].min && m < bins[i].max) { bins[i].count++; break; } } });
    return bins;
  }, [skus]);

  // 在途TOP10
  const transitTop = useMemo(() => [...skus].sort((a, b) => (b.橙联在途 || 0) - (a.橙联在途 || 0)).slice(0, 8).map(s => ({ name: s.SKU || "?", 品名: s.中文品名 || "", 在途: s.橙联在途 || 0, 可售: s.橙联可售 || 0 })), [skus]);

  // 库存预警
  const alerts = useMemo(() => skus.filter(s => (s.总可用库存 || 0) > 0 && (s.总可用库存 || 0) <= (s.安全库存 || 30) && (s.总可用库存 || 0) < 50).sort((a, b) => (a.总可用库存 || 0) - (b.总可用库存 || 0)), [skus]);

  // SKU 列表
  const skuList = useMemo(() => [...skus].sort((a, b) => (b.橙联在途 || 0) - (a.橙联在途 || 0)), [skus]);

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
              <p className="text-xs text-gray-400">{store.description} · {stats.count} SKU · 在途 {stats.inTransit} 件 · 货值 ¥{stats.value.toLocaleString()}</p>
            </div>
          </div>
        </div>
        <Badge variant="outline" className="text-xs">飞书实时数据</Badge>
      </div>

      {/* 概览卡片 */}
      <div className="grid grid-cols-5 gap-3">
        <StatCard label="SKU 数量" value={stats.count} unit="个" color="text-gray-800" />
        <StatCard label="橙联在途" value={stats.inTransit} unit="件" color="text-blue-600" />
        <StatCard label="橙联可售" value={stats.available} unit="件" color={stats.available ? "text-emerald-600" : "text-gray-300"} />
        <StatCard label="本地库存" value={stats.local} unit="件" color="text-amber-600" />
        <StatCard label="平均毛利率" value={stats.avgMargin > 0 ? `${(stats.avgMargin * 100).toFixed(1)}%` : "--"} unit="" color="text-purple-600" />
      </div>

      {/* 图表区 */}
      <div className="grid grid-cols-3 gap-4">
        {/* 品类 */}
        <ChartCard title="品类分布">
          {categoryDist.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart><Pie data={categoryDist} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value" label={({ name, value }) => `${name} ${value}`}>{categoryDist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* 状态 */}
        <ChartCard title="SKU 状态">
          {statusDist.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart><Pie data={statusDist} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value" label={({ name, value }) => `${name} ${value}`}>{statusDist.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* 毛利率 */}
        <ChartCard title="毛利率分布">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={marginBins}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
              <XAxis dataKey="name" fontSize={10} />
              <YAxis fontSize={10} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} name="SKU数" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* 在途TOP8 + 库存预警 */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="在途库存 TOP8">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={transitTop} layout="vertical" margin={{ top: 0, right: 20, left: 80, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
              <XAxis type="number" fontSize={10} />
              <YAxis dataKey="name" type="category" fontSize={10} width={75} tickLine={false} />
              <Tooltip formatter={(v) => [`${v}件`, "在途"]} labelFormatter={(l) => { const s = transitTop.find(d => d.name === String(l)); return s?.品名 || String(l); }} />
              <Bar dataKey="在途" fill={color} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm">⚠️ 库存预警</CardTitle><CardDescription className="text-[11px]">总可用库存 ≤ 安全库存 且不足50件</CardDescription></CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">✅ 库存充足，无预警</div>
            ) : (
              <ScrollArea className="max-h-[280px]">
                <div className="space-y-2">
                  {alerts.map(s => (
                    <div key={s.SKU} className="p-2.5 bg-red-50 rounded-lg border border-red-100">
                      <p className="text-sm font-medium text-gray-900">{s.SKU} <span className="text-xs text-gray-400">{s.中文品名}</span></p>
                      <p className="text-xs text-gray-500 mt-0.5">总可用: {s.总可用库存}件 · 安全库存: {s.安全库存}件</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* SKU 明细 */}
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm">📋 SKU 明细清单</CardTitle><CardDescription className="text-[11px]">按在途数量降序排列 · 共 {skuList.length} 个</CardDescription></CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[500px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-left text-gray-500">
                  <th className="py-2 px-2 font-medium w-8">#</th>
                  <th className="py-2 px-2 font-medium">SKU</th>
                  <th className="py-2 px-2 font-medium">品名</th>
                  <th className="py-2 px-2 font-medium text-right">在途</th>
                  <th className="py-2 px-2 font-medium text-right">可售</th>
                  <th className="py-2 px-2 font-medium text-right">本地</th>
                  <th className="py-2 px-2 font-medium text-right">总可用</th>
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
                      <td className="py-2 px-2 text-gray-700">{s.中文品名}</td>
                      <td className="py-2 px-2 text-right font-medium text-blue-600">{s.橙联在途 || 0}</td>
                      <td className="py-2 px-2 text-right font-medium text-emerald-600">{s.橙联可售 || 0}</td>
                      <td className="py-2 px-2 text-right text-amber-600">{s.本地库存 || 0}</td>
                      <td className="py-2 px-2 text-right font-medium">{s.总可用库存 || 0}</td>
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
function StatCard({ label, value, unit, color }: { label: string; value: string | number; unit: string; color: string }) {
  return (
    <Card><CardContent className="p-3.5 text-center">
      <p className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {unit && <p className="text-[10px] text-gray-400">{unit}</p>}
    </CardContent></Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader className="pb-1"><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>;
}

function Empty() {
  return <div className="py-12 text-center text-[11px] text-gray-400">暂无数据</div>;
}
