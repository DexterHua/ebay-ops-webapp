import { NextRequest, NextResponse } from "next/server";
import { listUsers, addUser, removeUser, resetPassword, updateUserPermissions } from "@/lib/users";
import { requireAdmin } from "@/lib/session-server";

function getStorageErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "账号存储暂时不可用，请稍后重试";
  return `账号存储暂时不可用，请稍后重试 (${error.name})`;
}

async function ensureAdmin(): Promise<NextResponse | null> {
  try {
    await requireAdmin();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "权限不足" || message === "未登录" || message === "登录状态无效" || message === "登录状态已失效") {
      return NextResponse.json({ ok: false, error: "仅管理员可操作" }, { status: 403 });
    }
    throw error;
  }
}

// GET — 列出所有用户
export async function GET() {
  try {
    const authError = await ensureAdmin();
    if (authError) return authError;
    return NextResponse.json({ ok: true, users: await listUsers() });
  } catch (error) {
    console.error("[auth-users] 读取用户失败:", error);
    return NextResponse.json({ ok: false, error: getStorageErrorMessage(error) }, { status: 500 });
  }
}

// POST — 新增或操作
export async function POST(request: NextRequest) {
  try {
    const authError = await ensureAdmin();
    if (authError) return authError;

    const body = await request.json();
    const { action, name, password, role, storeIds } = body;

    switch (action) {
      case "add": {
        if (!name || !password) return NextResponse.json({ ok: false, error: "请输入姓名和密码" }, { status: 400 });
        const r = await addUser(name, password, role, storeIds);
        return NextResponse.json(r);
      }
      case "delete": {
        if (!name) return NextResponse.json({ ok: false, error: "请指定用户" }, { status: 400 });
        const r = await removeUser(name);
        return NextResponse.json(r);
      }
      case "resetPassword": {
        if (!name || !password) return NextResponse.json({ ok: false, error: "请输入新密码" }, { status: 400 });
        const r = await resetPassword(name, password);
        return NextResponse.json(r);
      }
      case "updatePermissions": {
        if (!name) return NextResponse.json({ ok: false, error: "请指定用户" }, { status: 400 });
        const r = await updateUserPermissions(name, role, storeIds);
        return NextResponse.json(r);
      }
      default:
        return NextResponse.json({ ok: false, error: "未知操作" }, { status: 400 });
    }
  } catch (error) {
    console.error("[auth-users] 用户操作失败:", error);
    return NextResponse.json({ ok: false, error: getStorageErrorMessage(error) }, { status: 500 });
  }
}
