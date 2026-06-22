# Main SKU Owner Write Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production SKU saves derive the owner from the authenticated server session and continue saving with a warning when no valid Feishu `open_id` mapping exists.

**Architecture:** Keep SKU business fields in the existing client payload helper, but move ownership to the server boundary. A new pure helper reads the optional `LARK_USER_OPEN_IDS` JSON mapping; the save route ignores client owner data, requires a valid session, writes a Feishu user reference when configured, and otherwise omits the owner without failing the SKU record.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Vitest, Netlify environment variables, Feishu Base OpenAPI.

---

## File Structure

- Create `src/lib/lark-user-map.ts`: parse and validate the optional login-name to Feishu `open_id` mapping.
- Create `src/lib/lark-user-map.test.ts`: pure unit coverage for valid, missing, malformed, and invalid mappings.
- Modify `src/app/(main)/api/lark/save-record/route.ts`: establish session-owned SKU responsibility and non-blocking fallback.
- Modify `src/app/(main)/api/lark/save-record/route.test.ts`: route regression coverage for mapped owner, missing mapping, and invalid session.
- Modify `src/lib/data-entry-sku.ts`: stop constructing client-controlled responsibility data.
- Modify `src/lib/data-entry-sku.test.ts`: enforce the server-owned responsibility boundary.
- Modify `src/app/(main)/data-entry/page.tsx`: remove the redundant client session fetch from SKU submission.
- Modify `.env.example` and `docs/deployment-reform.md`: document `LARK_USER_OPEN_IDS` without storing real IDs.

### Task 1: Add the Feishu user mapping boundary

**Files:**
- Create: `src/lib/lark-user-map.ts`
- Test: `src/lib/lark-user-map.test.ts`

- [ ] **Step 1: Write the failing mapping tests**

```ts
import { describe, expect, it } from "vitest";
import { configuredLarkUserReference } from "./lark-user-map";

describe("configured Feishu user references", () => {
  it("maps the trimmed session name to a validated open_id", () => {
    expect(configuredLarkUserReference(" 车泉 ", '{"车泉":" ou_owner_123 "}')).toEqual([
      { id: "ou_owner_123" },
    ]);
  });

  it.each([undefined, "", "not-json", "[]", '{"车泉":"invalid"}'])(
    "returns undefined for unavailable or invalid mapping %s",
    (raw) => {
      expect(configuredLarkUserReference("车泉", raw)).toBeUndefined();
    },
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/lib/lark-user-map.test.ts`

Expected: FAIL because `src/lib/lark-user-map.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure mapping helper**

```ts
const OPEN_ID_PATTERN = /^ou_[A-Za-z0-9_-]+$/;

export function configuredLarkUserReference(
  sessionName: string,
  rawMapping: string | undefined = process.env.LARK_USER_OPEN_IDS,
): Array<{ id: string }> | undefined {
  const normalizedName = sessionName.trim();
  if (!normalizedName || !rawMapping?.trim()) return undefined;

  try {
    const parsed: unknown = JSON.parse(rawMapping);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const value = (parsed as Record<string, unknown>)[normalizedName];
    if (typeof value !== "string") return undefined;
    const openId = value.trim();
    return OPEN_ID_PATTERN.test(openId) ? [{ id: openId }] : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- src/lib/lark-user-map.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the helper**

```bash
git add src/lib/lark-user-map.ts src/lib/lark-user-map.test.ts
git commit -m "feat: resolve configured Feishu user IDs"
```

### Task 2: Make SKU ownership server-controlled and non-blocking

**Files:**
- Modify: `src/app/(main)/api/lark/save-record/route.test.ts:1-72`
- Modify: `src/app/(main)/api/lark/save-record/route.ts:5-104`

- [ ] **Step 1: Add failing route tests**

Add a hoisted session mock and module mock:

```ts
const session = vi.hoisted(() => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/session-server", () => ({
  requireSession: session.requireSession,
}));
```

Reset it with the existing mocks:

```ts
beforeEach(() => {
  session.requireSession.mockReset();
  session.requireSession.mockResolvedValue({
    name: "车泉",
    isAdmin: true,
    role: "admin",
    sessionVersion: 0,
  });
});
```

Add these SKU cases:

```ts
describe("save-record SKU ownership", () => {
  it("ignores a client owner and writes the authenticated user's configured open_id", async () => {
    vi.stubEnv("LARK_USER_OPEN_IDS", '{"车泉":"ou_owner_123"}');

    const response = await POST(request({
      table: "skuMaster",
      fields: { SKU: "SKU-1", 中文品名: "方向游丝", 负责人: "客户端伪造" },
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.warning).toBeUndefined();
    expect(lark.createLarkRecords).toHaveBeenCalledWith("sku", [{
      SKU: "SKU-1",
      中文品名: "方向游丝",
      负责人: [{ id: "ou_owner_123" }],
    }]);
  });

  it("saves without owner and warns when the session user has no valid mapping", async () => {
    vi.stubEnv("LARK_USER_OPEN_IDS", "");

    const response = await POST(request({
      table: "skuMaster",
      fields: { SKU: "SKU-2", 中文品名: "点火线圈", 负责人: "客户端伪造" },
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.warning).toContain("负责人未写入");
    expect(lark.createLarkRecords).toHaveBeenCalledWith("sku", [{
      SKU: "SKU-2",
      中文品名: "点火线圈",
    }]);
  });

  it("rejects an invalid session before writing the SKU", async () => {
    session.requireSession.mockRejectedValue(new Error("登录状态已失效"));

    const response = await POST(request({
      table: "skuMaster",
      fields: { SKU: "SKU-3", 中文品名: "水泵" },
    }));

    expect(response.status).toBe(500);
    expect(lark.createLarkRecords).not.toHaveBeenCalled();
  });
});
```

Import `afterEach` and restore environment stubs:

```ts
afterEach(() => {
  vi.unstubAllEnvs();
});
```

- [ ] **Step 2: Run the route tests and verify RED**

Run: `npm test -- 'src/app/(main)/api/lark/save-record/route.test.ts'`

Expected: mapped-owner and fallback tests FAIL because the route still resolves the client-provided name through `resolveLarkUserReference` and does not require the session.

- [ ] **Step 3: Implement server-controlled ownership**

Replace the old resolver import with:

```ts
import { configuredLarkUserReference } from "@/lib/lark-user-map";
import { requireSession } from "@/lib/session-server";
```

Replace the SKU normalization branch and initialize the warning before record creation:

```ts
let warning: string | undefined;
if (table === "skuMaster") {
  delete normalizedFields.负责人;
  const session = await requireSession();
  const ownerReference = configuredLarkUserReference(session.name);
  if (ownerReference) {
    normalizedFields.负责人 = ownerReference;
  } else {
    warning = "SKU 已保存，但当前账号未配置飞书 open_id，负责人未写入";
  }
}
```

Keep `createLarkRecords` unchanged. In the existing summary-sync catch, preserve an earlier warning:

```ts
const summaryWarning = `业务记录已保存，但运营汇总同步失败：${(error as Error).message}`;
warning = warning ? `${warning}；${summaryWarning}` : summaryWarning;
console.error("[lark] 汇总同步失败:", summaryWarning);
```

- [ ] **Step 4: Run the route tests and verify GREEN**

Run: `npm test -- 'src/app/(main)/api/lark/save-record/route.test.ts'`

Expected: PASS.

- [ ] **Step 5: Commit the route boundary**

```bash
git add 'src/app/(main)/api/lark/save-record/route.ts' 'src/app/(main)/api/lark/save-record/route.test.ts'
git commit -m "fix: make SKU owner writes non-blocking"
```

### Task 3: Remove client-owned responsibility data

**Files:**
- Modify: `src/lib/data-entry-sku.test.ts:4-30`
- Modify: `src/lib/data-entry-sku.ts:35-45`
- Modify: `src/app/(main)/data-entry/page.tsx:91-116`

- [ ] **Step 1: Change the payload test and verify RED**

Replace the existing tests with:

```ts
describe("data entry SKU master payload", () => {
  it("writes hidden status and business fields without a client-controlled owner", () => {
    const form = {
      ...defaultSkuMasterForm,
      SKU: "SP843060E010A001",
      中文品名: "方向游丝",
      供应商: "Custom Supplier",
      SKU状态: "停售",
      商品图片: "https://example.com/product.jpg",
      "商品毛重（g）": "320",
    };

    const payload = buildSkuMasterPayload(form);
    expect(payload).toMatchObject({
      SKU: "SP843060E010A001",
      中文品名: "方向游丝",
      供应商: "Custom Supplier",
      SKU状态: "待清点",
      商品图片: "https://example.com/product.jpg",
      "商品毛重（g）": 320,
    });
    expect(payload).not.toHaveProperty("负责人");
  });
});
```

Run: `npm test -- src/lib/data-entry-sku.test.ts`

Expected: FAIL because `buildSkuMasterPayload` still requires and emits `ownerName`.

- [ ] **Step 2: Implement the client payload boundary**

```ts
export function buildSkuMasterPayload(form: SkuMasterForm): Record<string, unknown> {
  return {
    ...form,
    SKU状态: SKU_MASTER_DEFAULT_STATUS,
    "商品毛重（g）": parseFloat(form["商品毛重（g）"]) || 0,
  };
}
```

Delete `currentUserName()` from the page and simplify submission:

```ts
const handleSubmit = async () => {
  if (!form.SKU || !form.中文品名) {
    toast.error("请至少填写 SKU 和 中文品名");
    return;
  }
  const payload = buildSkuMasterPayload(form);
  await submit("skuMaster", payload);
  setForm({ ...defaultForm });
};
```

- [ ] **Step 3: Run focused helper and route tests**

Run: `npm test -- src/lib/data-entry-sku.test.ts 'src/app/(main)/api/lark/save-record/route.test.ts'`

Expected: PASS.

- [ ] **Step 4: Commit the client boundary**

```bash
git add src/lib/data-entry-sku.ts src/lib/data-entry-sku.test.ts 'src/app/(main)/data-entry/page.tsx'
git commit -m "fix: move SKU ownership to the server"
```

### Task 4: Document configuration and verify the release

**Files:**
- Modify: `.env.example:9-19`
- Modify: `docs/deployment-reform.md:47-72`

- [ ] **Step 1: Document the optional mapping**

Add a placeholder-only example:

```dotenv
# 可选：登录姓名到飞书 open_id 的 JSON 映射；缺失时 SKU 仍保存但负责人留空。
LARK_USER_OPEN_IDS={}
```

Add `LARK_USER_OPEN_IDS` to the production OpenAPI variable list with the same fallback explanation. Never commit real names or IDs.

- [ ] **Step 2: Run formatting and release safety checks**

Run: `git diff --check`

Expected: exit 0 with no output.

Run: `npm run release:check`

Expected: PASS with no leaked runtime credentials or local user data.

- [ ] **Step 3: Run the full verification suite**

Run: `npm test`

Expected: all Vitest suites pass.

Run: `npm run lint`

Expected: ESLint exits 0.

Run: `npm run build`

Expected: Next.js production build exits 0. If the managed sandbox blocks Turbopack process or port access, rerun only this command with the required elevation.

- [ ] **Step 4: Review final scope**

Run: `git status --short --branch`

Expected: only the intended implementation and documentation files are modified, on `main`.

Run: `git diff --stat HEAD`

Expected: changes are limited to the files named in this plan.

- [ ] **Step 5: Commit documentation and verified implementation state**

```bash
git add .env.example docs/deployment-reform.md
git commit -m "docs: explain SKU owner ID mapping"
```
