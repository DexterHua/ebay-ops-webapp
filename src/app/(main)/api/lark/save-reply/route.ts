// ============================================================
// 保存回复到飞书 08_客服售后异常 + 高风险推送
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { assertLarkWriteEnabled, updateLarkRecord } from "@/lib/lark-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const body = await request.json();
    const { recordId, replyText, issueType, priority } = body;

    if (!recordId || !replyText) {
      return NextResponse.json({ success: false, error: "缺少必填字段" }, { status: 400 });
    }
    if (!/^[A-Za-z0-9_-]+$/.test(recordId)) {
      return NextResponse.json({ success: false, error: "recordId 格式不正确" }, { status: 400 });
    }

    // 1. 更新飞书记录
    await updateLarkRecord("issues", recordId, {
      "处理动作": "已回复",
      "状态": "已完成",
      "描述": `[AI回复] ${replyText}`,
    });

    // 2. 高风险事件推送飞书消息
    const pushSent = false;
    const isHighRisk = priority === "高" ||
      ["纠纷Case", "差评风险", "账号风险"].includes(issueType);

    if (isHighRisk) {
      try {
        console.log("[push] 高风险事件已记录，待配置接收人后推送");
      } catch {
        console.log("[push] 推送跳过（可能需要指定接收人）");
      }
    }

    return NextResponse.json({ success: true, updated: true, pushSent });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
