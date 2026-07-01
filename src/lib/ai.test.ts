import { afterEach, describe, expect, it, vi } from "vitest";

import { callAIStructured } from "@/lib/ai";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("callAIStructured", () => {
  it("returns a friendly error when the AI response is blank after cleanup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: "   ",
        tokensUsed: 12,
      }),
    ));

    const result = await callAIStructured<{ ok: boolean }>({
      systemPrompt: "Return JSON only.",
      userMessage: "Analyze inventory.",
    });

    expect(result).toMatchObject({
      success: false,
      error: "AI 未返回可解析内容，请重试。",
      tokensUsed: 12,
    });
  });

  it("returns a friendly error when the AI JSON is truncated", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: "{",
        tokensUsed: 8192,
      }),
    ));

    const result = await callAIStructured<{ ok: boolean }>({
      systemPrompt: "Return JSON only.",
      userMessage: "Analyze inventory.",
    });

    expect(result).toMatchObject({
      success: false,
      error: "AI 返回的 JSON 不完整，请重试。",
      tokensUsed: 8192,
    });
  });
});
