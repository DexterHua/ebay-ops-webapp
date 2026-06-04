import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    provider: "tavily",
    configured: Boolean(process.env.TAVILY_API_KEY?.trim()),
  });
}
