// ============================================================
// eBay 运营 WebApp — 全局类型定义
// ============================================================

// --- 店铺 ---
export type StoreId = "NP" | "VG" | "TR" | "SP" | "NM";

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
  SKU状态: string;
  负责人: string;
  广告费率: number;
  预估毛利率: number;
  预估毛利: number;
  风险标签: string;
  供应商: string;
}

// --- SKU 运营汇总（映射自 19_SKU运营汇总） ---
export interface SkuOperationsSummary {
  sku: string;
  中文品名: string;
  橙联可售: number;
  橙联在途: number;
  本地库存: number;
  总可用库存: number;
  近7日日均销量: number;
  可售天数: string;
  安全库存: number;
  补货点: number;
  补货周期天数: number;
  补货状态: string;
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

// --- AI 响应 ---
export interface AIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  tokensUsed?: number;
}

// --- 全局常量 ---
export const STORES: Store[] = [
  { id: "NP", name: "NewPower", label: "NP", description: "主力店铺", active: true },
  { id: "VG", name: "VelocityGear", label: "VG", description: "测款店铺", active: true },
  { id: "TR", name: "TitanRig", label: "TR", description: "利润店铺", active: true },
  { id: "SP", name: "Solidparts", label: "SP", description: "标准件店铺", active: true },
  { id: "NM", name: "Nexusmoto", label: "NM", description: "清货店铺", active: true },
];

export const MODULES = [
  { id: "dashboard", name: "运营仪表盘", path: "/dashboard", description: "图表化数据看板，库存、销售与售后总览", adminOnly: true },
  { id: "inventory", name: "库存监控", path: "/inventory", description: "实时库存监控与智能补货建议" },
  { id: "inventoryFlow", name: "库存流转", path: "/inventory-flow", description: "采购批次、头程物流与库存状态批量推进" },
  {
    id: "sourcing",
    name: "选品流程",
    path: "/sourcing",
    description: "候选商品登记、初选、询价与结果推进",
    children: [
      { id: "sourcingRegister", name: "选品登记", path: "/sourcing/register", description: "录入候选商品并进入初选待处理" },
      { id: "sourcingReview", name: "初选处理", path: "/sourcing/review", description: "运营或主管填写初选结果与最高购入价" },
      { id: "sourcingQuotePending", name: "待询价清单", path: "/sourcing/quote-pending", description: "采购接收已入选的待询价商品" },
      { id: "sourcingQuoting", name: "利润评估", path: "/sourcing/quoting", description: "根据询价结果判断利润是否达标" },
      { id: "sourcingCompleted", name: "已完成", path: "/sourcing/completed", description: "查看已经完成询价的选品记录" },
      { id: "sourcingRejected", name: "未入选", path: "/sourcing/rejected", description: "查看初选未入选的候选商品" },
    ],
  },
  { id: "skuDetails", name: "SKU 详情", path: "/sku-details", description: "按 SKU、品名、OEM 等字段查询商品与库存详情" },
  { id: "listing", name: "详情页生成", path: "/listing", description: "按店铺模板生成 eBay HTML 详情页" },
  { id: "reviews", name: "评论回复", path: "/reviews", description: "智能生成评价回复草稿" },
  { id: "dataEntry", name: "数据录入", path: "/data-entry", description: "飞书多维表格在线录入" },
  { id: "finance", name: "财务报销", path: "/finance", description: "报销申请提交与审批管理" },
  { id: "accounts", name: "账号管理", path: "/accounts", description: "管理系统登录账号，仅管理员可用", adminOnly: true },
] as const;
