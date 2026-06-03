"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PurchaseBatchDraft, PurchaseBatchItemDraft, SkuLookupOption } from "./types";

interface DraftLine {
  sku: string;
  productName: string;
  quantity: string;
  existingSku: boolean;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeSku(value: string) {
  return value.trim().toUpperCase();
}

function optionSku(option: SkuLookupOption) {
  return normalizeSku(option.SKU || option.sku || "");
}

function optionProductName(option: SkuLookupOption) {
  return option.中文品名 || option.productName || "";
}

function toPositiveInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function emptyLine(): DraftLine {
  return { sku: "", productName: "", quantity: "1", existingSku: false };
}

export function PurchaseBatchesTab() {
  const router = useRouter();
  const [purchaseBatchNo, setPurchaseBatchNo] = useState("");
  const [supplier, setSupplier] = useState("");
  const [orderedAt, setOrderedAt] = useState(todayString);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [skuOptions, setSkuOptions] = useState<SkuLookupOption[]>([]);
  const [loadingSkus, setLoadingSkus] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const skuByCode = useMemo(() => {
    return new Map(skuOptions.map((option) => [optionSku(option), option]));
  }, [skuOptions]);

  const loadSkuOptions = useCallback(async () => {
    setLoadingSkus(true);
    try {
      const response = await fetch("/api/lark?table=sku&limit=500");
      const json = await response.json() as { success?: boolean; data?: SkuLookupOption[]; error?: string };
      if (!json.success) throw new Error(json.error || "读取 SKU 失败");
      setSkuOptions(json.data || []);
    } catch (error) {
      toast.error("SKU 列表读取失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setLoadingSkus(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void loadSkuOptions(); }, 0);
    return () => clearTimeout(timer);
  }, [loadSkuOptions]);

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line, lineIndex) => (
      lineIndex === index ? { ...line, ...patch } : line
    )));
  };

  const updateSku = (index: number, value: string) => {
    const sku = normalizeSku(value);
    const matched = skuByCode.get(sku);
    updateLine(index, {
      sku,
      existingSku: Boolean(matched),
      productName: matched ? optionProductName(matched) : lines[index]?.productName || "",
    });
  };

  const addLine = () => {
    setLines((current) => [...current, emptyLine()]);
  };

  const removeLine = (index: number) => {
    setLines((current) => current.length === 1 ? [emptyLine()] : current.filter((_, lineIndex) => lineIndex !== index));
  };

  const buildDraft = (): PurchaseBatchDraft | undefined => {
    const normalizedLines: PurchaseBatchItemDraft[] = lines.map((line) => ({
      sku: normalizeSku(line.sku),
      productName: line.productName.trim(),
      quantity: toPositiveInteger(line.quantity),
      existingSku: line.existingSku,
    }));
    const duplicatedSku = normalizedLines.find((line, index) => (
      line.sku && normalizedLines.findIndex((candidate) => candidate.sku === line.sku) !== index
    ));

    if (!purchaseBatchNo.trim()) {
      toast.error("采购批次号不能为空");
      return undefined;
    }
    if (!supplier.trim()) {
      toast.error("供应商不能为空");
      return undefined;
    }
    if (normalizedLines.length === 0) {
      toast.error("明细不能为空");
      return undefined;
    }
    const missingSku = normalizedLines.find((line) => !line.sku);
    if (missingSku) {
      toast.error("SKU 不能为空");
      return undefined;
    }
    const invalidQuantity = normalizedLines.find((line) => line.quantity <= 0);
    if (invalidQuantity) {
      toast.error("数量必须为正整数");
      return undefined;
    }
    const missingProductName = normalizedLines.find((line) => !line.existingSku && !line.productName);
    if (missingProductName) {
      toast.error("新 SKU 必须填写中文品名");
      return undefined;
    }
    if (duplicatedSku) {
      toast.error("同一采购批次内 SKU 不能重复", { description: duplicatedSku.sku });
      return undefined;
    }

    return {
      purchaseBatchNo: purchaseBatchNo.trim(),
      supplier: supplier.trim(),
      orderedAt,
      items: normalizedLines,
    };
  };

  const saveBatch = async () => {
    const draft = buildDraft();
    if (!draft) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/inventory-flow/purchase-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!response.ok || !json.success) throw new Error(json.error || "采购批次保存失败");
      toast.success("采购批次已保存", { description: `${draft.items.length} 条 SKU 明细已进入本地仓待清点` });
      setPurchaseBatchNo("");
      setSupplier("");
      setOrderedAt(todayString());
      setLines([emptyLine()]);
    } catch (error) {
      toast.error("保存失败", {
        description: error instanceof Error ? error.message : "服务端暂不可用",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">采购批次</CardTitle>
            <CardDescription>批量建立采购入库明细</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={loadSkuOptions} disabled={loadingSkus}>
            {loadingSkus ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            刷新 SKU
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">采购批次号 *</label>
            <Input value={purchaseBatchNo} onChange={(event) => setPurchaseBatchNo(event.target.value)} placeholder="PO-202606-001" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">供应商 *</label>
            <Input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="供应商名称" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">下单日期</label>
            <Input type="date" value={orderedAt} onChange={(event) => setOrderedAt(event.target.value)} />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900">批量明细</p>
              <p className="text-xs text-slate-500">{lines.length} 行，{lines.reduce((sum, line) => sum + toPositiveInteger(line.quantity), 0)} 件</p>
            </div>
            <Button variant="outline" size="sm" onClick={addLine}>
              <Plus />
              添加行
            </Button>
          </div>

          <div className="space-y-3">
            {lines.map((line, index) => {
              const suggestions = line.sku
                ? skuOptions
                    .filter((option) => {
                      const sku = optionSku(option);
                      const productName = optionProductName(option);
                      return sku.includes(line.sku) || productName.includes(line.sku);
                    })
                    .slice(0, 6)
                : [];

              return (
                <div key={index} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(10rem,1.1fr)_minmax(12rem,1.4fr)_8rem_auto] lg:items-end">
                    <div className="relative">
                      <label className="mb-1 block text-xs text-slate-500">SKU *</label>
                      <Input value={line.sku} onChange={(event) => updateSku(index, event.target.value)} placeholder="输入 SKU" />
                      {suggestions.length > 0 && !line.existingSku && (
                        <div className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                          {suggestions.map((option) => {
                            const sku = optionSku(option);
                            return (
                              <button
                                key={option.recordId || sku}
                                type="button"
                                className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-orange-50"
                                onMouseDown={() => updateSku(index, sku)}
                              >
                                <span className="block text-sm font-medium text-slate-900">{sku}</span>
                                <span className="block truncate text-xs text-slate-500">{optionProductName(option)}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs text-slate-500">中文品名 {line.existingSku ? "" : "*"}</label>
                      <Input
                        value={line.productName}
                        onChange={(event) => updateLine(index, { productName: event.target.value })}
                        disabled={line.existingSku}
                        placeholder="新 SKU 必填"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs text-slate-500">数量 *</label>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={line.quantity}
                        onChange={(event) => updateLine(index, { quantity: event.target.value })}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      {line.existingSku ? (
                        <Badge variant="secondary" className="gap-1 bg-emerald-50 text-emerald-700">
                          <CheckCircle2 className="size-3" />
                          已有
                        </Badge>
                      ) : (
                        <Badge variant="outline">新 SKU</Badge>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => removeLine(index)} aria-label="删除行">
                        <Trash2 />
                      </Button>
                    </div>
                  </div>

                  {line.existingSku && (
                    <div className="mt-2">
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto px-0 text-xs"
                        onClick={() => router.push(`/data-entry?sku=${encodeURIComponent(line.sku)}&editMaster=1`)}
                      >
                        更新基础资料
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="outline" onClick={addLine}>
            <Plus />
            添加 SKU
          </Button>
          <Button onClick={saveBatch} disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            保存采购批次
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
