import { NextRequest, NextResponse } from "next/server";
import { getProfitSettings, saveProfitSettings } from "@/lib/profit-settings";
import { requireAdmin, requireSession } from "@/lib/session-server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const VALIDATION_MESSAGES = new Set([
  "成本参数不完整",
  "成本参数不能小于 0",
  "汇率必须大于 0",
  "平台费率合计必须小于 100%",
  "缺少修改人",
]);

function isAuthenticationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message === "未登录" || message === "登录状态无效" || message === "登录状态已失效";
}

export async function GET() {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  try {
    return NextResponse.json(
      { ok: true, settings: await getProfitSettings() },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[profit-settings] 读取失败:", error);
    return NextResponse.json(
      { ok: false, error: "成本参数读取失败，请稍后重试" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function PUT(request: NextRequest) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    const status = isAuthenticationError(error) ? 401 : 403;
    return NextResponse.json(
      { ok: false, error: "仅管理员可修改成本参数" },
      { status, headers: NO_STORE_HEADERS },
    );
  }

  let body: { assumptions?: unknown };
  try {
    body = await request.json() as { assumptions?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: "请求格式无效" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const settings = await saveProfitSettings(body.assumptions, admin.name);
    return NextResponse.json({ ok: true, settings }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (VALIDATION_MESSAGES.has(message)) {
      return NextResponse.json({ ok: false, error: message }, { status: 400, headers: NO_STORE_HEADERS });
    }
    console.error("[profit-settings] 保存失败:", error);
    return NextResponse.json(
      { ok: false, error: "成本参数存储暂时不可用，请稍后重试" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
