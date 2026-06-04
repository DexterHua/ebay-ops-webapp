export interface PurchaseBatchItemDraft {
  sku: string;
  productName: string;
  quantity: number;
  existingSku: boolean;
}

export interface PurchaseBatchDraft {
  purchaseBatchNo: string;
  orderedAt: string;
  items: PurchaseBatchItemDraft[];
}

export interface SkuLookupOption {
  recordId?: string;
  SKU?: string;
  sku?: string;
  中文品名?: string;
  productName?: string;
}

export interface FlowDetailRecord {
  recordId: string;
  明细编号?: string;
  SKU?: string;
  中文品名快照?: string;
  来源采购批次?: string;
  当前物流批次?: string;
  原始数量?: number | string;
  当前数量?: number | string;
  当前状态?: string;
  是否完成?: boolean | string;
  版本号?: number | string;
}

export interface InventoryExceptionRecord {
  recordId: string;
  异常编号?: string;
  来源明细编号?: string;
  SKU?: string;
  异常类型?: string;
  责任节点?: string;
  预期数量?: number | string;
  实收数量?: number | string;
  差异数量?: number | string;
  处理状态?: string;
  负责人?: string;
  创建时间?: number | string;
  关闭时间?: number | string;
  备注?: string;
}
