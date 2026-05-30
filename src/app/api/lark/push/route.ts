// ============================================================
// 飞书消息推送 — 通过 lark-cli im +messages-send
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const LARK_CLI = "/Users/chequan/.nvm/versions/node/v24.15.0/bin/lark-cli";
const EXTRA_PATH = "/Users/chequan/.nvm/versions/node/v24.15.0/bin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chatId, content, title } = body;

    if (!chatId) {
      return NextResponse.json({ success: false, error: "缺少 chatId（请在飞书群设置中获取群ID）" }, { status: 400 });
    }
    if (!content) {
      return NextResponse.json({ success: false, error: "缺少 content" }, { status: 400 });
    }

    // 构建消息文本：title + content
    const fullText = title ? `**${title}**\n${content}` : content;

    const { stdout } = await execAsync(
      `${LARK_CLI} im +messages-send --chat-id ${chatId} --markdown '${fullText.replace(/'/g, "'\\''")}' --as user`,
      {
        maxBuffer: 5 * 1024 * 1024,
        env: { ...process.env, PATH: `${process.env.PATH}:${EXTRA_PATH}` },
      },
    );

    const result = JSON.parse(stdout);
    return NextResponse.json({ success: result.ok ?? true, messageId: result.data?.message_id });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
