# SKU Profit Calculator Global Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict profit cost-parameter editing to administrators, persist saved parameters globally, and keep every SKU profit calculation ephemeral and free of Lark writes.

**Architecture:** Add a focused settings repository that mirrors the existing user-storage pattern: local JSON during development and a site-level Netlify Blob in Netlify runtime. Expose settings through an authenticated API with server-authoritative `requireAdmin()` protection for writes, then make the calculator fetch those settings and render either admin edit controls or ordinary-user read-only controls.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest, Netlify Blobs, existing session helpers, existing shadcn-style UI components, sonner.

---

### Task 1: Global Profit Settings Repository

**Files:**
- Create: `src/lib/profit-settings.ts`
- Create: `src/lib/profit-settings.test.ts`
- Reuse: `src/lib/profit-calculator.ts`

- [ ] **Step 1: Write failing repository tests**

Create tests that import the wished-for API:

```ts
import {
  getProfitSettings,
  saveProfitSettings,
  validateProfitAssumptions,
} from "./profit-settings";

expect(validateProfitAssumptions(DEFAULT_PROFIT_ASSUMPTIONS)).toEqual(DEFAULT_PROFIT_ASSUMPTIONS);
expect(() => validateProfitAssumptions({ ...DEFAULT_PROFIT_ASSUMPTIONS, exchangeRate: 0 }))
  .toThrow("汇率必须大于 0");
expect(await getProfitSettings()).toMatchObject({ assumptions: DEFAULT_PROFIT_ASSUMPTIONS });
expect(await saveProfitSettings(DEFAULT_PROFIT_ASSUMPTIONS, "车泉"))
  .toMatchObject({ updatedBy: "车泉", assumptions: DEFAULT_PROFIT_ASSUMPTIONS });
```

Mock `fs` and `@netlify/blobs` following `src/lib/users.test.ts`. Cover local fallback, Netlify strong-consistency reads, malformed stored data fallback, and failed validation before any write.

- [ ] **Step 2: Run the tests and confirm RED**

Run: `npm test -- src/lib/profit-settings.test.ts`

Expected: FAIL because `src/lib/profit-settings.ts` does not exist.

- [ ] **Step 3: Implement the settings repository**

Create these public types and functions:

```ts
export interface ProfitSettingsSnapshot {
  assumptions: ProfitAssumptions;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function validateProfitAssumptions(value: unknown): ProfitAssumptions;
export async function getProfitSettings(): Promise<ProfitSettingsSnapshot>;
export async function saveProfitSettings(
  assumptions: unknown,
  updatedBy: string,
): Promise<ProfitSettingsSnapshot>;
```

Implementation rules:

- Use `data/profit-settings.json` locally.
- In Netlify runtime, use `getStore("profit-settings")` and key `current`.
- Read Netlify with `{ type: "json", consistency: "strong" }`.
- Return code defaults when no saved file/blob exists.
- Reject missing fields, non-finite values, negative amounts/rates, `exchangeRate <= 0`, and combined variable rate `>= 1`.
- Validate before writing and serialize settings with `updatedAt` and `updatedBy`.
- Keep a promise queue around writes so concurrent saves do not interleave.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- src/lib/profit-settings.test.ts`

Expected: all repository tests pass.

### Task 2: Authenticated Settings API

**Files:**
- Create: `src/app/(main)/api/profit-settings/route.ts`
- Create: `src/app/(main)/api/profit-settings/route.test.ts`
- Reuse: `src/lib/session-server.ts`

- [ ] **Step 1: Write failing route tests**

Mock `requireSession`, `requireAdmin`, `getProfitSettings`, and `saveProfitSettings`. Add cases proving:

```ts
expect((await GET()).status).toBe(200); // authenticated ordinary user
expect((await PUT(adminRequest)).status).toBe(200); // administrator
expect((await PUT(operatorRequest)).status).toBe(403); // ordinary user
```

Also assert that `PUT` passes only `body.assumptions` plus the authenticated administrator name to `saveProfitSettings`.

- [ ] **Step 2: Run the route test and confirm RED**

Run: `npm test -- 'src/app/(main)/api/profit-settings/route.test.ts'`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement GET and PUT**

`GET` must call `requireSession()` before returning `{ ok: true, settings }`. Authentication failures return 401.

`PUT` must call `requireAdmin()` before reading/saving settings. Permission failures return `{ ok: false, error: "仅管理员可修改成本参数" }` with status 403. Validation failures return 400. Storage failures return 500 without exposing internal configuration or credentials.

Do not accept or persist SKU, purchase price, weight, sale price, cost breakdown, profit, or margin fields.

- [ ] **Step 4: Run route and repository tests**

Run: `npm test -- 'src/app/(main)/api/profit-settings/route.test.ts' src/lib/profit-settings.test.ts`

Expected: both files pass.

### Task 3: Protect Local Runtime Data

**Files:**
- Modify: `.gitignore`
- Modify: `src/lib/release-safety.ts`
- Modify: `src/lib/release-safety.test.ts`

- [ ] **Step 1: Add a failing release-safety assertion**

Extend the sensitive runtime file test so tracked `data/profit-settings.json` produces:

```ts
expect(result.errors).toContain(
  "敏感或本地运行态文件被 Git 跟踪：data/profit-settings.json",
);
```

- [ ] **Step 2: Run and confirm RED**

Run: `npm test -- src/lib/release-safety.test.ts`

Expected: FAIL because the new path is not protected.

- [ ] **Step 3: Add ignore and safety rules**

Add `data/profit-settings.json` to `.gitignore` and to the runtime-sensitive file list in `src/lib/release-safety.ts`.

- [ ] **Step 4: Run and confirm GREEN**

Run: `npm test -- src/lib/release-safety.test.ts`

Expected: all release-safety tests pass.

### Task 4: Role-Aware Calculator Controls

**Files:**
- Modify: `src/components/sku/profit-calculator.tsx`
- Reuse: `src/app/(main)/api/auth/me/route.ts`

- [ ] **Step 1: Add pure client-state tests before component edits**

Create `src/lib/profit-settings-client.test.ts` and `src/lib/profit-settings-client.ts` around these wished-for helpers:

```ts
expect(getProfitSettingsMode({ isAdmin: false, loading: false })).toBe("readonly");
expect(getProfitSettingsMode({ isAdmin: true, loading: false })).toBe("editable");
expect(getProfitSettingsMode({ isAdmin: true, loading: true })).toBe("loading");
expect(hasUnsavedProfitSettings(saved, draft)).toBe(false);
expect(hasUnsavedProfitSettings(saved, { ...draft, exchangeRate: 7 })).toBe(true);
```

Run: `npm test -- src/lib/profit-settings-client.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 2: Implement minimal client-state helpers and confirm GREEN**

Export:

```ts
export type ProfitSettingsMode = "loading" | "readonly" | "editable";
export function getProfitSettingsMode(input: { isAdmin: boolean; loading: boolean }): ProfitSettingsMode;
export function hasUnsavedProfitSettings(saved: ProfitAssumptions, draft: ProfitAssumptions): boolean;
```

Run: `npm test -- src/lib/profit-settings-client.test.ts`

Expected: PASS.

- [ ] **Step 3: Load settings and role in the calculator**

On component mount, request `/api/profit-settings` and `/api/auth/me` in parallel. Use loaded assumptions for calculation. If settings loading fails, keep code defaults and show `当前使用默认参数` without blocking the calculator.

The fetch only transmits the authenticated cookie. It must never transmit profit-calculation inputs or results.

- [ ] **Step 4: Render role-specific controls**

For ordinary users:

- Render all nine settings inputs with `readOnly`.
- Show a lock icon and `仅管理员可修改`.
- Hide `恢复默认` and `保存并应用`.

For administrators:

- Enable settings inputs.
- Keep draft edits local so the displayed profit preview updates immediately.
- Show `恢复默认` and `保存并应用`.
- Disable save while unchanged, invalid, loading, or saving.
- On successful `PUT`, replace the saved snapshot, clear dirty state, and show a success toast.
- On failed `PUT`, keep the draft and show the server error.

- [ ] **Step 5: Run focused tests and lint**

Run:

```bash
npm test -- src/lib/profit-settings-client.test.ts src/lib/profit-calculator.test.ts
npm run lint -- src/components/sku/profit-calculator.tsx src/lib/profit-settings-client.ts
```

Expected: PASS.

### Task 5: End-to-End Verification

**Files:**
- No additional product files expected.

- [ ] **Step 1: Run all automated verification**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected: 0 test failures, 0 lint errors, successful production build, and no whitespace errors.

- [ ] **Step 2: Verify administrator behavior locally**

At `http://localhost:3000/sku-details` while logged in as administrator:

- Expand cost settings and confirm inputs are editable.
- Change one draft value and confirm profit preview changes before save.
- Confirm `保存并应用` becomes enabled.
- Save, reload, and confirm the saved value is reloaded.
- Restore and save defaults so local verification does not leave surprising settings behind.

- [ ] **Step 3: Verify server authorization directly**

Use route tests as the authoritative non-admin proof: a mocked ordinary persisted role must receive 403 from `PUT` even if the client is bypassed. Confirm `GET` remains available to authenticated non-admin users.

- [ ] **Step 4: Verify responsive presentation**

In the in-app browser, check default and 390 px viewports for overflow and verify read-only/editable badges, buttons, units, and error text do not overlap.

- [ ] **Step 5: Confirm integration boundaries**

Verify no Lark write endpoint is called, no Netlify deployment command ran, no Git push occurred, and `data/profit-settings.json` is untracked and ignored.
