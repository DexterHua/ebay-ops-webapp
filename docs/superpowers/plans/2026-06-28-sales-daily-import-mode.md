# Sales Daily Import Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual sales daily entry with a 店小秘 `.xlsx` import workflow that writes `07_销售日报` and triggers the existing inventory deduction scan.

**Architecture:** Add a small server-side OOXML reader for first-sheet `.xlsx` tables, a sales import normalizer that maps 店小秘 rows to Lark sales records, and a Next route that supports preview and commit. The UI uploads files from the existing Sales Daily tab and shows import results instead of the manual one-row form.

**Tech Stack:** Next.js route handlers, TypeScript, Vitest, Node `zlib`, existing Lark helpers, existing `runSalesInventoryScan`.

---

## File Structure

- Create `src/lib/xlsx-table.ts`: minimal `.xlsx` ZIP/XML table reader for first-sheet data.
- Create `src/lib/sales-daily-import.ts`: 店小秘 header validation, row normalization, dedupe key, import summary helpers.
- Create `src/lib/sales-daily-import.test.ts`: parser and normalizer tests with an in-memory XLSX fixture.
- Create `src/app/(main)/api/sales/import/route.ts`: multipart preview/commit API.
- Create `src/app/(main)/api/sales/import/route.test.ts`: route-level tests with mocked Lark and scan dependencies.
- Modify `src/app/(main)/data-entry/page.tsx`: replace `SalesForm` with `SalesImportPanel`.

## Task 1: Parser And Normalizer

- [ ] **Step 1: Write failing parser and mapping tests**

Create `src/lib/sales-daily-import.test.ts` with tests that:

```ts
import { describe, expect, it } from "vitest";
import { buildSalesImportRows, parseXlsxTable } from "@/lib/sales-daily-import";

it("parses 店小秘 workbook rows and skips the total row", async () => {
  const table = await parseXlsxTable(makeDianxiaomiWorkbook());
  const result = buildSalesImportRows(table, { SP255609CH2DA001: "Clock Spring" });
  expect(result.validRows).toHaveLength(2);
  expect(result.validRows[0].fields).toMatchObject({
    SKU: "SP255609CH2DA001",
    商品名称: "Clock Spring",
    店铺: "Solidparts",
    售出数量: 1,
    销售额: 18.61,
    eBay费用: 2.98,
    广告费: 0,
    橙联履约费: 0,
    商品成本: 0,
    退款金额: 0,
  });
  expect(result.validRows[0].fields.备注).toContain("导入Key: 店小秘:8548767-114:SP255609CH2DA001:2026-06-27");
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npm test -- src/lib/sales-daily-import.test.ts`

Expected: FAIL because `@/lib/sales-daily-import` does not exist.

- [ ] **Step 3: Implement minimal parser and normalizer**

Create `src/lib/xlsx-table.ts` with a central-directory ZIP reader using `zlib.inflateRawSync`, then XML extraction for `xl/sharedStrings.xml` and `xl/worksheets/sheet1.xml`.

Create `src/lib/sales-daily-import.ts` exporting:

```ts
export interface ImportedSalesRow {
  importKey: string;
  sourceRow: number;
  fields: Record<string, unknown>;
}

export interface SalesImportBuildResult {
  validRows: ImportedSalesRow[];
  errors: Array<{ row: number; message: string }>;
  summary: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    dateRange?: { from: string; to: string };
    stores: string[];
  };
}

export { parseXlsxTable } from "@/lib/xlsx-table";
export function buildSalesImportRows(table: string[][], skuNames: Record<string, string>): SalesImportBuildResult;
export function salesImportKey(row: { orderNo: string; sku: string; shippedDate: string }): string;
export function remarkHasImportKey(remark: unknown, importKey: string): boolean;
```

- [ ] **Step 4: Run parser tests to verify GREEN**

Run: `npm test -- src/lib/sales-daily-import.test.ts`

Expected: PASS.

## Task 2: Import Route

- [ ] **Step 1: Write failing route tests**

Create `src/app/(main)/api/sales/import/route.test.ts` mocking:

- `assertLarkWriteEnabled`
- `listLarkRecords`
- `createLarkRecords`
- `requireRole`
- `createLarkSalesInventoryScanRepository`
- `runSalesInventoryScan`

Test preview does not write and commit writes non-duplicate rows:

```ts
expect(lark.createLarkRecords).not.toHaveBeenCalled();
expect(scan.runSalesInventoryScan).not.toHaveBeenCalled();
```

and for commit:

```ts
expect(lark.createLarkRecords).toHaveBeenCalledWith("sales", expect.arrayContaining([
  expect.objectContaining({ SKU: "SP255609CH2DA001", 店铺: "Solidparts" }),
]));
expect(scan.runSalesInventoryScan).toHaveBeenCalledOnce();
```

- [ ] **Step 2: Run route tests to verify RED**

Run: `npm test -- 'src/app/(main)/api/sales/import/route.test.ts'`

Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement route**

Create `src/app/(main)/api/sales/import/route.ts`:

- `POST` accepts multipart `file` and `commit`.
- Requires admin or operator role with `requireRole(["admin", "operator"])`.
- Calls `assertLarkWriteEnabled()` only when `commit=true`.
- Reads SKU master for names and existing sales for duplicate import keys.
- Returns JSON with `preview`, `created`, `duplicates`, `errors`, `summary`, and optional `scan`.
- On commit, calls `createLarkRecords("sales", rows)` and then `runSalesInventoryScan(...)` with a limit large enough for the imported row count.

- [ ] **Step 4: Run route tests to verify GREEN**

Run: `npm test -- 'src/app/(main)/api/sales/import/route.test.ts'`

Expected: PASS.

## Task 3: UI Replacement

- [ ] **Step 1: Modify Sales Daily tab UI**

In `src/app/(main)/data-entry/page.tsx`, replace `SalesForm` with `SalesImportPanel`:

- file input accepting `.xlsx`
- preview button
- import button enabled after successful preview
- summary rows for total, valid, duplicates, errors, date range, stores
- compact error list
- result panel showing sales rows written and scan result

- [ ] **Step 2: Run lint/type-adjacent tests**

Run: `npm test -- src/lib/sales-daily-import.test.ts 'src/app/(main)/api/sales/import/route.test.ts'`

Expected: PASS.

## Task 4: Verification

- [ ] **Step 1: Run focused regression tests**

Run:

```bash
npm test -- src/lib/sales-daily-import.test.ts 'src/app/(main)/api/sales/import/route.test.ts' src/lib/sales-inventory-scan.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: no new lint errors.

- [ ] **Step 3: Verify in browser**

Open `http://localhost:3000/data-entry`, switch to `销售日报`, confirm the import UI renders and does not overlap at desktop width.
