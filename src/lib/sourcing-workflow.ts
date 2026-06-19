export type SourcingFilter = "review" | "quotePending" | "profitReview" | "completed" | "rejected";
export type ProfitReviewResult = "入选" | "未入选";
export type SourcingStage = "初选待处理" | "已入选待询价" | "利润评估" | "询价中" | "已完成" | "未入选";

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

export function resolveQuoteStage(input: { supplier: string; price: number | undefined }): SourcingStage {
  return input.supplier.trim() && input.price !== undefined ? "利润评估" : "已入选待询价";
}

export function buildProfitReviewPatch(result: ProfitReviewResult): { 选品阶段: "已完成" | "未入选" } {
  return { 选品阶段: result === "入选" ? "已完成" : "未入选" };
}

export function sourcingRecordMatchesFilter(record: Record<string, unknown>, filter: SourcingFilter): boolean {
  const stage = text(record.选品阶段);
  const result = text(record.初选结果);
  if (filter === "review") return !stage || stage === "初选待处理";
  if (filter === "quotePending") return stage === "已入选待询价";
  if (filter === "profitReview") return stage === "利润评估" || stage === "询价中";
  if (filter === "completed") return stage === "已完成";
  return stage === "未入选" || result === "未入选";
}
