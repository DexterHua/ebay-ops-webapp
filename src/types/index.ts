// ============================================================
// eBay 运营 WebApp — 全局类型定义
// ============================================================

// --- 店铺 ---
export type StoreId = "A" | "B" | "C" | "D";

export interface Store {
  id: StoreId;
  name: string;
  label: string;
  description: string;
  active: boolean;
}

// --- SKU 主数据（映射自 01_SKU主数据） ---
export interface SkuMasterData {
  sku: string;
  中文品名: string;
  英文标题关键词: string;
  类目: string;
  规格: string;
  采购价: number;
  建议售价: number;
  头程成本: number;
  橙联可售: number;
  橙联在途: number;
  本地库存: number;
  总可用库存: number;
  近7日日均销量: number;
  可售天数: string;
  安全库存: number;
  补货点: number;
  补货周期天数: number;
  SKU状态: string;
  补货状态: string;
  负责人: string;
  广告费率: number;
  预估毛利率: number;
  预估毛利: number;
  风险标签: string;
  供应商: string;
}

// --- 库存监控 ---
export interface StockAlert {
  sku: string;
  productName: string;
  橙联可售: number;
  橙联在途: number;
  本地库存: number;
  dailySales: number;
  daysRemaining: number;
  replenishCycleDays: number;
  estimatedOutOfStockDate: string;
  priority: "urgent" | "warning" | "normal";
  profitMargin: number;
}

export interface ReplenishAdvice {
  sku: string;
  productName: string;
  currentStock: number;
  inTransit: number;
  dailySales: number;
  salesTrend: "rising" | "stable" | "declining";
  daysUntilStockout: number;
  suggestedOrderQty: number;
  suggestedOrderDate: string;
  priority: string;
  aiSummary: string;
}

// --- 详情页生成 ---
export interface ListingContent {
  sku: string;
  titleV1: string;
  titleV2: string;
  titleV3: string;
  selectedTitle?: string;
  descriptionHTML: string;
  itemSpecs: Record<string, string>;
  status: "草稿" | "已审核" | "已使用";
  generatedAt: string;
}

// --- 评论回复 ---
export interface ReviewInput {
  reviewContent: string;
  rating: number; // 1-5
  buyerName: string;
  sku: string;
  productName: string;
  language: string;
}

export interface ReplyDraft {
  replyText: string;
  tone: "感谢" | "解释" | "道歉补救";
  keyPoints: string[];
  followupAction?: string;
}

// --- 选品 ---
export interface SourcingInput {
  category: string;
  keywords: string;
  budgetRange?: { min: number; max: number };
}

export interface SourcingAnalysis {
  category: string;
  keywords: string;
  opportunityScore: number; // 1-10
  estimatedProfitRate: number;
  estimatedCost: number;
  suggestedPrice: number;
  competitorLinks: string[];
  aiSummary: string;
  riskFlags: string[];
}

// --- AI 响应 ---
export interface AIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  tokensUsed?: number;
}

// --- 全局常量 ---
export const STORES: Store[] = [
  { id: "A", name: "A店-主力店", label: "A店", description: "主力店铺", active: true },
  { id: "B", name: "B店-测款店", label: "B店", description: "测款店铺", active: true },
  { id: "C", name: "C店-利润店", label: "C店", description: "利润店铺", active: true },
  { id: "D", name: "D店-清货店", label: "D店", description: "清货店铺", active: false },
];

export const MODULES = [
  { id: "inventory", name: "📦 库存监控", path: "/inventory", description: "实时库存监控与智能补货建议" },
  { id: "listing", name: "🖼️ 详情页生成", path: "/listing", description: "AI生成eBay标题、描述与ItemSpecs" },
  { id: "reviews", name: "📝 评论回复", path: "/reviews", description: "智能生成评价回复草稿" },
  { id: "sourcing", name: "🎯 选品助手", path: "/sourcing", description: "AI驱动的选品分析与评分" },
] as const;
