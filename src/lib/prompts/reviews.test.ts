import { describe, expect, it } from "vitest";
import { REVIEWS_SYSTEM_PROMPT, buildReviewsUserMessage } from "./reviews";

describe("review reply prompts", () => {
  it("asks for exactly two English replies with Chinese translations", () => {
    expect(REVIEWS_SYSTEM_PROMPT).toContain("\"replies\"");
    expect(REVIEWS_SYSTEM_PROMPT).toContain("\"english\"");
    expect(REVIEWS_SYSTEM_PROMPT).toContain("\"chinese\"");
    expect(REVIEWS_SYSTEM_PROMPT).toContain("exactly 2");
    expect(REVIEWS_SYSTEM_PROMPT).toContain("platform policy");
  });

  it("builds the user message from rating and buyer review content", () => {
    const message = buildReviewsUserMessage({
      content: "Great seller, fast shipping.",
      rating: 5,
    });

    expect(message).toContain("评分: 5/5");
    expect(message).toContain("Great seller, fast shipping.");
    expect(message).not.toContain("买家:");
    expect(message).not.toContain("产品:");
    expect(message).not.toContain("语言:");
  });

  it("includes selected SKU, product name, and category context when provided", () => {
    const message = buildReviewsUserMessage({
      content: "Fits perfectly and arrived fast.",
      rating: 5,
      sku: "SP843060E010A001",
      productName: "方向游丝",
      category: "Clock Spring",
    });

    expect(message).toContain("SKU: SP843060E010A001");
    expect(message).toContain("商品: 方向游丝");
    expect(message).toContain("品类: Clock Spring");
    expect(message).toContain("Fits perfectly and arrived fast.");
  });
});
