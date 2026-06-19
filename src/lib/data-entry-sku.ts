export type SkuMasterForm = {
  SKU: string;
  中文品名: string;
  英文标题关键词: string;
  OEM: string;
  类目: string;
  供应商: string;
  SKU状态: string;
  风险标签: string;
  "商品毛重（g）": string;
  "商品尺寸（含包装）（cm）": string;
  商品图片: string;
  描述: string;
  备注: string;
};

export const SKU_MASTER_DEFAULT_STATUS = "待清点";

export const defaultSkuMasterForm: SkuMasterForm = {
  SKU: "",
  中文品名: "",
  英文标题关键词: "",
  OEM: "",
  类目: "Others",
  供应商: "KY",
  SKU状态: SKU_MASTER_DEFAULT_STATUS,
  风险标签: "低风险",
  "商品毛重（g）": "",
  "商品尺寸（含包装）（cm）": "",
  商品图片: "",
  描述: "",
  备注: "",
};

export function buildSkuMasterPayload(form: SkuMasterForm, ownerName: string): Record<string, unknown> {
  const owner = ownerName.trim();
  if (!owner) throw new Error("登录状态失效，请重新登录");

  return {
    ...form,
    SKU状态: SKU_MASTER_DEFAULT_STATUS,
    负责人: owner,
    "商品毛重（g）": parseFloat(form["商品毛重（g）"]) || 0,
  };
}
