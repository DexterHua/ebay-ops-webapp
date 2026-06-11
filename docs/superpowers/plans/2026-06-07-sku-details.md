# SKU Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only `/sku-details` page that lets operators fuzzy-search SKU records and inspect merged product, image, price, and inventory details.

**Architecture:** Keep data shaping in a focused `src/lib/sku-details.ts` module with pure helpers for tests. The React page reads the existing `/api/lark` endpoints, uses the helpers to merge records by `SKU`, and renders the search and selected SKU detail UI. Navigation is added through existing `MODULES` and `ModuleIcon` patterns.

**Tech Stack:** Next.js App Router, React client component, TypeScript, Vitest, existing shadcn-style UI components, lucide-react icons.

---

### Task 1: SKU Details Domain Helpers

**Files:**
- Create: `src/lib/sku-details.ts`
- Test: `src/lib/sku-details.test.ts`

- [ ] **Step 1: Write failing tests for merging, image extraction, number parsing, and search**

Create `src/lib/sku-details.test.ts` with cases proving:
- `buildSkuDetails()` merges `sku`, `strategy`, and `summary` rows by `SKU`.
- `buildSkuDetails()` does not expose purchase price or margin in the public detail model.
- `extractImageUrl()` handles `商品图片（链接）`, `商品图片`, `图片链接`, `Image URL`, and `imageUrl`.
- `searchSkuDetails()` matches SKU, Chinese name, English keywords, OEM, category, supplier, and status.

Run: `npm test -- src/lib/sku-details.test.ts`
Expected: FAIL because `src/lib/sku-details.ts` does not exist yet.

- [ ] **Step 2: Implement the helper module**

Create `src/lib/sku-details.ts` exporting:
- `SkuDetails`
- `toDisplayText(value)`
- `toLarkNumber(value)`
- `extractImageUrl(record)`
- `buildSkuDetails({ skuRows, strategyRows, summaryRows })`
- `searchSkuDetails(items, query, limit = 8)`

Implementation rules:
- Use `SKU` as the merge key.
- Keep display fields aligned with the spec: no purchase price and no profit margin in `SkuDetails`.
- Prefer `预计可售天数`, then `可售天数`, then calculate `橙联可售 / 近7日日均销量` when daily sales is positive.
- Use plain defensive parsing for Lark arrays and objects.

- [ ] **Step 3: Run helper tests**

Run: `npm test -- src/lib/sku-details.test.ts`
Expected: PASS.

---

### Task 2: Navigation

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/components/layout/module-icons.tsx`
- Test: `src/lib/access-control.test.ts`

- [ ] **Step 1: Add a failing access test for `/sku-details`**

Update `src/lib/access-control.test.ts` so the normal business route test expects both operator and purchaser roles to access `/sku-details`, and add an assertion that the visible modules contain `/sku-details`.

Run: `npm test -- src/lib/access-control.test.ts`
Expected: FAIL because `MODULES` does not include `/sku-details`.

- [ ] **Step 2: Add the module and icon**

Add `{ id: "skuDetails", name: "SKU 详情", path: "/sku-details", description: "按 SKU、品名、OEM 等字段查询商品与库存详情" }` to `MODULES`.

Map `skuDetails` to a relevant lucide icon in `ModuleIcon`, such as `ScanSearch` or `PackageSearch`.

- [ ] **Step 3: Run access tests**

Run: `npm test -- src/lib/access-control.test.ts`
Expected: PASS.

---

### Task 3: SKU Details Page

**Files:**
- Create: `src/app/(main)/sku-details/page.tsx`

- [ ] **Step 1: Build the client page using existing UI components**

Create a client page that:
- Fetches `/api/lark?table=sku`, `/api/lark?table=strategy`, and `/api/lark?table=summary` in parallel.
- Uses `buildSkuDetails()` to merge data.
- Shows a search input and first 8 matches through `searchSkuDetails()`.
- Selects a SKU from the suggestion list.
- Shows sections for product info, spec/price, inventory/sales, and image.
- Renders only suggested price, gross weight, and packed dimensions in the spec/price section.
- Provides a copy-link button for the image URL.
- Handles loading, failed read, empty data, no matches, no image, and image load failure states.

- [ ] **Step 2: Run targeted checks**

Run:
- `npm test -- src/lib/sku-details.test.ts src/lib/access-control.test.ts`
- `npm run lint`

Expected: PASS.

---

### Task 4: Build Verification

**Files:**
- No new files.

- [ ] **Step 1: Run production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 2: Run Cloudflare build if the Next build passes**

Run: `npm run build:cloudflare`
Expected: PASS, unless blocked by environment-specific network or platform issues. If blocked, record the exact error.
