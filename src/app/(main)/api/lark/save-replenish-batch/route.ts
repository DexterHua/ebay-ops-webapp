// ============================================================
// 批量保存补货建议到飞书 10_补货采购建议
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assertLarkWriteEnabled, getLarkBaseToken, getLarkTableId, runLarkCli } from "@/lib/lark-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const tmpFiles: string[] = [];
  try {
    assertLarkWriteEnabled();
    const body = await request.json();
    const items = body.items as Array<{
      SKU: string; 商品名称: string; 橙联可售: number; 橙联在途: number;
      近7日日均销量: number; 补货点: string; 建议采购量: number;
      预计断货日期: string; 采购优先级: string; 描述: string;
    }>;

    if (!items || items.length === 0) {
      return NextResponse.json({ success: false, error: "items 为空" }, { status: 400 });
    }

    const today = `${new Date().toISOString().slice(0, 10)} 00:00:00`;
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
      const fn = join(tmpdir(), `_repl_batch_${Date.now()}_${i}.json`);
      tmpFiles.push(fn);
      writeFileSync(fn, payload);

      const { stdout } = await runLarkCli([
        "base", "+record-batch-create",
        "--base-token", getLarkBaseToken(),
        "--table-id", getLarkTableId("replenish"),
        "--json", `@${fn}`,
        "--as", "user",
      ]);

      const result = JSON.parse(stdout);
      if (result.ok) totalWritten += batch.length;
      else console.error("[replenish-batch] 写入失败:", JSON.stringify(result.error).slice(0, 200));

      unlinkSync(fn);

      if (i + BATCH < items.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return NextResponse.json({ success: true, written: totalWritten, total: items.length });
  } catch (error) {
    tmpFiles.forEach((f) => { try { unlinkSync(f); } catch { /* ok */ } });
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
