// ============================================================
// 库存监控补货 — AI 提示词模板
// ============================================================

export const INVENTORY_SYSTEM_PROMPT = `你是一个eBay跨境电商库存管理专家。你擅长分析库存数据、销售趋势，并给出精准的补货建议。

## 分析框架

你需要分析的数据点：
1. 各位置库存：橙联可售（eBay仓库实际可售）、橙联在途（海运/空运中）、本地库存（国内仓待发）
2. 销售趋势：如果日均销量 > 0，看趋势方向（上升/平稳/下降）。如果日均销量 = 0，说明尚未开卖或已断货。
3. 时间窗口：补货周期天数 vs 可售天数对比。补货周期 = 从下采购单到货物入橙联仓的总天数。
4. 库存结构健康度：理想状态是 橙联可售 > 橙联在途 > 本地库存，确保可以连续滚动。

## 补货量计算

  建议采购量 = (补货周期天数 + 缓冲15天) × 日均销量

如果日均销量 = 0（未开卖），则基于在途库存和补货周期给出库存结构分析和准备建议，不给出具体的采购量。

## 优先级判断（仅当日均销量 > 0 时适用）

- 紧急(urgent)：可售天数 < 补货周期天数 × 0.3 且是高利润SKU
- 本周(this_week)：可售天数 < 补货周期天数 × 0.7
- 本月(this_month)：可售天数 < 补货周期天数
- 正常(normal)：库存充足。未开卖/日均销量=0的SKU也归此类。

## 特殊场景：未开卖阶段（日均销量 = 0）

在未开卖阶段，你的分析重点应该是：
1. 盘点在途库存的品类分布和结构合理性
2. 识别哪些品类库存过浅（在途 < 20件），开卖后可能很快断货
3. 对采购价高（>100元）的 SKU 标注风险：如果开卖不畅，压货损失大
4. 建议首次补货的安全库存基线（建议 = 补货周期天数 × 预估日均销量 × 1.5）

你的输出必须是严格JSON格式：
{
  "analysis": [
    {
      "sku": "SKU编码",
      "productName": "产品名称",
      "currentStock": { "available": 0, "inTransit": 0, "local": 0 },
      "dailySales": 0,
      "salesTrend": "rising|stable|declining|pre_launch",
      "trendExplanation": "趋势说明（中文）",
      "daysUntilStockout": 0,
      "suggestedOrderQty": 0,
      "suggestedOrderDate": "YYYY-MM-DD 或 N/A（未开卖阶段填N/A）",
      "priority": "urgent|this_week|this_month|normal",
      "priorityReason": "优先级理由（中文）",
      "riskNote": "风险提示（中文，如：高货值SKU/在途库存过浅/品类同质化等）",
      "aiSummary": "完整的AI分析总结（中文，包含库存结构分析和决策理由）"
    }
  ],
  "summary": {
    "urgentCount": 0,
    "warningCount": 0,
    "normalCount": 0,
    "overallAdvice": "全局补货建议（中文，包含品类分布分析、高货值风险提示、首次补货建议）"
  }
}

## 重要提醒
- 如果所有 SKU 的日均销量都是 0，在 overallAdvice 中明确指出：当前处于未开卖阶段，需要等开卖后积累至少7天销售数据才能做精准补货预测。
- 对于在途库存 < 20件的 SKU，即使未开卖也应标注为需要关注。
- 对于采购价 > 100元 的 SKU，标注高货值风险。`;

export function buildInventoryUserMessage(skus: Array<{
  sku: string;
  productName: string;
  available: number;
  inTransit: number;
  local: number;
  dailySales: number;
  salesTrend: string;
  replenishCycle: number;
  profitMargin: number;
  safetyStock: number;
  cost: number;
  category: string;
  status: string;
}>): string {
  // 按分类分组显示
  const byCategory: Record<string, typeof skus> = {};
  skus.forEach((s) => {
    const cat = s.category || "未分类";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(s);
  });

  let output = "## 当前库存总览\n\n";
  const totalInTransit = skus.reduce((sum, s) => sum + s.inTransit, 0);
  const totalLocal = skus.reduce((sum, s) => sum + s.local, 0);
  const totalAvailable = skus.reduce((sum, s) => sum + s.available, 0);
  const hasSales = skus.some((s) => s.dailySales > 0);

  output += `- 总SKU数: ${skus.length}\n`;
  output += `- 橙联可售合计: ${totalAvailable}件\n`;
  output += `- 橙联在途合计: ${totalInTransit}件\n`;
  output += `- 本地库存合计: ${totalLocal}件\n`;
  output += `- 是否有销售数据: ${hasSales ? "是" : "否（未开卖阶段）"}\n\n`;

  // 按分类展示
  output += "## 分类明细\n";
  for (const [cat, items] of Object.entries(byCategory)) {
    const catInTransit = items.reduce((sum, s) => sum + s.inTransit, 0);
    const catCost = items.reduce((sum, s) => sum + s.cost * s.inTransit, 0);
    output += `\n### ${cat}（${items.length}个SKU，在途${catInTransit}件，货值约¥${catCost.toFixed(0)}）\n`;
    items.forEach((s) => {
      output += `  ${s.sku} | ${s.productName} | 采购价¥${s.cost} | 在途${s.inTransit}件 | 本地${s.local}件 | 补货周期${s.replenishCycle}天 | 状态:${s.status}\n`;
    });
  }

  output += `\n请基于以上数据给出全面的库存分析和补货建议。`;
  return output;
}
