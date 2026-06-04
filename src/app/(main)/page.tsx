"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MODULES } from "@/types";
import { ModuleIcon } from "@/components/layout/module-icons";
import { ArrowUpRight, Boxes, PackageCheck, WalletCards } from "lucide-react";

const EXTRA_DESC: Record<string, string> = {
  dashboard: "库存看板 · 销售趋势 · 售后分布 · 流程追踪 — 一张图看懂全局 →",
  inventory: "实时监控海外仓库存 · AI预测断货时间 · 智能补货建议 →",
  listing: "SKU自动选择 → AI生成eBay标题/HTML描述/ItemSpecs → 保存飞书 →",
  reviews: "飞书待办列表 → AI分析买家消息 → 生成回复草稿 → 回写飞书 →",
  dataEntry: "SKU主数据 · 销售日报 · 库存流水 · 客服异常 · 竞品监控 — 一站式录入 →",
  finance: "报销申请提报 → 财务审批 → 记录归档 → 飞书烁立德财务表格同步 →",
};

export default function Home() {
  const [userName, setUserName] = useState("");
  const [stats, setStats] = useState({ sku: 0, pipeline: 0, pipelineValue: 0, totalValue: 0 });

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me").then((r) => r.json()),
      fetch("/api/lark?table=sku&limit=200").then((r) => r.json()),
      fetch("/api/lark?table=summary&limit=200").then((r) => r.json()),
    ]).then(([me, skus, summary]) => {
      if (me.name) setUserName(me.name);
      if (skus.success && summary.success) {
        const valid = (skus.data || []).filter((s: Record<string, unknown>) => s.SKU && s["中文品名"]);
        const skuByCode = new Map(valid.map((s: Record<string, unknown>) => [String(s.SKU), s]));
        const snapshots = (summary.data || []) as Array<Record<string, unknown>>;

        // 在途库存 = 国内集货仓 + 橙联在途（已离开公司但未到可售状态的货物）
        const pipeline = snapshots.reduce((sum, s) =>
          sum + (Number(s["国内集货仓"]) || 0) + (Number(s["橙联在途"]) || 0), 0);

        // 计算全部库存总货值（本地 + 国内集货仓 + 橙联在途 + 橙联可售）
        const totalVal = snapshots.reduce((sum, s) => {
          const sku = skuByCode.get(String(s.SKU)) as Record<string, unknown> | undefined;
          const price = Number(sku?.["采购价"]) || 0;
          const qty = (Number(s["本地库存"]) || 0) + (Number(s["国内集货仓"]) || 0)
            + (Number(s["橙联在途"]) || 0) + (Number(s["橙联可售"]) || 0);
          return sum + price * qty;
        }, 0);

        // 在途货值 = 国内集货仓 + 橙联在途 的价值
        const pipelineVal = snapshots.reduce((sum, s) => {
          const sku = skuByCode.get(String(s.SKU)) as Record<string, unknown> | undefined;
          const price = Number(sku?.["采购价"]) || 0;
          const qty = (Number(s["国内集货仓"]) || 0) + (Number(s["橙联在途"]) || 0);
          return sum + price * qty;
        }, 0);

        setStats({ sku: valid.length, pipeline, pipelineValue: pipelineVal, totalValue: totalVal });
      }
    }).catch(() => {});
  }, []);

  return (
    <div className="app-page max-w-6xl">
      {/* 欢迎区 */}
      <div>
        <p className="page-kicker">Operations Overview</p>
        <h1 className="page-title">
          {userName ? `欢迎回来，${userName}` : <span className="inline-block h-7 w-40 animate-pulse rounded-md bg-muted align-middle" />}
        </h1>
        <p className="page-description">
          NewPower · VelocityGear · TitanRig 运营中 &nbsp;|&nbsp;
          {stats.sku > 0
            ? `${stats.sku} SKU · ${stats.pipeline.toLocaleString()} 件在途 · 总货值 ¥${(stats.totalValue / 10000).toFixed(1)}万`
            : <span className="inline-block h-4 w-64 animate-pulse rounded-md bg-muted align-middle" />}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <SummaryCard icon={Boxes} label="有效 SKU" value={stats.sku.toLocaleString()} />
        <SummaryCard icon={PackageCheck} label="在途库存" value={`${stats.pipeline.toLocaleString()} 件`} />
        <SummaryCard icon={WalletCards} label="在途货值" value={`¥${(stats.pipelineValue / 10000).toFixed(1)} 万`} />
        <SummaryCard icon={WalletCards} label="总货值" value={`¥${(stats.totalValue / 10000).toFixed(1)} 万`} />
      </div>

      {/* 快速入口 */}
      <p className="page-kicker pt-2">Modules</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODULES.map((mod) => (
          <Link key={mod.id} href={mod.path}>
            <Card className="group h-full cursor-pointer border-slate-200 transition-all hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-[0_14px_30px_rgba(15,23,42,0.08)]">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                      <ModuleIcon moduleId={mod.id} className="h-4.5 w-4.5" strokeWidth={1.8} />
                    </span>
                    {mod.name}
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-orange-500" />
                </CardTitle>
                <CardDescription className="text-xs">{mod.description}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-[12px] text-gray-400 group-hover:text-gray-600 transition-colors leading-relaxed">
                  {EXTRA_DESC[mod.id] || ""}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: typeof Boxes; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
          <Icon className="h-4.5 w-4.5" strokeWidth={1.8} />
        </span>
        <div>
          <p className="text-xs font-medium text-slate-400">{label}</p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-slate-900">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
