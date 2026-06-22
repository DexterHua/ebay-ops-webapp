// ============================================================
// 通用数据写入 API — 支持任意表的新增记录
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import {
  assertLarkWriteEnabled,
  createLarkRecords,
  LarkTable,
  syncSalesSummary,
  syncStockSummaryFromFlow,
} from "@/lib/lark-server";
import { configuredLarkUserReference } from "@/lib/lark-user-map";
import { requireSession } from "@/lib/session-server";

const TABLE_MAP: Record<string, LarkTable> = {
  skuMaster: "sku",
  sales: "sales",
  stockFlow: "stockFlow",
  issues: "issues",
  competitors: "competitors",
  replenish: "replenish",
  sourcing: "sourcing",
};

const DATE_FIELDS: Partial<Record<LarkTable, string[]>> = {
  sales: ["日期"],
  stockFlow: ["日期"],
  issues: ["创建日期"],
  competitors: ["记录日期"],
  sourcing: ["登记时间", "初选时间", "询价时间"],
};

function normalizeDateTime(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().replace(/\//g, "-");
  const timestamp = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? `${normalized}T00:00:00+08:00`
      : normalized,
  );
  return Number.isNaN(timestamp) ? value : timestamp;
}

function normalizeUrlField(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const url = value.trim();
  if (!url) return "";
  return { text: url, link: url };
}

function normalizeSourcingFields(fields: Record<string, unknown>): Record<string, unknown> {
  if ("商品链接" in fields) {
    return {
      ...fields,
      商品链接: normalizeUrlField(fields.商品链接),
    };
  }
  return fields;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const body = await request.json();
    const { table, fields } = body;

    if (!table || !fields || typeof fields !== "object" || Array.isArray(fields)) {
      return NextResponse.json({ success: false, error: "缺少 table 或 fields" }, { status: 400 });
    }

    const tableKey = TABLE_MAP[table];
    if (!tableKey) {
      return NextResponse.json({ success: false, error: `未知表: ${table}，可选: ${Object.keys(TABLE_MAP).join(", ")}` }, { status: 400 });
    }

    const normalizedFields = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== ""),
    );
    let warning: string | undefined;
    if (table === "skuMaster") {
      delete normalizedFields.负责人;
      let sessionName: string;
      try {
        sessionName = (await requireSession()).name;
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        const isSessionError = message === "未登录"
          || message === "登录状态无效"
          || message === "登录状态已失效";
        if (isSessionError) {
          return NextResponse.json({ success: false, error: message }, { status: 401 });
        }
        throw error;
      }
      const ownerReference = configuredLarkUserReference(sessionName);
      if (ownerReference) {
        normalizedFields.负责人 = ownerReference;
      } else {
        warning = "SKU 已保存，但当前账号未配置飞书 open_id，负责人未写入";
      }
    }
    for (const field of DATE_FIELDS[tableKey] || []) {
      if (field in normalizedFields) normalizedFields[field] = normalizeDateTime(normalizedFields[field]);
    }
    const larkFields = tableKey === "sourcing" ? normalizeSourcingFields(normalizedFields) : normalizedFields;

    const recordIds = await createLarkRecords(tableKey, [larkFields]);
    try {
      if (tableKey === "stockFlow") await syncStockSummaryFromFlow(normalizedFields);
      if (tableKey === "sales") await syncSalesSummary(String(normalizedFields.SKU || ""));
    } catch (error) {
      const summaryWarning = `业务记录已保存，但运营汇总同步失败：${(error as Error).message}`;
      warning = warning ? `${warning}；${summaryWarning}` : summaryWarning;
      console.error("[lark] 汇总同步失败:", summaryWarning);
    }

    return NextResponse.json({ success: true, table, recordIds, warning });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
