// ============================================================
// 飞书集成层 — 封装 Lark CLI 调用，读写多维表格
// ============================================================

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ---- 配置 ----
export const LARK_CONFIG = {
  baseToken: "RveVbcouwa06KcsDXcIc45AInkg",
  tableIds: {
    skuMaster: "tbl6w66MyySgO75J",       // 01_SKU主数据
    stockFlow: "tbl7aa7a0MaSsUSr",        // 02_库存流水
    salesDaily: "tbl65ySLOb7YOXN1",       // 07_销售日报
    customerService: "tbl3cCCTik5VVO7I",  // 08_客服售后异常
    replenishAdvice: "tbl1PtyuYfzXe2dt",  // 10_补货采购建议
    listingContent: "tblswYKzSskqXZ1V",   // 15_详情页内容库
    sourcingPool: "tblqnSLNGWFURtQq",      // 16_选品池
  },
};

// ---- 通用执行函数 ----
async function larkExec(command: string): Promise<{ ok: boolean; data: unknown; error?: string }> {
  try {
    const { stdout } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });
    const result = JSON.parse(stdout);
    return { ok: result.ok ?? true, data: result.data ?? result };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    if (err.stdout) {
      try {
        const parsed = JSON.parse(err.stdout);
        return { ok: false, data: parsed, error: parsed?.error?.message || "未知错误" };
      } catch {
        return { ok: false, data: null, error: err.stdout };
      }
    }
    return { ok: false, data: null, error: err.message || "执行失败" };
  }
}

// ---- 数据读取 ----

/** 获取 SKU 主数据列表（支持按店铺/状态筛选） */
export async function getSkuMasterData(filter?: {
  store?: string;
  status?: string;
}): Promise<Record<string, unknown>[]> {
  const tableId = LARK_CONFIG.tableIds.skuMaster;
  let cmd = `lark-cli base +record-list --base-token ${LARK_CONFIG.baseToken} --table-id ${tableId} --as user --limit 200`;

  const result = await larkExec(cmd);
  if (!result.ok || !result.data) {
    console.error("读取SKU主数据失败:", result.error);
    return [];
  }
  return (result.data as { records?: Record<string, unknown>[] })?.records || [];
}

/** 获取补货采购建议列表 */
export async function getReplenishAdvice(): Promise<Record<string, unknown>[]> {
  const tableId = LARK_CONFIG.tableIds.replenishAdvice;
  const cmd = `lark-cli base +record-list --base-token ${LARK_CONFIG.baseToken} --table-id ${tableId} --as user --limit 200`;

  const result = await larkExec(cmd);
  if (!result.ok || !result.data) {
    console.error("读取补货建议失败:", result.error);
    return [];
  }
  return (result.data as { records?: Record<string, unknown>[] })?.records || [];
}

/** 获取客服售后异常列表 */
export async function getCustomerServiceIssues(filter?: {
  issueType?: string;
}): Promise<Record<string, unknown>[]> {
  const tableId = LARK_CONFIG.tableIds.customerService;
  const cmd = `lark-cli base +record-list --base-token ${LARK_CONFIG.baseToken} --table-id ${tableId} --as user --limit 200`;

  const result = await larkExec(cmd);
  if (!result.ok || !result.data) {
    console.error("读取客服异常失败:", result.error);
    return [];
  }
  return (result.data as { records?: Record<string, unknown>[] })?.records || [];
}

// ---- 数据写入 ----

/** 新增详情页内容记录 */
export async function createListingContent(data: {
  sku: string;
  titleV1: string;
  titleV2: string;
  titleV3: string;
  descriptionHTML: string;
  itemSpecs: string;
}): Promise<string | null> {
  const tableId = LARK_CONFIG.tableIds.listingContent;
  const payload = JSON.stringify({
    records: [{
      fields: {
        SKU: data.sku,
        标题版本1: data.titleV1,
        标题版本2: data.titleV2,
        标题版本3: data.titleV3,
        描述HTML: data.descriptionHTML,
        ItemSpecs: data.itemSpecs,
        状态: "草稿",
      },
    }],
  });

  const cmd = `lark-cli base +record-batch-create --base-token ${LARK_CONFIG.baseToken} --table-id ${tableId} --json '${payload}' --as user`;
  const result = await larkExec(cmd);
  if (!result.ok) {
    console.error("写入详情页内容失败:", result.error);
    return null;
  }
  return "ok";
}

/** 新增选品池记录 */
export async function createSourcingRecord(data: {
  category: string;
  keywords: string;
  opportunityScore: number;
  estimatedProfitRate: number;
  estimatedCost: number;
  suggestedPrice: number;
  competitorLinks: string;
  aiSummary: string;
}): Promise<string | null> {
  const tableId = LARK_CONFIG.tableIds.sourcingPool;
  const payload = JSON.stringify({
    records: [{
      fields: {
        品类关键词: `${data.category} - ${data.keywords}`,
        机会评分: data.opportunityScore,
        预估利润率: data.estimatedProfitRate,
        预估采购价: data.estimatedCost,
        建议售价: data.suggestedPrice,
        竞品链接: data.competitorLinks,
        AI分析摘要: data.aiSummary,
        状态: "待评估",
      },
    }],
  });

  const cmd = `lark-cli base +record-batch-create --base-token ${LARK_CONFIG.baseToken} --table-id ${tableId} --json '${payload}' --as user`;
  const result = await larkExec(cmd);
  if (!result.ok) {
    console.error("写入选品池失败:", result.error);
    return null;
  }
  return "ok";
}

/** 更新补货采购建议 */
export async function updateReplenishAdvice(data: {
  sku: string;
  suggestedOrderQty: number;
  estimatedOutOfStockDate: string;
  priority: string;
  aiSummary: string;
}): Promise<boolean> {
  // 先搜索已有记录
  const tableId = LARK_CONFIG.tableIds.replenishAdvice;
  const searchCmd = `lark-cli base +record-search --base-token ${LARK_CONFIG.baseToken} --table-id ${tableId} --query "${data.sku}" --as user`;
  const searchResult = await larkExec(searchCmd);

  // TODO: 实现更新逻辑（根据 record_id 更新对应字段）
  console.log("补货建议更新:", data);
  return true;
}

// ---- 飞书消息推送 ----

/** 发送飞书消息到指定群聊 */
export async function sendFeishuMessage(params: {
  chatId: string;
  title: string;
  content: string;
}): Promise<boolean> {
  const payload = JSON.stringify({
    chat_id: params.chatId,
    msg_type: "interactive",
    content: JSON.stringify({
      header: {
        title: { tag: "plain_text", content: params.title },
        template: "red" as const,
      },
      elements: [
        { tag: "markdown", content: params.content },
      ],
    }),
  });

  // 通过 lark-cli im 发送
  const cmd = `lark-cli im +send --chat-id ${params.chatId} --json '${payload}' --as user`;
  const result = await larkExec(cmd);
  return result.ok;
}
