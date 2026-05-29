// ============================================================
// AI 引擎 — 前端调用封装（通过 Next.js API Route 代理）
// API Key 仅在服务端，不暴露到浏览器
// ============================================================

import { AIResponse } from "@/types";

/**
 * 调用 AI API（通过服务端代理）
 */
export async function callAI(params: {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<AIResponse<string>> {
  const { systemPrompt, userMessage, maxTokens = 4096, temperature = 0.7 } = params;

  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemPrompt,
        userMessage,
        maxTokens,
        temperature,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      return { success: false, error: result.error || `请求失败 (${response.status})` };
    }

    return {
      success: true,
      data: result.data,
      tokensUsed: result.tokensUsed,
    };
  } catch (error) {
    return { success: false, error: `请求失败: ${(error as Error).message}` };
  }
}

/**
 * 调用 AI API 并返回结构化 JSON
 */
export async function callAIStructured<T>(params: {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<AIResponse<T>> {
  const result = await callAI({
    ...params,
    systemPrompt: `${params.systemPrompt}\n\n你必须只返回有效的JSON，不要包含任何其他文字、解释或markdown代码块标记。直接返回纯JSON对象。`,
  });

  if (!result.success || !result.data) {
    return { success: false, error: result.error };
  }

  try {
    let cleaned = result.data.trim();
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(cleaned) as T;
    return { success: true, data: parsed, tokensUsed: result.tokensUsed };
  } catch (error) {
    return { success: false, error: `JSON 解析失败: ${(error as Error).message}`, tokensUsed: result.tokensUsed };
  }
}
