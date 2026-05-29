// ============================================================
// 飞书多维表格 API Route — 服务端代理 Lark CLI 调用
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const BASE_TOKEN = "RveVbcouwa06KcsDXcIc45AInkg";
const LARK_CLI = "/Users/chequan/.nvm/versions/node/v24.15.0/bin/lark-cli";
const EXTRA_PATH = "/Users/chequan/.nvm/versions/node/v24.15.0/bin";

// 表 ID 映射
const TABLE_IDS: Record<string, string> = {
  sku: "tbl6w66MyySgO75J",
  sales: "tbl65ySLOb7YOXN1",
  issues: "tbl3cCCTik5VVO7I",
  replenish: "tbl1PtyuYfzXe2dt",
};

// 缓存：字段 ID → 字段名
const fieldCache: Record<string, Record<string, string>> = {};

/** 执行 lark-cli 返回 JSON（record-list 需加 --format json，其他命令默认 JSON） */
async function larkJson(params: { command: string; formatJson?: boolean }): Promise<unknown> {
  const formatFlag = params.formatJson ? " --format json" : "";
  const fullCmd = `${LARK_CLI} ${params.command} --as user${formatFlag}`;
  console.log("[lark]", fullCmd.slice(0, 150));

  const { stdout, stderr } = await execAsync(fullCmd, {
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, PATH: `${process.env.PATH}:${EXTRA_PATH}` },
  });

  if (stderr) console.log("[lark] stderr:", stderr.slice(0, 200));
  return JSON.parse(stdout);
}

/** 获取字段 ID→名称 映射 */
async function getFieldMap(tableId: string): Promise<Record<string, string>> {
  if (fieldCache[tableId]) return fieldCache[tableId];

  const raw = await larkJson({
    command: `base +field-list --base-token ${BASE_TOKEN} --table-id ${tableId}`,
  }) as { ok: boolean; data: { fields?: Array<{ id: string; name: string }> } };

  const map: Record<string, string> = {};
  for (const f of raw.data?.fields || []) {
    map[f.id] = f.name;
  }
  fieldCache[tableId] = map;
  return map;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table") || "sku";
  const tableId = TABLE_IDS[table];
  const limit = Math.min(parseInt(searchParams.get("limit") || "200"), 200);

  if (!tableId) {
    return NextResponse.json(
      { success: false, error: `未知表: ${table}，可选: ${Object.keys(TABLE_IDS).join(", ")}` },
      { status: 400 }
    );
  }

  try {
    // 并行获取字段映射 + 记录数据
    const [fieldMap, raw] = await Promise.all([
      getFieldMap(tableId),
      larkJson({
        command: `base +record-list --base-token ${BASE_TOKEN} --table-id ${tableId} --limit ${limit}`,
        formatJson: true,
      }) as Promise<{
        ok: boolean;
        data: { data?: unknown[][]; field_id_list?: string[]; has_more?: boolean };
      }>,
    ]);

    if (!raw.ok) {
      return NextResponse.json({ success: false, error: "飞书API返回失败" }, { status: 500 });
    }

    const rows = raw.data?.data || [];
    const fieldIds = raw.data?.field_id_list || [];

    // 将数组转为 { 字段名: 值 } 对象
    const items = rows.map((row: unknown[], idx: number) => {
      const obj: Record<string, unknown> = { _idx: idx };
      fieldIds.forEach((fid, i) => {
        const name = fieldMap[fid] || fid;
        obj[name] = row[i];
      });
      return obj;
    });

    return NextResponse.json({
      success: true,
      table,
      count: items.length,
      hasMore: raw.data?.has_more || false,
      data: items,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误";
    console.error("[lark] 请求失败:", msg.slice(0, 300));
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
