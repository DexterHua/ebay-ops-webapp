import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { getJwtSecret } from "@/lib/auth-config";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    if (!token) return NextResponse.json({ name: null, isAdmin: false }, { status: 401 });

    const { payload } = await jwtVerify(token, getJwtSecret());
    return NextResponse.json({ name: payload.name as string, isAdmin: !!payload.isAdmin });
  } catch {
    return NextResponse.json({ name: null, isAdmin: false }, { status: 401 });
  }
}
