import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { listUsers, addUser, removeUser, resetPassword } from "@/lib/users";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "solid-ecom-ops-secret-key-2025");

/** 验证管理员权限 */
async function checkAdmin(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    if (!token) return false;
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return !!payload.isAdmin;
  } catch {
    return false;
  }
}

// GET — 列出所有用户
export async function GET() {
  if (!(await checkAdmin())) {
    return NextResponse.json({ ok: false, error: "仅管理员可操作" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, users: listUsers() });
}

// POST — 新增或操作
export async function POST(request: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ ok: false, error: "仅管理员可操作" }, { status: 403 });
  }

  const body = await request.json();
  const { action, name, password } = body;

  switch (action) {
    case "add": {
      if (!name || !password) return NextResponse.json({ ok: false, error: "请输入姓名和密码" }, { status: 400 });
      const r = addUser(name, password);
      return NextResponse.json(r);
    }
    case "delete": {
      if (!name) return NextResponse.json({ ok: false, error: "请指定用户" }, { status: 400 });
      const r = removeUser(name);
      return NextResponse.json(r);
    }
    case "resetPassword": {
      if (!name || !password) return NextResponse.json({ ok: false, error: "请输入新密码" }, { status: 400 });
      const r = resetPassword(name, password);
      return NextResponse.json(r);
    }
    default:
      return NextResponse.json({ ok: false, error: "未知操作" }, { status: 400 });
  }
}
