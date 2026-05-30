// ============================================================
// 保存详情页到飞书 15_详情页内容库
// ============================================================

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { exec } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

const BASE_TOKEN = "RveVbcouwa06KcsDXcIc45AInkg";
const TABLE_ID = "tblswYKzSskqXZ1V";
const LARK_CLI = "/Users/chequan/.nvm/versions/node/v24.15.0/bin/lark-cli";
const EXTRA_PATH = "/Users/chequan/.nvm/versions/node/v24.15.0/bin";

const CWD = /* turbopackIgnore: true */ process.cwd();

function cleanupTmp(filename: string) {
  if (!filename) return;
  try { unlinkSync(join(CWD, filename)); } catch { /* ignore */ }
}

export async function POST(request: NextRequest) {
  let tmpFile = "";
  try {
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

    tmpFile = `_savelisting_${Date.now()}.json`;
    writeFileSync(join(CWD, tmpFile), JSON.stringify(payload));

    const { stdout } = await execAsync(
      `${LARK_CLI} base +record-batch-create --base-token ${BASE_TOKEN} --table-id ${TABLE_ID} --json @${tmpFile} --as user`,
      { maxBuffer: 10 * 1024 * 1024, cwd: CWD, env: { ...process.env, PATH: `${process.env.PATH}:${EXTRA_PATH}` } },
    );

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
