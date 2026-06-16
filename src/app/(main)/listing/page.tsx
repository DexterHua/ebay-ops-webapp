"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  DETAIL_TEMPLATE_STORES,
  DetailFields,
  DetailRow,
  DetailTemplateVariant,
  buildDetailFields,
  detailRowsFromFields,
  findSkuRecord,
  getRecordText,
  replaceEditableItemDetails,
} from "@/lib/detail-template";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clipboard, FileCode2, Search, Store, WandSparkles } from "lucide-react";
import { toast } from "sonner";

interface SkuFromLark {
  _idx: number;
  recordId?: string;
  SKU?: string;
  sku?: string;
  中文品名?: string;
  英文标题关键词?: string;
  类目?: string[] | string;
  OEM?: string;
  SKU状态?: string[] | string;
  [key: string]: unknown;
}

function emptyDetailFields(): DetailFields {
  return {
    condition: "",
    reference: "",
    package: "",
    fitment: "",
    buyerCheck: "",
  };
}

function extractTemplateRows(templateHtml: string): DetailRow[] {
  if (typeof window === "undefined" || !templateHtml) return detailRowsFromFields(emptyDetailFields());
  const documentHtml = new DOMParser().parseFromString(templateHtml, "text/html");
  const rows = Array.from(documentHtml.querySelectorAll("td[contenteditable='true']")).slice(0, 5);
  return rows.map((cell, index) => {
    const key = detailRowsFromFields(emptyDetailFields())[index].key;
    const label = cell.closest("tr")?.querySelector("th")?.textContent?.trim() || detailRowsFromFields(emptyDetailFields())[index].label;
    return { key, label, value: cell.textContent?.trim() || "" };
  });
}

function rowsToFields(rows: DetailRow[]): DetailFields {
  return rows.reduce<DetailFields>((fields, row) => {
    fields[row.key] = row.value;
    return fields;
  }, emptyDetailFields());
}

export default function ListingPage() {
  const [skuList, setSkuList] = useState<SkuFromLark[]>([]);
  const [skuLoading, setSkuLoading] = useState(true);
  const [selectedStoreId, setSelectedStoreId] = useState(DETAIL_TEMPLATE_STORES[0].id);
  const [selectedTemplateVariant, setSelectedTemplateVariant] = useState<DetailTemplateVariant>("withBanner");
  const [skuInput, setSkuInput] = useState("");
  const [templateHtml, setTemplateHtml] = useState("");
  const [templateLoading, setTemplateLoading] = useState(true);
  const [detailRows, setDetailRows] = useState<DetailRow[]>(detailRowsFromFields(emptyDetailFields()));
  const [selectedSkuMeta, setSelectedSkuMeta] = useState<SkuFromLark | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  const selectedStore = DETAIL_TEMPLATE_STORES.find((storeItem) => storeItem.id === selectedStoreId) || DETAIL_TEMPLATE_STORES[0];
  const selectedTemplate = selectedStore.templates[selectedTemplateVariant];
  const detailFields = useMemo(() => rowsToFields(detailRows), [detailRows]);
  const generatedHtml = useMemo(
    () => (templateHtml ? replaceEditableItemDetails(templateHtml, detailFields) : ""),
    [detailFields, templateHtml],
  );

  const filteredSkus = useMemo(() => {
    const query = skuInput.trim().toLowerCase();
    if (!query) return [];
    return skuList
      .filter((record) => {
        const sku = getRecordText(record, ["SKU", "sku"]);
        const name = getRecordText(record, ["中文品名", "英文标题关键词", "品名", "产品名称"]);
        return sku.toLowerCase().includes(query) || name.toLowerCase().includes(query);
      })
      .slice(0, 12);
  }, [skuInput, skuList]);

  useEffect(() => {
    let ignore = false;
    fetch("/api/lark?table=sku&limit=5000")
      .then((response) => response.json())
      .then((json) => {
        if (ignore) return;
        if (json.success) {
          setSkuList(json.data as SkuFromLark[]);
        } else {
          toast.error("SKU 主数据加载失败", { description: json.error });
        }
      })
      .catch(() => toast.error("SKU 主数据加载失败，请检查飞书连接"))
      .finally(() => {
        if (!ignore) setSkuLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    fetch(selectedTemplate.templatePath)
      .then((response) => {
        if (!response.ok) throw new Error("模板文件读取失败");
        return response.text();
      })
      .then((html) => {
        if (ignore) return;
        setTemplateHtml(html);
        const rows = extractTemplateRows(html);
        setDetailRows(selectedSkuMeta ? detailRowsFromFields(buildDetailFields(selectedSkuMeta)) : rows);
      })
      .catch(() => toast.error(`${selectedStore.name} 模板加载失败`))
      .finally(() => {
        if (!ignore) setTemplateLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [selectedStore.name, selectedSkuMeta, selectedTemplate.templatePath]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const match = findSkuRecord(skuList, skuInput);
      if (!match) {
        setSelectedSkuMeta(null);
        return;
      }
      setSelectedSkuMeta(match);
      setDetailRows(detailRowsFromFields(buildDetailFields(match)));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [skuInput, skuList]);

  const selectSku = (record: SkuFromLark) => {
    const sku = getRecordText(record, ["SKU", "sku"]);
    setSkuInput(sku);
    setSelectedSkuMeta(record);
    setDetailRows(detailRowsFromFields(buildDetailFields(record)));
    setShowSearch(false);
    toast.success(`已填入 ${sku} 的 Item Detail`);
  };

  const updateDetailRow = (key: keyof DetailFields, value: string) => {
    setDetailRows((rows) => rows.map((row) => (row.key === key ? { ...row, value } : row)));
  };

  const writeClipboardText = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Fall through to the legacy copy path for embedded browsers.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!copied) throw new Error("Clipboard copy failed");
  };

  const copyHtml = async () => {
    if (!generatedHtml) return;
    try {
      await writeClipboardText(generatedHtml);
      toast.success("HTML 代码已复制");
    } catch {
      toast.error("复制失败，请检查浏览器剪贴板权限");
    }
  };

  const skuName = selectedSkuMeta ? getRecordText(selectedSkuMeta, ["中文品名", "英文标题关键词", "品名"]) : "";
  const skuStatus = selectedSkuMeta ? getRecordText(selectedSkuMeta, ["SKU状态", "状态"]) : "";

  return (
    <div className="app-page max-w-7xl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="page-kicker">Listing Template Builder</p>
          <h1 className="page-title">详情页生成器</h1>
          <p className="page-description">选择店铺模板，输入 SKU，自动读取飞书 “SKU 主数据” 并填入 Item Detail 可编辑栏。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={copyHtml} disabled={!generatedHtml || templateLoading}>
            <Clipboard className="h-4 w-4" />
            复制代码
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Store className="h-4 w-4 text-orange-500" />
                店铺模板
              </CardTitle>
              <CardDescription>每个店铺使用各自的 HTML 详情页样式。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {DETAIL_TEMPLATE_STORES.map((storeItem) => {
                const selected = selectedStoreId === storeItem.id;
                return (
                  <button
                    key={storeItem.id}
                    type="button"
                    onClick={() => {
                      setTemplateLoading(true);
                      setSelectedStoreId(storeItem.id);
                    }}
                    className={cn(
                      "flex items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors",
                      selected ? "border-orange-300 bg-orange-50 text-orange-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                    )}
                  >
                    <span className="block text-sm font-semibold">{storeItem.name}</span>
                    {selected && <CheckCircle2 className="h-4 w-4 text-orange-500" />}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">模板版本</CardTitle>
              <CardDescription>选择是否保留顶部 banner 图片。</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {Object.values(selectedStore.templates).map((templateOption) => {
                const selected = selectedTemplateVariant === templateOption.id;
                return (
                  <button
                    key={templateOption.id}
                    type="button"
                    onClick={() => {
                      setTemplateLoading(true);
                      setSelectedTemplateVariant(templateOption.id);
                    }}
                    className={cn(
                      "flex items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors",
                      selected ? "border-orange-300 bg-orange-50 text-orange-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                    )}
                  >
                    <span>
                      <span className="block text-sm font-semibold">{templateOption.name}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{templateOption.description}</span>
                    </span>
                    {selected && <CheckCircle2 className="h-4 w-4 text-orange-500" />}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4 text-orange-500" />
                SKU 主数据
              </CardTitle>
              <CardDescription>输入完整 SKU 会自动匹配；也可以从搜索结果中点选。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Input
                  value={skuInput}
                  placeholder={skuLoading ? "正在加载 SKU 主数据..." : "输入 SKU 编码"}
                  onChange={(event) => {
                    setSkuInput(event.target.value);
                    setShowSearch(true);
                  }}
                  onFocus={() => setShowSearch(true)}
                  onBlur={() => setTimeout(() => setShowSearch(false), 160)}
                  disabled={skuLoading}
                />
                {showSearch && filteredSkus.length > 0 && (
                  <div className="mt-2 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                    <ScrollArea className="max-h-72">
                      {filteredSkus.map((record) => {
                        const sku = getRecordText(record, ["SKU", "sku"]);
                        return (
                          <button
                            key={record.recordId || record._idx}
                            type="button"
                            onMouseDown={() => selectSku(record)}
                            className="w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-orange-50"
                          >
                            <span className="block text-sm font-semibold text-slate-900">{sku}</span>
                            <span className="mt-0.5 block truncate text-xs text-slate-500">
                              {getRecordText(record, ["中文品名", "英文标题关键词", "品名"]) || "未填写品名"}
                            </span>
                          </button>
                        );
                      })}
                    </ScrollArea>
                  </div>
                )}
              </div>

              {selectedSkuMeta ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Badge className="bg-emerald-600">{getRecordText(selectedSkuMeta, ["SKU", "sku"])}</Badge>
                    {skuStatus && <Badge variant="outline">{skuStatus}</Badge>}
                  </div>
                  <p className="text-sm font-medium text-emerald-950">{skuName || "已匹配 SKU 主数据"}</p>
                  <p className="mt-1 text-xs text-emerald-700">已自动填入下方 Item Detail，可在生成前继续修改。</p>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  {skuInput.trim() ? "未找到完全匹配的 SKU，请检查编码或从下拉结果选择。" : `已加载 ${skuList.length} 条 SKU 主数据。`}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <WandSparkles className="h-4 w-4 text-orange-500" />
                Item Detail
              </CardTitle>
              <CardDescription>这些字段会替换模板里带 `contenteditable` 的详情表格单元格。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {detailRows.map((row) => (
                <div key={row.key} className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-500">{row.label}</label>
                  <Textarea
                    value={row.value}
                    onChange={(event) => updateDetailRow(row.key, event.target.value)}
                    rows={row.key === "buyerCheck" || row.key === "fitment" ? 3 : 2}
                    className="resize-y text-sm"
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileCode2 className="h-4 w-4 text-orange-500" />
                  {selectedStore.label} 预览
                </CardTitle>
                <CardDescription>确认后可直接复制代码导入 eBay 系统。</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{selectedStore.name}</Badge>
                <Badge variant="outline">{selectedTemplate.name}</Badge>
                {skuInput.trim() && <Badge variant="outline">{skuInput.trim()}</Badge>}
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[680px] overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                {templateLoading ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">模板加载中...</div>
                ) : (
                  <iframe title="详情页预览" srcDoc={generatedHtml} className="h-full w-full bg-white" />
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
