import { describe, expect, it } from "vitest";
import { analyzeReleaseSafety } from "./release-safety";

const COMPLETE_ENV_EXAMPLE = [
  "JWT_SECRET=",
  "AUTH_USERS=",
  "AUTH_USERS_JSON=",
  "DEEPSEEK_API_KEY=",
  "DEEPSEEK_MODEL=deepseek-v4-pro",
  "TAVILY_API_KEY=",
  "LARK_APP_ID=",
  "LARK_APP_SECRET=",
  "LARK_BASE_TOKEN=",
  "LARK_BASE_FINANCE=",
  "LARK_CLI_PATH=lark-cli",
  "LARK_EXTRA_PATH=",
  "LARK_MAX_READ_RECORDS=5000",
  "LARK_WRITE_ENABLED=false",
  "LARK_TABLE_SKU=",
  "LARK_TABLE_SALES=",
  "LARK_TABLE_STOCK_FLOW=",
  "LARK_TABLE_ISSUES=",
  "LARK_TABLE_COMPETITORS=",
  "LARK_TABLE_REPLENISH=",
  "LARK_TABLE_LISTING=",
  "LARK_TABLE_SOURCING=",
  "LARK_TABLE_FLOW=",
  "LARK_TABLE_STOCK_STRATEGY=",
  "LARK_TABLE_SKU_SUMMARY=",
  "LARK_TABLE_PURCHASE_BATCH=",
  "LARK_TABLE_SHIPMENT_BATCH=",
  "LARK_TABLE_INVENTORY_DETAIL=",
  "LARK_TABLE_INVENTORY_EXCEPTION=",
  "LARK_TABLE_INVENTORY_TRANSACTION=",
  "LARK_TABLE_INVENTORY_WARNING=",
  "LARK_TABLE_MONTHLY_EXCHANGE_RATE=",
  "LARK_TABLE_OPERATING_DAY_SUMMARY=",
  "LARK_TABLE_OPERATING_PERIOD_SUMMARY=",
  "LARK_TABLE_SKU_PERIOD_SUMMARY=",
  "LARK_TABLE_PROFIT_BREAKDOWN=",
  "LARK_TABLE_FINANCE=",
  "LARK_TABLE_SKU_CHANGE_REQUESTS=",
  "INVENTORY_SALES_SCAN_SECRET=",
  "LARK_INVENTORY_ALERT_CHAT_ID=",
  "OPERATIONS_DASHBOARD_REBUILD_SECRET=",
].join("\n");

describe("analyzeReleaseSafety", () => {
  it("blocks release when local runtime or secret files are tracked", () => {
    const result = analyzeReleaseSafety({
      envExample: COMPLETE_ENV_EXAMPLE,
      packageScripts: {},
      trackedFiles: [".env.local", "data/users.json", "data/profit-settings.json", ".netlify/state.json"],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("敏感或本地运行态文件被 Git 跟踪：.env.local");
    expect(result.errors).toContain("敏感或本地运行态文件被 Git 跟踪：data/users.json");
    expect(result.errors).toContain("敏感或本地运行态文件被 Git 跟踪：data/profit-settings.json");
    expect(result.errors).toContain("敏感或本地运行态文件被 Git 跟踪：.netlify/state.json");
  });

  it("blocks package scripts that directly deploy to Netlify", () => {
    const result = analyzeReleaseSafety({
      envExample: COMPLETE_ENV_EXAMPLE,
      packageScripts: {
        "deploy:netlify": "netlify deploy --prod",
      },
      trackedFiles: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("package.json 脚本 deploy:netlify 直接调用 netlify deploy，发布应改由 GitHub main 触发");
  });

  it("requires sensitive environment templates to exist and stay empty", () => {
    const result = analyzeReleaseSafety({
      envExample: COMPLETE_ENV_EXAMPLE.replace("LARK_APP_SECRET=", "LARK_APP_SECRET=real-secret"),
      packageScripts: {},
      trackedFiles: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(".env.example 中的 LARK_APP_SECRET 必须保留为空模板");
  });

  it("requires the hashed user seed template to stay empty", () => {
    const result = analyzeReleaseSafety({
      envExample: COMPLETE_ENV_EXAMPLE.replace("AUTH_USERS_JSON=", "AUTH_USERS_JSON=[real-users]"),
      packageScripts: {},
      trackedFiles: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(".env.example 中的 AUTH_USERS_JSON 必须保留为空模板");
  });

  it("warns instead of blocking when local Netlify link points to another site", () => {
    const result = analyzeReleaseSafety({
      envExample: COMPLETE_ENV_EXAMPLE,
      expectedNetlifySiteId: "current-site-id",
      netlifyStateSiteId: "old-site-id",
      packageScripts: {},
      trackedFiles: [],
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain(".netlify/state.json 指向 old-site-id；当前线上项目是 current-site-id，本地 CLI relink 后再使用");
  });

  it("accepts a safe repository release baseline", () => {
    const result = analyzeReleaseSafety({
      currentBranch: "main",
      envExample: COMPLETE_ENV_EXAMPLE,
      expectedNetlifySiteId: "current-site-id",
      netlifyStateSiteId: "current-site-id",
      packageScripts: {
        test: "vitest run",
        build: "next build",
      },
      trackedFiles: ["src/lib/users.ts", "netlify.toml"],
    });

    expect(result).toEqual({
      ok: true,
      errors: [],
      warnings: [],
      notices: ["当前分支 main 可用于生产发布检查"],
    });
  });
});
