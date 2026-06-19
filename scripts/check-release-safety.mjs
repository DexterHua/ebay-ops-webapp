import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const expectedNetlifySiteId = process.env.EXPECTED_NETLIFY_SITE_ID?.trim();

const protectedTrackedFiles = new Set([
  ".env",
  ".env.local",
  "data/users.json",
  ".netlify/state.json",
]);

const requiredEmptyEnvKeys = [
  "JWT_SECRET",
  "AUTH_USERS",
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

const requiredSafeDefaults = {
  DEEPSEEK_MODEL: "deepseek-v4-pro",
  LARK_CLI_PATH: "lark-cli",
  LARK_MAX_READ_RECORDS: "5000",
  LARK_WRITE_ENABLED: "false",
};

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf-8" }).trim();
}

function parseEnvTemplate(content) {
  const values = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    values.set(line.slice(0, index), line.slice(index + 1));
  }
  return values;
}

const errors = [];
const warnings = [];
const notices = [];

const trackedFiles = runGit(["ls-files"]).split("\n").filter(Boolean);
for (const file of trackedFiles) {
  if (protectedTrackedFiles.has(file)) {
    errors.push(`敏感或本地运行态文件被 Git 跟踪：${file}`);
  }
}

const packageJson = JSON.parse(readFileSync("package.json", "utf-8"));
for (const [name, command] of Object.entries(packageJson.scripts || {})) {
  if (/\bnetlify\s+deploy\b/.test(command)) {
    errors.push(`package.json 脚本 ${name} 直接调用 netlify deploy，发布应改由 GitHub main 触发`);
  }
}

const env = parseEnvTemplate(readFileSync(".env.example", "utf-8"));
for (const key of requiredEmptyEnvKeys) {
  if (!env.has(key)) {
    errors.push(`.env.example 缺少 ${key} 空模板`);
  } else if ((env.get(key) || "").trim() !== "") {
    errors.push(`.env.example 中的 ${key} 必须保留为空模板`);
  }
}

for (const [key, expected] of Object.entries(requiredSafeDefaults)) {
  if (!env.has(key)) {
    errors.push(`.env.example 缺少 ${key} 安全默认值`);
  } else if ((env.get(key) || "").trim() !== expected) {
    errors.push(`.env.example 中的 ${key} 应为 ${expected}`);
  }
}

if (expectedNetlifySiteId && existsSync(".netlify/state.json")) {
  const state = JSON.parse(readFileSync(".netlify/state.json", "utf-8"));
  if (state.siteId && state.siteId !== expectedNetlifySiteId) {
    warnings.push(`.netlify/state.json 指向 ${state.siteId}；当前线上项目是 ${expectedNetlifySiteId}，本地 CLI relink 后再使用`);
  }
}

const branch = runGit(["branch", "--show-current"]);
if (branch === "main") {
  notices.push("当前分支 main 可用于生产发布检查");
} else if (branch === "develop") {
  warnings.push("当前分支 develop 应只用于开发；生产发布请合并到 main 后由 GitHub 触发 Netlify");
} else if (branch) {
  warnings.push(`当前分支 ${branch} 不是 main/develop；确认不会触发 Netlify 生产部署`);
}

for (const message of notices) console.log(`info: ${message}`);
for (const message of warnings) console.warn(`warn: ${message}`);
for (const message of errors) console.error(`error: ${message}`);

if (errors.length > 0) {
  console.error(`release safety check failed: ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}

console.log(`release safety check passed: ${warnings.length} warning(s)`);
