# Sourcing Workbench Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-class sourcing workflow menu with child process pages for registration, initial review, quotation, and completed outcomes.

**Architecture:** Keep Lark Base as the system of record. Add sourcing to the generic read API, add a focused update endpoint for sourcing records, and implement sourcing UI as a small route group under `/sourcing/*` with shared client components. Extend the existing module navigation to render optional child routes without changing role filtering semantics.

**Tech Stack:** Next.js App Router, React client components, Vitest, existing `lark-server` helpers, existing shadcn-style UI primitives.

---

### Task 1: Navigation Model

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/header.tsx`
- Modify: `src/components/layout/module-icons.tsx`
- Test: `src/lib/access-control.test.ts`

- [ ] Add `sourcing` to `MODULES` as a first-class module with `children`:
  - `/sourcing/register` named `选品登记`
  - `/sourcing/review` named `初选处理`
  - `/sourcing/quote-pending` named `待询价清单`
  - `/sourcing/quoting` named `询价中`
  - `/sourcing/completed` named `已完成`
  - `/sourcing/rejected` named `未入选`
- [ ] Update sidebar rendering so modules with `children` show the parent row plus child links. A parent is active when `pathname` equals the parent path or starts with it.
- [ ] Update header module lookup to support child routes by flattening modules.
- [ ] Add a sourcing icon mapping in `ModuleIcon`.
- [ ] Add an access-control test proving nested modules remain visible to non-admin roles when not `adminOnly`.

### Task 2: Sourcing API

**Files:**
- Modify: `src/app/(main)/api/lark/route.ts`
- Create: `src/app/(main)/api/sourcing/record/route.ts`
- Test: `src/app/(main)/api/lark/route.test.ts`
- Test: `src/app/(main)/api/sourcing/record/route.test.ts`

- [ ] Add `sourcing: "sourcing"` to the generic Lark read API table map.
- [ ] Add `PATCH /api/sourcing/record` accepting `{ recordId, fields }`.
- [ ] Normalize sourcing update date fields `初选时间` and `询价时间` to timestamps.
- [ ] Normalize `商品链接` updates to `{ text, link }` when present.
- [ ] Reject missing `recordId` or invalid `fields` with 400.
- [ ] Use `updateLarkRecord("sourcing", recordId, normalizedFields)`.

### Task 3: Sourcing Workbench UI

**Files:**
- Create: `src/app/(main)/sourcing/page.tsx`
- Create: `src/app/(main)/sourcing/register/page.tsx`
- Create: `src/app/(main)/sourcing/review/page.tsx`
- Create: `src/app/(main)/sourcing/quote-pending/page.tsx`
- Create: `src/app/(main)/sourcing/quoting/page.tsx`
- Create: `src/app/(main)/sourcing/completed/page.tsx`
- Create: `src/app/(main)/sourcing/rejected/page.tsx`
- Create: `src/components/sourcing/sourcing-form.tsx`
- Create: `src/components/sourcing/sourcing-workbench.tsx`

- [ ] Move the working sourcing registration form into `SourcingForm` so `/sourcing/register` can use it.
- [ ] Keep `/data-entry` intact for the existing data entry workflows, but remove sourcing from its tab list so the new menu is the canonical route.
- [ ] Build `SourcingWorkbench` to fetch `/api/lark?table=sourcing`, filter records by stage/result, and render cards with OEM, names, brand, sales, price, link, registrant, and notes.
- [ ] On `/sourcing/review`, provide inputs for `初选结果`, `最高购入价格`, and `初选备注`; save:
  - if `初选结果` is `入选`, set `选品阶段` to `已入选待询价`
  - if `初选结果` is `未入选`, set `选品阶段` to `未入选`
  - if `初选结果` is `待补充`, keep `选品阶段` as `初选待处理`
  - set `初选人` from `/api/auth/me`
  - set `初选时间` to now
- [ ] On `/sourcing/quote-pending` and `/sourcing/quoting`, provide inputs for `供应商`, `供应商报价`, and `采购备注`; save:
  - set `选品阶段` to `询价中` when quote info is partial
  - set `选品阶段` to `已完成` when supplier and quote are both filled
  - set `询价人` from `/api/auth/me`
  - set `询价时间` to now
- [ ] Completed and rejected pages are read-only lists.

### Task 4: Verification

**Files:**
- No production files.

- [ ] Run `npm test -- src/lib/access-control.test.ts src/app/(main)/api/lark/route.test.ts src/app/(main)/api/sourcing/record/route.test.ts`.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Open or refresh `http://localhost:3001/sourcing/register` and confirm the page renders.
