import { NextResponse } from "next/server";
import { isTavilyConfigured } from "@/lib/sourcing-search";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    provider: "tavily",
    configured: isTavilyConfigured(),
  });
}
