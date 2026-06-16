import { NextRequest, NextResponse } from "next/server";
import { assertLarkWriteEnabled, updateLarkRecord } from "@/lib/lark-server";

const DATE_FIELDS = ["初选时间", "询价时间"] as const;

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
  const normalized = { ...fields };
  for (const field of DATE_FIELDS) {
    if (field in normalized) normalized[field] = normalizeDateTime(normalized[field]);
  }
  if ("商品链接" in normalized) normalized.商品链接 = normalizeUrlField(normalized.商品链接);
  return normalized;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const body = await request.json() as { recordId?: unknown; fields?: unknown };
    const recordId = typeof body.recordId === "string" ? body.recordId.trim() : "";
    const fields = body.fields;

    if (!recordId) {
      return NextResponse.json({ success: false, error: "缺少 recordId" }, { status: 400 });
    }
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      return NextResponse.json({ success: false, error: "缺少 fields" }, { status: 400 });
    }

    await updateLarkRecord("sourcing", recordId, normalizeSourcingFields(fields as Record<string, unknown>));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
