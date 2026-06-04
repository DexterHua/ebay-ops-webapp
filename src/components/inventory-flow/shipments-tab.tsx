"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, PackagePlus, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { FlowDetailRecord } from "./types";

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toText(value: unknown): string {
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(",");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return toText(record.text ?? record.value ?? "");
  }
  return value == null ? "" : String(value);
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

const TARGET_STATE = "国内集货仓待发";

export function ShipmentsTab() {
  const [shipmentBatchNo, setShipmentBatchNo] = useState("");
  const [carrier, setCarrier] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [shippedAt, setShippedAt] = useState(todayString);
  const [autoTransition, setAutoTransition] = useState(false);
  const [details, setDetails] = useState<FlowDetailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [skuFilter, setSkuFilter] = useState("");

  const loadDetails = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/inventory-flow/data?resource=details");
      const json = await response.json() as { success?: boolean; data?: FlowDetailRecord[]; error?: string };
      if (!json.success) throw new Error(json.error || "读取库存明细失败");
      setDetails(json.data || []);
      setSelectedIds(new Set());
    } catch (error) {
      toast.error("库存明细读取失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void loadDetails(); }, 0);
    return () => clearTimeout(timer);
  }, [loadDetails]);

  const pendingShipmentDetails = useMemo(() => {
    return details.filter((detail) => {
      const state = toText(detail.当前状态);
      const sku = toText(detail.SKU).toUpperCase();
      return state === TARGET_STATE
        && (!skuFilter || sku.includes(skuFilter.toUpperCase()));
    });
  }, [details, skuFilter]);

  const selectedDetails = pendingShipmentDetails.filter((detail) => selectedIds.has(detail.recordId));
  const selectedQuantity = selectedDetails.reduce((sum, detail) => sum + toNumber(detail.当前数量), 0);
  const selectedSkuCount = new Set(selectedDetails.map((detail) => toText(detail.SKU)).filter(Boolean)).size;

  const toggleOne = (recordId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(recordId);
      else next.delete(recordId);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(pendingShipmentDetails.map((detail) => detail.recordId)) : new Set());
  };

  const submitShipment = async () => {
    if (!shipmentBatchNo.trim()) {
      toast.error("物流批次号不能为空");
      return;
    }
    if (!carrier.trim()) {
      toast.error("承运商不能为空");
      return;
    }
    if (selectedDetails.length === 0) {
      toast.error("请至少选择一条待发运明细");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/inventory-flow/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentBatchNo: shipmentBatchNo.trim(),
          carrier: carrier.trim(),
          trackingNo: trackingNo.trim(),
          shippedAt,
          autoTransition,
          bindings: selectedDetails.map((detail) => ({
            detailId: toText(detail.明细编号),
            version: toNumber(detail.版本号),
            quantity: toNumber(detail.当前数量),
          })),
        }),
      });
      const json = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!response.ok || !json.success) throw new Error(json.error || "物流批次创建失败");
      toast.success("物流批次已创建", {
        description: `已绑定 ${selectedDetails.length} 条明细${autoTransition ? "并推进至橙联在途" : ""}`,
      });
      setShipmentBatchNo("");
      setCarrier("");
      setTrackingNo("");
      setShippedAt(todayString());
      setAutoTransition(false);
      loadDetails();
    } catch (error) {
      toast.error("创建失败", {
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
            <CardTitle className="text-base">头程物流</CardTitle>
            <CardDescription>创建物流批次并绑定国内集货仓待发明细</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={loadDetails} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            刷新明细
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* 物流批次表单 */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-slate-500">物流批次号 *</label>
            <Input value={shipmentBatchNo} onChange={(event) => setShipmentBatchNo(event.target.value)} placeholder="SHIP-202606-001" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">承运商 *</label>
            <Input value={carrier} onChange={(event) => setCarrier(event.target.value)} placeholder="承运商名称" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">跟踪号</label>
            <Input value={trackingNo} onChange={(event) => setTrackingNo(event.target.value)} placeholder="物流跟踪号" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">发货日期</label>
            <Input type="date" value={shippedAt} onChange={(event) => setShippedAt(event.target.value)} />
          </div>
        </div>

        {/* 自动推进选项 */}
        <div className="flex items-center gap-2">
          <Checkbox checked={autoTransition} onChange={(event) => setAutoTransition(event.currentTarget.checked)} id="auto-transition" />
          <label htmlFor="auto-transition" className="text-sm text-slate-700 cursor-pointer">
            绑定后自动推进至 <Badge className="bg-orange-50 text-orange-700 ml-1">橙联在途</Badge>
          </label>
        </div>

        {/* 待发运明细列表 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900">
                <Truck className="inline size-4 mr-1" />
                待发运明细（{TARGET_STATE}）
              </p>
              <p className="text-xs text-slate-500">
                {pendingShipmentDetails.length} 条，已选 {selectedDetails.length} 条
              </p>
            </div>
            <Input
              className="max-w-[200px]"
              value={skuFilter}
              onChange={(event) => setSkuFilter(event.target.value)}
              placeholder="筛选 SKU"
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="grid grid-cols-[2.5rem_1.1fr_1fr_1fr_6rem] items-center gap-3 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 max-md:hidden">
              <Checkbox
                checked={pendingShipmentDetails.length > 0 && pendingShipmentDetails.every((detail) => selectedIds.has(detail.recordId))}
                onChange={(event) => toggleAll(event.currentTarget.checked)}
                disabled={pendingShipmentDetails.length === 0}
              />
              <span>SKU</span>
              <span>采购批次</span>
              <span>状态</span>
              <span className="text-right">数量</span>
            </div>

            {loading ? (
              <div className="p-8 text-center text-sm text-slate-500">正在读取库存明细...</div>
            ) : pendingShipmentDetails.length === 0 ? (
              <div className="p-8 text-center">
                <Truck className="mx-auto size-8 text-slate-200" />
                <p className="mt-2 text-sm text-slate-500">暂无待发运明细</p>
                <p className="mt-1 text-xs text-slate-400">请先将明细推进至「{TARGET_STATE}」</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {pendingShipmentDetails.map((detail) => {
                  const sku = toText(detail.SKU);
                  const purchaseBatch = toText(detail.来源采购批次);
                  const checked = selectedIds.has(detail.recordId);
                  return (
                    <label key={detail.recordId} className="grid cursor-pointer grid-cols-[2.5rem_1fr] gap-3 px-3 py-3 hover:bg-orange-50/40 md:grid-cols-[2.5rem_1.1fr_1fr_1fr_6rem] md:items-center">
                      <Checkbox checked={checked} onChange={(event) => toggleOne(detail.recordId, event.currentTarget.checked)} />
                      <div>
                        <p className="text-sm font-medium text-slate-900">{sku || "未命名 SKU"}</p>
                        <p className="truncate text-xs text-slate-500">{toText(detail.中文品名快照) || toText(detail.明细编号)}</p>
                      </div>
                      <div className="text-xs text-slate-500 max-md:col-start-2">
                        <p>{purchaseBatch || "未绑定采购批次"}</p>
                      </div>
                      <div className="max-md:col-start-2">
                        <Badge variant="outline">{TARGET_STATE}</Badge>
                      </div>
                      <div className="text-right text-sm font-semibold text-slate-900 max-md:col-start-2 max-md:text-left">
                        {toNumber(detail.当前数量)}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 操作栏 */}
        <div className="flex flex-col gap-3 rounded-lg border border-slate-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-600">
            已选 <span className="font-semibold text-slate-900">{selectedDetails.length}</span> 条，
            <span className="font-semibold text-slate-900">{selectedSkuCount}</span> 个 SKU，
            <span className="font-semibold text-slate-900">{selectedQuantity}</span> 件
            {autoTransition && (
              <span className="ml-1 text-orange-600">→ 将自动推进至橙联在途</span>
            )}
          </div>
          <Button onClick={submitShipment} disabled={submitting || selectedDetails.length === 0}>
            {submitting ? <Loader2 className="animate-spin" /> : <PackagePlus />}
            {submitting ? "创建中..." : "创建物流批次并绑定"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
