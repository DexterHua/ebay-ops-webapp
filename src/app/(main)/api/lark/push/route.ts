// ============================================================
// 飞书消息推送 — 通过 lark-cli im +messages-send
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { assertLarkWriteEnabled, sendLarkMarkdownMessage } from "@/lib/lark-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const body = await request.json();
    const { chatId, content, title } = body;

    if (!chatId) {
      return NextResponse.json({ success: false, error: "缺少 chatId（请在飞书群设置中获取群ID）" }, { status: 400 });
    }
    if (!content) {
      return NextResponse.json({ success: false, error: "缺少 content" }, { status: 400 });
    }
    if (!/^[A-Za-z0-9_-]+$/.test(chatId)) {
      return NextResponse.json({ success: false, error: "chatId 格式不正确" }, { status: 400 });
    }

    // 构建消息文本：title + content
    const fullText = title ? `**${title}**\n${content}` : content;

    const messageId = await sendLarkMarkdownMessage(chatId, fullText);
    return NextResponse.json({ success: true, messageId });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
