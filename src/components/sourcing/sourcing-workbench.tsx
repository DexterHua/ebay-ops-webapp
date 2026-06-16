"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type SourcingMode = "review" | "quote" | "readonly";
type SourcingFilter = "review" | "quotePending" | "quoting" | "completed" | "rejected";

type SourcingRecord = {
  recordId: string;
  OEM码?: unknown;
  品牌?: unknown;
  商品链接?: unknown;
  英文名称?: unknown;
  中文名称?: unknown;
  近90天销量?: unknown;
  eBay平均售价?: unknown;
  选品备注?: unknown;
  登记人?: unknown;
  登记时间?: unknown;
  选品阶段?: unknown;
  初选结果?: unknown;
  最高购入价格?: unknown;
  初选备注?: unknown;
  初选人?: unknown;
  初选时间?: unknown;
  供应商?: unknown;
  供应商报价?: unknown;
  采购备注?: unknown;
  询价人?: unknown;
  询价时间?: unknown;
};

const FILTER_LABELS: Record<SourcingFilter, string> = {
  review: "初选待处理",
  quotePending: "待询价清单",
  quoting: "询价中",
  completed: "已完成",
  rejected: "未入选",
};

function collectText(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectText);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return ["text", "name", "value", "url", "link"].flatMap((key) => collectText(record[key]));
  }
  return [];
}

function text(value: unknown): string {
  return collectText(value).join("、");
}

function money(value: unknown, currency = ""): string {
  const raw = text(value);
  if (!raw) return "-";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return raw;
  return `${currency}${parsed.toFixed(2)}`;
}

function dateText(value: unknown): string {
  const raw = text(value);
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return new Date(parsed).toLocaleString("zh-CN", { hour12: false });
  }
  return raw || "-";
}

function urlFrom(value: unknown): string {
  return collectText(value).find((item) => /^https?:\/\//i.test(item)) || "";
}

function matchesFilter(record: SourcingRecord, filter: SourcingFilter): boolean {
  const stage = text(record.选品阶段);
  const result = text(record.初选结果);
  if (filter === "review") return !stage || stage === "初选待处理";
  if (filter === "quotePending") return stage === "已入选待询价";
  if (filter === "quoting") return stage === "询价中";
  if (filter === "completed") return stage === "已完成";
  return stage === "未入选" || result === "未入选";
}

async function currentUserName(): Promise<string> {
  const me = await fetch("/api/auth/me")
    .then((response) => response.json())
    .catch(() => null) as { name?: string | null } | null;
  if (!me?.name) throw new Error("登录状态失效，请重新登录");
  return me.name;
}

export function SourcingWorkbench({
  filter,
  mode,
  title,
  description,
}: {
  filter: SourcingFilter;
  mode: SourcingMode;
  title: string;
  description: string;
}) {
  const [records, setRecords] = useState<SourcingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const readRecords = async (): Promise<SourcingRecord[]> => {
    const response = await fetch("/api/lark?table=sourcing");
    const json = await response.json() as { success?: boolean; data?: SourcingRecord[]; error?: string };
    if (!json.success) throw new Error(json.error || "选品数据读取失败");
    return json.data || [];
  };

  useEffect(() => {
    let cancelled = false;
    readRecords()
      .then((items) => {
        if (!cancelled) setRecords(items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "选品数据读取失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRecords(await readRecords());
    } catch (err) {
      setError(err instanceof Error ? err.message : "选品数据读取失败");
    } finally {
      setLoading(false);
    }
  };

  const visibleRecords = useMemo(
    () => records.filter((record) => matchesFilter(record, filter)),
    [records, filter],
  );

  const saveRecord = async (recordId: string, fields: Record<string, unknown>) => {
    setSavingId(recordId);
    try {
      const response = await fetch("/api/sourcing/record", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId, fields }),
      });
      const json = await response.json() as { success?: boolean; error?: string };
      if (!json.success) throw new Error(json.error || "保存失败");
      toast.success("选品记录已更新");
      await load();
    } catch (err) {
      toast.error("保存失败", { description: err instanceof Error ? err.message : "请稍后重试" });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="app-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="page-kicker">Sourcing Workflow</p>
          <h1 className="page-title">{title}</h1>
          <p className="page-description">{description}</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? "刷新中..." : "刷新"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{FILTER_LABELS[filter]}</CardTitle>
          <CardDescription>
            当前共 {visibleRecords.length} 条记录
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && <p className="text-sm text-slate-500">正在读取选品池...</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!loading && !error && visibleRecords.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
              当前阶段暂无记录
            </div>
          )}
          {visibleRecords.map((record) => (
            <SourcingRecordCard
              key={record.recordId}
              record={record}
              mode={mode}
              saving={savingId === record.recordId}
              onSave={(fields) => saveRecord(record.recordId, fields)}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function SourcingRecordCard({
  record,
  mode,
  saving,
  onSave,
}: {
  record: SourcingRecord;
  mode: SourcingMode;
  saving: boolean;
  onSave: (fields: Record<string, unknown>) => Promise<void>;
}) {
  const link = urlFrom(record.商品链接);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{text(record.选品阶段) || "初选待处理"}</Badge>
            {text(record.初选结果) && <Badge variant="outline">{text(record.初选结果)}</Badge>}
            <span className="text-xs text-slate-400">登记人：{text(record.登记人) || "-"}</span>
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">{text(record.中文名称) || "未命名商品"}</h2>
            <p className="text-sm text-slate-500">{text(record.英文名称) || "-"}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-4">
            <span>OEM：{text(record.OEM码) || "-"}</span>
            <span>品牌：{text(record.品牌) || "-"}</span>
            <span>90天销量：{text(record.近90天销量) || "-"}</span>
            <span>eBay均价：{money(record.eBay平均售价, "$")}</span>
          </div>
          <p className="text-xs text-slate-400">登记时间：{dateText(record.登记时间)}</p>
          {text(record.选品备注) && <p className="text-sm text-slate-600">备注：{text(record.选品备注)}</p>}
          {link && (
            <a className="text-xs font-medium text-orange-600 hover:underline" href={link} target="_blank" rel="noreferrer">
              打开商品链接
            </a>
          )}
        </div>
        <div className="w-full lg:w-80">
          {mode === "review" && <ReviewAction record={record} saving={saving} onSave={onSave} />}
          {mode === "quote" && <QuoteAction record={record} saving={saving} onSave={onSave} />}
          {mode === "readonly" && <ReadonlyProgress record={record} />}
        </div>
      </div>
    </div>
  );
}

function ReviewAction({
  record,
  saving,
  onSave,
}: {
  record: SourcingRecord;
  saving: boolean;
  onSave: (fields: Record<string, unknown>) => Promise<void>;
}) {
  const [result, setResult] = useState(text(record.初选结果) || "入选");
  const [maxPrice, setMaxPrice] = useState(text(record.最高购入价格));
  const [remark, setRemark] = useState(text(record.初选备注));

  const submit = async () => {
    const price = maxPrice.trim() ? Number.parseFloat(maxPrice) : undefined;
    if (price !== undefined && !Number.isFinite(price)) {
      toast.error("最高购入价格必须是数字");
      return;
    }
    try {
      const reviewer = await currentUserName();
      const stage = result === "入选" ? "已入选待询价" : result === "未入选" ? "未入选" : "初选待处理";
      await onSave({
        初选结果: result,
        最高购入价格: price,
        初选备注: remark.trim(),
        初选人: reviewer,
        初选时间: new Date().toISOString(),
        选品阶段: stage,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    }
  };

  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-medium text-slate-500">初选操作</p>
      <Select value={result} onValueChange={(value) => setResult(value || "入选")}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {["入选", "未入选", "待补充"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} type="number" min="0" step="0.01" placeholder="最高购入价格（人民币）" />
      <Textarea value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="初选备注" />
      <Button className="w-full" onClick={submit} disabled={saving}>
        {saving ? "保存中..." : "保存初选结果"}
      </Button>
    </div>
  );
}

function QuoteAction({
  record,
  saving,
  onSave,
}: {
  record: SourcingRecord;
  saving: boolean;
  onSave: (fields: Record<string, unknown>) => Promise<void>;
}) {
  const [supplier, setSupplier] = useState(text(record.供应商));
  const [quote, setQuote] = useState(text(record.供应商报价));
  const [remark, setRemark] = useState(text(record.采购备注));

  const submit = async () => {
    const price = quote.trim() ? Number.parseFloat(quote) : undefined;
    if (price !== undefined && !Number.isFinite(price)) {
      toast.error("供应商报价必须是数字");
      return;
    }
    try {
      const purchaser = await currentUserName();
      const stage = supplier.trim() && price !== undefined ? "已完成" : "询价中";
      await onSave({
        供应商: supplier.trim(),
        供应商报价: price,
        采购备注: remark.trim(),
        询价人: purchaser,
        询价时间: new Date().toISOString(),
        选品阶段: stage,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    }
  };

  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-medium text-slate-500">询价操作</p>
      <Input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="供应商" />
      <Input value={quote} onChange={(event) => setQuote(event.target.value)} type="number" min="0" step="0.01" placeholder="供应商报价（人民币）" />
      <Textarea value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="采购备注" />
      <Button className="w-full" onClick={submit} disabled={saving}>
        {saving ? "保存中..." : "保存询价信息"}
      </Button>
    </div>
  );
}

function ReadonlyProgress({ record }: { record: SourcingRecord }) {
  return (
    <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
      <p>最高购入价：{money(record.最高购入价格, "¥")}</p>
      <p>初选人：{text(record.初选人) || "-"}</p>
      <p>供应商：{text(record.供应商) || "-"}</p>
      <p>报价：{money(record.供应商报价, "¥")}</p>
      <p>询价人：{text(record.询价人) || "-"}</p>
    </div>
  );
}
