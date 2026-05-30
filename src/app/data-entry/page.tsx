"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

// ============================================================
// 📋 数据录入 — 四大高频表单
// ============================================================

const STORES = ["NewPower", "VelocityGear", "TitanRig", "Nexusmoto"];

interface SkuOption { SKU?: string; 中文品名?: string; [key: string]: unknown }

export default function DataEntryPage() {
  const [skuList, setSkuList] = useState<SkuOption[]>([]);
  const [activeTab, setActiveTab] = useState("sku");

  useEffect(() => {
    fetch("/api/lark?table=sku&limit=200")
      .then(r => r.json()).then(j => { if (j.success) setSkuList(j.data); }).catch(() => {});
  }, []);

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "/");

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">📋 数据录入</h1>
        <p className="text-gray-500 mt-1">飞书多维表格数据在线录入，无需切换到飞书界面</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="sku">🏷️ SKU 主数据</TabsTrigger>
          <TabsTrigger value="sales">📊 销售日报</TabsTrigger>
          <TabsTrigger value="stock">📦 库存流水</TabsTrigger>
          <TabsTrigger value="issues">🎫 客服异常</TabsTrigger>
          <TabsTrigger value="competitors">🔍 竞品</TabsTrigger>
        </TabsList>

        <TabsContent value="sku">
          <SkuForm />
        </TabsContent>
        <TabsContent value="sales">
          <SalesForm skuList={skuList} today={today} />
        </TabsContent>
        <TabsContent value="stock">
          <StockForm skuList={skuList} today={today} />
        </TabsContent>
        <TabsContent value="issues">
          <IssuesForm skuList={skuList} today={today} />
        </TabsContent>
        <TabsContent value="competitors">
          <CompetitorForm skuList={skuList} today={today} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ==============================================================
//  通用 Hook
// ==============================================================
function useSubmit() {
  const [submitting, setSubmitting] = useState(false);
  const submit = async (table: string, fields: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/lark/save-record", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, fields }),
      });
      const json = await res.json();
      if (json.success) { toast.success(`已保存到飞书`); return true; }
      else { toast.error("保存失败", { description: json.error }); return false; }
    } catch { toast.error("网络错误"); return false; }
    finally { setSubmitting(false); }
  };
  return { submitting, submit };
}

// ==============================================================
//  🏷️ SKU 主数据录入
// ==============================================================
function SkuForm() {
  const { submitting, submit } = useSubmit();
  const defaultForm = {
    SKU: "", 中文品名: "", 英文标题关键词: "", OEM: "",
    类目: "Others", 供应商: "KY", SKU状态: "待清点", 风险标签: "低风险",
    采购价: "", 建议售价: "", 头程成本件: "", 橙联履约预估件: "",
    补货周期天数: "30", 安全库存: "", 广告费率: "", eBay费率: "",
    橙联在途: "0", 本地库存: "0", 橙联可售: "0",
    商品毛重g: "", 商品尺寸含包装cm: "", 近7日日均销量: "0",
    负责人: "", 描述: "", 备注: "",
  };
  const [form, setForm] = useState(defaultForm);

  const numericFields = ["采购价","建议售价","头程成本件","橙联履约预估件","补货周期天数","安全库存","广告费率","eBay费率","橙联在途","本地库存","橙联可售","商品毛重g","近7日日均销量"];

  const handleSubmit = async () => {
    if (!form.SKU || !form.中文品名) { toast.error("请至少填写 SKU 和 中文品名"); return; }
    const payload: Record<string, unknown> = { ...form };
    numericFields.forEach(k => { payload[k] = parseFloat(form[k as keyof typeof form]) || 0; });
    const ok = await submit("skuMaster", payload);
    if (ok) setForm({ ...defaultForm, 橙联在途: "0", 本地库存: "0", 橙联可售: "0", 近7日日均销量: "0", 补货周期天数: "30" });
  };

  const f = (key: string) => ({ value: form[key as keyof typeof form] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({...form, [key]: e.target.value}) });

  return <Card>
    <CardHeader><CardTitle className="text-base">🏷️ SKU 主数据录入</CardTitle><CardDescription>新增商品基础档案，写入 01_SKU主数据。公式字段自动计算无需填写。</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {/* 基本信息 */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">📌 基本信息</p>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-[10px] text-gray-400">SKU *</label><Input {...f("SKU")} placeholder="如 SP843060E010A001" /></div>
          <div className="col-span-2"><label className="text-[10px] text-gray-400">中文品名 *</label><Input {...f("中文品名")} placeholder="方向游丝" /></div>
          <div className="col-span-2"><label className="text-[10px] text-gray-400">英文标题关键词</label><Input {...f("英文标题关键词")} placeholder="Steering Wheel Clock Spring" /></div>
          <div><label className="text-[10px] text-gray-400">类目</label><Select value={form.类目} onValueChange={(v) => setForm({...form, 类目: v || "Others"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Clock Spring","Carburetor","Others"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          <div><label className="text-[10px] text-gray-400">OEM</label><Input {...f("OEM")} placeholder="84306-0E010*1" /></div>
          <div><label className="text-[10px] text-gray-400">商品毛重(g)</label><Input {...f("商品毛重g")} type="number" /></div>
          <div><label className="text-[10px] text-gray-400">尺寸(cm)</label><Input {...f("商品尺寸含包装cm")} placeholder="13.2*13.2*9.4" /></div>
        </div>
      </div>

      <Separator />

      {/* 成本与定价 */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">💰 成本与定价</p>
        <div className="grid grid-cols-4 gap-3">
          <div><label className="text-[10px] text-gray-400">采购价(¥)</label><Input {...f("采购价")} type="number" step="0.1" /></div>
          <div><label className="text-[10px] text-gray-400">建议售价($)</label><Input {...f("建议售价")} type="number" step="0.01" /></div>
          <div><label className="text-[10px] text-gray-400">头程成本/件(¥)</label><Input {...f("头程成本件")} type="number" step="0.01" /></div>
          <div><label className="text-[10px] text-gray-400">橙联履约/件($)</label><Input {...f("橙联履约预估件")} type="number" step="0.01" /></div>
          <div><label className="text-[10px] text-gray-400">广告费率</label><Input {...f("广告费率")} type="number" step="0.01" placeholder="0.08 = 8%" /></div>
          <div><label className="text-[10px] text-gray-400">eBay费率</label><Input {...f("eBay费率")} type="number" step="0.01" placeholder="默认 13.25" /></div>
        </div>
      </div>

      <Separator />

      {/* 库存参数 */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">📦 库存参数</p>
        <div className="grid grid-cols-4 gap-3">
          <div><label className="text-[10px] text-gray-400">橙联在途</label><Input {...f("橙联在途")} type="number" /></div>
          <div><label className="text-[10px] text-gray-400">本地库存</label><Input {...f("本地库存")} type="number" /></div>
          <div><label className="text-[10px] text-gray-400">橙联可售</label><Input {...f("橙联可售")} type="number" /></div>
          <div><label className="text-[10px] text-gray-400">安全库存</label><Input {...f("安全库存")} type="number" /></div>
          <div><label className="text-[10px] text-gray-400">补货周期(天)</label><Input {...f("补货周期天数")} type="number" /></div>
          <div><label className="text-[10px] text-gray-400">近7日日均销量</label><Input {...f("近7日日均销量")} type="number" step="0.1" placeholder="开卖后更新" /></div>
        </div>
      </div>

      <Separator />

      {/* 状态与分类 */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">🏷️ 状态与分类</p>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-[10px] text-gray-400">SKU状态</label><Select value={form.SKU状态} onValueChange={(v) => setForm({...form, SKU状态: v || "待清点"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><ScrollArea className="max-h-48">{["已上架","橙联在途","待入仓","待清点","待质检","待拍照","待贴标","滞销","停售"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</ScrollArea></SelectContent></Select></div>
          <div><label className="text-[10px] text-gray-400">供应商</label><Select value={form.供应商} onValueChange={(v) => setForm({...form, 供应商: v || "KY"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["HB","KY","DY","JX","YC","MD"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
          <div><label className="text-[10px] text-gray-400">风险标签</label><Select value={form.风险标签} onValueChange={(v) => setForm({...form, 风险标签: v || "低风险"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["低风险","带电/认证需复核"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
          <div><label className="text-[10px] text-gray-400">负责人</label><Input {...f("负责人")} placeholder="刘渊/严娅/车泉" /></div>
          <div><label className="text-[10px] text-gray-400">描述</label><Input {...f("描述")} placeholder="产品用途/卖点摘要" /></div>
          <div><label className="text-[10px] text-gray-400">备注</label><Input {...f("备注")} /></div>
        </div>
      </div>

      <Button onClick={handleSubmit} disabled={submitting} className="w-full">
        {submitting ? "⏳ 保存中..." : "💾 保存到飞书 01_SKU主数据"}
      </Button>
    </CardContent>
  </Card>;
}

// ==============================================================
//  📊 销售日报
// ==============================================================
function SalesForm({ skuList, today }: { skuList: SkuOption[]; today: string }) {
  const { submitting, submit } = useSubmit();
  const [form, setForm] = useState({ SKU: "", 商品名称: "", 店铺: "NewPower", 日期: today, 售出数量: "1", 销售额: "", 商品成本: "", eBay费用: "", 广告费: "", 橙联履约费: "", 退款金额: "0", 备注: "" });

  const handleSkuSelect = (sku: string) => {
    const found = skuList.find(s => s.SKU === sku);
    setForm({ ...form, SKU: sku, 商品名称: found?.中文品名 || "" });
  };

  const handleSubmit = async () => {
    if (!form.SKU || !form.销售额) { toast.error("请填写 SKU 和 销售额"); return; }
    const ok = await submit("sales", {
      ...form,
      售出数量: parseInt(form.售出数量) || 0,
      销售额: parseFloat(form.销售额) || 0,
      商品成本: parseFloat(form.商品成本) || 0,
      eBay费用: parseFloat(form.eBay费用) || 0,
      广告费: parseFloat(form.广告费) || 0,
      橙联履约费: parseFloat(form.橙联履约费) || 0,
      退款金额: parseFloat(form.退款金额) || 0,
    });
    if (ok) setForm({ ...form, 售出数量: "1", 销售额: "", 商品成本: "", eBay费用: "", 广告费: "", 橙联履约费: "", 退款金额: "0", 备注: "" });
  };

  return <Card>
    <CardHeader><CardTitle className="text-base">📊 每日销售数据录入</CardTitle><CardDescription>每卖出一单记录一次，写入 07_销售日报</CardDescription></CardHeader>
    <CardContent className="grid grid-cols-2 gap-3">
      <div><label className="text-xs text-gray-400">SKU *</label>
        <Select value={form.SKU} onValueChange={(v) => handleSkuSelect(v || "")}>
          <SelectTrigger><SelectValue placeholder="选择 SKU" /></SelectTrigger>
          <SelectContent>
            <ScrollArea className="max-h-60">
              {skuList.map((s, i) => <SelectItem key={String(s._idx ?? i)} value={s.SKU || ""}>{s.SKU} — {s.中文品名}</SelectItem>)}
            </ScrollArea>
          </SelectContent>
        </Select>
      </div>
      <div><label className="text-xs text-gray-400">商品名称</label><Input value={form.商品名称} onChange={e => setForm({...form, 商品名称: e.target.value})} placeholder="自动填充" /></div>
      <div><label className="text-xs text-gray-400">店铺</label><Select value={form.店铺} onValueChange={(v) => setForm({...form, 店铺: v || "NewPower"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STORES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
      <div><label className="text-xs text-gray-400">日期</label><Input value={form.日期} onChange={e => setForm({...form, 日期: e.target.value})} /></div>
      <div><label className="text-xs text-gray-400">售出数量 *</label><Input type="number" value={form.售出数量} onChange={e => setForm({...form, 售出数量: e.target.value})} /></div>
      <div><label className="text-xs text-gray-400">销售额 ($) *</label><Input type="number" step="0.01" value={form.销售额} onChange={e => setForm({...form, 销售额: e.target.value})} placeholder="必填" /></div>
      <div><label className="text-xs text-gray-400">商品成本 ($)</label><Input type="number" step="0.01" value={form.商品成本} onChange={e => setForm({...form, 商品成本: e.target.value})} /></div>
      <div><label className="text-xs text-gray-400">eBay费用 ($)</label><Input type="number" step="0.01" value={form.eBay费用} onChange={e => setForm({...form, eBay费用: e.target.value})} /></div>
      <div><label className="text-xs text-gray-400">广告费 ($)</label><Input type="number" step="0.01" value={form.广告费} onChange={e => setForm({...form, 广告费: e.target.value})} /></div>
      <div><label className="text-xs text-gray-400">橙联履约费 ($)</label><Input type="number" step="0.01" value={form.橙联履约费} onChange={e => setForm({...form, 橙联履约费: e.target.value})} /></div>
      <div><label className="text-xs text-gray-400">退款金额 ($)</label><Input type="number" step="0.01" value={form.退款金额} onChange={e => setForm({...form, 退款金额: e.target.value})} /></div>
      <div className="col-span-2"><label className="text-xs text-gray-400">备注</label><Input value={form.备注} onChange={e => setForm({...form, 备注: e.target.value})} /></div>
      <div className="col-span-2"><Button onClick={handleSubmit} disabled={submitting} className="w-full">{submitting ? "⏳ 保存中..." : "💾 保存到飞书"}</Button></div>
    </CardContent>
  </Card>;
}

// ==============================================================
//  📦 库存流水
// ==============================================================
function StockForm({ skuList, today }: { skuList: SkuOption[]; today: string }) {
  const { submitting, submit } = useSubmit();
  const MOVEMENT_TYPES = ["到货入库", "发往橙联", "橙联上架", "橙联签收", "订单出库", "退货入库", "报损", "库存调整", "质检转良品"];
  const LOCATIONS = ["本地仓", "橙联在途", "橙联可售", "不良品", "退货待检"];

  const [form, setForm] = useState({ SKU: "", 日期: today, 变动类型: "到货入库", 库存位置: "本地仓", 数量变动: "", 相关单号: "", 操作人: "", 备注: "" });

  const handleSubmit = async () => {
    if (!form.SKU || !form.数量变动) { toast.error("请填写 SKU 和 数量变动"); return; }
    const ok = await submit("stockFlow", { ...form, 数量变动: parseInt(form.数量变动) || 0 });
    if (ok) setForm({ ...form, 数量变动: "", 相关单号: "", 备注: "" });
  };

  return <Card>
    <CardHeader><CardTitle className="text-base">📦 库存变动记录</CardTitle><CardDescription>每次库存变动记一笔，写入 02_库存流水</CardDescription></CardHeader>
    <CardContent className="grid grid-cols-2 gap-3">
      <div className="col-span-2"><label className="text-xs text-gray-400">SKU *</label>
        <Select value={form.SKU} onValueChange={(v) => setForm({...form, SKU: v || ""})}>
          <SelectTrigger><SelectValue placeholder="选择 SKU" /></SelectTrigger>
          <SelectContent><ScrollArea className="max-h-60">{skuList.map((s, i) => <SelectItem key={String(s._idx ?? i)} value={s.SKU || ""}>{s.SKU} — {s.中文品名}</SelectItem>)}</ScrollArea></SelectContent>
        </Select>
      </div>
      <div><label className="text-xs text-gray-400">变动类型 *</label><Select value={form.变动类型} onValueChange={(v) => setForm({...form,变动类型: v || "到货入库"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{MOVEMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
      <div><label className="text-xs text-gray-400">库存位置</label><Select value={form.库存位置} onValueChange={(v) => setForm({...form,库存位置: v || "本地仓"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select></div>
      <div><label className="text-xs text-gray-400">数量变动 *</label><Input type="number" value={form.数量变动} onChange={e => setForm({...form, 数量变动: e.target.value})} placeholder="正数=增加，负数=减少" /></div>
      <div><label className="text-xs text-gray-400">日期</label><Input value={form.日期} onChange={e => setForm({...form, 日期: e.target.value})} /></div>
      <div><label className="text-xs text-gray-400">相关单号</label><Input value={form.相关单号} onChange={e => setForm({...form, 相关单号: e.target.value})} placeholder="采购单/物流号/订单号" /></div>
      <div><label className="text-xs text-gray-400">操作人</label><Input value={form.操作人} onChange={e => setForm({...form, 操作人: e.target.value})} /></div>
      <div className="col-span-2"><label className="text-xs text-gray-400">备注</label><Input value={form.备注} onChange={e => setForm({...form, 备注: e.target.value})} /></div>
      <div className="col-span-2"><Button onClick={handleSubmit} disabled={submitting} className="w-full">{submitting ? "⏳ 保存中..." : "💾 保存到飞书"}</Button></div>
    </CardContent>
  </Card>;
}

// ==============================================================
//  🎫 客服异常
// ==============================================================
function IssuesForm({ skuList, today }: { skuList: SkuOption[]; today: string }) {
  const { submitting, submit } = useSubmit();
  const ISSUE_TYPES = ["买家消息", "差评风险", "纠纷Case", "退货", "退款", "取消请求", "物流异常", "商品质量", "账号风险"];
  const PROBLEM_OPTS = ["已接单但暂无轨迹", "询问兼容型号"];
  const ACTIONS = ["跟进橙联轨迹", "已回复"];

  const [form, setForm] = useState({ SKU: "", 订单号: "", 店铺: "NewPower", 异常类型: "买家消息", 问题描述: "", 优先级: "中", 状态: "待办", 责任人: "", 描述: "", 备注: "", 创建日期: today });

  const handleSubmit = async () => {
    if (!form.SKU) { toast.error("请填写 SKU"); return; }
    await submit("issues", form);
    if (true) setForm({ ...form, 订单号: "", 描述: "", 备注: "" });
  };

  return <Card>
    <CardHeader><CardTitle className="text-base">🎫 客服售后记录</CardTitle><CardDescription>收到买家消息/评价/纠纷时录入，写入 08_客服售后异常</CardDescription></CardHeader>
    <CardContent className="grid grid-cols-2 gap-3">
      <div><label className="text-xs text-gray-400">SKU *</label>
        <Select value={form.SKU} onValueChange={(v) => setForm({...form, SKU: v || ""})}>
          <SelectTrigger><SelectValue placeholder="选择 SKU" /></SelectTrigger>
          <SelectContent><ScrollArea className="max-h-60">{skuList.map((s, i) => <SelectItem key={String(s._idx ?? i)} value={s.SKU || ""}>{s.SKU}</SelectItem>)}</ScrollArea></SelectContent>
        </Select>
      </div>
      <div><label className="text-xs text-gray-400">订单号</label><Input value={form.订单号} onChange={e => setForm({...form, 订单号: e.target.value})} /></div>
      <div><label className="text-xs text-gray-400">店铺</label><Select value={form.店铺} onValueChange={(v) => setForm({...form, 店铺: v || "NewPower"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STORES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
      <div><label className="text-xs text-gray-400">异常类型 *</label><Select value={form.异常类型} onValueChange={(v) => setForm({...form,异常类型: v || "买家消息"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ISSUE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
      <div><label className="text-xs text-gray-400">优先级</label><Select value={form.优先级} onValueChange={(v) => setForm({...form,优先级: v || "中"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["高","中","低"].map(p => <SelectItem key={p} value={p}>{p === "高" ? "🔴 " : p === "中" ? "🟡 " : "🟢 "}{p}</SelectItem>)}</SelectContent></Select></div>
      <div><label className="text-xs text-gray-400">状态</label><Select value={form.状态} onValueChange={(v) => setForm({...form,状态: v || "待办"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["待办","进行中","已完成","延期"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
      <div><label className="text-xs text-gray-400">责任人</label><Input value={form.责任人} onChange={e => setForm({...form, 责任人: e.target.value})} /></div>
      <div><label className="text-xs text-gray-400">创建日期</label><Input value={form.创建日期} onChange={e => setForm({...form, 创建日期: e.target.value})} /></div>
      <div className="col-span-2"><label className="text-xs text-gray-400">问题描述</label><Input value={form.描述} onChange={e => setForm({...form, 描述: e.target.value})} placeholder="买家说了什么 / 发生了什么问题" /></div>
      <div className="col-span-2"><label className="text-xs text-gray-400">备注</label><Input value={form.备注} onChange={e => setForm({...form, 备注: e.target.value})} /></div>
      <div className="col-span-2"><Button onClick={handleSubmit} disabled={submitting} className="w-full">{submitting ? "⏳ 保存中..." : "💾 保存到飞书"}</Button></div>
    </CardContent>
  </Card>;
}

// ==============================================================
//  🔍 竞品监控
// ==============================================================
function CompetitorForm({ skuList, today }: { skuList: SkuOption[]; today: string }) {
  const { submitting, submit } = useSubmit();
  const [form, setForm] = useState({ SKU: "", 关键词: "", 竞品链接: "", 竞品售价: "", 竞品运费: "0", 我方售价: "", 竞品总价: "", 价差: "", "销量|观察": "", 动作建议: "", 负责人: "", 记录日期: today, 备注: "" });

  const calcDiff = () => {
    const comp = parseFloat(form.竞品售价) || 0; const us = parseFloat(form.我方售价) || 0;
    setForm({ ...form, 竞品总价: String(comp + (parseFloat(form.竞品运费)||0)), 价差: us ? (us - comp).toFixed(1) : "" });
  };

  const handleSubmit = async () => {
    if (!form.SKU || !form.竞品售价) { toast.error("请填写 SKU 和 竞品售价"); return; }
    await submit("competitors", {
      ...form,
      竞品售价: parseFloat(form.竞品售价) || 0,
      竞品运费: parseFloat(form.竞品运费) || 0,
      我方售价: parseFloat(form.我方售价) || 0,
      竞品总价: parseFloat(form.竞品总价) || 0,
      价差: parseFloat(form.价差) || 0,
    });
  };

  return <Card>
    <CardHeader><CardTitle className="text-base">🔍 竞品价格监控</CardTitle><CardDescription>记录竞品价格变动，写入 09_竞品价格监控</CardDescription></CardHeader>
    <CardContent className="grid grid-cols-2 gap-3">
      <div><label className="text-xs text-gray-400">SKU *</label>
        <Select value={form.SKU} onValueChange={(v) => setForm({...form, SKU: v || ""})}>
          <SelectTrigger><SelectValue placeholder="选择我方 SKU" /></SelectTrigger>
          <SelectContent><ScrollArea className="max-h-60">{skuList.map((s, i) => <SelectItem key={String(s._idx ?? i)} value={s.SKU || ""}>{s.SKU} — {s.中文品名}</SelectItem>)}</ScrollArea></SelectContent>
        </Select>
      </div>
      <div><label className="text-xs text-gray-400">搜索关键词</label><Input value={form.关键词} onChange={e => setForm({...form, 关键词: e.target.value})} /></div>
      <div className="col-span-2"><label className="text-xs text-gray-400">竞品链接</label><Input value={form.竞品链接} onChange={e => setForm({...form, 竞品链接: e.target.value})} placeholder="https://www.ebay.com/itm/..." /></div>
      <div><label className="text-xs text-gray-400">竞品售价 ($) *</label><Input type="number" step="0.01" value={form.竞品售价} onChange={e => { setForm({...form, 竞品售价: e.target.value}); }} onBlur={calcDiff} /></div>
      <div><label className="text-xs text-gray-400">竞品运费 ($)</label><Input type="number" step="0.01" value={form.竞品运费} onChange={e => { setForm({...form, 竞品运费: e.target.value}); }} onBlur={calcDiff} /></div>
      <div><label className="text-xs text-gray-400">我方售价 ($)</label><Input type="number" step="0.01" value={form.我方售价} onChange={e => { setForm({...form, 我方售价: e.target.value}); }} onBlur={calcDiff} /></div>
      <div><label className="text-xs text-gray-400">价差</label><Input value={form.价差 ? `$${form.价差}` : "自动计算"} readOnly className="bg-gray-50" /></div>
      <div><label className="text-xs text-gray-400">销量观察</label><Input value={form["销量|观察"]} onChange={e => setForm({...form, "销量|观察": e.target.value})} placeholder="如: 日销5件" /></div>
      <div><label className="text-xs text-gray-400">动作建议</label><Input value={form.动作建议} onChange={e => setForm({...form, 动作建议: e.target.value})} placeholder="跟价/观望/降价" /></div>
      <div><label className="text-xs text-gray-400">负责人</label><Input value={form.负责人} onChange={e => setForm({...form, 负责人: e.target.value})} /></div>
      <div><label className="text-xs text-gray-400">记录日期</label><Input value={form.记录日期} onChange={e => setForm({...form, 记录日期: e.target.value})} /></div>
      <div className="col-span-2"><label className="text-xs text-gray-400">备注</label><Input value={form.备注} onChange={e => setForm({...form, 备注: e.target.value})} /></div>
      <div className="col-span-2"><Button onClick={handleSubmit} disabled={submitting} className="w-full">{submitting ? "⏳ 保存中..." : "💾 保存到飞书"}</Button></div>
    </CardContent>
  </Card>;
}
