import { NextResponse } from "next/server";
import { isLarkWriteEnabled, listLarkRecords } from "@/lib/lark-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cachedStatus: { connected: boolean; checkedAt: number } | null = null;
const CACHE_MS = 60_000;

/** 只读探测飞书连接状态，不返回任何业务数据。 */
export async function GET() {
  if (cachedStatus && Date.now() - cachedStatus.checkedAt < CACHE_MS) {
    return NextResponse.json({
      connected: cachedStatus.connected,
      readOnly: !isLarkWriteEnabled(),
    });
  }

  try {
    await listLarkRecords("sku", 1);
    cachedStatus = { connected: true, checkedAt: Date.now() };
  } catch {
    cachedStatus = { connected: false, checkedAt: Date.now() };
  }

  return NextResponse.json({
    connected: cachedStatus.connected,
    readOnly: !isLarkWriteEnabled(),
  });
}
