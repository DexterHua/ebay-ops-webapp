import { NextRequest, NextResponse } from "next/server";
import { downloadLarkMedia } from "@/lib/lark-server";
import { requireSession } from "@/lib/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "attachment";
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const { searchParams } = new URL(request.url);
    const fileToken = (searchParams.get("fileToken") || "").trim();
    const requestedName = (searchParams.get("name") || "").trim();
    if (!fileToken || !FILE_TOKEN_PATTERN.test(fileToken)) throw new Error("附件 token 无效");

    const media = await downloadLarkMedia(fileToken);
    const filename = requestedName || media.filename || "attachment";
    return new NextResponse(Buffer.from(media.data), {
      headers: {
        "Content-Type": media.contentType,
        "Content-Disposition": contentDisposition(filename),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    const status = message.includes("未登录") || message.includes("登录状态") ? 401
      : message.includes("无效") ? 400
        : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
