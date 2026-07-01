# Operations Dashboard Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first Base-backed operations dashboard slice by normalizing sales import fields, currency/cost inputs, and Base table configuration.

**Architecture:** Keep calculations owned by Feishu Base fields and summary tables. The web app prepares canonical stored fields at import time and exposes table mappings so automation can later rebuild dashboard summary tables without inventing separate metrics.

**Tech Stack:** Next.js, TypeScript, Vitest, Feishu Base via existing `lark-server` repository helpers.

---

### Current Status

Implemented on 2026-06-30. Feishu Base tables `26`-`30` were created and the web app now has normalized sales import fields plus the operations dashboard rebuild endpoint. See `docs/agent-handoff-2026-06-30-operations-dashboard.md` for Base tokens, table IDs, metric rules, verification, and the pending Feishu dashboard block list.

### Task 1: Canonical Sales Import Fields

**Files:**
- Modify: `src/lib/sales-daily-import.ts`
- Test: `src/lib/sales-daily-import.test.ts`

- [x] **Step 1: Write failing tests for canonical fields**

Add assertions that imported rows include `销售额_USD`, `退款金额_USD`, `订单手续费_USD`, `橙联履约费_USD`, `其他费用_USD`, `导入Key`, `单品采购价_RMB`, `USD_CNY汇率`, while keeping old compatibility aliases.

- [x] **Step 2: Implement minimal import mapping**

Read SKU finance data from an optional map and monthly exchange rates from an optional map. Use `订单手续费` as `订单手续费_USD`; do not add `营销费用` to fees.

- [x] **Step 3: Run targeted import tests**

Run: `npm test -- src/lib/sales-daily-import.test.ts`

### Task 2: Sales Import Route Context

**Files:**
- Modify: `src/app/(main)/api/sales/import/route.ts`
- Test: `src/app/(main)/api/sales/import/route.test.ts`

- [x] **Step 1: Write failing tests for route-side context**

Verify the route passes SKU purchase prices and monthly USD/CNY rates into `buildSalesImportRows`.

- [x] **Step 2: Implement context builders**

Use SKU records for product names and purchase price aliases, and use configured exchange-rate table records when available.

- [x] **Step 3: Run route tests**

Run: `npm test -- src/app/(main)/api/sales/import/route.test.ts`

### Task 3: Base Table Environment Mapping

**Files:**
- Modify: `src/lib/lark-server.ts`
- Modify: `.env.example`
- Modify: `src/lib/release-safety.ts`
- Test: `src/lib/lark-server.test.ts`
- Test: `src/lib/release-safety.test.ts`

- [x] **Step 1: Write failing tests for new table keys**

Verify `exchangeRate`, `operatingDaySummary`, `operatingPeriodSummary`, `skuPeriodSummary`, and `profitBreakdown` map to empty env templates.

- [x] **Step 2: Add table keys and release-safety templates**

Keep templates empty and preserve `LARK_WRITE_ENABLED=false`.

- [x] **Step 3: Run focused tests**

Run: `npm test -- src/lib/lark-server.test.ts src/lib/release-safety.test.ts`

### Task 4: Verification

**Files:**
- Test only.

- [x] **Step 1: Run all touched tests**

Run: `npm test -- src/lib/sales-daily-import.test.ts src/app/(main)/api/sales/import/route.test.ts src/lib/lark-server.test.ts src/lib/release-safety.test.ts`

- [x] **Step 2: Inspect diff**

Run: `git diff -- src/lib/sales-daily-import.ts src/lib/sales-daily-import.test.ts src/app/(main)/api/sales/import/route.ts src/app/(main)/api/sales/import/route.test.ts src/lib/lark-server.ts src/lib/lark-server.test.ts src/lib/release-safety.ts src/lib/release-safety.test.ts .env.example`
