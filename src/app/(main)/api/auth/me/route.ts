import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session-server";

export async function GET() {
  try {
    const { name, isAdmin, role } = await requireSession();
    return NextResponse.json({ name, isAdmin, role });
  } catch {
    return NextResponse.json({ name: null, isAdmin: false, role: null }, { status: 401 });
  }
}
