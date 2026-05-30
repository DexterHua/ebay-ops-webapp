// ============================================================
// 保存详情页到飞书 15_详情页内容库
// ============================================================

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assertLarkWriteEnabled, getLarkBaseToken, getLarkTableId, runLarkCli } from "@/lib/lark-server";

function cleanupTmp(filename: string) {
  if (!filename) return;
  try { unlinkSync(filename); } catch { /* ignore */ }
}

export async function POST(request: NextRequest) {
  let tmpFile = "";
  try {
    assertLarkWriteEnabled();
    const body = await request.json();
    const { sku, titleV1, titleV2, titleV3, descriptionHTML, itemSpecs } = body;

    if (!sku || !titleV1 || !descriptionHTML) {
      return NextResponse.json({ success: false, error: "缺少必填字段: sku, titleV1, descriptionHTML" }, { status: 400 });
    }

    const payload = {
      fields: ["SKU", "标题版本1", "标题版本2", "标题版本3", "描述HTML", "ItemSpecs", "状态"],
      rows: [[
        sku, titleV1, titleV2 || "", titleV3 || "", descriptionHTML, itemSpecs || "{}", "草稿",
      ]],
    };

    tmpFile = join(tmpdir(), `_savelisting_${Date.now()}.json`);
    writeFileSync(tmpFile, JSON.stringify(payload));

    const { stdout } = await runLarkCli([
      "base", "+record-batch-create",
      "--base-token", getLarkBaseToken(),
      "--table-id", getLarkTableId("listing"),
      "--json", `@${tmpFile}`,
      "--as", "user",
    ]);

    cleanupTmp(tmpFile);
    const result = JSON.parse(stdout);

    if (result.ok) {
      return NextResponse.json({ success: true, sku });
    }
    return NextResponse.json({ success: false, error: JSON.stringify(result.error) }, { status: 500 });
  } catch (error) {
    cleanupTmp(tmpFile);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
