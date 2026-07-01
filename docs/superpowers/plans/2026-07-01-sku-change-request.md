# SKU Change Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stock SKU backfill workflow where operators and purchasers submit SKU master-data edits for admin approval before `01_SKU主数据` is updated.

**Architecture:** Store pending edits in a new Feishu Base table keyed by `LARK_TABLE_SKU_CHANGE_REQUESTS`. The web app reads SKU master data, writes change requests, and only updates the SKU master table from the admin approval endpoint.

**Tech Stack:** Next.js route handlers, React client page, Vitest, existing Lark Base wrapper.

---

### Task 1: SKU Change Request Domain

**Files:**
- Create: `src/lib/sku-change-request.ts`
- Test: `src/lib/sku-change-request.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it("builds a patch containing only changed editable fields", () => {
  const result = buildSkuChangePatch({
    original: { SKU: "SP-001", 中文品名: "旧名称", OEM: "A", SKU状态: "待清点" },
    updates: { SKU: "SP-001", 中文品名: "新名称", OEM: "A", SKU状态: "已上架" },
  });
  expect(result.patch).toEqual({ 中文品名: "新名称", SKU状态: "已上架" });
});
```

- [ ] **Step 2: Run failing test**

Run: `npm test -- src/lib/sku-change-request.test.ts`
Expected: FAIL because `src/lib/sku-change-request.ts` does not exist.

- [ ] **Step 3: Implement domain helpers**

Create helpers for editable field names, text normalization, patch building, request field serialization, and request normalization.

- [ ] **Step 4: Run domain tests**

Run: `npm test -- src/lib/sku-change-request.test.ts`
Expected: PASS.

### Task 2: SKU Change Request API

**Files:**
- Create: `src/app/(main)/api/sku/change-requests/route.ts`
- Create: `src/app/(main)/api/sku/change-requests/route.test.ts`
- Modify: `src/lib/lark-server.ts`
- Modify: `.env.example`
- Modify: `src/lib/release-safety.ts`

- [ ] **Step 1: Write failing route tests**

Cover:
- `POST` by operator creates one `skuChangeRequest` record and does not call `updateLarkRecord("sku", ...)`.
- `PUT` approve by admin updates `sku` with the parsed patch and marks request approved.
- `PUT` reject by admin only marks the request rejected.

- [ ] **Step 2: Run failing route tests**

Run: `npm test -- 'src/app/(main)/api/sku/change-requests/route.test.ts'`
Expected: FAIL because the route and table mapping do not exist.

- [ ] **Step 3: Implement route**

Add `skuChangeRequest: "LARK_TABLE_SKU_CHANGE_REQUESTS"` to Lark table mapping. Implement `GET`, `POST`, and `PUT` handlers with role checks:
- `GET`: logged-in users can read requests; admins see all, others see their submitted requests.
- `POST`: `admin`, `operator`, `purchaser` can submit.
- `PUT`: admin-only approve/reject.

- [ ] **Step 4: Run route tests**

Run: `npm test -- 'src/app/(main)/api/sku/change-requests/route.test.ts'`
Expected: PASS.

### Task 3: Data Entry UI

**Files:**
- Modify: `src/app/(main)/data-entry/page.tsx`

- [ ] **Step 1: Add UI state and API calls**

Use existing `skuList`, `/api/auth/me`, and `/api/sku/change-requests`. Add search/select SKU, editable fields, changed-field preview, submit request button, and admin pending review list.

- [ ] **Step 2: Verify page compiles**

Run: `npm run lint`
Expected: PASS.

### Task 4: Feishu Table Setup

**Files:**
- Modify: `.env.local` after table creation.

- [ ] **Step 1: Create `31_SKU主数据修改审核`**

Use `lark-cli base +table-create` with fields:
`申请编号`, `SKU`, `SKU记录ID`, `原始数据JSON`, `修改内容JSON`, `修改字段`, `提交人`, `提交角色`, `提交时间`, `审核状态`, `审核人`, `审核时间`, `审核备注`.

- [ ] **Step 2: Add local table ID**

Add `LARK_TABLE_SKU_CHANGE_REQUESTS=<created table id>` to `.env.local`; add blank key to `.env.example`.

### Task 5: Final Verification

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/lib/sku-change-request.test.ts 'src/app/(main)/api/sku/change-requests/route.test.ts'`
Expected: PASS.

- [ ] **Step 2: Run full checks**

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Browser sanity check**

Open `http://localhost:3000/data-entry`, confirm the SKU tab renders and the new controls fit the existing layout.
