// ============================================================
// 保存详情页到飞书 15_详情页内容库
// ============================================================

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { assertLarkWriteEnabled, createLarkRecords } from "@/lib/lark-server";

export async function POST(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const body = await request.json();
    const { sku, titleV1, titleV2, titleV3, descriptionHTML, itemSpecs } = body;

    if (!sku || !titleV1 || !descriptionHTML) {
      return NextResponse.json({ success: false, error: "缺少必填字段: sku, titleV1, descriptionHTML" }, { status: 400 });
    }

    await createLarkRecords("listing", [{
      SKU: sku,
      标题版本1: titleV1,
      标题版本2: titleV2 || "",
      标题版本3: titleV3 || "",
      描述HTML: descriptionHTML,
      ItemSpecs: itemSpecs || "{}",
      状态: "草稿",
    }]);
    return NextResponse.json({ success: true, sku });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
