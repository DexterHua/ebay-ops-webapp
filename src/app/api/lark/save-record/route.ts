// ============================================================
// 通用数据写入 API — 支持任意表的新增记录
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);
const LARK_CLI = "/Users/chequan/.nvm/versions/node/v24.15.0/bin/lark-cli";
const EXTRA_PATH = "/Users/chequan/.nvm/versions/node/v24.15.0/bin";
const BASE_TOKEN = "RveVbcouwa06KcsDXcIc45AInkg";

const TABLE_MAP: Record<string, string> = {
  skuMaster: "tbl6w66MyySgO75J",    // 01_SKU主数据
  sales: "tbl65ySLOb7YOXN1",        // 07_销售日报
  stockFlow: "tbl7aa7a0MaSsUSr",    // 02_库存流水
  issues: "tbl3cCCTik5VVO7I",       // 08_客服售后异常
  competitors: "tbl4QQLO4Exf0ErU",  // 09_竞品价格监控
  replenish: "tbl1PtyuYfzXe2dt",    // 10_补货采购建议
  sourcing: "tblqnSLNGWFURtQq",     // 16_选品池
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CWD = /* turbopackIgnore: true */ process.cwd();

export async function POST(request: NextRequest) {
  let tmpFile = "";
  try {
    const body = await request.json();
    const { table, fields } = body;

    if (!table || !fields) {
      return NextResponse.json({ success: false, error: "缺少 table 或 fields" }, { status: 400 });
    }

    const tableId = TABLE_MAP[table];
    if (!tableId) {
      return NextResponse.json({ success: false, error: `未知表: ${table}，可选: ${Object.keys(TABLE_MAP).join(", ")}` }, { status: 400 });
    }

    // 将 fields 对象转为 lark-cli record-batch-create 格式
    const fieldNames = Object.keys(fields);
    const row = fieldNames.map((fn) => fields[fn] ?? null);
    const payload = { fields: fieldNames, rows: [row] };

    tmpFile = `_save_${table}_${Date.now()}.json`;
    writeFileSync(join(CWD, tmpFile), JSON.stringify(payload));

    const { stdout } = await execAsync(
      `${LARK_CLI} base +record-batch-create --base-token ${BASE_TOKEN} --table-id ${tableId} --json @${tmpFile} --as user`,
      { maxBuffer: 5 * 1024 * 1024, cwd: CWD, env: { ...process.env, PATH: `${process.env.PATH}:${EXTRA_PATH}` } },
    );

    unlinkSync(join(CWD, tmpFile));
    const result = JSON.parse(stdout);

    if (result.ok) {
      return NextResponse.json({ success: true, table, recordIds: result.data?.record_id_list || [] });
    }
    return NextResponse.json({ success: false, error: result.error?.message || "写入失败" }, { status: 500 });
  } catch (error) {
    if (tmpFile) { try { unlinkSync(join(CWD, tmpFile)); } catch { /* ok */ } }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
