"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { SKU_CHANGE_EDITABLE_FIELDS, buildSkuChangePatch, type SkuChangeRequest } from "@/lib/sku-change-request";
import { AlertTriangle, BadgeCheck, BadgeX, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Search, Send, Upload } from "lucide-react";

// ============================================================
// 数据录入 — 高频表单
// ============================================================

const STORES = ["NewPower", "VelocityGear", "TitanRig", "Solidparts", "Nexusmoto"];

interface SkuOption { recordId?: string; SKU?: string; 中文品名?: string; [key: string]: unknown }

export default function DataEntryPage() {
  const [skuList, setSkuList] = useState<SkuOption[]>([]);
  const [activeTab, setActiveTab] = useState("sku");

  useEffect(() => {
    fetch("/api/lark?table=sku&limit=200")
      .then(r => r.json()).then(j => { if (j.success) setSkuList(j.data); }).catch(() => {});
  }, []);

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "/");

  return (
    <div className="app-page max-w-4xl">
      <div>
        <p className="page-kicker">Data Workspace</p>
        <h1 className="page-title">数据录入</h1>
        <p className="page-description">飞书多维表格数据在线录入，无需切换到飞书界面</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex w-full justify-start overflow-x-auto">
          <TabsTrigger value="sku">SKU 主数据</TabsTrigger>
          <TabsTrigger value="sales">销售日报</TabsTrigger>
          <TabsTrigger value="issues">客服异常</TabsTrigger>
          <TabsTrigger value="competitors">竞品</TabsTrigger>
        </TabsList>

        <TabsContent value="sku">
          <SkuForm skuList={skuList} />
        </TabsContent>
        <TabsContent value="sales">
          <SalesImportPanel />
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
      if (json.success) {
        if (json.warning) toast.warning("记录已保存，但需要检查", { description: json.warning });
        else toast.success("已保存到飞书");
        return true;
      }
      else { toast.error("保存失败", { description: json.error }); return false; }
    } catch { toast.error("网络错误"); return false; }
    finally { setSubmitting(false); }
  };
  return { submitting, submit };
}

// ==============================================================
//  SKU 主数据录入
// ==============================================================
type SkuImportResult = {
  success?: boolean;
  commit?: boolean;
  ready?: number;
  created?: number;
  duplicates?: Array<{ sourceRow: number; SKU?: unknown; 中文品名?: unknown; reason?: string }>;
  errors?: Array<{ row: number; message: string }>;
  summary?: {
    totalRows: number;
    validRows: number;
    duplicateRows: number;
    errorRows: number;
  };
  rows?: Array<{ sourceRow: number; SKU?: unknown; 中文品名?: unknown }>;
  recordIds?: string[];
  warning?: string;
  error?: string;
};

function SkuForm({ skuList }: { skuList: SkuOption[] }) {
  const [importFile, setImportFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SkuImportResult | null>(null);
  const [result, setResult] = useState<SkuImportResult | null>(null);
  const [loading, setLoading] = useState<"preview" | "commit" | null>(null);

  const submitImport = async (commit: boolean) => {
    if (!importFile) { toast.error("请选择商品录入模板 XLSX 文件"); return; }
    setLoading(commit ? "commit" : "preview");
    if (!commit) setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile, importFile.name);
      formData.append("commit", commit ? "true" : "false");
      const response = await fetch("/api/sku/import", { method: "POST", body: formData });
      const json = await response.json() as SkuImportResult;
      if (!response.ok || !json.success) {
        toast.error(commit ? "导入失败" : "解析失败", { description: json.error });
        return;
      }
      if (commit) {
        setResult(json);
        if (json.warning) toast.warning("SKU 已导入，但需要检查", { description: json.warning });
        else toast.success("SKU 主数据已导入", { description: `新增 ${json.created || 0} 条，跳过重复 ${json.duplicates?.length || 0} 条` });
      } else {
        setPreview(json);
        toast.success("解析完成", { description: `可导入 ${json.ready || 0} 条，重复 ${json.duplicates?.length || 0} 条，异常 ${json.errors?.length || 0} 条` });
      }
    } catch (error) {
      toast.error("请求失败", { description: error instanceof Error ? error.message : "网络错误" });
    } finally {
      setLoading(null);
    }
  };

  const canImport = Boolean(importFile && preview && (preview.ready || 0) > 0 && loading !== "commit");
  const summary = result?.summary || preview?.summary;

  return <Card>
    <CardHeader><CardTitle className="text-base">SKU 主数据导入</CardTitle><CardDescription>通过模板批量导入新品，重复 SKU 会自动跳过；存量 SKU 走补录审核。</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500">批量导入新品</p>
            <p className="mt-1 text-xs text-gray-400">下载模板后填写新品，重量列按 kg 填写，系统导入前会转换为 g。</p>
          </div>
          <Button type="button" variant="outline" onClick={() => { window.location.href = "/api/sku/import/template"; }}>
            <Download />
            下载导入模板
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <label className="mb-1 block text-xs text-gray-400">商品录入模板 XLSX 文件</label>
            <Input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                setImportFile(event.target.files?.[0] || null);
                setPreview(null);
                setResult(null);
              }}
            />
          </div>
          <Button type="button" variant="outline" onClick={() => submitImport(false)} disabled={!importFile || loading !== null}>
            {loading === "preview" ? <RefreshCw className="animate-spin" /> : <Upload />}
            解析预览
          </Button>
          <Button type="button" onClick={() => submitImport(true)} disabled={!canImport}>
            {loading === "commit" ? <RefreshCw className="animate-spin" /> : <CheckCircle2 />}
            导入新品
          </Button>
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ImportMetric label="总行数" value={summary.totalRows} />
            <ImportMetric label="可导入" value={preview?.ready ?? result?.created ?? 0} />
            <ImportMetric label="重复" value={summary.duplicateRows} />
            <ImportMetric label="异常" value={summary.errorRows} tone={summary.errorRows > 0 ? "warn" : "default"} />
          </div>
        )}

        {result?.warning && (
          <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {result.warning}
          </div>
        )}

        {(preview?.errors?.length || result?.errors?.length) ? (
          <ImportList
            icon={<AlertTriangle className="size-4 text-amber-600" />}
            title="异常行"
            items={(result?.errors || preview?.errors || []).slice(0, 8).map((item) => `第 ${item.row} 行：${item.message}`)}
          />
        ) : null}

        {(preview?.duplicates?.length || result?.duplicates?.length) ? (
          <ImportList
            title="重复 SKU"
            items={(result?.duplicates || preview?.duplicates || []).slice(0, 8).map((item) => `第 ${item.sourceRow} 行：${String(item.SKU || "")} ${item.reason || ""}`)}
          />
        ) : null}

        {(preview?.rows?.length || 0) > 0 && (
          <ImportList
            title="预览明细"
            items={(preview?.rows || []).slice(0, 8).map((item) => `第 ${item.sourceRow} 行：${String(item.SKU || "")} / ${String(item.中文品名 || "")}`)}
          />
        )}
      </div>

      <Separator />

      <SkuChangeRequestPanel skuList={skuList} />
    </CardContent>
  </Card>;
}

function displayText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(displayText).filter(Boolean).join("、");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return displayText(record.text ?? record.value ?? record.name ?? record.id ?? "");
  }
  return "";
}

function pickSkuChangeFields(sku: SkuOption): Record<string, unknown> {
  const fields: Record<string, unknown> = { SKU: sku.SKU || "" };
  for (const field of SKU_CHANGE_EDITABLE_FIELDS) {
    fields[field] = sku[field] ?? "";
  }
  return fields;
}

function SkuChangeRequestPanel({ skuList }: { skuList: SkuOption[] }) {
  const [user, setUser] = useState<{ name?: string | null; isAdmin?: boolean; role?: string | null }>({});
  const [query, setQuery] = useState("");
  const [showMatches, setShowMatches] = useState(false);
  const [selectedSku, setSelectedSku] = useState<SkuOption | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [requests, setRequests] = useState<SkuChangeRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const loadRequests = async () => {
    setRequestsLoading(true);
    try {
      const response = await fetch("/api/sku/change-requests");
      const json = await response.json() as { success?: boolean; data?: SkuChangeRequest[]; error?: string };
      if (!response.ok || !json.success) throw new Error(json.error || "读取 SKU 修改申请失败");
      setRequests(json.data || []);
    } catch (error) {
      toast.error("SKU 修改申请加载失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally {
      setRequestsLoading(false);
    }
  };

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((json) => setUser(json))
      .catch(() => setUser({}));
    const timer = setTimeout(() => { void loadRequests(); }, 0);
    return () => clearTimeout(timer);
  }, []);

  const matchedSkus = query.trim()
    ? skuList.filter((sku) => {
      const keyword = query.trim().toLowerCase();
      return displayText(sku.SKU).toLowerCase().includes(keyword)
        || displayText(sku.中文品名).toLowerCase().includes(keyword);
    }).slice(0, 20)
    : [];

  const selectSku = (sku: SkuOption) => {
    setSelectedSku(sku);
    setQuery(`${displayText(sku.SKU)} / ${displayText(sku.中文品名)}`);
    setShowMatches(false);
    setEdits(Object.fromEntries(SKU_CHANGE_EDITABLE_FIELDS.map((field) => [field, displayText(sku[field])])));
  };

  const original = selectedSku ? pickSkuChangeFields(selectedSku) : {};
  const { changedFields } = selectedSku
    ? buildSkuChangePatch({ original, updates: edits })
    : { changedFields: [] };

  const submitRequest = async () => {
    if (!selectedSku?.recordId || !selectedSku.SKU) {
      toast.error("请先选择已有 SKU");
      return;
    }
    if (changedFields.length === 0) {
      toast.error("没有可提交的修改");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/sku/change-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: selectedSku.SKU,
          skuRecordId: selectedSku.recordId,
          original,
          updates: edits,
        }),
      });
      const json = await response.json() as { success?: boolean; error?: string; message?: string };
      if (!response.ok || !json.success) throw new Error(json.error || "提交失败");
      toast.success(json.message || "SKU 修改申请已提交");
      setSelectedSku(null);
      setQuery("");
      setEdits({});
      await loadRequests();
    } catch (error) {
      toast.error("提交失败", { description: error instanceof Error ? error.message : "服务端暂不可用" });
    } finally {
      setSubmitting(false);
    }
  };

  const reviewRequest = async (request: SkuChangeRequest, action: "approve" | "reject") => {
    const note = action === "reject"
      ? window.prompt("请输入否决原因（可留空）") || ""
      : "";
    if (action === "approve" && !window.confirm(`确认通过 ${request.sku} 的修改申请吗？`)) return;

    setReviewing(request.recordId);
    try {
      const response = await fetch("/api/sku/change-requests", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: request.recordId, action, reviewNote: note }),
      });
      const json = await response.json() as { success?: boolean; error?: string; message?: string };
      if (!response.ok || !json.success) throw new Error(json.error || "审核失败");
      toast.success(json.message || "审核完成");
      await loadRequests();
    } catch (error) {
      toast.error("审核失败", { description: error instanceof Error ? error.message : "服务端暂不可用" });
    } finally {
      setReviewing(null);
    }
  };

  const pendingRequests = requests.filter((request) => request.status === "待审核");
  const recentRequests = requests.filter((request) => request.status !== "待审核").slice(0, 5);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-gray-500">存量 SKU 补录</p>
        <p className="mt-1 text-xs text-gray-400">运营和采购提交已有 SKU 的修改申请，管理员通过后写入 01_SKU主数据。</p>
      </div>

      <div className="space-y-3 rounded-md border border-slate-100 bg-slate-50/50 p-3">
        <div className="relative">
          <label className="mb-1 block text-xs text-gray-400">选择已有 SKU</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-300" />
            <Input
              className="pl-9"
              placeholder="输入 SKU 编码或中文品名"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedSku(null);
                setShowMatches(true);
              }}
              onFocus={() => { if (query) setShowMatches(true); }}
              onBlur={() => setTimeout(() => setShowMatches(false), 200)}
            />
          </div>
          {showMatches && matchedSkus.length > 0 && (
            <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
              <ScrollArea className="max-h-56">
                {matchedSkus.map((sku, index) => (
                  <button
                    key={sku.recordId || String(index)}
                    className="w-full border-b border-slate-50 px-3 py-2 text-left last:border-b-0 hover:bg-blue-50"
                    onMouseDown={() => selectSku(sku)}
                  >
                    <span className="text-sm font-medium text-slate-900">{displayText(sku.SKU)}</span>
                    <span className="ml-2 text-xs text-slate-400">{displayText(sku.中文品名)}</span>
                  </button>
                ))}
              </ScrollArea>
            </div>
          )}
          {showMatches && query && matchedSkus.length === 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white p-2 text-center text-sm text-slate-400">未匹配</div>
          )}
        </div>

        {selectedSku && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {SKU_CHANGE_EDITABLE_FIELDS.map((field) => (
                <div key={field} className={field === "描述" || field === "备注" ? "sm:col-span-3" : ""}>
                  <label className="text-[10px] text-gray-400">{field}</label>
                  {field === "描述" || field === "备注" ? (
                    <Textarea
                      value={edits[field] || ""}
                      onChange={(event) => setEdits({ ...edits, [field]: event.target.value })}
                      className="min-h-20 bg-white"
                    />
                  ) : (
                    <Input
                      value={edits[field] || ""}
                      onChange={(event) => setEdits({ ...edits, [field]: event.target.value })}
                      className="bg-white"
                    />
                  )}
                </div>
              ))}
            </div>

            {changedFields.length > 0 && (
              <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2">
                <p className="text-xs font-medium text-blue-700">修改字段</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {changedFields.map((field) => (
                    <Badge key={field} variant="secondary" className="bg-white text-blue-700">{field}</Badge>
                  ))}
                </div>
              </div>
            )}

            <Button type="button" onClick={submitRequest} disabled={submitting || changedFields.length === 0} className="w-full">
              {submitting ? <RefreshCw className="animate-spin" /> : <Send />}
              提交修改申请
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-md border border-slate-100 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <div>
            <p className="text-sm font-medium text-slate-700">修改申请</p>
            <p className="text-xs text-slate-400">{user.isAdmin ? "管理员审核队列" : "我的提交记录"}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={loadRequests} disabled={requestsLoading}>
            {requestsLoading ? <RefreshCw className="animate-spin" /> : <RefreshCw />}
            刷新
          </Button>
        </div>

        <div className="space-y-2 p-3">
          {requestsLoading ? (
            <p className="py-6 text-center text-sm text-slate-400">加载中...</p>
          ) : requests.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">暂无修改申请</p>
          ) : (
            [...pendingRequests, ...recentRequests].map((request) => (
              <div key={request.recordId} className="rounded-md border border-slate-100 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{request.sku}</p>
                      <Badge className={request.status === "待审核" ? "bg-amber-100 text-amber-700 hover:bg-amber-100" : request.status === "已通过" ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : "bg-slate-100 text-slate-600 hover:bg-slate-100"}>
                        {request.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">提交人：{request.submitter || "-"} · 字段：{request.changedFields.join("、") || "-"}</p>
                  </div>
                  {user.isAdmin && request.status === "待审核" && (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 border-emerald-200 px-2 text-emerald-700 hover:bg-emerald-50"
                        disabled={reviewing === request.recordId}
                        onClick={() => reviewRequest(request, "approve")}
                      >
                        {reviewing === request.recordId ? <RefreshCw className="size-3 animate-spin" /> : <BadgeCheck className="size-3" />}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 border-red-200 px-2 text-red-700 hover:bg-red-50"
                        disabled={reviewing === request.recordId}
                        onClick={() => reviewRequest(request, "reject")}
                      >
                        {reviewing === request.recordId ? <RefreshCw className="size-3 animate-spin" /> : <BadgeX className="size-3" />}
                      </Button>
                    </div>
                  )}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {request.changedFields.slice(0, 6).map((field) => (
                    <div key={field} className="rounded-md bg-slate-50 px-2 py-1.5 text-xs">
                      <p className="font-medium text-slate-600">{field}</p>
                      <p className="mt-0.5 truncate text-slate-400">原：{displayText(request.original[field]) || "-"}</p>
                      <p className="mt-0.5 truncate text-slate-700">新：{displayText(request.patch[field]) || "-"}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ==============================================================
//  销售日报导入
// ==============================================================
type SalesImportResult = {
  success?: boolean;
  commit?: boolean;
  ready?: number;
  created?: number;
  duplicates?: Array<{ sourceRow: number; importKey: string; SKU?: unknown; 店铺?: unknown; 售出数量?: unknown }>;
  errors?: Array<{ row: number; message: string }>;
  summary?: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    dateRange?: { from: string; to: string };
    stores: string[];
  };
  rows?: Array<{ sourceRow: number; importKey: string; SKU?: unknown; 店铺?: unknown; 售出数量?: unknown }>;
  scan?: {
    status?: "started" | "skipped";
    reason?: string;
    limit?: number;
    processed?: number;
    deducted?: number;
    skipped?: number;
    exceptions?: number;
    warnings?: number;
    notificationStatus?: string;
  };
  error?: string;
};

function SalesImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SalesImportResult | null>(null);
  const [result, setResult] = useState<SalesImportResult | null>(null);
  const [loading, setLoading] = useState<"preview" | "commit" | null>(null);

  const submitImport = async (commit: boolean) => {
    if (!file) { toast.error("请选择店小秘 XLSX 文件"); return; }
    setLoading(commit ? "commit" : "preview");
    if (!commit) setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("commit", commit ? "true" : "false");
      const response = await fetch("/api/sales/import", { method: "POST", body: formData });
      const json = await response.json() as SalesImportResult;
      if (!response.ok || !json.success) {
        toast.error(commit ? "导入失败" : "解析失败", { description: json.error });
        return;
      }
      if (commit) {
        setResult(json);
        const scanDescription = json.scan?.status === "started"
          ? "库存扣减后台处理中"
          : json.scan?.status === "skipped"
            ? "没有新增记录，库存扫描已跳过"
            : "库存状态已返回";
        toast.success("销售日报已写入", { description: `新增 ${json.created || 0} 条，重复 ${json.duplicates?.length || 0} 条；${scanDescription}` });
      } else {
        setPreview(json);
        toast.success("解析完成", { description: `可导入 ${json.ready || 0} 条，异常 ${json.errors?.length || 0} 条` });
      }
    } catch (error) {
      toast.error("请求失败", { description: error instanceof Error ? error.message : "网络错误" });
    } finally {
      setLoading(null);
    }
  };

  const canImport = Boolean(file && preview && (preview.ready || 0) > 0 && loading !== "commit");
  const summary = result?.summary || preview?.summary;

  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="size-4" /> 销售日报导入</CardTitle>
      <CardDescription>店小秘销售数据写入 07_销售日报，并同步库存扣减与店铺销售看板</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <label className="mb-1 block text-xs text-gray-400">店小秘 XLSX 文件</label>
          <Input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setPreview(null);
              setResult(null);
            }}
          />
        </div>
        <Button type="button" variant="outline" onClick={() => submitImport(false)} disabled={!file || loading !== null}>
          {loading === "preview" ? <RefreshCw className="animate-spin" /> : <Upload />}
          解析预览
        </Button>
        <Button type="button" onClick={() => submitImport(true)} disabled={!canImport}>
          {loading === "commit" ? <RefreshCw className="animate-spin" /> : <CheckCircle2 />}
          导入并扣减库存
        </Button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <ImportMetric label="总行数" value={summary.totalRows} />
          <ImportMetric label="有效行" value={summary.validRows} />
          <ImportMetric label="可导入" value={preview?.ready ?? result?.created ?? 0} />
          <ImportMetric label="重复" value={preview?.duplicates?.length ?? result?.duplicates?.length ?? 0} />
          <ImportMetric label="异常" value={summary.errorRows} tone={summary.errorRows > 0 ? "warn" : "default"} />
        </div>
      )}

      {summary?.dateRange && (
        <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-medium text-slate-700">{summary.dateRange.from} 至 {summary.dateRange.to}</span>
          <span className="mx-2 text-slate-300">|</span>
          <span>{summary.stores.join(" / ") || "无店铺"}</span>
        </div>
      )}

      {result?.scan && (
        <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {result.scan.status === "started"
            ? `销售日报已写入，库存扣减扫描已在后台启动（本次最多处理 ${result.scan.limit || 0} 条）。稍后刷新仪表盘查看库存与销售看板。`
            : result.scan.status === "skipped"
              ? `销售日报无新增记录，已跳过库存扣减扫描：${result.scan.reason || ""}`
              : `库存扫描：处理 ${result.scan.processed || 0} 条，扣减 ${result.scan.deducted || 0} 条，异常 ${result.scan.exceptions || 0} 条，预警 ${result.scan.warnings || 0} 个`}
        </div>
      )}

      {(preview?.errors?.length || result?.errors?.length) ? (
        <ImportList
          icon={<AlertTriangle className="size-4 text-amber-600" />}
          title="异常行"
          items={(result?.errors || preview?.errors || []).slice(0, 8).map((item) => `第 ${item.row} 行：${item.message}`)}
        />
      ) : null}

      {(preview?.duplicates?.length || result?.duplicates?.length) ? (
        <ImportList
          title="重复记录"
          items={(result?.duplicates || preview?.duplicates || []).slice(0, 8).map((item) => `第 ${item.sourceRow} 行：${String(item.SKU || "")} ${String(item.店铺 || "")}`)}
        />
      ) : null}

      {(preview?.rows?.length || 0) > 0 && (
        <ImportList
          title="预览明细"
          items={(preview?.rows || []).slice(0, 8).map((item) => `第 ${item.sourceRow} 行：${String(item.SKU || "")} / ${String(item.店铺 || "")} / ${String(item.售出数量 || "")} 件`)}
        />
      )}
    </CardContent>
  </Card>;
}

function ImportMetric({ label, value, tone = "default" }: { label: string; value: number | string; tone?: "default" | "warn" }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${tone === "warn" ? "border-amber-100 bg-amber-50" : "border-slate-100 bg-white"}`}>
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function ImportList({ title, items, icon }: { title: string; items: string[]; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-100 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
        {icon}
        <span>{title}</span>
      </div>
      <div className="max-h-44 overflow-auto px-3 py-2">
        {items.map((item) => (
          <p key={item} className="truncate py-0.5 text-xs text-slate-500">{item}</p>
        ))}
      </div>
    </div>
  );
}

// ==============================================================
//  客服异常
// ==============================================================
function IssuesForm({ skuList, today }: { skuList: SkuOption[]; today: string }) {
  const { submitting, submit } = useSubmit();
  const ISSUE_TYPES = ["买家消息", "差评风险", "纠纷Case", "退货", "退款", "取消请求", "物流异常", "商品质量", "账号风险"];
  const [form, setForm] = useState({ SKU: "", 订单号: "", 店铺: "NewPower", 异常类型: "买家消息", 问题描述: "", 优先级: "中", 状态: "待办", 责任人: "", 描述: "", 备注: "", 创建日期: today });
  const [skuQuery, setSkuQuery] = useState("");
  const [showSku, setShowSku] = useState(false);

  const matched = skuQuery.trim()
    ? skuList.filter(s => s.SKU?.toLowerCase().includes(skuQuery.toLowerCase()) || s.中文品名?.toLowerCase().includes(skuQuery.toLowerCase()))
    : [];

  const handleSkuSelect = (s: SkuOption) => {
    setForm({ ...form, SKU: s.SKU || "" });
    setSkuQuery(s.SKU || "");
    setShowSku(false);
  };

  const handleSubmit = async () => {
    if (!form.SKU) { toast.error("请填写 SKU"); return; }
    const ok = await submit("issues", form);
    if (ok) setForm({ ...form, 订单号: "", 描述: "", 备注: "" });
  };

  return <Card>
    <CardHeader><CardTitle className="text-base">客服售后记录</CardTitle><CardDescription>收到买家消息/评价/纠纷时录入，写入 08_客服售后异常</CardDescription></CardHeader>
    <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="relative"><label className="text-xs text-gray-400">SKU *</label>
        <Input
          placeholder="输入 SKU 编码或品名…"
          value={skuQuery}
          onChange={e => {
            setSkuQuery(e.target.value);
            setForm({ ...form, SKU: "" });
            setShowSku(true);
          }}
          onFocus={() => { if (skuQuery) setShowSku(true); }}
          onBlur={() => setTimeout(() => setShowSku(false), 200)}
        />
        {showSku && matched.length > 0 && (
          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-hidden">
            <ScrollArea className="max-h-48">
              {matched.map((s, i) => (
                <button key={String(s._idx ?? i)} className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-b-0" onMouseDown={() => handleSkuSelect(s)}>
                  <span className="text-sm font-medium text-gray-900">{s.SKU}</span>
                  <span className="text-xs text-gray-400 ml-2">{s.中文品名}</span>
                </button>
              ))}
            </ScrollArea>
          </div>
        )}
        {showSku && skuQuery && matched.length === 0 && (
          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-center text-sm text-gray-400">未匹配</div>
        )}
      </div>
      <div><label className="text-xs text-gray-400">订单号</label><Input value={form.订单号} onChange={e => setForm({...form, 订单号: e.target.value})} /></div>
      <div><label className="text-xs text-gray-400">店铺</label><Select value={form.店铺} onValueChange={(v) => setForm({...form, 店铺: v || "NewPower"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STORES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
      <div><label className="text-xs text-gray-400">异常类型 *</label><Select value={form.异常类型} onValueChange={(v) => setForm({...form,异常类型: v || "买家消息"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ISSUE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
      <div><label className="text-xs text-gray-400">优先级</label><Select value={form.优先级} onValueChange={(v) => setForm({...form,优先级: v || "中"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["高","中","低"].map(p => <SelectItem key={p} value={p}>{p === "高" ? "" : p === "中" ? "" : ""}{p}</SelectItem>)}</SelectContent></Select></div>
      <div><label className="text-xs text-gray-400">状态</label><Select value={form.状态} onValueChange={(v) => setForm({...form,状态: v || "待办"})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["待办","进行中","已完成","延期"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
      <div><label className="text-xs text-gray-400">责任人</label><Input value={form.责任人} onChange={e => setForm({...form, 责任人: e.target.value})} /></div>
      <div><label className="text-xs text-gray-400">创建日期</label><Input value={form.创建日期} onChange={e => setForm({...form, 创建日期: e.target.value})} /></div>
      <div className="sm:col-span-2"><label className="text-xs text-gray-400">问题描述</label><Input value={form.描述} onChange={e => setForm({...form, 描述: e.target.value})} placeholder="买家说了什么 / 发生了什么问题" /></div>
      <div className="sm:col-span-2"><label className="text-xs text-gray-400">备注</label><Input value={form.备注} onChange={e => setForm({...form, 备注: e.target.value})} /></div>
      <div className="sm:col-span-2"><Button onClick={handleSubmit} disabled={submitting} className="w-full">{submitting ? "保存中..." : "保存到飞书"}</Button></div>
    </CardContent>
  </Card>;
}

// ==============================================================
//  竞品监控
// ==============================================================
function CompetitorForm({ skuList, today }: { skuList: SkuOption[]; today: string }) {
  const { submitting, submit } = useSubmit();
  const [form, setForm] = useState({ SKU: "", 关键词: "", 竞品链接: "", 竞品售价: "", 竞品运费: "0", 我方售价: "", 竞品总价: "", 价差: "", "销量|观察": "", 动作建议: "", 负责人: "", 记录日期: today, 备注: "" });
  const [skuQuery, setSkuQuery] = useState("");
  const [showSku, setShowSku] = useState(false);

  const matched = skuQuery.trim()
    ? skuList.filter(s => s.SKU?.toLowerCase().includes(skuQuery.toLowerCase()) || s.中文品名?.toLowerCase().includes(skuQuery.toLowerCase()))
    : [];

  const handleSkuSelect = (s: SkuOption) => {
    setForm({ ...form, SKU: s.SKU || "" });
    setSkuQuery(s.SKU || "");
    setShowSku(false);
  };

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
    <CardHeader><CardTitle className="text-base">竞品价格监控</CardTitle><CardDescription>记录竞品价格变动，写入 09_竞品价格监控</CardDescription></CardHeader>
    <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="relative"><label className="text-xs text-gray-400">SKU *</label>
        <Input
          placeholder="输入 SKU 编码或品名…"
          value={skuQuery}
          onChange={e => {
            setSkuQuery(e.target.value);
            setForm({ ...form, SKU: "" });
            setShowSku(true);
          }}
          onFocus={() => { if (skuQuery) setShowSku(true); }}
          onBlur={() => setTimeout(() => setShowSku(false), 200)}
        />
        {showSku && matched.length > 0 && (
          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-hidden">
            <ScrollArea className="max-h-48">
              {matched.map((s, i) => (
                <button key={String(s._idx ?? i)} className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-b-0" onMouseDown={() => handleSkuSelect(s)}>
                  <span className="text-sm font-medium text-gray-900">{s.SKU}</span>
                  <span className="text-xs text-gray-400 ml-2">{s.中文品名}</span>
                </button>
              ))}
            </ScrollArea>
          </div>
        )}
        {showSku && skuQuery && matched.length === 0 && (
          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-center text-sm text-gray-400">未匹配</div>
        )}
      </div>
      <div><label className="text-xs text-gray-400">搜索关键词</label><Input value={form.关键词} onChange={e => setForm({...form, 关键词: e.target.value})} /></div>
      <div className="sm:col-span-2"><label className="text-xs text-gray-400">竞品链接</label><Input value={form.竞品链接} onChange={e => setForm({...form, 竞品链接: e.target.value})} placeholder="https://www.ebay.com/itm/..." /></div>
      <div><label className="text-xs text-gray-400">竞品售价 ($) *</label><Input type="number" step="0.01" value={form.竞品售价} onChange={e => { setForm({...form, 竞品售价: e.target.value}); }} onBlur={calcDiff} /></div>
      <div><label className="text-xs text-gray-400">竞品运费 ($)</label><Input type="number" step="0.01" value={form.竞品运费} onChange={e => { setForm({...form, 竞品运费: e.target.value}); }} onBlur={calcDiff} /></div>
      <div><label className="text-xs text-gray-400">我方售价 ($)</label><Input type="number" step="0.01" value={form.我方售价} onChange={e => { setForm({...form, 我方售价: e.target.value}); }} onBlur={calcDiff} /></div>
      <div><label className="text-xs text-gray-400">价差</label><Input value={form.价差 ? `$${form.价差}` : "自动计算"} readOnly className="bg-gray-50" /></div>
      <div><label className="text-xs text-gray-400">销量观察</label><Input value={form["销量|观察"]} onChange={e => setForm({...form, "销量|观察": e.target.value})} placeholder="如: 日销5件" /></div>
      <div><label className="text-xs text-gray-400">动作建议</label><Input value={form.动作建议} onChange={e => setForm({...form, 动作建议: e.target.value})} placeholder="跟价/观望/降价" /></div>
      <div><label className="text-xs text-gray-400">负责人</label><Input value={form.负责人} onChange={e => setForm({...form, 负责人: e.target.value})} /></div>
      <div><label className="text-xs text-gray-400">记录日期</label><Input value={form.记录日期} onChange={e => setForm({...form, 记录日期: e.target.value})} /></div>
      <div className="sm:col-span-2"><label className="text-xs text-gray-400">备注</label><Input value={form.备注} onChange={e => setForm({...form, 备注: e.target.value})} /></div>
      <div className="sm:col-span-2"><Button onClick={handleSubmit} disabled={submitting} className="w-full">{submitting ? "保存中..." : "保存到飞书"}</Button></div>
    </CardContent>
  </Card>;
}
