"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_PROFIT_ASSUMPTIONS,
  calculateProfit,
  type ProfitAssumptions,
  type ProfitCostBreakdown,
} from "@/lib/profit-calculator";
import {
  getProfitSettingsMode,
  hasUnsavedProfitSettings,
  isValidProfitSettingsDraft,
} from "@/lib/profit-settings-client";
import { cn } from "@/lib/utils";
import {
  Calculator,
  ChevronDown,
  CircleDollarSign,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";

interface ProfitCalculatorProps {
  sku: string;
  purchasePriceCny: number;
  grossWeightG: number;
  defaultSalePriceUsd: number;
}

interface ProfitSettingsApiResponse {
  ok?: boolean;
  error?: string;
  settings?: {
    assumptions: ProfitAssumptions;
    updatedAt: string | null;
    updatedBy: string | null;
  };
}

interface CurrentUserResponse {
  isAdmin?: boolean;
}

type AssumptionField = keyof ProfitAssumptions;
type CostField = keyof ProfitCostBreakdown;

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const cnyFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COST_ITEMS: Array<{ key: CostField; label: string; color: string }> = [
  { key: "product", label: "产品成本", color: "bg-orange-500" },
  { key: "firstMile", label: "头程运费", color: "bg-blue-500" },
  { key: "lastMile", label: "尾程运费", color: "bg-cyan-500" },
  { key: "tariff", label: "关税", color: "bg-violet-500" },
  { key: "warehouseInbound", label: "海外仓入库费", color: "bg-amber-500" },
  { key: "warehouseHandling", label: "海外仓操作费", color: "bg-slate-500" },
  { key: "ebayFee", label: "eBay 佣金", color: "bg-emerald-500" },
  { key: "advertising", label: "广告费", color: "bg-rose-500" },
  { key: "returns", label: "退货成本", color: "bg-teal-500" },
];

const ASSUMPTION_FIELDS: Array<{
  key: AssumptionField;
  label: string;
  suffix: string;
  percentage?: boolean;
}> = [
  { key: "exchangeRate", label: "USD/CNY 汇率", suffix: "" },
  { key: "firstMileCnyPerKg", label: "头程运费", suffix: "RMB/kg" },
  { key: "lastMileUsdPerKg", label: "尾程运费", suffix: "USD/kg" },
  { key: "tariffRate", label: "关税比例", suffix: "%", percentage: true },
  { key: "warehouseInboundUsd", label: "海外仓入库费", suffix: "USD" },
  { key: "warehouseHandlingUsd", label: "海外仓操作费", suffix: "USD" },
  { key: "ebayFeeRate", label: "eBay 佣金比例", suffix: "%", percentage: true },
  { key: "advertisingRate", label: "广告费比例", suffix: "%", percentage: true },
  { key: "returnRate", label: "退货率", suffix: "%", percentage: true },
];

function formatUsd(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? usdFormatter.format(value) : "--";
}

function formatPercent(value: number) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "--";
}

function ResultMetric({ label, value, tone = "default" }: {
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative";
}) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
      <p className="text-[11px] leading-5 text-slate-400">{label}</p>
      <p className={cn(
        "mt-0.5 break-words text-xl font-semibold text-slate-900",
        tone === "positive" && "text-emerald-600",
        tone === "negative" && "text-red-600",
      )}>
        {value}
      </p>
    </div>
  );
}

export function ProfitCalculator({
  sku,
  purchasePriceCny,
  grossWeightG,
  defaultSalePriceUsd,
}: ProfitCalculatorProps) {
  const [salePrice, setSalePrice] = useState(defaultSalePriceUsd > 0 ? String(defaultSalePriceUsd) : "");
  const [assumptions, setAssumptions] = useState<ProfitAssumptions>({ ...DEFAULT_PROFIT_ASSUMPTIONS });
  const [savedAssumptions, setSavedAssumptions] = useState<ProfitAssumptions>({ ...DEFAULT_PROFIT_ASSUMPTIONS });
  const [isAdmin, setIsAdmin] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
  const [settingsMeta, setSettingsMeta] = useState<{ updatedAt: string | null; updatedBy: string | null }>({
    updatedAt: null,
    updatedBy: null,
  });
  const salePriceUsd = Number(salePrice);
  const settingsMode = getProfitSettingsMode({ isAdmin, loading: settingsLoading });
  const settingsEditable = settingsMode === "editable" && !settingsLoadFailed;
  const settingsDirty = hasUnsavedProfitSettings(savedAssumptions, assumptions);
  const settingsDraftValid = isValidProfitSettingsDraft(assumptions);
  const result = useMemo(() => calculateProfit({
    purchasePriceCny,
    grossWeightG,
    salePriceUsd,
    assumptions,
  }), [assumptions, grossWeightG, purchasePriceCny, salePriceUsd]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all([
        fetch("/api/profit-settings", { cache: "no-store" })
          .then(async (response) => ({ response, json: await response.json() as ProfitSettingsApiResponse }))
          .catch(() => null),
        fetch("/api/auth/me", { cache: "no-store" })
          .then(async (response) => ({ response, json: await response.json() as CurrentUserResponse }))
          .catch(() => null),
      ]).then(([settingsResult, userResult]) => {
        if (cancelled) return;
        setIsAdmin(Boolean(userResult?.response.ok && userResult.json.isAdmin));

        const loaded = settingsResult?.response.ok ? settingsResult.json.settings : undefined;
        if (settingsResult?.json.ok && loaded && isValidProfitSettingsDraft(loaded.assumptions)) {
          setAssumptions({ ...loaded.assumptions });
          setSavedAssumptions({ ...loaded.assumptions });
          setSettingsMeta({ updatedAt: loaded.updatedAt, updatedBy: loaded.updatedBy });
          setSettingsLoadFailed(false);
        } else {
          setSettingsLoadFailed(true);
        }
        setSettingsLoading(false);
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const updateAssumption = (field: AssumptionField, rawValue: string, percentage = false) => {
    if (!settingsEditable) return;
    const parsed = Number(rawValue);
    setAssumptions((current) => ({
      ...current,
      [field]: Number.isFinite(parsed) ? (percentage ? parsed / 100 : parsed) : 0,
    }));
  };

  const saveAssumptions = async () => {
    if (!settingsEditable || !settingsDirty || !settingsDraftValid || settingsSaving) return;
    setSettingsSaving(true);
    try {
      const response = await fetch("/api/profit-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assumptions }),
      });
      const json = await response.json() as ProfitSettingsApiResponse;
      if (!response.ok || !json.ok || !json.settings) {
        throw new Error(json.error || "成本参数保存失败");
      }
      setAssumptions({ ...json.settings.assumptions });
      setSavedAssumptions({ ...json.settings.assumptions });
      setSettingsMeta({ updatedAt: json.settings.updatedAt, updatedBy: json.settings.updatedBy });
      toast.success("成本参数已保存并应用", {
        description: "其他用户刷新或下次进入时将读取最新参数",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "成本参数保存失败");
    } finally {
      setSettingsSaving(false);
    }
  };

  const profitTone = !result.valid || result.profit === 0
    ? "default"
    : result.profit > 0 ? "positive" : "negative";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-orange-500" />
              利润计算器
            </CardTitle>
            <CardDescription className="mt-1">基于 {sku} 的采购价与毛重，本地实时估算</CardDescription>
          </div>
          <Badge variant="secondary" className="w-fit">不写入飞书</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="space-y-1.5" htmlFor={`purchase-price-${sku}`}>
            <span className="text-xs font-medium text-slate-600">采购价（RMB）</span>
            <Input
              id={`purchase-price-${sku}`}
              value={purchasePriceCny > 0 ? cnyFormatter.format(purchasePriceCny) : "--"}
              readOnly
              className="bg-slate-50 text-slate-500"
            />
          </label>
          <label className="space-y-1.5" htmlFor={`gross-weight-${sku}`}>
            <span className="text-xs font-medium text-slate-600">商品毛重（g）</span>
            <Input
              id={`gross-weight-${sku}`}
              value={grossWeightG > 0 ? `${grossWeightG} g` : "--"}
              readOnly
              className="bg-slate-50 text-slate-500"
            />
          </label>
          <label className="space-y-1.5" htmlFor={`sale-price-${sku}`}>
            <span className="text-xs font-medium text-slate-600">销售价格（USD）</span>
            <div className="relative">
              <CircleDollarSign className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-500" />
              <Input
                id={`sale-price-${sku}`}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={salePrice}
                onChange={(event) => setSalePrice(event.target.value)}
                className="pl-8 font-semibold"
              />
            </div>
          </label>
        </div>

        {!result.valid && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {result.error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ResultMetric label="预计净利润" value={result.valid ? formatUsd(result.profit) : "--"} tone={profitTone} />
          <ResultMetric label="预计净利率" value={result.valid ? formatPercent(result.margin) : "--"} tone={profitTone} />
          <ResultMetric label="预计总成本" value={result.valid ? formatUsd(result.totalCost) : "--"} />
        </div>

        <section aria-labelledby={`target-price-title-${sku}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 id={`target-price-title-${sku}`} className="text-sm font-semibold text-slate-800">目标利润售价</h3>
            <span className="text-[11px] text-slate-400">已包含平台费用</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              ["保本价", "0%", result.targetPrices.breakEven],
              ["稳健价", "20%", result.targetPrices.margin20],
              ["目标价", "40%", result.targetPrices.margin40],
            ].map(([label, margin, value]) => (
              <div key={String(margin)} className="rounded-lg border border-slate-100 bg-white px-3 py-3">
                <div className="flex flex-col items-start gap-1">
                  <Badge variant="outline">{margin}</Badge>
                  <span className="text-xs text-slate-500">{label}</span>
                </div>
                <p className="mt-2 text-lg font-semibold text-slate-900">{formatUsd(value as number | null)}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby={`cost-breakdown-title-${sku}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 id={`cost-breakdown-title-${sku}`} className="text-sm font-semibold text-slate-800">成本构成</h3>
            <span className="text-[11px] text-slate-400">比例为占当前售价</span>
          </div>
          <div className="grid grid-cols-1 gap-y-3">
            {COST_ITEMS.map((item) => {
              const amount = result.costs[item.key];
              const share = result.valid && salePriceUsd > 0 ? amount / salePriceUsd : 0;
              return (
                <div key={item.key} className="min-w-0">
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", item.color)} aria-hidden="true" />
                      <span className="truncate text-slate-600">{item.label}</span>
                    </div>
                    <span className="shrink-0 font-medium text-slate-800">
                      {result.valid ? `${formatUsd(amount)} · ${formatPercent(share)}` : "--"}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={cn("h-full rounded-full", item.color)}
                      style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <details className="group rounded-lg border border-slate-200 bg-slate-50">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-slate-700">
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-slate-500" />
              成本参数
            </span>
            <span className="flex items-center gap-2">
              {settingsMode === "loading" && (
                <Badge variant="outline" className="gap-1">
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                  加载中
                </Badge>
              )}
              {settingsMode === "readonly" && (
                <Badge variant="outline" className="gap-1">
                  <LockKeyhole className="h-3 w-3" />
                  只读
                </Badge>
              )}
              {settingsMode === "editable" && (
                <Badge variant="outline" className="gap-1 border-emerald-200 text-emerald-700">
                  <ShieldCheck className="h-3 w-3" />
                  管理员
                </Badge>
              )}
              <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="border-t border-slate-200 px-3 pb-3 pt-3">
            {settingsLoadFailed && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                成本参数读取失败，当前使用默认参数。为避免覆盖已有配置，本次不可保存，请刷新后重试。
              </div>
            )}
            {!settingsLoadFailed && settingsMode === "readonly" && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                <LockKeyhole className="h-3.5 w-3.5 shrink-0" />
                全局成本参数由管理员维护，当前账号仅可查看。
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {ASSUMPTION_FIELDS.map((field) => (
                <label key={field.key} className="space-y-1.5" htmlFor={`${field.key}-${sku}`}>
                  <span className="text-[11px] font-medium text-slate-500">{field.label}</span>
                  <div className="relative">
                    <Input
                      id={`${field.key}-${sku}`}
                      type="number"
                      min="0"
                      step={field.percentage ? "0.01" : "0.01"}
                      inputMode="decimal"
                      readOnly={!settingsEditable}
                      disabled={settingsLoading || settingsSaving}
                      value={field.percentage
                        ? Number((assumptions[field.key] * 100).toFixed(4))
                        : assumptions[field.key]}
                      onChange={(event) => updateAssumption(field.key, event.target.value, field.percentage)}
                      className={cn(
                        "h-9",
                        field.suffix && "pr-16",
                        !settingsEditable && "bg-slate-100 text-slate-500",
                      )}
                    />
                    {field.suffix && (
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
                        {field.suffix}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>
            {settingsMode === "editable" && (
              <div className="mt-3 flex flex-col gap-3 border-t border-slate-200 pt-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] leading-5 text-slate-400">
                  {settingsMeta.updatedBy && settingsMeta.updatedAt
                    ? `上次由 ${settingsMeta.updatedBy} 更新`
                    : "当前使用系统默认参数"}
                  {settingsDirty ? " · 有未保存修改" : ""}
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!settingsEditable || settingsSaving}
                    onClick={() => setAssumptions({ ...DEFAULT_PROFIT_ASSUMPTIONS })}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    恢复默认
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!settingsEditable || !settingsDirty || !settingsDraftValid || settingsSaving}
                    onClick={() => { void saveAssumptions(); }}
                  >
                    {settingsSaving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {settingsSaving ? "保存中" : "保存并应用"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
