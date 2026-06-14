import { NextRequest, NextResponse } from "next/server";
import { changePassword } from "@/lib/users";
import { requireSession } from "@/lib/session-server";

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();

    const { currentPassword, newPassword } = await request.json();
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ ok: false, error: "请填写原密码和新密码" }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ ok: false, error: "新密码至少需要 6 位" }, { status: 400 });
    }

    const result = await changePassword(session.name, currentPassword, newPassword);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    if (error instanceof Error && (
      error.message === "未登录" ||
      error.message === "登录状态无效" ||
      error.message === "登录状态已失效"
    )) {
      return NextResponse.json({ ok: false, error: "登录状态已失效，请重新登录" }, { status: 401 });
    }
    console.error("[change-password] 修改密码失败:", error);
    return NextResponse.json({ ok: false, error: "修改密码失败，请稍后重试" }, { status: 500 });
  }
}
