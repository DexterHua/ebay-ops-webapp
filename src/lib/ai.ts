// ============================================================
// AI 引擎 — 前端调用封装（通过 Next.js API Route 代理）
// API Key 仅在服务端，不暴露到浏览器
// ============================================================

import { AIResponse } from "@/types";

/** 修复模型偶尔在 JSON 字符串内部直接输出的换行等控制字符。 */
function escapeJsonStringControlCharacters(value: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }
    if (char === "\"") {
      result += char;
      inString = !inString;
      continue;
    }
    if (inString) {
      if (char === "\n") { result += "\\n"; continue; }
      if (char === "\r") { result += "\\r"; continue; }
      if (char === "\t") { result += "\\t"; continue; }
    }
    result += char;
  }

  return result;
}

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

    if (response.headers.get("X-AI-Stream") === "1") {
      const data = await response.text();
      if (!response.ok) return { success: false, error: data || `请求失败 (${response.status})` };
      return { success: true, data };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      const timeout = response.status === 504 || text.includes("Inactivity Timeout");
      return {
        success: false,
        error: timeout
          ? "分析生成超时，请重试。"
          : `服务返回异常 (${response.status})，请稍后重试`,
      };
    }

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
    if (!cleaned) {
      return { success: false, error: "AI 未返回可解析内容，请重试。", tokensUsed: result.tokensUsed };
    }
    if (
      (cleaned.startsWith("{") && !cleaned.endsWith("}")) ||
      (cleaned.startsWith("[") && !cleaned.endsWith("]"))
    ) {
      return { success: false, error: "AI 返回的 JSON 不完整，请重试。", tokensUsed: result.tokensUsed };
    }
    const parsed = JSON.parse(escapeJsonStringControlCharacters(cleaned)) as T;
    return { success: true, data: parsed, tokensUsed: result.tokensUsed };
  } catch (error) {
    if ((error as Error).message.includes("Unexpected end of JSON input")) {
      return { success: false, error: "AI 返回的 JSON 不完整，请重试。", tokensUsed: result.tokensUsed };
    }
    return { success: false, error: `JSON 解析失败: ${(error as Error).message}`, tokensUsed: result.tokensUsed };
  }
}
