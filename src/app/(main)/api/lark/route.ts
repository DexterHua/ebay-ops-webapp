// ============================================================
// 飞书多维表格 API Route — 服务端代理 Lark CLI 调用
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getLarkBaseToken, getLarkReadLimit, getLarkTableId, LarkTable, runLarkCli } from "@/lib/lark-server";

// 表 ID 映射
const TABLE_IDS: Record<string, LarkTable> = {
  sku: "sku",
  sales: "sales",
  issues: "issues",
  replenish: "replenish",
  flow: "flow",
};

// 缓存：字段 ID → 字段名
const fieldCache: Record<string, Record<string, string>> = {};

/** 执行 lark-cli 返回 JSON。 */
async function larkJson(args: string[]): Promise<unknown> {
  const { stdout, stderr } = await runLarkCli([...args, "--as", "user"]);
  if (stderr) console.log("[lark] stderr:", stderr.slice(0, 200));
  return JSON.parse(stdout);
}

/** 获取字段 ID→名称 映射 */
async function getFieldMap(baseToken: string, tableId: string): Promise<Record<string, string>> {
  if (fieldCache[tableId]) return fieldCache[tableId];

  const raw = await larkJson([
    "base", "+field-list", "--base-token", baseToken, "--table-id", tableId,
  ]) as { ok: boolean; data: { fields?: Array<{ id: string; name: string }> } };

  const map: Record<string, string> = {};
  for (const f of raw.data?.fields || []) {
    map[f.id] = f.name;
  }
  fieldCache[tableId] = map;
  return map;
}

interface LarkRecordPage {
  ok: boolean;
  data?: {
    data?: unknown[][];
    field_id_list?: string[];
    record_id_list?: string[];
    has_more?: boolean;
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table") || "sku";
  const tableKey = TABLE_IDS[table];

  if (!tableKey) {
    return NextResponse.json(
      { success: false, error: `未知表: ${table}，可选: ${Object.keys(TABLE_IDS).join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const baseToken = getLarkBaseToken();
    const tableId = getLarkTableId(tableKey);
    const fieldMap = await getFieldMap(baseToken, tableId);
    const maxRecords = getLarkReadLimit();
    const items: Record<string, unknown>[] = [];
    const pageSize = 200;
    let offset = 0;
    let hasMore = false;

    do {
      const raw = await larkJson([
        "base", "+record-list",
        "--base-token", baseToken,
        "--table-id", tableId,
        "--offset", String(offset),
        "--limit", String(pageSize),
        "--format", "json",
      ]) as LarkRecordPage;

      if (!raw.ok) {
        return NextResponse.json({ success: false, error: "飞书API返回失败" }, { status: 500 });
      }

      const rows = raw.data?.data || [];
      const fieldIds = raw.data?.field_id_list || [];
      const recordIds = raw.data?.record_id_list || [];

      rows.forEach((row, idx) => {
        const obj: Record<string, unknown> = {
          _idx: offset + idx,
          recordId: recordIds[idx],
        };
        fieldIds.forEach((fid, i) => {
          const name = fieldMap[fid] || fid;
          obj[name] = row[i];
        });
        items.push(obj);
      });

      hasMore = raw.data?.has_more || false;
      offset += rows.length;
      if (hasMore && rows.length === 0) throw new Error("飞书分页返回空页，已停止读取");
    } while (hasMore && items.length < maxRecords);

    const data = items.slice(0, maxRecords);

    return NextResponse.json({
      success: true,
      table,
      count: data.length,
      hasMore,
      truncated: hasMore && items.length >= maxRecords,
      data,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误";
    console.error("[lark] 请求失败:", msg.slice(0, 300));
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
