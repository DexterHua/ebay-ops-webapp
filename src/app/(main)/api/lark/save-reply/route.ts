// ============================================================
// 保存回复到飞书 08_客服售后异常 + 高风险推送
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assertLarkWriteEnabled, getLarkBaseToken, getLarkTableId, runLarkCli } from "@/lib/lark-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let tmpFile = "";
  let pushFile = "";
  try {
    assertLarkWriteEnabled();
    const body = await request.json();
    const { recordId, replyText, issueType, priority, sku, orderNo } = body;

    if (!recordId || !replyText) {
      return NextResponse.json({ success: false, error: "缺少必填字段" }, { status: 400 });
    }
    if (!/^[A-Za-z0-9_-]+$/.test(recordId)) {
      return NextResponse.json({ success: false, error: "recordId 格式不正确" }, { status: 400 });
    }

    // 1. 更新飞书记录
    tmpFile = join(tmpdir(), `_reply_${Date.now()}.json`);
    writeFileSync(tmpFile, JSON.stringify({
      "处理动作": "已回复",
      "状态": "已完成",
      "描述": `[AI回复] ${replyText}`,
    }));

    const { stdout } = await runLarkCli([
      "base", "+record-upsert",
      "--base-token", getLarkBaseToken(),
      "--table-id", getLarkTableId("issues"),
      "--record-id", recordId,
      "--json", `@${tmpFile}`,
      "--as", "user",
    ], { maxBuffer: 5 * 1024 * 1024 });

    unlinkSync(tmpFile);
    const result = JSON.parse(stdout);

    // 2. 高风险事件推送飞书消息
    let pushSent = false;
    const isHighRisk = priority === "高" ||
      ["纠纷Case", "差评风险", "账号风险"].includes(issueType);

    if (isHighRisk) {
      try {
        pushFile = join(tmpdir(), `_push_${Date.now()}.json`);
        writeFileSync(pushFile, JSON.stringify({
          receive_id_type: "open_id",
          msg_type: "interactive",
          content: JSON.stringify({
            header: { title: { tag: "plain_text", content: `⚠️ 高风险售后 — ${issueType}` }, template: "red" },
            elements: [
              { tag: "div", text: { tag: "plain_text", content: `SKU: ${sku || "未知"} | 订单: ${orderNo || "未知"}` } },
              { tag: "div", text: { tag: "plain_text", content: "AI 已生成回复草稿已保存到多维表格，请管理人审核后再发送给买家。" } },
            ],
          }),
        }));

        await runLarkCli([
          "api", "POST", "/open-apis/im/v1/messages?receive_id_type=open_id",
          "--json", `@${pushFile}`,
          "--as", "user",
        ], { maxBuffer: 5 * 1024 * 1024 });
        unlinkSync(pushFile);
        pushSent = true;
      } catch {
        console.log("[push] 推送跳过（可能需要指定接收人）");
      }
    }

    return NextResponse.json({ success: result.ok, updated: result.ok, pushSent });
  } catch (error) {
    if (tmpFile) { try { unlinkSync(tmpFile); } catch { /* ok */ } }
    if (pushFile) { try { unlinkSync(pushFile); } catch { /* ok */ } }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
