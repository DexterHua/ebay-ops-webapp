import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getJwtSecret } from "@/lib/auth-config";

// 无需登录即可访问的路径
const PUBLIC_PATHS = [
  /^\/login$/,
  /^\/api\/auth\//,
  /^\/_next\//,
  /^\/logo\.png$/,
  /^\/logo-thumb\.png$/,
  /^\/favicon\.ico$/,
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => p.test(pathname));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公开路径直接放行
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get("auth_token")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    await jwtVerify(token, getJwtSecret());
    return NextResponse.next();
  } catch {
    // Token 过期或无效
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
