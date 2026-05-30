// ============================================================
// 飞书集成层 — 端到端推送 + 类型定义
// （实际 lark-cli 调用现在在 /api/lark/* 路由中执行）
// ============================================================

// ---- 配置 ----
export const LARK_CONFIG = {
  baseToken: "RveVbcouwa06KcsDXcIc45AInkg",
  tableIds: {
    skuMaster: "tbl6w66MyySgO75J",
    stockFlow: "tbl7aa7a0MaSsUSr",
    salesDaily: "tbl65ySLOb7YOXN1",
    customerService: "tbl3cCCTik5VVO7I",
    replenishAdvice: "tbl1PtyuYfzXe2dt",
    listingContent: "tblswYKzSskqXZ1V",
    sourcingPool: "tblqnSLNGWFURtQq",
    flow: "tblQxWm3VHIpTXd8",
  },
};

// ---- 飞书消息推送（通过 API Route 代理） ----

/** 发送飞书消息（浏览器调用 → API Route → lark-cli） */
export async function sendFeishuMessage(params: {
  chatId: string;
  content: string;
  title?: string;
}): Promise<boolean> {
  try {
    const res = await fetch("/api/lark/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    return json.success === true;
  } catch {
    return false;
  }
}

// ---- 库存预警推送 ----

/** 从浏览器调用：推送库存预警汇总到飞书 */
export async function pushInventoryAlert(params: {
  urgentSkus: Array<{ sku: string; name: string; daysRemaining: number }>;
  warningSkus: Array<{ sku: string; name: string; daysRemaining: number }>;
}): Promise<boolean> {
  const lines: string[] = [];

  if (params.urgentSkus.length > 0) {
    lines.push("🔴 **紧急补货**");
    params.urgentSkus.forEach((s) => {
      lines.push(`· ${s.sku} ${s.name} — 仅剩 **${s.daysRemaining}天** 库存`);
    });
  }

  if (params.warningSkus.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("🟡 **需关注**");
    params.warningSkus.forEach((s) => {
      lines.push(`· ${s.sku} ${s.name} — 可售 ${s.daysRemaining}天`);
    });
  }

  if (lines.length === 0) return false;

  return sendFeishuMessage({
    chatId: "placeholder", // 用户需要配置目标群 chat_id
    title: `📦 库存预警 · ${params.urgentSkus.length + params.warningSkus.length} 个 SKU`,
    content: lines.join("\n"),
  });
}
