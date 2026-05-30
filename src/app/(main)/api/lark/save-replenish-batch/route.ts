// ============================================================
// 批量保存补货建议到飞书 10_补货采购建议
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);
const BASE_TOKEN = "RveVbcouwa06KcsDXcIc45AInkg";
const TABLE_ID = "tbl1PtyuYfzXe2dt";
const LARK_CLI = "/Users/chequan/.nvm/versions/node/v24.15.0/bin/lark-cli";
const EXTRA_PATH = "/Users/chequan/.nvm/versions/node/v24.15.0/bin";
const CWD = /* turbopackIgnore: true */ process.cwd();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const tmpFiles: string[] = [];
  try {
    const body = await request.json();
    const items = body.items as Array<{
      SKU: string; 商品名称: string; 橙联可售: number; 橙联在途: number;
      近7日日均销量: number; 补货点: string; 建议采购量: number;
      预计断货日期: string; 采购优先级: string; 描述: string;
    }>;

    if (!items || items.length === 0) {
      return NextResponse.json({ success: false, error: "items 为空" }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
    const BATCH = 50;
    const fields = ["SKU", "商品名称", "橙联可售", "橙联在途", "近7日日均销量", "补货点", "建议采购量", "预计断货日期", "采购优先级", "描述", "生成日期", "采购状态"];
    let totalWritten = 0;

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH).map((item) => [
        item.SKU, item.商品名称, item.橙联可售, item.橙联在途,
        item.近7日日均销量, item.补货点, item.建议采购量,
        item.预计断货日期, item.采购优先级, item.描述, today, "待采购",
      ]);

      const payload = JSON.stringify({ fields, rows: batch });
      const fn = `_repl_batch_${i}.json`;
      tmpFiles.push(fn);
      writeFileSync(join(CWD, fn), payload);

      const { stdout } = await execAsync(
        `${LARK_CLI} base +record-batch-create --base-token ${BASE_TOKEN} --table-id ${TABLE_ID} --json @${fn} --as user`,
        { maxBuffer: 10 * 1024 * 1024, cwd: CWD, env: { ...process.env, PATH: `${process.env.PATH}:${EXTRA_PATH}` } },
      );

      const result = JSON.parse(stdout);
      if (result.ok) totalWritten += batch.length;
      else console.error("[replenish-batch] 写入失败:", JSON.stringify(result.error).slice(0, 200));

      unlinkSync(join(CWD, fn));

      if (i + BATCH < items.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return NextResponse.json({ success: true, written: totalWritten, total: items.length });
  } catch (error) {
    tmpFiles.forEach((f) => { try { unlinkSync(join(CWD, f)); } catch { /* ok */ } });
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
