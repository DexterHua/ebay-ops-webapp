import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getJwtSecret } from "@/lib/auth-config";

// 无需登录即可访问的路径
const PUBLIC_PATHS = [
  /^\/login$/,
  /^\/api\/auth\//,
  /^\/api\/inventory\/sales-scan$/,
  /^\/_next\//,
  /^\/logo\.png$/,
  /^\/logo-thumb\.png$/,
  /^\/favicon\.ico$/,
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => p.test(pathname));
}

function canonicalizeLocalhost(request: NextRequest): NextResponse | null {
  const host = request.headers.get("host") || "";
  if (!host.startsWith("127.0.0.1")) return null;

  const targetHost = host.replace("127.0.0.1", "localhost");
  const targetUrl = `${request.nextUrl.protocol}//${targetHost}${request.nextUrl.pathname}${request.nextUrl.search}`;
  const escapedTargetUrl = targetUrl.replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escapedTargetUrl}"><script>location.replace(${JSON.stringify(targetUrl)})</script>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  ) as NextResponse;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const canonicalRedirect = canonicalizeLocalhost(request);
  if (canonicalRedirect) return canonicalRedirect;

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
