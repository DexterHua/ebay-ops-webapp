export interface ReleaseSafetyInput {
  currentBranch?: string;
  envExample: string;
  expectedNetlifySiteId?: string;
  netlifyStateSiteId?: string;
  packageScripts: Record<string, string>;
  trackedFiles: string[];
}

export interface ReleaseSafetyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  notices: string[];
}

const PROTECTED_TRACKED_FILES = new Set([
  ".env",
  ".env.local",
  "data/users.json",
  "data/profit-settings.json",
  ".netlify/state.json",
]);

const REQUIRED_EMPTY_ENV_KEYS = [
  "JWT_SECRET",
  "AUTH_USERS",
  "AUTH_USERS_JSON",
  "DEEPSEEK_API_KEY",
  "TAVILY_API_KEY",
  "LARK_APP_ID",
  "LARK_APP_SECRET",
  "LARK_BASE_TOKEN",
  "LARK_BASE_FINANCE",
  "LARK_EXTRA_PATH",
  "LARK_TABLE_SKU",
  "LARK_TABLE_SALES",
  "LARK_TABLE_STOCK_FLOW",
  "LARK_TABLE_ISSUES",
  "LARK_TABLE_COMPETITORS",
  "LARK_TABLE_REPLENISH",
  "LARK_TABLE_LISTING",
  "LARK_TABLE_SOURCING",
  "LARK_TABLE_FLOW",
  "LARK_TABLE_STOCK_STRATEGY",
  "LARK_TABLE_SKU_SUMMARY",
  "LARK_TABLE_PURCHASE_BATCH",
  "LARK_TABLE_SHIPMENT_BATCH",
  "LARK_TABLE_INVENTORY_DETAIL",
  "LARK_TABLE_INVENTORY_EXCEPTION",
  "LARK_TABLE_INVENTORY_TRANSACTION",
  "LARK_TABLE_INVENTORY_WARNING",
  "LARK_TABLE_FINANCE",
  "INVENTORY_SALES_SCAN_SECRET",
  "LARK_INVENTORY_ALERT_CHAT_ID",
];

const REQUIRED_SAFE_DEFAULTS: Record<string, string> = {
  DEEPSEEK_MODEL: "deepseek-v4-pro",
  LARK_CLI_PATH: "lark-cli",
  LARK_MAX_READ_RECORDS: "5000",
  LARK_WRITE_ENABLED: "false",
};

function parseEnvTemplate(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    values.set(line.slice(0, index), line.slice(index + 1));
  }
  return values;
}

export function analyzeReleaseSafety(input: ReleaseSafetyInput): ReleaseSafetyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const notices: string[] = [];

  for (const file of input.trackedFiles) {
    if (PROTECTED_TRACKED_FILES.has(file)) {
      errors.push(`敏感或本地运行态文件被 Git 跟踪：${file}`);
    }
  }

  for (const [name, command] of Object.entries(input.packageScripts)) {
    if (/\bnetlify\s+deploy\b/.test(command)) {
      errors.push(`package.json 脚本 ${name} 直接调用 netlify deploy，发布应改由 GitHub main 触发`);
    }
  }

  const env = parseEnvTemplate(input.envExample);
  for (const key of REQUIRED_EMPTY_ENV_KEYS) {
    if (!env.has(key)) {
      errors.push(`.env.example 缺少 ${key} 空模板`);
      continue;
    }
    if ((env.get(key) || "").trim() !== "") {
      errors.push(`.env.example 中的 ${key} 必须保留为空模板`);
    }
  }

  for (const [key, expected] of Object.entries(REQUIRED_SAFE_DEFAULTS)) {
    if (!env.has(key)) {
      errors.push(`.env.example 缺少 ${key} 安全默认值`);
      continue;
    }
    if ((env.get(key) || "").trim() !== expected) {
      errors.push(`.env.example 中的 ${key} 应为 ${expected}`);
    }
  }

  if (input.expectedNetlifySiteId && input.netlifyStateSiteId && input.expectedNetlifySiteId !== input.netlifyStateSiteId) {
    warnings.push(`.netlify/state.json 指向 ${input.netlifyStateSiteId}；当前线上项目是 ${input.expectedNetlifySiteId}，本地 CLI relink 后再使用`);
  }

  if (input.currentBranch === "main") {
    notices.push("当前分支 main 可用于生产发布检查");
  } else if (input.currentBranch === "develop") {
    warnings.push("当前分支 develop 应只用于开发；生产发布请合并到 main 后由 GitHub 触发 Netlify");
  } else if (input.currentBranch) {
    warnings.push(`当前分支 ${input.currentBranch} 不是 main/develop；确认不会触发 Netlify 生产部署`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    notices,
  };
}
