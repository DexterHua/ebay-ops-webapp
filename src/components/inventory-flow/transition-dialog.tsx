"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Loader2, Split, Truck } from "lucide-react";
import { toast } from "sonner";
import { INVENTORY_STATES, type InventoryState } from "@/lib/inventory-flow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

function getNextState(currentState: string): InventoryState | undefined {
  const index = INVENTORY_STATES.indexOf(currentState as InventoryState);
  return index >= 0 ? INVENTORY_STATES[index + 1] : undefined;
}

function getExceptionType(nextState?: InventoryState) {
  if (nextState === "待包装") return "清点差异";
  if (nextState === "国内集货仓待发") return "集货仓签收差异";
  if (nextState === "海外仓待上架") return "海外仓签收差异";
  if (nextState === "橙联可售") return "上架差异";
  return "其他";
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export function TransitionDialog({
  open,
  details,
  onOpenChange,
  onCompleted,
}: {
  open: boolean;
  details: FlowDetailRecord[];
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  // 用户手动修改的数量（key=recordId，value=字符串）。未修改的明细默认取当期全部数量。
  const [quantityOverrides, setQuantityOverrides] = useState<Record<string, string>>({});
  const [actualQuantityOverrides, setActualQuantityOverrides] = useState<Record<string, string>>({});
  const [shipmentBatchNo, setShipmentBatchNo] = useState("");
  const [carrier, setCarrier] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [shippedAt, setShippedAt] = useState(todayString);

  // 弹窗关闭时清空覆盖值，下次打开时使用默认全部数量
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setQuantityOverrides({});
      setActualQuantityOverrides({});
      setShipmentBatchNo("");
      setCarrier("");
      setTrackingNo("");
      setShippedAt(todayString());
    }
    onOpenChange(nextOpen);
  };

  const currentStates = useMemo(
    () => [...new Set(details.map((detail) => toText(detail.当前状态)).filter(Boolean))],
    [details],
  );
  const currentState = currentStates[0] || "";
  const nextState = getNextState(currentState);
  const skuCount = new Set(details.map((detail) => toText(detail.SKU)).filter(Boolean)).size;
  const needsShipmentBatch = nextState === "橙联在途"
    && details.some((detail) => !toText(detail.当前物流批次));

  // 每条明细的有效数量：用户覆盖值 或 当前全部数量
  const effectiveQuantities = useMemo(() => {
    const result: Record<string, string> = {};
    for (const detail of details) {
      result[detail.recordId] = quantityOverrides[detail.recordId] ?? String(toNumber(detail.当前数量));
    }
    return result;
  }, [details, quantityOverrides]);

  // 每条明细的本次推进数量（数字形式）
  const parsedQuantities = useMemo(() => {
    const result: Record<string, number> = {};
    for (const detail of details) {
      const raw = effectiveQuantities[detail.recordId];
      const parsed = raw ? Number.parseInt(raw, 10) : 0;
      result[detail.recordId] = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
    }
    return result;
  }, [details, effectiveQuantities]);

  const effectiveActualQuantities = useMemo(() => {
    const result: Record<string, string> = {};
    for (const detail of details) {
      const expected = effectiveQuantities[detail.recordId] ?? String(toNumber(detail.当前数量));
      result[detail.recordId] = actualQuantityOverrides[detail.recordId] ?? expected;
    }
    return result;
  }, [details, effectiveQuantities, actualQuantityOverrides]);

  const parsedActualQuantities = useMemo(() => {
    const result: Record<string, number> = {};
    for (const detail of details) {
      const raw = effectiveActualQuantities[detail.recordId];
      const parsed = raw === "" ? 0 : Number.parseInt(raw, 10);
      result[detail.recordId] = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
    }
    return result;
  }, [details, effectiveActualQuantities]);

  // 本次推进总件数
  const totalAdvanceQty = Object.values(parsedQuantities).reduce((sum, q) => sum + q, 0);
  const totalActualQty = Object.values(parsedActualQuantities).reduce((sum, q) => sum + Math.max(q, 0), 0);
  const totalDifferenceQty = details.reduce(
    (sum, detail) => sum + Math.max((parsedQuantities[detail.recordId] || 0) - (parsedActualQuantities[detail.recordId] || 0), 0),
    0,
  );

  // 留置合计（暂留当前状态的数量）
  const totalRemainingQty = details.reduce(
    (sum, detail) => sum + Math.max(toNumber(detail.当前数量) - (parsedQuantities[detail.recordId] || 0), 0),
    0,
  );

  const invalidReason = (() => {
    if (details.length === 0) return "请选择明细";
    if (currentStates.length !== 1) return "不同当前状态的明细不能在同一次操作中推进";
    if (!nextState) return "当前状态没有允许的下一状态";
    if (needsShipmentBatch) {
      if (currentState !== "国内集货仓待发") return "只有国内集货仓待发明细可以创建物流批次并发运";
      if (!shipmentBatchNo.trim()) return "物流批次号不能为空";
      if (!carrier.trim()) return "承运商不能为空";
    } else if (nextState === "橙联在途" && details.some((detail) => !toText(detail.当前物流批次))) {
      return "进入橙联在途前必须绑定物流批次";
    }
    for (const detail of details) {
      const qty = parsedQuantities[detail.recordId] || 0;
      if (qty <= 0) return `明细 ${toText(detail.SKU) || toText(detail.明细编号)} 推进数量必须大于 0`;
      if (qty > toNumber(detail.当前数量)) {
        return `明细 ${toText(detail.SKU) || toText(detail.明细编号)} 推进数量超限`;
      }
      if (!needsShipmentBatch) {
        const actualQty = parsedActualQuantities[detail.recordId];
        if (actualQty < 0) return `明细 ${toText(detail.SKU) || toText(detail.明细编号)} 实收数量必须为非负整数`;
        if (actualQty > qty) return `明细 ${toText(detail.SKU) || toText(detail.明细编号)} 实收数量不能大于推进数量`;
      }
    }
    if (totalAdvanceQty <= 0) return "至少需要推进 1 件";
    return "";
  })();

  const hasAnyPartial = details.some(
    (detail) => (parsedQuantities[detail.recordId] || 0) < toNumber(detail.当前数量),
  );

  const submit = async () => {
    if (invalidReason || !nextState) {
      toast.error(invalidReason || "无法推进");
      return;
    }

    setSubmitting(true);
    try {
      if (needsShipmentBatch) {
        const response = await fetch("/api/inventory-flow/shipments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shipmentBatchNo: shipmentBatchNo.trim(),
            carrier: carrier.trim(),
            trackingNo: trackingNo.trim(),
            shippedAt,
            autoTransition: true,
            bindings: details.map((detail) => ({
              detailId: toText(detail.明细编号),
              version: toNumber(detail.版本号),
              quantity: parsedQuantities[detail.recordId] || toNumber(detail.当前数量),
            })),
          }),
        });
        const json = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
        if (!response.ok || !json.success) throw new Error(json.error || "物流发运失败");

        const remainingDesc = totalRemainingQty > 0
          ? `，${totalRemainingQty} 件留置国内集货仓待发等待合并`
          : "";
        toast.success("物流批次已创建并发运", {
          description: `${details.length} 条明细进入橙联在途，发运 ${totalAdvanceQty} 件${remainingDesc}`,
        });
        onOpenChange(false);
        onCompleted();
        return;
      }

      const response = await fetch("/api/inventory-flow/transitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: crypto.randomUUID(),
          nextState,
          items: details.map((detail) => ({
            detailId: toText(detail.明细编号),
            version: toNumber(detail.版本号),
            quantity: parsedQuantities[detail.recordId] || toNumber(detail.当前数量),
            actualQuantity: parsedActualQuantities[detail.recordId],
            exceptionType: parsedActualQuantities[detail.recordId] < (parsedQuantities[detail.recordId] || 0)
              ? getExceptionType(nextState)
              : undefined,
          })),
        }),
      });
      const json = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!response.ok || !json.success) throw new Error(json.error || "状态推进失败");

      const remainingDesc = totalRemainingQty > 0
        ? `，${totalRemainingQty} 件留置当前状态等待合并`
        : "";
      const differenceDesc = totalDifferenceQty > 0 ? `，${totalDifferenceQty} 件进入异常暂存` : "";
      toast.success("状态推进已提交", {
        description: `${details.length} 条明细进入 ${nextState}，预期 ${totalAdvanceQty} 件，实收 ${totalActualQty} 件${remainingDesc}${differenceDesc}`,
      });
      onOpenChange(false);
      onCompleted();
    } catch (error) {
      toast.error("推进失败", {
        description: error instanceof Error ? error.message : "服务端暂不可用",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{needsShipmentBatch ? "填写物流信息并发运" : "确认推进状态"}</DialogTitle>
          <DialogDescription>
            {needsShipmentBatch
              ? "提交后会创建物流批次、绑定所选明细，并直接推进至橙联在途。"
              : "提交后会写入库存明细、库存流水，并重算 SKU 运营汇总。"}
            如需留置部分库存，请修改对应明细的推进数量，留置件数保留在当前状态等待后续合并发货。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 汇总卡片 */}
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">明细数</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{details.length}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">SKU 数</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{skuCount}</p>
            </div>
            <div className="rounded-lg border border-green-100 bg-green-50 p-3">
              <p className="text-xs text-green-600">本次推进</p>
              <p className="mt-1 text-lg font-semibold text-green-700">{totalAdvanceQty}</p>
            </div>
            <div className="rounded-lg border border-orange-100 bg-orange-50 p-3">
              <p className="text-xs text-orange-600">留置</p>
              <p className="mt-1 text-lg font-semibold text-orange-700">{totalRemainingQty}</p>
            </div>
          </div>

          {/* 状态变化 */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white p-3">
            <Badge variant="outline">{currentState || "未知状态"}</Badge>
            <ArrowRight className="size-4 text-slate-400" />
            <Badge className="bg-orange-50 text-orange-700">{nextState || "无下一状态"}</Badge>
          </div>

          {needsShipmentBatch && (
            <div className="space-y-3 rounded-lg border border-orange-100 bg-orange-50/50 p-3">
              <div className="flex items-start gap-2">
                <Truck className="mt-0.5 size-4 shrink-0 text-orange-500" />
                <div>
                  <p className="text-sm font-medium text-orange-800">本次发运信息</p>
                  <p className="mt-0.5 text-xs text-orange-700">
                    这些信息会写入头程物流批次，后续可按物流批次号或跟踪号查询。
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
            </div>
          )}

          {/* 每条明细的推进数量 */}
          <div className="max-h-80 space-y-2 overflow-auto">
            <div className={`sticky top-0 z-10 grid ${needsShipmentBatch ? "grid-cols-[1.2fr_4rem_5.5rem_4rem]" : "grid-cols-[1.2fr_4rem_5.5rem_5.5rem_4rem]"} gap-3 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500`}>
              <span>SKU / 批次</span>
              <span className="text-right">现有</span>
              <span className="text-right">{needsShipmentBatch ? "发运数" : "推进数"}</span>
              {!needsShipmentBatch && <span className="text-right">实收数</span>}
              <span className="text-right">留置</span>
            </div>
            {details.map((detail) => {
              const sku = toText(detail.SKU);
              const purchaseBatch = toText(detail.来源采购批次);
              const currentQty = toNumber(detail.当前数量);
              const advanceQty = parsedQuantities[detail.recordId] || 0;
              const actualQty = parsedActualQuantities[detail.recordId] || 0;
              const remaining = Math.max(currentQty - advanceQty, 0);
              const isPartial = advanceQty > 0 && advanceQty < currentQty;
              const difference = Math.max(advanceQty - actualQty, 0);

              return (
                <div
                  key={detail.recordId}
                  className={`grid ${needsShipmentBatch ? "grid-cols-[1.2fr_4rem_5.5rem_4rem]" : "grid-cols-[1.2fr_4rem_5.5rem_5.5rem_4rem]"} items-center gap-3 rounded-md border border-slate-100 px-3 py-2`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{sku || "未命名"}</p>
                    <p className="truncate text-xs text-slate-500">{purchaseBatch || toText(detail.明细编号)}</p>
                  </div>
                  <p className="text-right text-sm text-slate-700">{currentQty}</p>
                  <div>
                    <Input
                      type="number"
                      min={1}
                      max={currentQty}
                      step={1}
                      value={effectiveQuantities[detail.recordId] || String(currentQty)}
                      onChange={(event) =>
                        setQuantityOverrides((prev) => ({
                          ...prev,
                          [detail.recordId]: event.target.value,
                        }))
                      }
                      className="h-8 text-sm text-right"
                    />
                  </div>
                  {!needsShipmentBatch && (
                    <div>
                      <Input
                        type="number"
                        min={0}
                        max={advanceQty || currentQty}
                        step={1}
                        value={effectiveActualQuantities[detail.recordId] || "0"}
                        onChange={(event) =>
                          setActualQuantityOverrides((prev) => ({
                            ...prev,
                            [detail.recordId]: event.target.value,
                          }))
                        }
                        className={`h-8 text-sm text-right ${difference > 0 ? "border-red-200 text-red-700" : ""}`}
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-1">
                    <span className={`text-sm ${isPartial ? "font-semibold text-orange-600" : "text-slate-400"}`}>
                      {remaining}
                    </span>
                    {isPartial && <Split className="size-3 text-orange-400" />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 留置提示 */}
          {hasAnyPartial && (
            <div className="flex items-start gap-2 rounded-lg border border-orange-100 bg-orange-50 p-3">
              <Split className="mt-0.5 size-4 shrink-0 text-orange-500" />
              <div className="text-sm text-orange-700">
                <p className="font-medium">部分数量留置</p>
                <p className="mt-0.5 text-xs text-orange-600">
                  留置的 {totalRemainingQty} 件库存将保留在「{currentState}」状态，
                  后续可与其他批次合并发运。拆分会在库存流水中记录「拆分推进」操作类型。
                </p>
              </div>
            </div>
          )}

          {!needsShipmentBatch && totalDifferenceQty > 0 && (
            <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
              实收少于推进数的 {totalDifferenceQty} 件会自动生成库存异常，并先进入异常暂存。
            </div>
          )}

          {invalidReason && (
            <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
              {invalidReason}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={submit} disabled={Boolean(invalidReason) || submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            {needsShipmentBatch
              ? `发运 ${totalAdvanceQty} 件至橙联在途`
              : totalDifferenceQty > 0
              ? `实收 ${totalActualQty} 件，异常 ${totalDifferenceQty} 件`
              : hasAnyPartial ? `推进 ${totalAdvanceQty} 件，留置 ${totalRemainingQty} 件` : "确认推进"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
