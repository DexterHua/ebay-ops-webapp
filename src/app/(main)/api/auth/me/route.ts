import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session-server";

export async function GET() {
  try {
    const { name, isAdmin, role, storeIds } = await requireSession();
    return NextResponse.json({ name, isAdmin, role, storeIds });
  } catch {
    return NextResponse.json({ name: null, isAdmin: false, role: null, storeIds: [] }, { status: 401 });
  }
}
