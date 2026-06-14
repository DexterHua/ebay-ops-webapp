import { NextResponse } from "next/server";
import { listUsers } from "@/lib/users";
import { requireSession } from "@/lib/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();
    const members = (await listUsers()).map((user) => ({
      name: user.name,
      role: user.role,
    }));
    return NextResponse.json({ ok: true, members });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const status = message.includes("未登录") || message.includes("登录状态") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
