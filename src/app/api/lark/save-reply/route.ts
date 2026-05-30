// ============================================================
// 保存回复到飞书 08_客服售后异常 + 高风险推送
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);
const BASE_TOKEN = "RveVbcouwa06KcsDXcIc45AInkg";
const TABLE_ID = "tbl3cCCTik5VVO7I";
const LARK_CLI = "/Users/chequan/.nvm/versions/node/v24.15.0/bin/lark-cli";
const EXTRA_PATH = "/Users/chequan/.nvm/versions/node/v24.15.0/bin";
const CWD = /* turbopackIgnore: true */ process.cwd();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let tmpFile = "";
  let pushFile = "";
  try {
    const body = await request.json();
    const { recordId, replyText, issueType, priority, sku, orderNo } = body;

    if (!recordId || !replyText) {
      return NextResponse.json({ success: false, error: "缺少必填字段" }, { status: 400 });
    }

    // 1. 更新飞书记录
    tmpFile = `_reply_${Date.now()}.json`;
    writeFileSync(join(CWD, tmpFile), JSON.stringify({
      "处理动作": "已回复",
      "状态": "已完成",
      "描述": `[AI回复] ${replyText}`,
    }));

    const updateCmd = `${LARK_CLI} base +record-upsert --base-token ${BASE_TOKEN} --table-id ${TABLE_ID} --record-id ${recordId} --json @${tmpFile} --as user`;
    const { stdout } = await execAsync(updateCmd, {
      maxBuffer: 5 * 1024 * 1024, cwd: CWD,
      env: { ...process.env, PATH: `${process.env.PATH}:${EXTRA_PATH}` },
    });

    unlinkSync(join(CWD, tmpFile));
    const result = JSON.parse(stdout);

    // 2. 高风险事件推送飞书消息
    let pushSent = false;
    const isHighRisk = priority === "高" ||
      ["纠纷Case", "差评风险", "账号风险"].includes(issueType);

    if (isHighRisk) {
      try {
        pushFile = `_push_${Date.now()}.json`;
        writeFileSync(join(CWD, pushFile), JSON.stringify({
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

        await execAsync(
          `${LARK_CLI} api POST /open-apis/im/v1/messages?receive_id_type=open_id --json @${pushFile} --as user`,
          { maxBuffer: 5 * 1024 * 1024, cwd: CWD,
            env: { ...process.env, PATH: `${process.env.PATH}:${EXTRA_PATH}` },
          },
        );
        unlinkSync(join(CWD, pushFile));
        pushSent = true;
      } catch {
        console.log("[push] 推送跳过（可能需要指定接收人）");
      }
    }

    return NextResponse.json({ success: result.ok, updated: result.ok, pushSent });
  } catch (error) {
    if (tmpFile) { try { unlinkSync(join(CWD, tmpFile)); } catch { /* ok */ } }
    if (pushFile) { try { unlinkSync(join(CWD, pushFile)); } catch { /* ok */ } }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
