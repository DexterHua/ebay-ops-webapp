# Inventory Flow Transaction Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inventory batch transitions recoverable and internally consistent so a failed submit cannot silently leave details, ledger rows, and SKU summaries diverged.

**Architecture:** Keep the existing Next.js routes and repository interfaces, but harden the domain service. Add transaction metadata, recovery context, preflight validation, ledger completeness checks, and a small admin/operator reconciliation endpoint that can rebuild SKU summaries from detail rows after explicit confirmation.

**Tech Stack:** Next.js 16 route handlers, TypeScript domain services, Vitest, Feishu/Lark Base repository wrappers.

---

### Task 1: Regression Tests For Partial Transition Failures

**Files:**
- Modify: `src/lib/inventory-batch-server.test.ts`
- Modify: `src/lib/inventory-batch-server.ts`

- [ ] **Step 1: Write failing tests**

Add tests that prove failed flow writes leave the transaction non-completed and retry can finish missing ledger and summary work.

- [ ] **Step 2: Run targeted tests and verify failure**

Run: `npm test -- src/lib/inventory-batch-server.test.ts`
Expected: failing assertions around transaction status and missing recovery metadata.

- [ ] **Step 3: Implement transaction failure metadata**

Update transition and shipment flows to mark failed transactions with `failureReason`, `operationType`, `operator`, timestamps, and `recoveryContext` before rethrowing.

- [ ] **Step 4: Run targeted tests and verify pass**

Run: `npm test -- src/lib/inventory-batch-server.test.ts`
Expected: the new regression tests pass.

### Task 2: Completion-Time Consistency Checks

**Files:**
- Modify: `src/lib/inventory-batch-server.ts`
- Modify: `src/lib/inventory-batch-server.test.ts`

- [ ] **Step 1: Write failing consistency test**

Simulate a missing ledger pair after details were updated and assert the transaction cannot be marked completed.

- [ ] **Step 2: Implement consistency validation**

Before `completeTransaction`, validate that every cross-location move has matching stock flow rows and that summaries rebuilt from details are persisted.

- [ ] **Step 3: Run targeted tests**

Run: `npm test -- src/lib/inventory-batch-server.test.ts`
Expected: all inventory batch tests pass.

### Task 3: Reconciliation Domain Helper And API

**Files:**
- Modify: `src/lib/inventory-batch-server.ts`
- Modify: `src/lib/inventory-batch-server.test.ts`
- Create: `src/app/(main)/api/inventory-flow/reconcile/route.ts`
- Create: `src/app/(main)/api/inventory-flow/reconcile/route.test.ts`

- [ ] **Step 1: Write failing reconcile tests**

Test that selected SKUs are rebuilt from `22_SKU批次库存明细` into `19_SKU运营汇总`.

- [ ] **Step 2: Implement helper**

Export a `reconcileInventorySummaries(repo, skus)` helper that reuses `summarizeDetails` and writes exact summary values.

- [ ] **Step 3: Implement protected route**

Add a POST route requiring admin/operator and Lark write enablement. Body: `{ "skus": ["SKU-1"] }`.

- [ ] **Step 4: Run route and domain tests**

Run: `npm test -- src/lib/inventory-batch-server.test.ts 'src/app/(main)/api/inventory-flow/reconcile/route.test.ts'`
Expected: all targeted tests pass.

### Task 4: Verification

**Files:**
- All modified files

- [ ] **Step 1: Run full tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no lint errors.

- [ ] **Step 3: Build if feasible**

Run: `npm run build`; if sandbox blocks binding, rerun with escalation.
Expected: build succeeds or environment limitation is reported.
