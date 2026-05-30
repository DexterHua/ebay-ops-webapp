import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "solid-ecom-ops-secret-key-2025");

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    if (!token) return NextResponse.json({ name: null, isAdmin: false }, { status: 401 });

    const { payload } = await jwtVerify(token, JWT_SECRET);
    return NextResponse.json({ name: payload.name as string, isAdmin: !!payload.isAdmin });
  } catch {
    return NextResponse.json({ name: null, isAdmin: false }, { status: 401 });
  }
}
