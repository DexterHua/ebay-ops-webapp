import { describe, expect, it } from "vitest";
import {
  buildProfitReviewPatch,
  resolveQuoteStage,
  sourcingRecordMatchesFilter,
} from "./sourcing-workflow";

describe("sourcing workflow", () => {
  it("moves completed quote information to profit review", () => {
    expect(resolveQuoteStage({ supplier: "供应商A", price: 88 })).toBe("利润评估");
    expect(resolveQuoteStage({ supplier: "供应商A", price: undefined })).toBe("已入选待询价");
    expect(resolveQuoteStage({ supplier: "", price: 88 })).toBe("已入选待询价");
  });

  it("routes profit review decisions to final lists", () => {
    expect(buildProfitReviewPatch("入选")).toEqual({ 选品阶段: "已完成" });
    expect(buildProfitReviewPatch("未入选")).toEqual({ 选品阶段: "未入选" });
  });

  it("shows new and legacy quote stages in the profit review filter", () => {
    expect(sourcingRecordMatchesFilter({ 选品阶段: "利润评估" }, "profitReview")).toBe(true);
    expect(sourcingRecordMatchesFilter({ 选品阶段: "询价中" }, "profitReview")).toBe(true);
    expect(sourcingRecordMatchesFilter({ 选品阶段: "已入选待询价" }, "profitReview")).toBe(false);
  });
});
