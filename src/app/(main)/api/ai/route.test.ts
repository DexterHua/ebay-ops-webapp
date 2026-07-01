import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "./route";

function request(body: Record<string, unknown> = {}) {
  return new NextRequest("https://internal/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemPrompt: "Return JSON only.",
      userMessage: "Analyze inventory.",
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/ai", () => {
  it("requests strict JSON output without thinking tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: { content: "{\"ok\":true}" },
            finish_reason: "stop",
          },
        ],
        usage: { total_tokens: 42 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.any(String),
      }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    });
  });

  it("returns an actionable error when the provider response has no message content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {},
            finish_reason: "length",
          },
        ],
        usage: { total_tokens: 8192 },
      }),
    ));

    const response = await POST(request());
    const json = await response.json() as { success?: boolean; error?: string; tokensUsed?: number };

    expect(response.status).toBe(502);
    expect(json).toMatchObject({
      success: false,
      tokensUsed: 8192,
    });
    expect(json.error).toContain("AI 未返回有效内容");
  });
});
