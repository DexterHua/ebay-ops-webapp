"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

function useSubmit() {
  const [submitting, setSubmitting] = useState(false);
  const submit = async (fields: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/lark/save-record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: "sourcing", fields }),
      });
      const json = await res.json() as { success?: boolean; warning?: string; error?: string };
      if (json.success) {
        if (json.warning) toast.warning("记录已保存，但需要检查", { description: json.warning });
        else toast.success("已提交选品记录");
        return true;
      }
      toast.error("保存失败", { description: json.error });
      return false;
    } catch {
      toast.error("网络错误");
      return false;
    } finally {
      setSubmitting(false);
    }
  };
  return { submitting, submit };
}

export function SourcingForm() {
  const { submitting, submit } = useSubmit();
  const defaultForm = {
    OEM码: "",
    品牌: "",
    商品链接: "",
    英文名称: "",
    中文名称: "",
    近90天销量: "",
    eBay平均售价: "",
    选品备注: "",
  };
  const [form, setForm] = useState(defaultForm);

  const f = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm({ ...form, [key]: event.target.value });
    },
  });

  const parseOptionalInteger = (value: string) => {
    if (!value.trim()) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };

  const parseOptionalMoney = (value: string) => {
    if (!value.trim()) return undefined;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : Number.NaN;
  };

  const handleSubmit = async () => {
    if (!form.OEM码.trim() || !form.英文名称.trim() || !form.中文名称.trim()) {
      toast.error("请填写 OEM码、英文名称和中文名称");
      return;
    }

    const sales90 = parseOptionalInteger(form.近90天销量);
    if (Number.isNaN(sales90)) {
      toast.error("近90天销量必须是整数");
      return;
    }

    const ebayAveragePrice = parseOptionalMoney(form.eBay平均售价);
    if (Number.isNaN(ebayAveragePrice)) {
      toast.error("eBay平均售价必须是数字");
      return;
    }

    const me = await fetch("/api/auth/me")
      .then((response) => response.json())
      .catch(() => null) as { name?: string | null } | null;
    if (!me?.name) {
      toast.error("登录状态失效，请重新登录");
      return;
    }

    const payload: Record<string, unknown> = {
      OEM码: form.OEM码.trim(),
      品牌: form.品牌.trim(),
      商品链接: form.商品链接.trim(),
      英文名称: form.英文名称.trim(),
      中文名称: form.中文名称.trim(),
      选品备注: form.选品备注.trim(),
      登记人: me.name,
      登记时间: new Date().toISOString(),
      选品阶段: "初选待处理",
    };
    if (sales90 !== undefined) payload.近90天销量 = sales90;
    if (ebayAveragePrice !== undefined) payload.eBay平均售价 = ebayAveragePrice;

    const ok = await submit(payload);
    if (ok) setForm({ ...defaultForm });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">选品登记</CardTitle>
        <CardDescription>登记候选商品，写入 16_选品池，并进入初选待处理。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">商品身份</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="text-[10px] text-gray-400">OEM码 *</label>
              <Input {...f("OEM码")} placeholder="如 84306-0E010" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">品牌</label>
              <Input {...f("品牌")} placeholder="Toyota / Honda" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">商品链接</label>
              <Input {...f("商品链接")} placeholder="https://www.ebay.com/itm/..." />
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">商品名称</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] text-gray-400">英文名称 *</label>
              <Input {...f("英文名称")} placeholder="Steering Wheel Clock Spring" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">中文名称 *</label>
              <Input {...f("中文名称")} placeholder="方向盘游丝" />
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">市场数据与备注</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] text-gray-400">近90天销量</label>
              <Input {...f("近90天销量")} type="number" min="0" step="1" placeholder="如 120" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">eBay平均售价 ($)</label>
              <Input {...f("eBay平均售价")} type="number" min="0" step="0.01" placeholder="如 29.99" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] text-gray-400">备注</label>
              <Input {...f("选品备注")} placeholder="竞争情况、车型适配、风险点等" />
            </div>
          </div>
        </div>

        <Button onClick={handleSubmit} disabled={submitting} className="w-full">
          {submitting ? "提交中..." : "提交选品记录"}
        </Button>
      </CardContent>
    </Card>
  );
}
