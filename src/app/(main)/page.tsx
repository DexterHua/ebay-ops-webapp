"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MODULES } from "@/types";

const EXTRA_DESC: Record<string, string> = {
  dashboard: "库存看板 · 销售趋势 · 售后分布 · 流程追踪 — 一张图看懂全局 →",
  inventory: "实时监控海外仓库存 · AI预测断货时间 · 智能补货建议 →",
  listing: "SKU自动选择 → AI生成eBay标题/HTML描述/ItemSpecs → 保存飞书 →",
  reviews: "飞书待办列表 → AI分析买家消息 → 生成回复草稿 → 回写飞书 →",
  sourcing: "品类关键词 → AI市场分析 → 利润预估 + 风险评分 → 保存选品池 →",
  dataEntry: "SKU主数据 · 销售日报 · 库存流水 · 客服异常 · 竞品监控 — 一站式录入 →",
};

export default function Home() {
  const [userName, setUserName] = useState("");
  const [stats, setStats] = useState({ sku: 0, inTransit: 0, value: 0 });

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me").then((r) => r.json()),
      fetch("/api/lark?table=sku&limit=200").then((r) => r.json()),
    ]).then(([me, skus]) => {
      if (me.name) setUserName(me.name);
      if (skus.success) {
        const valid = (skus.data || []).filter((s: Record<string, unknown>) => s.SKU && s["中文品名"]);
        const transit = valid.reduce((sum: number, s: Record<string, unknown>) => sum + (Number(s["橙联在途"]) || 0), 0);
        const val = valid.reduce((sum: number, s: Record<string, unknown>) => sum + (Number(s["采购价"]) || 0) * (Number(s["橙联在途"]) || 0), 0);
        setStats({ sku: valid.length, inTransit: transit, value: val });
      }
    }).catch(() => {});
  }, []);

  return (
    <div className="space-y-5 max-w-4xl">
      {/* 欢迎区 */}
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">概述</p>
        <h1 className="text-xl font-bold text-gray-900 mt-1">
          {userName ? `欢迎回来，${userName}` : <Skeleton className="h-7 w-40 inline-block" />}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          NewPower · VelocityGear · TitanRig 运营中 &nbsp;|&nbsp;
          {stats.sku > 0
            ? `${stats.sku} SKU · ${stats.inTransit.toLocaleString()} 件在途 · 货值 ¥${(stats.value / 10000).toFixed(1)}万`
            : <Skeleton className="h-4 w-64 inline-block" />}
        </p>
      </div>

      {/* 快速入口 */}
      <p className="text-xs text-gray-400 uppercase tracking-wider font-medium pt-2">功能模块</p>
      <div className="grid grid-cols-2 gap-3">
        {MODULES.map((mod) => (
          <Link key={mod.id} href={mod.path}>
            <Card className="hover:shadow-sm hover:border-gray-300 transition-all cursor-pointer border-gray-200 h-full group">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  {mod.name}
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
