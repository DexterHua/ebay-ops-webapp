import { execFile } from "child_process";
import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, dirname, isAbsolute, join, relative } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const SENSITIVE_ARG_FLAGS = ["--base-token", "--app-secret", "--access-token", "--refresh-token"];

const TABLE_ENV_KEYS = {
  sku: "LARK_TABLE_SKU",
  sales: "LARK_TABLE_SALES",
  stockFlow: "LARK_TABLE_STOCK_FLOW",
  issues: "LARK_TABLE_ISSUES",
  competitors: "LARK_TABLE_COMPETITORS",
  replenish: "LARK_TABLE_REPLENISH",
  listing: "LARK_TABLE_LISTING",
  sourcing: "LARK_TABLE_SOURCING",
  flow: "LARK_TABLE_FLOW",
  strategy: "LARK_TABLE_STOCK_STRATEGY",
  summary: "LARK_TABLE_SKU_SUMMARY",
  purchaseBatch: "LARK_TABLE_PURCHASE_BATCH",
  shipmentBatch: "LARK_TABLE_SHIPMENT_BATCH",
  inventoryDetail: "LARK_TABLE_INVENTORY_DETAIL",
  inventoryException: "LARK_TABLE_INVENTORY_EXCEPTION",
} as const;

export type LarkTable = keyof typeof TABLE_ENV_KEYS;
export interface LarkRecord {
  recordId: string;
  fields: Record<string, unknown>;
}

let tenantTokenCache: { token: string; expiresAt: number } | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}

/** 默认关闭所有飞书写入，避免开发和排查过程中误改业务数据。 */
export function assertLarkWriteEnabled(): void {
  if (process.env.LARK_WRITE_ENABLED !== "true") {
    throw new Error("飞书写入已关闭；确认允许写入后请设置 LARK_WRITE_ENABLED=true");
  }
}

export function getLarkBaseToken(): string {
  return getRequiredEnv("LARK_BASE_TOKEN");
}

export function getLarkTableId(table: LarkTable): string {
  return getRequiredEnv(TABLE_ENV_KEYS[table]);
}

export function getLarkReadLimit(): number {
  const parsed = Number.parseInt(process.env.LARK_MAX_READ_RECORDS || "5000", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
}

function hasLarkOpenApiCredentials(): boolean {
  return Boolean(process.env.LARK_APP_ID?.trim() && process.env.LARK_APP_SECRET?.trim());
}

async function getTenantAccessToken(): Promise<string> {
  if (tenantTokenCache && tenantTokenCache.expiresAt > Date.now()) return tenantTokenCache.token;

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: getRequiredEnv("LARK_APP_ID"),
      app_secret: getRequiredEnv("LARK_APP_SECRET"),
    }),
  });
  const result = await response.json() as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };
  if (!response.ok || result.code !== 0 || !result.tenant_access_token) {
    throw new Error(`飞书应用认证失败：${result.msg || response.statusText}`);
  }

  tenantTokenCache = {
    token: result.tenant_access_token,
    expiresAt: Date.now() + Math.max((result.expire || 7200) - 60, 60) * 1000,
  };
  return tenantTokenCache.token;
}

async function larkOpenApi<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`https://open.feishu.cn${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${await getTenantAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const result = await response.json() as { code?: number; msg?: string; data?: T };
  if (!response.ok || result.code !== 0) {
    throw new Error(`飞书 API 调用失败（${result.code ?? response.status}）：${result.msg || response.statusText}`);
  }
  return result.data as T;
}

function sanitizeLarkError(error: unknown): Error {
  const output = error as { stderr?: unknown; stdout?: unknown };
  for (const candidate of [output.stderr, output.stdout]) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      const result = JSON.parse(candidate) as { error?: { message?: string; hint?: string } };
      const message = result.error?.message;
      if (message) {
        return new Error(result.error?.hint ? `${message}：${result.error.hint}` : message);
      }
    } catch {
      // 非 JSON 错误继续走通用脱敏逻辑。
    }
  }

  let message = error instanceof Error ? error.message : String(error);
  for (const flag of SENSITIVE_ARG_FLAGS) {
    message = message.replace(new RegExp(`(${flag}\\s+)\\S+`, "g"), "$1[已隐藏]");
  }
  return new Error(message);
}

/** 使用参数数组调用 lark-cli，避免用户输入参与 shell 解析。 */
async function runLarkCli(
  args: string[],
  options: { cwd?: string; maxBuffer?: number } = {},
) {
  const extraPath = process.env.LARK_EXTRA_PATH?.trim();
  const path = [process.env.PATH, extraPath].filter(Boolean).join(delimiter);
  const jsonFiles = args
    .filter((arg) => arg.startsWith("@") && isAbsolute(arg.slice(1)))
    .map((arg) => arg.slice(1));
  const cwd = options.cwd || (jsonFiles.length > 0 ? dirname(jsonFiles[0]) : undefined);
  const normalizedArgs = cwd
    ? args.map((arg) => {
        if (!arg.startsWith("@") || !isAbsolute(arg.slice(1))) return arg;

        const filename = relative(cwd, arg.slice(1));
        if (filename.startsWith("..") || isAbsolute(filename)) {
          throw new Error("飞书 JSON 文件必须位于命令执行目录内");
        }
        return `@./${filename}`;
      })
    : args;

  try {
    return await execFileAsync(process.env.LARK_CLI_PATH?.trim() || "lark-cli", normalizedArgs, {
      cwd,
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
      env: { ...process.env, PATH: path },
    });
  } catch (error) {
    throw sanitizeLarkError(error);
  }
}

function withTmpJson(prefix: string, payload: unknown): { filename: string; remove: () => void } {
  const filename = join(tmpdir(), `_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(filename, JSON.stringify(payload), { encoding: "utf-8", mode: 0o600, flag: "wx" });
  return {
    filename,
    remove: () => {
      try { unlinkSync(filename); } catch { /* 文件可能已被清理。 */ }
    },
  };
}

async function getLocalFieldMap(baseToken: string, tableId: string): Promise<Record<string, string>> {
  const { stdout } = await runLarkCli([
    "base", "+field-list", "--base-token", baseToken, "--table-id", tableId, "--as", "user",
  ]);
  const raw = JSON.parse(stdout) as { data?: { fields?: Array<{ id: string; name: string }> } };
  return Object.fromEntries((raw.data?.fields || []).map((field) => [field.id, field.name]));
}

/** 读取多维表格记录。Workers 使用 OpenAPI，本地使用 lark-cli。 */
export async function listLarkRecords(table: LarkTable, maxRecords = getLarkReadLimit()): Promise<{
  records: LarkRecord[];
  hasMore: boolean;
}> {
  if (!Number.isInteger(maxRecords) || maxRecords <= 0) throw new Error("maxRecords 必须为正数");
  const baseToken = getLarkBaseToken();
  const tableId = getLarkTableId(table);
  const records: LarkRecord[] = [];

  if (hasLarkOpenApiCredentials()) {
    let pageToken = "";
    let hasMore = false;
    do {
      const params = new URLSearchParams({ page_size: String(Math.min(500, maxRecords - records.length || 1)) });
      if (pageToken) params.set("page_token", pageToken);
      const data = await larkOpenApi<{
        items?: Array<{ record_id: string; fields: Record<string, unknown> }>;
        has_more?: boolean;
        page_token?: string;
      }>(`/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records?${params}`);
      records.push(...(data.items || []).map((item) => ({ recordId: item.record_id, fields: item.fields })));
      hasMore = (data.has_more || false) || records.length > maxRecords;
      pageToken = data.page_token || "";
    } while (hasMore && pageToken && records.length < maxRecords);
    return { records: records.slice(0, maxRecords), hasMore };
  }

  const fieldMap = await getLocalFieldMap(baseToken, tableId);
  let offset = 0;
  let hasMore = false;
  do {
    const { stdout } = await runLarkCli([
      "base", "+record-list",
      "--base-token", baseToken,
      "--table-id", tableId,
      "--offset", String(offset),
      "--limit", String(Math.min(200, maxRecords - records.length)),
      "--format", "json",
      "--as", "user",
    ]);
    const raw = JSON.parse(stdout) as {
      data?: {
        data?: unknown[][];
        field_id_list?: string[];
        record_id_list?: string[];
        has_more?: boolean;
      };
    };
    const rows = raw.data?.data || [];
    const fieldIds = raw.data?.field_id_list || [];
    const recordIds = raw.data?.record_id_list || [];
    rows.forEach((row, index) => {
      records.push({
        recordId: recordIds[index],
        fields: Object.fromEntries(fieldIds.map((fieldId, fieldIndex) => [fieldMap[fieldId] || fieldId, row[fieldIndex]])),
      });
    });
    hasMore = (raw.data?.has_more || false) || records.length > maxRecords;
    offset += rows.length;
    if (hasMore && rows.length === 0) throw new Error("飞书分页返回空页，已停止读取");
  } while (hasMore && records.length < maxRecords);
  return { records: records.slice(0, maxRecords), hasMore };
}

/** 新增多维表格记录。 */
export async function createLarkRecords(table: LarkTable, records: Array<Record<string, unknown>>): Promise<string[]> {
  if (records.length === 0) return [];
  assertLarkWriteEnabled();
  const baseToken = getLarkBaseToken();
  const tableId = getLarkTableId(table);

  if (hasLarkOpenApiCredentials()) {
    const data = await larkOpenApi<{ records?: Array<{ record_id: string }> }>(
      `/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records/batch_create`,
      { method: "POST", body: { records: records.map((fields) => ({ fields })) } },
    );
    return (data.records || []).map((record) => record.record_id);
  }

  const fields = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const temp = withTmpJson("lark_create", {
    fields,
    rows: records.map((record) => fields.map((field) => record[field] ?? null)),
  });
  try {
    const { stdout } = await runLarkCli([
      "base", "+record-batch-create",
      "--base-token", baseToken,
      "--table-id", tableId,
      "--json", `@${temp.filename}`,
      "--as", "user",
    ]);
    const result = JSON.parse(stdout) as { ok?: boolean; data?: { record_id_list?: string[] }; error?: { message?: string } };
    if (!result.ok) throw new Error(result.error?.message || "飞书写入失败");
    return result.data?.record_id_list || [];
  } finally {
    temp.remove();
  }
}

/** 更新一条多维表格记录。 */
export async function updateLarkRecord(table: LarkTable, recordId: string, fields: Record<string, unknown>): Promise<void> {
  assertLarkWriteEnabled();
  const baseToken = getLarkBaseToken();
  const tableId = getLarkTableId(table);
  if (hasLarkOpenApiCredentials()) {
    await larkOpenApi(
      `/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records/${recordId}`,
      { method: "PUT", body: { fields } },
    );
    return;
  }

  const temp = withTmpJson("lark_update", fields);
  try {
    const { stdout } = await runLarkCli([
      "base", "+record-upsert",
      "--base-token", baseToken,
      "--table-id", tableId,
      "--record-id", recordId,
      "--json", `@${temp.filename}`,
      "--as", "user",
    ]);
    const result = JSON.parse(stdout) as { ok?: boolean; error?: { message?: string } };
    if (!result.ok) throw new Error(result.error?.message || "飞书更新失败");
  } finally {
    temp.remove();
  }
}

/** 按顺序更新多条多维表格记录。 */
export async function updateLarkRecords(
  table: LarkTable,
  updates: Array<{ recordId: string; fields: Record<string, unknown> }>,
): Promise<void> {
  for (const [completedCount, update] of updates.entries()) {
    try {
      await updateLarkRecord(table, update.recordId, update.fields);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`更新飞书记录 ${update.recordId} 失败（已完成 ${completedCount} 条）：${message}`);
    }
  }
}

function toLarkText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(toLarkText).filter(Boolean).join(",");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return toLarkText(record.value ?? record.text ?? "");
  }
  return value == null ? "" : String(value);
}

export function readLarkText(value: unknown): string {
  return toLarkText(value);
}

/** 在完整读取结果中按文本字段查找唯一记录。 */
export function findUniqueLarkRecordByText(
  result: { records: LarkRecord[]; hasMore: boolean },
  field: string,
  value: string,
): LarkRecord | undefined {
  if (result.hasMore) throw new Error("飞书记录未完整读取，无法执行唯一文本查找");
  const matches = result.records.filter((record) => toLarkText(record.fields[field]) === value);
  if (matches.length > 1) throw new Error(`字段“${field}”的值“${value}”匹配到多条飞书记录`);
  return matches[0];
}

/** 按文本字段查找唯一多维表格记录。 */
export async function findLarkRecordByText(
  table: LarkTable,
  field: string,
  value: string,
): Promise<LarkRecord | undefined> {
  return findUniqueLarkRecordByText(await listLarkRecords(table), field, value);
}

/** 从完整汇总读取结果中按 SKU 选择唯一记录。 */
export function findUniqueSummaryRecordBySku(
  result: { records: LarkRecord[]; hasMore: boolean },
  sku: string,
): LarkRecord | undefined {
  return findUniqueLarkRecordByText(result, "SKU", sku);
}

async function getSummaryRecordBySku(sku: string): Promise<LarkRecord | undefined> {
  return findUniqueSummaryRecordBySku(await listLarkRecords("summary"), sku);
}

type StockSummaryField = "本地库存" | "国内集货仓" | "橙联在途" | "橙联可售" | "异常暂存";

const SUMMARY_FIELD_BY_STOCK_LOCATION: Record<string, StockSummaryField> = {
  本地仓: "本地库存",
  本地库存: "本地库存",
  国内集货仓: "国内集货仓",
  橙联在途: "橙联在途",
  橙联可售: "橙联可售",
  异常暂存: "异常暂存",
};

function getStockSummaryField(location: string): StockSummaryField {
  const field = SUMMARY_FIELD_BY_STOCK_LOCATION[location];
  if (!field) throw new Error(`未知库存位置：${location}`);
  return field;
}

function toStrictLarkNumber(value: unknown, label: string, allowMissing = false): number {
  if (allowMissing && value === undefined) return 0;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return toStrictLarkNumber(record.value ?? record.text ?? record.number, label);
  }
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.replace(/,/g, ""))
      : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`${label}必须是有限数`);
  return parsed;
}

function getStrictStockDelta(value: unknown): number {
  const delta = toStrictLarkNumber(value, "数量变动");
  if (delta === 0) throw new Error("数量变动不能为 0");
  return delta;
}

function getStrictStockValue(fields: Record<string, unknown>, field: StockSummaryField): number {
  const value = toStrictLarkNumber(fields[field], field, true);
  if (value < 0) throw new Error(`${field}不能为负数`);
  return value;
}

/** 校验零散库存流水同步所需字段。 */
export function parseStockSummaryFlow(fields: Record<string, unknown>): {
  sku: string;
  location: string;
  delta: number;
} | undefined {
  const sku = toLarkText(fields.SKU).trim();
  const location = toLarkText(fields.库存位置).trim();
  if (!sku || !location) return undefined;
  getStockSummaryField(location);
  return { sku, location, delta: getStrictStockDelta(fields.数量变动) };
}

/** 计算零散库存流水对应的运营汇总 patch。 */
export function calculateStockSummaryPatch(
  fields: Record<string, unknown>,
  location: string,
  delta: number,
  sku = "",
): Record<string, number> {
  const summaryField = getStockSummaryField(location);
  const normalizedDelta = getStrictStockDelta(delta);
  const nextFields: Record<StockSummaryField, number> = {
    本地库存: getStrictStockValue(fields, "本地库存"),
    国内集货仓: getStrictStockValue(fields, "国内集货仓"),
    橙联在途: getStrictStockValue(fields, "橙联在途"),
    橙联可售: getStrictStockValue(fields, "橙联可售"),
    异常暂存: getStrictStockValue(fields, "异常暂存"),
  };
  const nextValue = nextFields[summaryField] + normalizedDelta;
  if (nextValue < 0) throw new Error(`${sku ? `${sku} 的` : ""}${summaryField}库存不足，流水已保存但汇总未更新`);
  nextFields[summaryField] = nextValue;
  const totalAvailable = nextFields.本地库存
    + nextFields.国内集货仓
    + nextFields.橙联在途
    + nextFields.橙联可售;

  return {
    [summaryField]: nextValue,
    总可用库存: totalAvailable,
    账面总量: totalAvailable + nextFields.异常暂存,
  };
}

/** 库存流水落库后同步更新 SKU 运营汇总，汇总表不允许人工维护库存。 */
export async function syncStockSummaryFromFlow(fields: Record<string, unknown>): Promise<void> {
  const flow = parseStockSummaryFlow(fields);
  if (!flow) return;

  const summary = await getSummaryRecordBySku(flow.sku);
  if (!summary) throw new Error(`未找到 SKU ${flow.sku} 的运营汇总记录`);
  const patch = calculateStockSummaryPatch(summary.fields, flow.location, flow.delta, flow.sku);
  await updateLarkRecord("summary", summary.recordId, {
    ...patch,
    快照日期: Date.now(),
  });
}

/** 从完整销售记录中计算累计销量和近 7 日日均销量。 */
export function calculateSalesSummaryPatch(
  result: { records: LarkRecord[]; hasMore: boolean },
  sku: string,
  now = Date.now(),
): Record<string, number> {
	  if (result.hasMore) throw new Error("销售记录未完整读取，无法覆盖累计销量");
	  const skuSales = result.records.filter((record) => toLarkText(record.fields.SKU) === sku);
	  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
	  const cumulativeSales = skuSales.reduce((sum, record) => (
	    sum + toStrictLarkNumber(record.fields.售出数量, "售出数量")
	  ), 0);
	  const recentSales = skuSales
	    .filter((record) => toStrictLarkNumber(record.fields.日期, "日期") >= sevenDaysAgo)
	    .reduce((sum, record) => sum + toStrictLarkNumber(record.fields.售出数量, "售出数量"), 0);
  return {
    累计销量: cumulativeSales,
    近7日日均销量: recentSales / 7,
  };
}

/** 销售日报落库后同步刷新累计销量和近 7 日日均销量。 */
export async function syncSalesSummary(sku: string): Promise<void> {
  const summary = await getSummaryRecordBySku(sku);
  if (!summary) throw new Error(`未找到 SKU ${sku} 的运营汇总记录`);

  await updateLarkRecord("summary", summary.recordId, {
    ...calculateSalesSummaryPatch(await listLarkRecords("sales"), sku),
    快照日期: Date.now(),
  });
}

/** 发送群消息。 */
export async function sendLarkMarkdownMessage(chatId: string, text: string): Promise<string | undefined> {
  assertLarkWriteEnabled();
  if (hasLarkOpenApiCredentials()) {
    const data = await larkOpenApi<{ message_id?: string }>(
      "/open-apis/im/v1/messages?receive_id_type=chat_id",
      { method: "POST", body: { receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) } },
    );
    return data.message_id;
  }

  const { stdout } = await runLarkCli([
    "im", "+messages-send", "--chat-id", chatId, "--markdown", text, "--as", "user",
  ]);
  const result = JSON.parse(stdout) as { ok?: boolean; data?: { message_id?: string }; error?: { message?: string } };
  if (result.ok === false) throw new Error(result.error?.message || "飞书消息发送失败");
  return result.data?.message_id;
}

/** 将姓名、邮箱或 open_id 解析为飞书人员字段需要的引用格式。 */
export async function resolveLarkUserReference(query: string): Promise<Array<{ id: string }>> {
  const normalized = query.trim();
  if (!normalized) return [];
  if (/^ou_[A-Za-z0-9_-]+$/.test(normalized)) return [{ id: normalized }];
  if (hasLarkOpenApiCredentials()) {
    throw new Error("线上环境填写负责人时请使用飞书 open_id；也可以暂时留空");
  }

  const { stdout } = await runLarkCli([
    "contact", "+search-user",
    "--query", normalized,
    "--page-size", "30",
    "--format", "json",
    "--as", "user",
  ]);
  const result = JSON.parse(stdout) as {
    data?: {
      users?: Array<{
        open_id?: string;
        localized_name?: string;
        email?: string;
        enterprise_email?: string;
      }>;
    };
  };
  const users = result.data?.users || [];
  const exactMatches = users.filter((user) =>
    [user.localized_name, user.email, user.enterprise_email].includes(normalized),
  );

  if (exactMatches.length === 1 && exactMatches[0].open_id) {
    return [{ id: exactMatches[0].open_id }];
  }
  if (exactMatches.length > 1) {
    throw new Error(`负责人“${normalized}”匹配到多位飞书用户，请改用邮箱或 open_id`);
  }
  throw new Error(`未找到负责人“${normalized}”，请填写飞书中的完整姓名、邮箱或 open_id`);
}
