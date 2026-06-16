"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, BadgeX, ExternalLink, FileText, Loader2, Paperclip, Pencil, Plus, ReceiptText, RefreshCw, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface FinanceRecord {
  recordId: string;
  项目名称?: string;
  金额?: number;
  日期?: number | string;
  人员?: Array<{ id: string; name?: string }>;
  提交人?: string;
  报销类型?: string;
  审批状态?: string;
  进度?: string;
  列表状态?: string;
  附件?: FinanceAttachment[];
  发票及付款记录?: FinanceAttachment[];
  备注?: string;
  [key: string]: unknown;
}

interface FinanceAttachment {
  fileToken?: string;
  file_token?: string;
  name?: string;
  size?: number;
  url?: string;
  tmpUrl?: string;
  tmp_url?: string;
  type?: string;
}

interface MemberOption {
  name: string;
  role: string;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const parsed = Number(v.replace(/[,￥¥\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatDate(v: unknown): string {
  if (typeof v === "number" && v > 0) {
    return new Date(v).toISOString().slice(0, 10);
  }
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v.trim());
    return Number.isNaN(d.getTime()) ? v : d.toISOString().slice(0, 10);
  }
  return "-";
}

function formatPersonnel(v: unknown): string {
  if (Array.isArray(v)) return v.map((u) => (u as { name?: string }).name || (u as { id?: string }).id || "-").join("、");
  if (v && typeof v === "object") {
    const u = v as { name?: string };
    return u.name || "-";
  }
  return "-";
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function statusBadge(status: string) {
  switch (status) {
    case "待审批": return <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">⏳ 待审批</Badge>;
    case "已通过": return <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">✅ 已通过</Badge>;
    case "已驳回": return <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">❌ 已驳回</Badge>;
    default: return <Badge variant="outline">{status || "未知"}</Badge>;
  }
}

function financeStatus(record: FinanceRecord): string {
  return record.列表状态 || record.进度 || record.审批状态 || "";
}

function recordSubmitter(record: FinanceRecord): string {
  return String(record.提交人 || "").trim();
}

function recordSubmitterDisplay(record: FinanceRecord): string {
  return recordSubmitter(record) || formatPersonnel(record.人员);
}

function financeAttachments(record: FinanceRecord): FinanceAttachment[] {
  const normalized = Array.isArray(record.附件) ? record.附件 : [];
  const raw = Array.isArray(record.发票及付款记录) ? record.发票及付款记录 : [];
  return normalized.length > 0 ? normalized : raw;
}

function attachmentToken(attachment: FinanceAttachment): string {
  return String(attachment.fileToken || attachment.file_token || "").trim();
}

function attachmentHref(attachment: FinanceAttachment): string {
  const token = attachmentToken(attachment);
  if (token) {
    const params = new URLSearchParams({ fileToken: token });
    if (attachment.name) params.set("name", attachment.name);
    return `/api/finance/attachment?${params.toString()}`;
  }
  return String(attachment.url || attachment.tmpUrl || attachment.tmp_url || "#");
}

export default function FinancePage() {
  const [records, setRecords] = useState<FinanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState("");
  const [currentUserIsAdmin, setCurrentUserIsAdmin] = useState(false);
  const [editingRecord, setEditingRecord] = useState<FinanceRecord | null>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);

  // 表单字段
  const [projectName, setProjectName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [personnel, setPersonnel] = useState("");
  const [expenseType, setExpenseType] = useState("其他");
  const [notes, setNotes] = useState("");
  const [voucherFiles, setVoucherFiles] = useState<File[]>([]);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/finance");
      const json = await res.json() as { success?: boolean; data?: FinanceRecord[]; error?: string };
      if (!json.success) throw new Error(json.error || "读取财务数据失败");
      setRecords(json.data || []);
    } catch (error) {
      toast.error("财务数据加载失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void loadRecords(); }, 0);
    return () => clearTimeout(timer);
  }, [loadRecords]);

  const loadMembers = useCallback(async () => {
    try {
      const [meRes, membersRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/auth/members"),
      ]);
      const [meJson, membersJson] = await Promise.all([
        meRes.json() as Promise<{ name?: string | null; isAdmin?: boolean; role?: string | null }>,
        membersRes.json() as Promise<{ ok?: boolean; members?: MemberOption[] }>,
      ]);
      const userName = meJson.name || "";
      setCurrentUserName(userName);
      setCurrentUserIsAdmin(Boolean(meJson.isAdmin));
      if (membersJson.ok) {
        setMembers(membersJson.members || []);
      } else if (userName) {
        setMembers([{ name: userName, role: "current" }]);
      }
    } catch {
      // 成员列表失败不阻断报销流程，后端仍会兜底使用当前登录人。
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void loadMembers(); }, 0);
    return () => clearTimeout(timer);
  }, [loadMembers]);

  const totalExpense = useMemo(() => records.reduce((s, r) => s + toNumber(r.金额), 0), [records]);

  const memberOptions = useMemo(() => {
    const byName = new Map<string, MemberOption>();
    for (const member of members) {
      if (member.name) byName.set(member.name, member);
    }
    if (currentUserName && !byName.has(currentUserName)) {
      byName.set(currentUserName, { name: currentUserName, role: "current" });
    }
    return [...byName.values()];
  }, [currentUserName, members]);

  const resetForm = () => {
    setEditingRecord(null);
    setProjectName("");
    setAmount("");
    setDate(new Date().toISOString().slice(0, 10));
    setPersonnel(currentUserName);
    setExpenseType("其他");
    setNotes("");
    setVoucherFiles([]);
  };

  const openCreateDialog = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEditDialog = (record: FinanceRecord) => {
    setEditingRecord(record);
    setProjectName(String(record.项目名称 || ""));
    setAmount(toNumber(record.金额) > 0 ? String(toNumber(record.金额)) : "");
    const formattedDate = formatDate(record.日期);
    setDate(formattedDate === "-" ? new Date().toISOString().slice(0, 10) : formattedDate);
    setPersonnel(formatPersonnel(record.人员) === "-" ? currentUserName : formatPersonnel(record.人员));
    setExpenseType(String(record.报销类型 || "其他"));
    setNotes(String(record.备注 || ""));
    setVoucherFiles([]);
    setFormOpen(true);
  };

  const removeVoucherFile = (index: number) => {
    setVoucherFiles((files) => files.filter((_, fileIndex) => fileIndex !== index));
  };

  const canManageRecord = (record: FinanceRecord): boolean => {
    const submitter = recordSubmitter(record);
    const personnelNames = formatPersonnel(record.人员).split("、").filter(Boolean);
    return financeStatus(record) === "待审批"
      && (currentUserIsAdmin || submitter === currentUserName || (!submitter && personnelNames.includes(currentUserName)));
  };

  const submitForm = async () => {
    if (!projectName.trim()) { toast.error("项目名称不能为空"); return; }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) { toast.error("金额必须为正数"); return; }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("项目名称", projectName.trim());
      if (editingRecord) formData.append("recordId", editingRecord.recordId);
      formData.append("金额", String(amountNum));
      formData.append("日期", date);
      if (personnel.trim()) formData.append("人员", personnel.trim());
      formData.append("报销类型", expenseType.trim() || "其他");
      formData.append("备注", notes.trim());
      for (const file of voucherFiles) {
        formData.append("files", file, file.name);
      }

      const res = await fetch("/api/finance", {
        method: editingRecord ? "PATCH" : "POST",
        body: formData,
      });
      const json = await res.json() as { success?: boolean; error?: string; message?: string };
      if (!res.ok || !json.success) throw new Error(json.error || (editingRecord ? "报销更新失败" : "报销提交失败"));
      toast.success(json.message || (editingRecord ? "报销已更新" : "报销已提交"));
      setFormOpen(false);
      resetForm();
      loadRecords();
    } catch (error) {
      toast.error("提交失败", { description: error instanceof Error ? error.message : "服务端暂不可用" });
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async (record: FinanceRecord) => {
    if (!window.confirm(`确定撤回「${record.项目名称 || "未命名"}」这条报销申请吗？`)) return;
    setWithdrawing(record.recordId);
    try {
      const res = await fetch("/api/finance", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: record.recordId }),
      });
      const json = await res.json() as { success?: boolean; error?: string; message?: string };
      if (!res.ok || !json.success) throw new Error(json.error || "撤回失败");
      toast.success(json.message || "报销申请已撤回");
      loadRecords();
    } catch (error) {
      toast.error("撤回失败", { description: error instanceof Error ? error.message : "服务端暂不可用" });
    } finally {
      setWithdrawing(null);
    }
  };

  const approve = async (recordId: string, action: "approve" | "reject") => {
    setApproving(recordId);
    try {
      const res = await fetch("/api/finance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId, action }),
      });
      const json = await res.json() as { success?: boolean; error?: string; message?: string };
      if (!res.ok || !json.success) throw new Error(json.error || "审批失败");
      toast.success(json.message || "审批完成");
      loadRecords();
    } catch (error) {
      toast.error("审批失败", { description: error instanceof Error ? error.message : "服务端暂不可用" });
    } finally {
      setApproving(null);
    }
  };

  return (
    <div className="app-page max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="page-kicker">Finance</p>
          <h1 className="page-title">财务报销</h1>
          <p className="page-description">
            烁立德财务表格 · {records.length} 条记录 · 合计 ¥{totalExpense.toLocaleString()}
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus /> 新增报销
        </Button>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="报销记录" value={records.length} suffix="条" />
        <StatCard label="报销合计" value={`¥${totalExpense.toLocaleString()}`} />
        <StatCard label="待审批" value={records.filter(r => financeStatus(r) === "待审批").length} suffix="条" color="text-orange-600" />
        <StatCard label="已通过" value={records.filter(r => financeStatus(r) === "已通过").length} suffix="条" color="text-green-600" />
      </div>

      {/* 报销列表 */}
      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base">报销记录</CardTitle>
              <CardDescription>全部报销申请与进度状态</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadRecords} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-400">加载中...</div>
          ) : records.length === 0 ? (
            <div className="py-12 text-center">
              <ReceiptText className="mx-auto size-8 text-slate-200" />
              <p className="mt-3 text-sm text-slate-500">暂无报销记录</p>
              <p className="mt-1 text-xs text-slate-400">点击右上角「新增报销」开始录入</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="hidden grid-cols-[1.2fr_7rem_6rem_6rem_6rem_7rem_10rem] items-center gap-3 border-b border-slate-100 px-3 pb-2 text-xs font-medium text-slate-500 sm:grid">
                <span>项目名称</span>
                <span className="text-right">金额</span>
                <span>日期</span>
                <span>人员</span>
                <span>提交人</span>
                <span>附件</span>
                <span>状态 / 操作</span>
              </div>
              {records.map((record) => {
                const status = financeStatus(record);
                const attachments = financeAttachments(record);
                return (
                <div
                  key={record.recordId}
                  className="grid grid-cols-1 gap-2 rounded-lg border border-slate-100 p-3 sm:grid-cols-[1.2fr_7rem_6rem_6rem_6rem_7rem_10rem] sm:items-center sm:gap-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">{record.项目名称 || "未命名"}</p>
                    {record.备注 && <p className="mt-0.5 truncate text-xs text-slate-400">{record.备注}</p>}
                  </div>
                  <p className="text-right text-sm font-semibold text-slate-900 sm:text-right">
                    ¥{toNumber(record.金额).toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500">{formatDate(record.日期)}</p>
                  <p className="text-xs text-slate-500">{formatPersonnel(record.人员)}</p>
                  <p className="text-xs text-slate-500">{recordSubmitterDisplay(record) || "-"}</p>
                  <div className="min-w-0 text-xs">
                    {attachments.length > 0 ? (
                      <div className="space-y-1">
                        {attachments.slice(0, 2).map((attachment, index) => (
                          <a
                            key={`${attachmentToken(attachment) || attachment.name || "attachment"}-${index}`}
                            href={attachmentHref(attachment)}
                            target="_blank"
                            rel="noreferrer"
                            className="flex min-w-0 items-center gap-1 text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            <FileText className="size-3 shrink-0" />
                            <span className="truncate">{attachment.name || `附件 ${index + 1}`}</span>
                            <ExternalLink className="size-3 shrink-0" />
                          </a>
                        ))}
                        {attachments.length > 2 && <p className="text-[11px] text-slate-400">另有 {attachments.length - 2} 个</p>}
                      </div>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:justify-end">
                    {statusBadge(status)}
                    {status === "待审批" && currentUserIsAdmin && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-green-200 px-2 text-xs text-green-700 hover:bg-green-50"
                          disabled={approving === record.recordId}
                          onClick={() => approve(record.recordId, "approve")}
                        >
                          {approving === record.recordId ? <Loader2 className="size-3 animate-spin" /> : <BadgeCheck className="size-3" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-red-200 px-2 text-xs text-red-700 hover:bg-red-50"
                          disabled={approving === record.recordId}
                          onClick={() => approve(record.recordId, "reject")}
                        >
                          {approving === record.recordId ? <Loader2 className="size-3 animate-spin" /> : <BadgeX className="size-3" />}
                        </Button>
                      </div>
                    )}
                    {canManageRecord(record) && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs text-slate-600"
                          disabled={withdrawing === record.recordId}
                          onClick={() => openEditDialog(record)}
                        >
                          <Pencil className="size-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-orange-200 px-2 text-xs text-orange-700 hover:bg-orange-50"
                          disabled={withdrawing === record.recordId}
                          onClick={() => void withdraw(record)}
                        >
                          {withdrawing === record.recordId ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 新增报销对话框 */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRecord ? "修改报销" : "新增报销"}</DialogTitle>
            <DialogDescription>
              {editingRecord ? "修改待审批报销信息，新增凭证会追加同步到飞书多维表格。" : "填写报销信息后提交审批，凭证会同步上传到飞书多维表格。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-slate-500">项目名称 *</label>
              <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="如：餐费、办公用品采购" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">金额 (¥) *</label>
                <Input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">日期</label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">报销人</label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-orange-300 focus:outline-none focus:ring-1 focus:ring-orange-200"
                  value={personnel}
                  onChange={(e) => setPersonnel(e.target.value)}
                >
                  {!personnel && <option value="">选择报销人</option>}
                  {memberOptions.map((member) => (
                    <option key={member.name} value={member.name}>{member.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">报销类型</label>
                <Input value={expenseType} onChange={(e) => setExpenseType(e.target.value)} placeholder="如：差旅费、办公用品" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">备注</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="补充说明（可选）" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">凭证附件</label>
              <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center transition hover:border-orange-200 hover:bg-orange-50/50">
                <Paperclip className="size-5 text-slate-400" />
                <span className="mt-1 text-sm font-medium text-slate-700">选择发票或付款凭证</span>
                <span className="mt-0.5 text-xs text-slate-400">支持批量上传</span>
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  onChange={(e) => setVoucherFiles(Array.from(e.target.files || []))}
                />
              </label>
              {voucherFiles.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {voucherFiles.map((file, index) => (
                    <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-2 rounded-md border border-slate-100 bg-white px-2 py-1.5">
                      <FileText className="size-4 shrink-0 text-blue-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-700">{file.name}</p>
                        <p className="text-[11px] text-slate-400">{formatFileSize(file.size)}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-slate-400 hover:text-red-500"
                        onClick={() => removeVoucherFile(index)}
                      >
                        <X className="size-3.5" />
                        <span className="sr-only">移除</span>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={submitting}>取消</Button>
            <Button onClick={submitForm} disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" />}
              {editingRecord ? "保存修改" : "提交报销"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, suffix = "", color = "text-slate-900" }: { label: string; value: string | number; suffix?: string; color?: string }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-xs text-slate-400">{label}</p>
        <p className={`text-xl font-bold mt-1 ${color}`}>{value}<span className="text-sm font-normal text-slate-400">{suffix}</span></p>
      </CardContent>
    </Card>
  );
}
