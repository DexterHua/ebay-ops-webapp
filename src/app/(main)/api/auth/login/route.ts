import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { cookies } from "next/headers";
import { getUserRole, getUserSessionVersion, verifyUser } from "@/lib/users";
import { getJwtSecret } from "@/lib/auth-config";

export async function POST(request: NextRequest) {
  try {
    const { name, password } = await request.json();

    if (!name || !password) {
      return NextResponse.json({ ok: false, error: "请输入姓名和密码" }, { status: 400 });
    }

    const u = await verifyUser(name, password);
    if (!u) {
      return NextResponse.json({ ok: false, error: "姓名或密码不正确" }, { status: 401 });
    }

    const role = getUserRole(u);
    const sessionVersion = getUserSessionVersion(u);
    const admin = role === "admin";

    // 签发 JWT，服务端仍会以持久化账号信息为准重新校验。
    const token = await new SignJWT({ name: u.name, isAdmin: admin, role, sessionVersion })
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

    return NextResponse.json({ ok: true, name: u.name, isAdmin: admin, role });
  } catch {
    return NextResponse.json({ ok: false, error: "服务错误" }, { status: 500 });
  }
}
