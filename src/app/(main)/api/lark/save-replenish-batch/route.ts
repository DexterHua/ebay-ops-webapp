// ============================================================
// 批量保存补货建议到飞书 10_补货采购建议
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { assertLarkWriteEnabled, createLarkRecords } from "@/lib/lark-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertLarkWriteEnabled();
    const body = await request.json();
    const items = body.items as Array<{
      SKU: string; 商品名称: string; 橙联可售: number; 橙联在途: number;
      近7日日均销量: number; 补货点: string; 建议采购量: number;
      预计断货日期: string; 采购优先级: string; 描述: string;
    }>;

    if (!items || items.length === 0) {
      return NextResponse.json({ success: false, error: "items 为空" }, { status: 400 });
    }

    const today = Date.now();
    const BATCH = 50;
    let totalWritten = 0;

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH).map((item) => ({
        SKU: item.SKU,
        商品名称: item.商品名称,
        橙联可售: item.橙联可售,
        橙联在途: item.橙联在途,
        近7日日均销量: item.近7日日均销量,
        补货点: item.补货点,
        建议采购量: item.建议采购量,
        预计断货日期: item.预计断货日期 === "待定" ? null : Date.parse(`${item.预计断货日期}T00:00:00+08:00`),
        采购优先级: item.采购优先级,
        描述: item.描述,
        生成日期: today,
        采购状态: "待采购",
      }));

      await createLarkRecords("replenish", batch);
      totalWritten += batch.length;

      if (i + BATCH < items.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return NextResponse.json({ success: true, written: totalWritten, total: items.length });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
