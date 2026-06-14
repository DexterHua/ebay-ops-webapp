"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { InventoryExceptionRecord } from "./types";

const TARGET_STATES = [
  "本地仓待清点",
  "待包装",
  "已发往国内集货仓",
  "国内集货仓待发",
  "橙联在途",
  "海外仓待上架",
  "橙联可售",
];

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return toNumber(record.value ?? record.text ?? record.number);
  }
  return 0;
}

function toText(value: unknown): string {
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(",");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return toText(record.text ?? record.value ?? record.name ?? "");
  }
  return value == null ? "" : String(value);
}

function formatTime(value: unknown) {
  const timestamp = toNumber(value);
  if (!timestamp) return "未记录";
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function statusBadge(status: string) {
  if (status === "待处理") return "border-red-200 bg-red-50 text-red-700";
  if (status === "处理中") return "border-orange-200 bg-orange-50 text-orange-700";
  if (status === "已补回") return "border-green-200 bg-green-50 text-green-700";
  if (status === "已报损") return "border-slate-200 bg-slate-100 text-slate-700";
  return "border-blue-200 bg-blue-50 text-blue-700";
}

export function ExceptionsTab() {
  const [exceptions, setExceptions] = useState<InventoryExceptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [action, setAction] = useState<"补回库存" | "确认报损">("补回库存");
  const [targetState, setTargetState] = useState("国内集货仓待发");
  const [remark, setRemark] = useState("");
  const [filters, setFilters] = useState({
    status: "",
    type: "",
    node: "",
    sku: "",
  });

  const loadExceptions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/inventory-flow/data?resource=exceptions");
      const json = await response.json() as { success?: boolean; data?: InventoryExceptionRecord[]; error?: string };
      if (!json.success) throw new Error(json.error || "读取库存异常失败");
      setExceptions(json.data || []);
    } catch (error) {
      toast.error("库存异常读取失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void loadExceptions(); }, 0);
    return () => clearTimeout(timer);
  }, [loadExceptions]);

  const filteredExceptions = useMemo(() => {
    return exceptions.filter((item) => {
      const status = toText(item.处理状态);
      const type = toText(item.异常类型);
      const node = toText(item.责任节点);
      const sku = toText(item.SKU).toUpperCase();
      return (!filters.status || status.includes(filters.status))
        && (!filters.type || type.includes(filters.type))
        && (!filters.node || node.includes(filters.node))
        && (!filters.sku || sku.includes(filters.sku.toUpperCase()));
    });
  }, [exceptions, filters]);

  const selectedException = filteredExceptions.find((item) => toText(item.异常编号) === selectedId)
    || exceptions.find((item) => toText(item.异常编号) === selectedId);
  const openCount = exceptions.filter((item) => ["待处理", "处理中"].includes(toText(item.处理状态))).length;
  const abnormalQty = exceptions
    .filter((item) => ["待处理", "处理中"].includes(toText(item.处理状态)))
    .reduce((sum, item) => sum + Math.abs(toNumber(item.差异数量)), 0);

  const submitResolution = async () => {
    if (!selectedException) {
      toast.error("请选择一条异常");
      return;
    }
    if (action === "补回库存" && !targetState) {
      toast.error("请选择补回目标状态");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/inventory-flow/exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exceptionId: toText(selectedException.异常编号),
          action,
          targetState: action === "补回库存" ? targetState : undefined,
          remark,
        }),
      });
      const json = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!response.ok || !json.success) throw new Error(json.error || "异常处理失败");

      toast.success("异常已处理", {
        description: `${toText(selectedException.SKU)} ${action}`,
      });
      setSelectedId("");
      setRemark("");
      await loadExceptions();
    } catch (error) {
      toast.error("处理失败", {
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
            <CardTitle className="text-base">库存异常</CardTitle>
            <CardDescription>跟踪清点、签收、上架差异，并完成补回或报损闭环</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={loadExceptions} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            刷新异常
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-red-100 bg-red-50 p-3">
            <p className="text-xs text-red-600">待处理异常</p>
            <p className="mt-1 text-lg font-semibold text-red-700">{openCount}</p>
          </div>
          <div className="rounded-lg border border-orange-100 bg-orange-50 p-3">
            <p className="text-xs text-orange-600">异常暂存件数</p>
            <p className="mt-1 text-lg font-semibold text-orange-700">{abnormalQty}</p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">全部异常</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{exceptions.length}</p>
          </div>
          <div className="rounded-lg border border-green-100 bg-green-50 p-3">
            <p className="text-xs text-green-600">已关闭</p>
            <p className="mt-1 text-lg font-semibold text-green-700">{exceptions.length - openCount}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Input value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} placeholder="处理状态" />
          <Input value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })} placeholder="异常类型" />
          <Input value={filters.node} onChange={(event) => setFilters({ ...filters, node: event.target.value })} placeholder="责任节点" />
          <Input value={filters.sku} onChange={(event) => setFilters({ ...filters, sku: event.target.value })} placeholder="SKU" />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="grid grid-cols-[1.1fr_1fr_1fr_6rem] items-center gap-3 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 max-md:hidden">
              <span>异常 / SKU</span>
              <span>节点</span>
              <span>数量</span>
              <span className="text-right">状态</span>
            </div>

            {loading ? (
              <div className="p-8 text-center text-sm text-slate-500">正在读取库存异常...</div>
            ) : filteredExceptions.length === 0 ? (
              <div className="p-8 text-center">
                <AlertTriangle className="mx-auto size-8 text-slate-200" />
                <p className="mt-2 text-sm text-slate-500">暂无匹配异常</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredExceptions.map((item) => {
                  const id = toText(item.异常编号);
                  const status = toText(item.处理状态) || "待处理";
                  const selected = id === selectedId;
                  return (
                    <button
                      key={item.recordId || id}
                      type="button"
                      onClick={() => setSelectedId(id)}
                      className={`grid w-full cursor-pointer grid-cols-1 gap-2 px-3 py-3 text-left hover:bg-orange-50/40 md:grid-cols-[1.1fr_1fr_1fr_6rem] md:items-center ${selected ? "bg-orange-50" : ""}`}
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">{toText(item.SKU) || "未命名 SKU"}</p>
                        <p className="truncate text-xs text-slate-500">{id || toText(item.来源明细编号)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-700">{toText(item.异常类型) || "其他"}</p>
                        <p className="text-xs text-slate-500">{toText(item.责任节点) || "未记录"} · {formatTime(item.创建时间)}</p>
                      </div>
                      <div className="text-sm text-slate-700">
                        <p>预期 {toNumber(item.预期数量)} / 实收 {toNumber(item.实收数量)}</p>
                        <p className={toNumber(item.差异数量) < 0 ? "text-red-600" : "text-green-600"}>
                          差异 {toNumber(item.差异数量)}
                        </p>
                      </div>
                      <div className="text-right max-md:text-left">
                        <Badge className={statusBadge(status)}>{status}</Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3">
              <p className="text-sm font-medium text-slate-900">处理异常</p>
              <p className="text-xs text-slate-500">
                {selectedException ? `${toText(selectedException.SKU)} · ${toText(selectedException.异常编号)}` : "先从左侧选择异常记录"}
              </p>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={action === "补回库存" ? "default" : "outline"}
                  onClick={() => setAction("补回库存")}
                  disabled={!selectedException}
                >
                  <RotateCcw />
                  补回
                </Button>
                <Button
                  type="button"
                  variant={action === "确认报损" ? "default" : "outline"}
                  onClick={() => setAction("确认报损")}
                  disabled={!selectedException}
                >
                  <ShieldX />
                  报损
                </Button>
              </div>

              {action === "补回库存" && (
                <div>
                  <label className="mb-1 block text-xs text-slate-500">补回目标状态</label>
                  <select
                    value={targetState}
                    onChange={(event) => setTargetState(event.target.value)}
                    disabled={!selectedException}
                    className="h-9 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
                  >
                    {TARGET_STATES.map((state) => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs text-slate-500">处理备注</label>
                <Textarea
                  value={remark}
                  onChange={(event) => setRemark(event.target.value)}
                  disabled={!selectedException}
                  placeholder="填写补回说明、报损原因或责任说明"
                />
              </div>

              {selectedException && !["待处理", "处理中"].includes(toText(selectedException.处理状态)) && (
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm text-slate-500">
                  这条异常已处理，不能重复关闭。
                </div>
              )}

              <Button
                className="w-full"
                disabled={
                  !selectedException
                  || submitting
                  || !["待处理", "处理中"].includes(toText(selectedException.处理状态))
                }
                onClick={submitResolution}
              >
                {submitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                提交处理
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
