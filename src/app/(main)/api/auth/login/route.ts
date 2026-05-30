import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { cookies } from "next/headers";
import { verifyUser, isAdmin } from "@/lib/users";
import { getJwtSecret } from "@/lib/auth-config";

export async function POST(request: NextRequest) {
  try {
    const { name, password } = await request.json();

    if (!name || !password) {
      return NextResponse.json({ ok: false, error: "请输入姓名和密码" }, { status: 400 });
    }

    const u = verifyUser(name, password);
    if (!u) {
      return NextResponse.json({ ok: false, error: "姓名或密码不正确" }, { status: 401 });
    }

    const admin = isAdmin(name);

    // 签发 JWT，含 isAdmin 标记
    const token = await new SignJWT({ name: u.name, isAdmin: admin })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(getJwtSecret());

    const cookieStore = await cookies();
    cookieStore.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 3600,
      path: "/",
    });

    return NextResponse.json({ ok: true, name: u.name, isAdmin: admin });
  } catch {
    return NextResponse.json({ ok: false, error: "服务错误" }, { status: 500 });
  }
}
