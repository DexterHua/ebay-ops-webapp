"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2, RefreshCw, Split } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TransitionDialog } from "./transition-dialog";
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

function isDone(value: unknown) {
  return value === true || value === "true" || value === "是";
}

/** 明细是否为拆分后留置在原地的（原始数量 > 当前数量，表示已有部分被推进走） */
function isLeftover(detail: FlowDetailRecord): boolean {
  const original = toNumber(detail.原始数量);
  const current = toNumber(detail.当前数量);
  return original > 0 && current > 0 && original > current;
}

/** 明细编号是否表明它是拆分/绑定产物 */
function isSplitChild(detailId: string): boolean {
  return detailId.includes("-MOVE-") || detailId.includes("-BIND-");
}

export function FlowDetailsTab() {
  const [details, setDetails] = useState<FlowDetailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showLeftoverOnly, setShowLeftoverOnly] = useState(false);
  const [filters, setFilters] = useState({
    state: "",
    purchaseBatchNo: "",
    shipmentBatchNo: "",
    sku: "",
  });

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

  const filteredDetails = useMemo(() => {
    return details.filter((detail) => {
      if (isDone(detail.是否完成)) return false;
      const state = toText(detail.当前状态);
      const purchaseBatch = toText(detail.来源采购批次);
      const shipmentBatch = toText(detail.当前物流批次);
      const sku = toText(detail.SKU).toUpperCase();
      const matchesState = !filters.state || state.includes(filters.state);
      const matchesPurchase = !filters.purchaseBatchNo || purchaseBatch.includes(filters.purchaseBatchNo);
      const matchesShipment = !filters.shipmentBatchNo || shipmentBatch.includes(filters.shipmentBatchNo);
      const matchesSku = !filters.sku || sku.includes(filters.sku.toUpperCase());
      const matchesLeftover = !showLeftoverOnly || isLeftover(detail);
      return matchesState && matchesPurchase && matchesShipment && matchesSku && matchesLeftover;
    });
  }, [details, filters, showLeftoverOnly]);

  const selectedDetails = filteredDetails.filter((detail) => selectedIds.has(detail.recordId));
  const selectedQuantity = selectedDetails.reduce((sum, detail) => sum + toNumber(detail.当前数量), 0);
  const selectedSkuCount = new Set(selectedDetails.map((detail) => toText(detail.SKU)).filter(Boolean)).size;

  // 当前可见的留置库存统计
  const leftoverCount = details.filter((d) => !isDone(d.是否完成) && isLeftover(d)).length;

  const toggleOne = (recordId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(recordId);
      else next.delete(recordId);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(filteredDetails.map((detail) => detail.recordId)) : new Set());
  };

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">批次流转</CardTitle>
            <CardDescription>筛选明细、多选并批量推进。可逐行修改数量留置部分库存等待合并发货。</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {leftoverCount > 0 && (
              <Button
                variant={showLeftoverOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setShowLeftoverOnly((v) => !v)}
                className={showLeftoverOnly ? "bg-orange-500 hover:bg-orange-600" : ""}
              >
                <Split className="size-3.5" />
                留置 {leftoverCount}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={loadDetails} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              刷新明细
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Input value={filters.state} onChange={(event) => setFilters({ ...filters, state: event.target.value })} placeholder="当前状态" />
          <Input value={filters.purchaseBatchNo} onChange={(event) => setFilters({ ...filters, purchaseBatchNo: event.target.value })} placeholder="采购批次号" />
          <Input value={filters.shipmentBatchNo} onChange={(event) => setFilters({ ...filters, shipmentBatchNo: event.target.value })} placeholder="物流批次号" />
          <Input value={filters.sku} onChange={(event) => setFilters({ ...filters, sku: event.target.value })} placeholder="SKU" />
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="grid grid-cols-[2.5rem_1.1fr_1fr_1fr_6rem] items-center gap-3 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 max-md:hidden">
            <Checkbox
              checked={filteredDetails.length > 0 && filteredDetails.every((detail) => selectedIds.has(detail.recordId))}
              onChange={(event) => toggleAll(event.currentTarget.checked)}
              disabled={filteredDetails.length === 0}
            />
            <span>SKU</span>
            <span>批次</span>
            <span>状态</span>
            <span className="text-right">数量</span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">正在读取库存明细...</div>
          ) : filteredDetails.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              {showLeftoverOnly ? "暂无留置库存" : "暂无待推进明细"}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredDetails.map((detail) => {
                const sku = toText(detail.SKU);
                const purchaseBatch = toText(detail.来源采购批次);
                const shipmentBatch = toText(detail.当前物流批次);
                const state = toText(detail.当前状态);
                const currentQty = toNumber(detail.当前数量);
                const originalQty = toNumber(detail.原始数量);
                const checked = selectedIds.has(detail.recordId);
                const detailId = toText(detail.明细编号);
                const leftOver = isLeftover(detail);
                const splitChild = isSplitChild(detailId);

                return (
                  <label key={detail.recordId} className="grid cursor-pointer grid-cols-[2.5rem_1fr] gap-3 px-3 py-3 hover:bg-orange-50/40 md:grid-cols-[2.5rem_1.1fr_1fr_1fr_6rem] md:items-center">
                    <Checkbox checked={checked} onChange={(event) => toggleOne(detail.recordId, event.currentTarget.checked)} />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-slate-900">{sku || "未命名 SKU"}</p>
                        {leftOver && (
                          <Badge className="gap-1 border-orange-200 bg-orange-50 text-orange-700 text-[10px]">
                            <Split className="size-2.5" />
                            留置
                          </Badge>
                        )}
                        {splitChild && !leftOver && (
                          <Badge className="border-blue-200 bg-blue-50 text-blue-700 text-[10px]">
                            拆分
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-500">{toText(detail.中文品名快照) || detailId}</p>
                    </div>
                    <div className="text-xs text-slate-500 max-md:col-start-2">
                      <p>{purchaseBatch || "未绑定采购批次"}</p>
                      {shipmentBatch && <p>{shipmentBatch}</p>}
                    </div>
                    <div className="max-md:col-start-2">
                      <Badge variant="outline">{state || "未知状态"}</Badge>
                    </div>
                    <div className="text-right max-md:col-start-2 max-md:text-left">
                      <p className="text-sm font-semibold text-slate-900">{currentQty}</p>
                      {leftOver && (
                        <p className="text-[10px] text-slate-400">
                          原始 {originalQty}，{originalQty - currentQty} 已移出
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-slate-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-600">
            已选 <span className="font-semibold text-slate-900">{selectedDetails.length}</span> 条，
            <span className="font-semibold text-slate-900">{selectedSkuCount}</span> 个 SKU，
            <span className="font-semibold text-slate-900">{selectedQuantity}</span> 件
          </div>
          <Button disabled={selectedDetails.length === 0} onClick={() => setTransitionOpen(true)}>
            推进状态
            <ArrowRight />
          </Button>
        </div>

        <TransitionDialog
          open={transitionOpen}
          details={selectedDetails}
          onOpenChange={setTransitionOpen}
          onCompleted={loadDetails}
        />
      </CardContent>
    </Card>
  );
}
