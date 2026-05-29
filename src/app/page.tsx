import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MODULES } from "@/types";

export default function Home() {
  return (
    <div className="space-y-6 max-w-5xl">
      {/* 欢迎区 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">👋 欢迎回来，车泉</h1>
        <p className="text-gray-500 mt-1">eBay 四店铺运营管理 · NewPower / VelocityGear / TitanRig 运营中 · Nexusmoto 待启用</p>
      </div>

      {/* 快速概览卡片 */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "在售 SKU", value: "--", sub: "开售后显示" },
          { label: "待处理异常", value: "--", sub: "开售后显示" },
          { label: "本周需补货", value: "--", sub: "开售后显示" },
          { label: "30天销售额", value: "--", sub: "开售后显示" },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">{stat.label}</p>
              <p className="text-2xl font-bold mt-1">{stat.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 模块入口 */}
      <div className="grid grid-cols-2 gap-4">
        {MODULES.map((mod) => (
          <Link key={mod.id} href={mod.path}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-gray-200 hover:border-gray-400 h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  {mod.name}
                  {mod.id === "inventory" && (
                    <Badge className="text-xs bg-red-100 text-red-700 border-0">优先开发</Badge>
                  )}
                </CardTitle>
                <CardDescription>{mod.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-400">
                  {mod.id === "inventory" && "实时监控海外仓库存，AI预测断货时间并给出补货建议 →"}
                  {mod.id === "listing" && "从SKU数据读取 → AI生成标题/描述/ItemSpecs → 多版本对比 →"}
                  {mod.id === "reviews" && "输入买家评价 → AI情感分析 → 生成对应语气回复草稿 →"}
                  {mod.id === "sourcing" && "输入品类关键词 → AI市场分析 → 利润预估+风险评分 →"}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
