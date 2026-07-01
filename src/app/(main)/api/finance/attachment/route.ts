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
    // 附件在新标签页打开，返回 HTML 错误页更方便查看
    const errorHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>附件预览失败</title><style>
      body{font-family:-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
      .card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center;max-width:480px}
      h1{font-size:1.25rem;margin:0 0 .5rem;color:#333}
      p{margin:0 0 1.5rem;color:#666;font-size:.875rem;line-height:1.5}
      .btn{display:inline-block;padding:.5rem 1rem;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-size:.875rem}
      .btn:hover{background:#1d4ed8}
      .error{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:.75rem;margin-bottom:1rem;color:#dc2626;font-size:.8125rem;text-align:left;word-break:break-all}
    </style></head><body><div class="card">
      <h1>🔗 附件预览失败</h1>
      <p>无法从飞书下载该附件</p>
      <div class="error">${message}</div>
      <a class="btn" href="javascript:history.back()">返回</a>
    </div></body></html>`;
    return new NextResponse(errorHtml, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
