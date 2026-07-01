import { NextResponse } from "next/server";
import { buildSkuImportTemplateWorkbook } from "@/lib/sku-import-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const workbook = buildSkuImportTemplateWorkbook();
  const body = workbook.buffer.slice(workbook.byteOffset, workbook.byteOffset + workbook.byteLength) as ArrayBuffer;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=\"sku-import-template.xlsx\"",
      "Cache-Control": "no-store",
    },
  });
}
