import { NextResponse } from "next/server";
import { getLarkBaseToken, getLarkTableId, runLarkCli } from "@/lib/lark-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cachedStatus: { connected: boolean; checkedAt: number } | null = null;
const CACHE_MS = 60_000;

/** 只读探测飞书连接状态，不返回任何业务数据。 */
export async function GET() {
  if (cachedStatus && Date.now() - cachedStatus.checkedAt < CACHE_MS) {
    return NextResponse.json({
      connected: cachedStatus.connected,
      readOnly: process.env.LARK_WRITE_ENABLED !== "true",
    });
  }

  try {
    const { stdout } = await runLarkCli([
      "base", "+record-list",
      "--base-token", getLarkBaseToken(),
      "--table-id", getLarkTableId("sku"),
      "--limit", "1",
      "--format", "json",
      "--as", "user",
    ]);
    const result = JSON.parse(stdout) as { ok?: boolean };
    cachedStatus = { connected: result.ok === true, checkedAt: Date.now() };
  } catch {
    cachedStatus = { connected: false, checkedAt: Date.now() };
  }

  return NextResponse.json({
    connected: cachedStatus.connected,
    readOnly: process.env.LARK_WRITE_ENABLED !== "true",
  });
}
