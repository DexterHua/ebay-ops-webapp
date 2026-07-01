export interface InventoryAnalysisInput {
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
  totalSales: number;
  autoDailySales: number;
}

export interface InventoryAnalysisResult {
  analysis: Array<{
    sku: string;
    productName: string;
    currentStock: { available: number; inTransit: number; local: number };
    dailySales: number;
    salesTrend: string;
    trendExplanation: string;
    daysUntilStockout: number;
    suggestedOrderQty: number;
    suggestedOrderDate: string;
    priority: string;
    priorityReason: string;
    riskNote: string;
    aiSummary: string;
  }>;
  summary: {
    urgentCount: number;
    warningCount: number;
    normalCount: number;
    overallAdvice: string;
  };
}

export const REPLENISHMENT_EXPORT_COLUMNS = [
  "SKU",
  "商品名称",
  "橙联可售",
  "橙联在途",
  "本地库存",
  "日均销量",
  "预计断货天数",
  "建议采购量",
  "最晚下单",
  "采购优先级",
  "风险提示",
  "分析摘要",
] as const;

export type ReplenishmentExportRow = Record<typeof REPLENISHMENT_EXPORT_COLUMNS[number], string>;

function formatDateAfterDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + Math.max(0, Math.floor(days)));
  return date.toISOString().slice(0, 10);
}

function priorityLabel(priority: string): string {
  switch (priority) {
    case "urgent": return "紧急";
    case "this_week": return "本周";
    case "this_month": return "本月";
    default: return "正常";
  }
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function priorityForSku(sku: InventoryAnalysisInput, daysUntilStockout: number): string {
  if (sku.dailySales <= 0) {
    if (sku.inTransit > 0 && sku.inTransit < 20) return "this_month";
    if (sku.cost > 100) return "this_month";
    return "normal";
  }

  const cycle = Math.max(1, sku.replenishCycle || 30);
  if (daysUntilStockout < cycle * 0.3 && sku.profitMargin >= 0.3) return "urgent";
  if (daysUntilStockout < cycle * 0.7) return "this_week";
  if (daysUntilStockout < cycle) return "this_month";
  return "normal";
}

function priorityReason(priority: string, sku: InventoryAnalysisInput, daysUntilStockout: number): string {
  if (sku.dailySales <= 0) {
    if (priority === "this_month") return "尚无销售数据，但在途较浅或货值较高，需要开卖后重点跟踪。";
    return "尚无销售数据，暂不建议立即补货，先观察开卖表现。";
  }
  if (priority === "urgent") return `可售约 ${daysUntilStockout} 天，低于补货周期的 30%，且毛利较高。`;
  if (priority === "this_week") return `可售约 ${daysUntilStockout} 天，低于补货周期的 70%。`;
  if (priority === "this_month") return `可售约 ${daysUntilStockout} 天，低于补货周期。`;
  return "当前可售库存覆盖补货周期，暂按正常节奏观察。";
}

function riskNoteForSku(sku: InventoryAnalysisInput, daysUntilStockout: number): string {
  const notes: string[] = [];
  if (sku.dailySales > 0 && daysUntilStockout < 7) notes.push("断货风险高");
  if (sku.inTransit > 0 && sku.inTransit < 20) notes.push("在途库存偏浅");
  if (sku.cost > 100) notes.push("高货值");
  if (sku.dailySales <= 0) notes.push("缺少销售数据");
  return notes.join("；");
}

function summaryForSku(sku: InventoryAnalysisInput, priority: string, daysUntilStockout: number, suggestedOrderQty: number): string {
  if (sku.dailySales <= 0) {
    return `当前未形成销售日均，建议先跟踪开卖后 7 天数据；在途 ${sku.inTransit} 件，本轮建议采购 ${suggestedOrderQty} 件。`;
  }
  if (priority === "normal") {
    return `当前可售约 ${daysUntilStockout} 天，覆盖补货周期；建议继续观察销量变化。`;
  }
  return `当前可售约 ${daysUntilStockout} 天，已低于补货周期阈值；建议采购 ${suggestedOrderQty} 件。`;
}

export function buildRuleBasedInventoryAnalysis(skus: InventoryAnalysisInput[]): InventoryAnalysisResult {
  const analysis = skus.map((sku) => {
    const daysUntilStockout = sku.dailySales > 0 ? Math.floor(sku.available / sku.dailySales) : 0;
    const suggestedOrderQty = sku.dailySales > 0
      ? Math.max(0, Math.ceil((Math.max(1, sku.replenishCycle || 30) + 15) * sku.dailySales))
      : 0;
    const priority = priorityForSku(sku, daysUntilStockout);
    const suggestedOrderDate = sku.dailySales > 0
      ? formatDateAfterDays(daysUntilStockout - Math.max(1, sku.replenishCycle || 30))
      : "N/A";

    return {
      sku: sku.sku,
      productName: sku.productName,
      currentStock: { available: sku.available, inTransit: sku.inTransit, local: sku.local },
      dailySales: sku.dailySales,
      salesTrend: sku.dailySales > 0 ? "stable" : "pre_launch",
      trendExplanation: sku.dailySales > 0
        ? `${sku.salesTrend || "已有销售数据"}，日均销量 ${sku.dailySales} 件。`
        : "尚无销售数据，处于开卖观察阶段。",
      daysUntilStockout,
      suggestedOrderQty,
      suggestedOrderDate,
      priority,
      priorityReason: priorityReason(priority, sku, daysUntilStockout),
      riskNote: riskNoteForSku(sku, daysUntilStockout),
      aiSummary: summaryForSku(sku, priority, daysUntilStockout, suggestedOrderQty),
    };
  });

  const urgentCount = analysis.filter((item) => item.priority === "urgent").length;
  const warningCount = analysis.filter((item) => item.priority === "this_week" || item.priority === "this_month").length;
  const normalCount = analysis.length - urgentCount - warningCount;
  const hasSales = skus.some((sku) => sku.dailySales > 0);
  const lowTransitCount = skus.filter((sku) => sku.dailySales <= 0 && sku.inTransit > 0 && sku.inTransit < 20).length;
  const highCostCount = skus.filter((sku) => sku.cost > 100).length;

  return {
    analysis,
    summary: {
      urgentCount,
      warningCount,
      normalCount,
      overallAdvice: hasSales
        ? `已基于库存、销量和补货周期生成规则分析。紧急 ${urgentCount} 个，需关注 ${warningCount} 个；优先处理可售天数低于补货周期的 SKU。`
        : `当前处于未开卖或销量不足阶段，建议先积累至少 7 天销售数据。低在途 SKU ${lowTransitCount} 个，高货值 SKU ${highCostCount} 个需重点观察。`,
    },
  };
}

export function hydrateInventoryAnalysisFromSource(
  result: InventoryAnalysisResult,
  skus: InventoryAnalysisInput[],
): InventoryAnalysisResult {
  const bySku = new Map(skus.map((sku) => [sku.sku, sku]));

  return {
    ...result,
    analysis: result.analysis.map((item) => {
      const source = bySku.get(item.sku);
      if (!source) return item;
      return {
        ...item,
        productName: source.productName || item.productName,
        currentStock: {
          available: source.available,
          inTransit: source.inTransit,
          local: source.local,
        },
        dailySales: source.dailySales,
        daysUntilStockout: source.dailySales > 0 ? Math.floor(source.available / source.dailySales) : item.daysUntilStockout,
      };
    }),
  };
}

export function buildReplenishmentExportRows(result: InventoryAnalysisResult): ReplenishmentExportRow[] {
  return result.analysis
    .filter((item) => item.priority !== "normal" && item.suggestedOrderQty > 0)
    .map((item) => ({
      SKU: item.sku,
      商品名称: item.productName,
      橙联可售: String(item.currentStock.available),
      橙联在途: String(item.currentStock.inTransit),
      本地库存: String(item.currentStock.local),
      日均销量: String(item.dailySales),
      预计断货天数: String(item.daysUntilStockout),
      建议采购量: String(item.suggestedOrderQty),
      最晚下单: item.suggestedOrderDate === "N/A" ? "待定" : item.suggestedOrderDate,
      采购优先级: priorityLabel(item.priority),
      风险提示: item.riskNote,
      分析摘要: item.aiSummary,
    }));
}

export function buildReplenishmentExcelHtml(rows: ReplenishmentExportRow[]): string {
  const headers = REPLENISHMENT_EXPORT_COLUMNS.map((column) => `<th>${htmlEscape(column)}</th>`).join("");
  const body = rows.map((row) => (
    `<tr>${REPLENISHMENT_EXPORT_COLUMNS.map((column) => `<td>${htmlEscape(row[column] || "")}</td>`).join("")}</tr>`
  )).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    table { border-collapse: collapse; font-family: Arial, "Microsoft YaHei", sans-serif; font-size: 12px; }
    th, td { border: 1px solid #d8dee8; padding: 6px 8px; mso-number-format: "\\@"; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 700; }
  </style>
</head>
<body>
  <table>
    <thead><tr>${headers}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
}

export function isRecoverableInventoryAiError(error?: string): boolean {
  if (!error) return false;
  return error.includes("JSON 不完整") ||
    error.includes("未返回可解析内容") ||
    error.includes("未返回有效内容");
}
