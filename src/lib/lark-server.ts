import { execFile } from "child_process";
import { delimiter, dirname, isAbsolute, relative } from "path";
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
} as const;

export type LarkTable = keyof typeof TABLE_ENV_KEYS;

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
export async function runLarkCli(
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

/** 将姓名、邮箱或 open_id 解析为飞书人员字段需要的引用格式。 */
export async function resolveLarkUserReference(query: string): Promise<Array<{ id: string }>> {
  const normalized = query.trim();
  if (!normalized) return [];
  if (/^ou_[A-Za-z0-9_-]+$/.test(normalized)) return [{ id: normalized }];

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
