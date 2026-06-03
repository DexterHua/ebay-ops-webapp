// ============================================================
// AI API Route — 服务端代理 DeepSeek 调用，保护 API Key
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { formatSourcingEvidence, searchSourcingEvidence } from "@/lib/sourcing-search";

const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";

async function pipeDeepSeekStream(response: Response, controller: ReadableStreamDefaultController, encoder: TextEncoder) {
  if (!response.body) throw new Error("DeepSeek API 未返回流式响应");

  const decoder = new TextDecoder();
  let buffer = "";
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const payload = line.trim();
        if (!payload.startsWith("data:")) continue;
        const data = payload.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
        };
        const choice = json.choices?.[0];
        if (choice?.finish_reason === "length") throw new Error("DeepSeek 输出达到长度上限，请缩小分析范围后重试");
        const content = choice?.delta?.content;
        if (content) controller.enqueue(encoder.encode(content));
      }

      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function createSourcingStream(options: {
  apiKey: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
  category: string;
  oemCode: string;
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Netlify 会中断约 30 秒内没有任何输出的同步请求。JSON 解析会忽略这些空白心跳。
      controller.enqueue(encoder.encode("\n"));
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode("\n")), 5_000);
      try {
        const evidence = await searchSourcingEvidence({
          category: options.category,
          oemCode: options.oemCode,
        });
        const groundedUserMessage = `${options.userMessage}

## 服务端实时联网检索证据
${formatSourcingEvidence(evidence)}`;
        const response = await fetch(DEEPSEEK_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: [
              { role: "system", content: options.systemPrompt },
              { role: "user", content: groundedUserMessage },
            ],
            max_tokens: Math.max(options.maxTokens, 8_192),
            temperature: options.temperature,
            stream: true,
            response_format: { type: "json_object" },
            thinking: { type: "disabled" },
          }),
        });
        if (!response.ok) throw new Error(`DeepSeek API 错误 (${response.status}): ${(await response.text()).slice(0, 300)}`);

        await pipeDeepSeekStream(response, controller, encoder);
        controller.close();
      } catch (error) {
        console.error("[ai] 选品流式分析失败:", error instanceof Error ? error.message : String(error));
        controller.error(error);
      } finally {
        clearInterval(heartbeat);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-AI-Stream": "1",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "DEEPSEEK_API_KEY 未配置" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { systemPrompt, userMessage, maxTokens = 4096, temperature = 0.7, researchMode, researchInput } = body;

    if (!systemPrompt || !userMessage) {
      return NextResponse.json(
        { success: false, error: "缺少 systemPrompt 或 userMessage" },
        { status: 400 }
      );
    }

    if (researchMode === "sourcing") {
      return createSourcingStream({
        apiKey,
        systemPrompt,
        userMessage,
        maxTokens,
        temperature,
        category: researchInput?.category || "",
        oemCode: researchInput?.oemCode || researchInput?.keywords || "",
      });
    }

    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return NextResponse.json(
        { success: false, error: `DeepSeek API 错误 (${response.status}): ${errorBody}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const textContent = data.choices?.[0]?.message?.content || "";

    return NextResponse.json({
      success: true,
      data: textContent,
      tokensUsed: data.usage?.total_tokens || 0,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `服务端错误: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
