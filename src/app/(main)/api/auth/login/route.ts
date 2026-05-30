import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { cookies } from "next/headers";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "solid-ecom-ops-secret-key-2025");

export async function POST(request: NextRequest) {
  try {
    const { name, password } = await request.json();

    if (!name || !password) {
      return NextResponse.json({ ok: false, error: "请输入姓名和密码" }, { status: 400 });
    }

    // 解析 AUTH_USERS 环境变量
    const raw = process.env.AUTH_USERS || "";
    const users = raw.split(",").map(s => s.trim()).filter(Boolean).map(s => {
      const [n, p] = s.split(":");
      return { name: n, password: p };
    });

    const u = users.find(u => u.name === name && u.password === password);
    if (!u) {
      return NextResponse.json({ ok: false, error: "姓名或密码不正确" }, { status: 401 });
    }

    // 签发 JWT，有效期 7 天
    const token = await new SignJWT({ name: u.name })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(JWT_SECRET);

    const cookieStore = await cookies();
    cookieStore.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 3600,
      path: "/",
    });

    return NextResponse.json({ ok: true, name: u.name });
  } catch {
    return NextResponse.json({ ok: false, error: "服务错误" }, { status: 500 });
  }
}
