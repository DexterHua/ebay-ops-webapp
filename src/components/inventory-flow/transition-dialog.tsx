"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
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
  const [singleQuantity, setSingleQuantity] = useState("");
  const currentStates = useMemo(() => [...new Set(details.map((detail) => toText(detail.当前状态)).filter(Boolean))], [details]);
  const currentState = currentStates[0] || "";
  const nextState = getNextState(currentState);
  const totalQuantity = details.reduce((sum, detail) => sum + toNumber(detail.当前数量), 0);
  const skuCount = new Set(details.map((detail) => toText(detail.SKU)).filter(Boolean)).size;
  const singleDetail = details.length === 1 ? details[0] : undefined;
  const quantity = singleDetail ? toNumber(singleQuantity || singleDetail.当前数量) : 0;
  const remainingQuantity = singleDetail ? Math.max(toNumber(singleDetail.当前数量) - quantity, 0) : 0;

  useEffect(() => {
    if (!open || !singleDetail) return;
    const timer = setTimeout(() => setSingleQuantity(String(toNumber(singleDetail.当前数量))), 0);
    return () => clearTimeout(timer);
  }, [open, singleDetail]);

  const invalidReason = (() => {
    if (details.length === 0) return "请选择明细";
    if (currentStates.length !== 1) return "不同当前状态的明细不能在同一次操作中推进";
    if (!nextState) return "当前状态没有允许的下一状态";
    if (nextState === "橙联在途" && details.some((detail) => !toText(detail.当前物流批次))) {
      return "进入橙联在途前必须绑定物流批次";
    }
    if (singleDetail && (quantity <= 0 || quantity > toNumber(singleDetail.当前数量))) {
      return "推进数量必须大于 0 且不超过当前数量";
    }
    return "";
  })();

  const submit = async () => {
    if (invalidReason || !nextState) {
      toast.error(invalidReason || "无法推进");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/inventory-flow/transitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: crypto.randomUUID(),
          nextState,
          items: details.map((detail) => ({
            detailId: toText(detail.明细编号),
            version: toNumber(detail.版本号),
            quantity: singleDetail ? quantity : toNumber(detail.当前数量),
          })),
        }),
      });
      const json = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!response.ok || !json.success) throw new Error(json.error || "状态推进失败");
      toast.success("状态推进已提交", { description: `${details.length} 条明细进入 ${nextState}` });
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>确认推进状态</DialogTitle>
          <DialogDescription>提交后会写入库存明细、库存流水，并重算 SKU 运营汇总。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">明细数</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{details.length}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">SKU 数</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{skuCount}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">总件数</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{singleDetail ? quantity || 0 : totalQuantity}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white p-3">
            <Badge variant="outline">{currentState || "未知状态"}</Badge>
            <ArrowRight className="size-4 text-slate-400" />
            <Badge className="bg-orange-50 text-orange-700">{nextState || "无下一状态"}</Badge>
          </div>

          {singleDetail && (
            <div>
              <label className="mb-1 block text-xs text-slate-500">本次推进数量</label>
              <Input
                type="number"
                min={1}
                max={toNumber(singleDetail.当前数量)}
                step={1}
                value={singleQuantity}
                onChange={(event) => setSingleQuantity(event.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">剩余 {remainingQuantity} 件会保留在当前状态。</p>
            </div>
          )}

          {invalidReason && (
            <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
              {invalidReason}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
          <Button onClick={submit} disabled={Boolean(invalidReason) || submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            确认推进
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
