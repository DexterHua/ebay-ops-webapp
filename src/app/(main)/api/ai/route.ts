// ============================================================
// AI API Route — 服务端代理 DeepSeek 调用，保护 API Key
// ============================================================

import { NextRequest, NextResponse } from "next/server";

const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";

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
    const { systemPrompt, userMessage, maxTokens = 4096, temperature = 0.7 } = body;

    if (!systemPrompt || !userMessage) {
      return NextResponse.json(
        { success: false, error: "缺少 systemPrompt 或 userMessage" },
        { status: 400 }
      );
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
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
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
    const choice = data.choices?.[0];
    const textContent = typeof choice?.message?.content === "string"
      ? choice.message.content.trim()
      : "";
    const tokensUsed = data.usage?.total_tokens || 0;

    if (!textContent) {
      const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown";
      const detail = finishReason === "length"
        ? "响应可能被截断，请减少分析数据量或稍后重试。"
        : "服务商返回了空内容，请稍后重试。";
      return NextResponse.json(
        {
          success: false,
          error: `AI 未返回有效内容（finish_reason: ${finishReason}）。${detail}`,
          tokensUsed,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      data: textContent,
      tokensUsed,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `服务端错误: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
