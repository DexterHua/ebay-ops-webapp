const MIN_SECRET_LENGTH = 32;
const RESPONSE_SUMMARY_LIMIT = 300;

function requireSecret(env) {
  const secret = String(env.INVENTORY_SALES_SCAN_SECRET || "").trim();
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error("INVENTORY_SALES_SCAN_SECRET 未配置或长度不足");
  }
  return secret;
}

function redact(value, secret) {
  return value.replaceAll(secret, "[redacted]");
}

export async function invokeScheduledSalesInventoryScan(openNextWorker, controller, env, ctx) {
  const secret = requireSecret(env);
  const request = new Request("https://internal/api/inventory/sales-scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
      "X-Cloudflare-Cron": controller.cron,
    },
    body: JSON.stringify({ limit: 200 }),
  });

  const response = await openNextWorker.fetch(request, env, ctx);
  if (!response.ok) {
    const summary = redact((await response.text()).slice(0, RESPONSE_SUMMARY_LIMIT), secret);
    throw new Error(`销售库存定时扫描失败 (${response.status}): ${summary}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("销售库存定时扫描响应不是有效 JSON");
  }
}
