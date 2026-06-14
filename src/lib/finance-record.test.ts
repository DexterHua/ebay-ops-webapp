import { describe, expect, it } from "vitest";
import { normalizeFinanceRecord, resolveFinancePersonnelReferences } from "@/lib/finance-record";

describe("财务报销记录规范化", () => {
  it("金额字段兼容数字字符串和对象返回形态", () => {
    expect(normalizeFinanceRecord("record-1", { 金额: "556.50" }).金额).toBe(556.5);
    expect(normalizeFinanceRecord("record-2", { 金额: { value: "360" } }).金额).toBe(360);
  });

  it("列表状态优先使用进度字段，并回退到审批状态", () => {
    expect(normalizeFinanceRecord("record-1", { 进度: "待付款", 审批状态: "待审批" }).列表状态).toBe("待付款");
    expect(normalizeFinanceRecord("record-2", { 审批状态: "已通过" }).列表状态).toBe("已通过");
  });

  it("附件字段规范化为可点击所需的 token、名称和链接", () => {
    const record = normalizeFinanceRecord("record-1", {
      发票及付款记录: [{
        file_token: "box-token",
        name: "付款凭证.png",
        size: 2048,
        type: "image/png",
        url: "https://open.feishu.cn/open-apis/drive/v1/medias/box-token/download",
      }],
    });

    expect(record.附件).toEqual([{
      fileToken: "box-token",
      name: "付款凭证.png",
      size: 2048,
      type: "image/png",
      url: "https://open.feishu.cn/open-apis/drive/v1/medias/box-token/download",
    }]);
  });

  it("提交前把报销人姓名解析成飞书 open_id，解析不到时不写无效人员字段", () => {
    const records = [
      { fields: { 人员: [{ id: "ou_2330cbb724020d04dee33600660d9b72", name: "车泉" }] } },
    ];

    expect(resolveFinancePersonnelReferences("车泉", "车泉", records)).toEqual([
      { id: "ou_2330cbb724020d04dee33600660d9b72" },
    ]);
    expect(resolveFinancePersonnelReferences("新同事", "车泉", records)).toEqual([]);
    expect(resolveFinancePersonnelReferences("ou_direct", "车泉", records)).toEqual([{ id: "ou_direct" }]);
  });
});
