# Agent Handoff - eBay Ops Webapp

Date: 2026-06-03
Workspace: `/Users/chequan/Documents/SolidSrUn/ebay-ops-webapp`

## Current Goal

Continue building the internal eBay operations webapp, especially the new `库存流转` module.

The current active feature is an inventory batch flow workbench that should support:

- purchase batch creation
- inventory detail ledger creation
- status transitions with partial quantity split
- shipment batch creation and binding
- exception handling
- summary rebuild into `19_SKU运营汇总`

## Local Login

Use the local dev admin account:

- Name: `车泉`
- Password: ask the project owner or reset locally with `resetPassword`.

Do not commit local password hashes or plaintext passwords to GitHub.

## Dev Server

The dev server has been started with:

```bash
npm run dev
```

URL:

```text
http://localhost:3000
```

Inventory flow page:

```text
http://localhost:3000/inventory-flow
```

If the server is no longer running, restart it from the project root.

## Verification Status

The latest checks passed:

```bash
npm run lint
npm test
npm run build
```

Notes:

- `npm test` currently reports `5 files / 109 tests passed`.
- `npm run build` may fail inside the restricted sandbox with a Turbopack `binding to a port` error. Re-run with elevated permissions if needed. With permission, build passed.
- Next.js prints a warning that `middleware` is deprecated in favor of `proxy`; this is not fixed yet.

## Important Existing Dirty State

The repo has many uncommitted changes from earlier work. Do not reset or revert them unless explicitly asked.

Notable existing changes include:

- broad UI refresh
- auth/session updates
- Cloudflare/OpenNext files
- Vitest setup
- inventory ledger pure functions
- Lark server changes
- inventory flow frontend/backend files

Use `git status --short` before editing and preserve unrelated changes.

## Implemented Inventory Flow Work

### Backend Pure Logic

Files:

- `src/lib/inventory-flow.ts`
- `src/lib/inventory-flow.test.ts`
- `src/lib/inventory-batch-server.ts`
- `src/lib/inventory-batch-server.test.ts`

Implemented:

- seven-state inventory flow:
  - `本地仓待清点`
  - `待包装`
  - `已发往国内集货仓`
  - `国内集货仓待发`
  - `橙联在途`
  - `海外仓待上架`
  - `橙联可售`
- state validation
- location ledger generation
- partial transition split
- whole-row transition
- opening balance helper
- SKU summary rebuild
- idempotent transaction handling
- retry after partial failure
- rule: entering `橙联在途` requires `当前物流批次`

### Lark Repository Adapter

File:

- `src/lib/inventory-lark-repository.ts`

Implemented adapter for `InventoryBatchRepository` using existing Lark helpers:

- upsert purchase batch by `采购批次号`
- upsert inventory detail by `明细编号`
- read/update inventory details
- upsert stock flow by matching transaction/detail/SKU/location/delta/type
- rebuild SKU summary

Important caveat:

- Transaction state is currently stored in an in-memory `Map`, not a persistent Lark transaction table. This is acceptable for local/dev continuity but not robust for production restarts. A later agent should consider adding a persistent transaction table or another durable idempotency store.

### API Routes

Files:

- `src/app/(main)/api/inventory-flow/data/route.ts`
- `src/app/(main)/api/inventory-flow/purchase-batches/route.ts`
- `src/app/(main)/api/inventory-flow/transitions/route.ts`

Implemented:

- `GET /api/inventory-flow/data?resource=details`
- `GET /api/inventory-flow/data?resource=purchases`
- `GET /api/inventory-flow/data?resource=shipments`
- `GET /api/inventory-flow/data?resource=exceptions`
- `POST /api/inventory-flow/purchase-batches`
- `POST /api/inventory-flow/transitions`

Auth/roles:

- reading data requires a valid session
- creating purchase batches allows `admin` and `purchaser`
- status transition allows `admin` and `operator`

Write protection:

- write routes call `assertLarkWriteEnabled()`
- `.env.local` must set `LARK_WRITE_ENABLED=true` before writes happen

### API Parsing

Files:

- `src/lib/inventory-flow-api.ts`
- `src/lib/inventory-flow-api.test.ts`

Implemented:

- purchase batch request parsing
- transition request parsing
- inventory flow data resource mapping
- validation for duplicate SKU/detail IDs, missing fields, invalid quantity/state/date

### Frontend Inventory Flow

Files:

- `src/app/(main)/inventory-flow/page.tsx`
- `src/components/inventory-flow/purchase-batches-tab.tsx`
- `src/components/inventory-flow/flow-details-tab.tsx`
- `src/components/inventory-flow/transition-dialog.tsx`
- `src/components/inventory-flow/shipments-tab.tsx`
- `src/components/inventory-flow/exceptions-tab.tsx`
- `src/components/inventory-flow/types.ts`
- `src/components/ui/checkbox.tsx`

Implemented:

- navigation module `库存流转`
- inventory flow page with four tabs:
  - `采购批次`
  - `批次流转`
  - `头程物流`
  - `库存异常`
- purchase batch form:
  - batch no, supplier, ordered date
  - multiple SKU lines
  - SKU lookup from `/api/lark?table=sku&limit=500`
  - existing SKU locks product name
  - new SKU requires product name
  - validates empty batch/supplier/items/SKU, positive integer quantity, duplicate SKU
  - posts to `/api/inventory-flow/purchase-batches`
- flow details tab:
  - reads `/api/inventory-flow/data?resource=details`
  - filters by state, purchase batch, shipment batch, SKU
  - hides completed rows
  - supports multi-select
  - shows selected detail count, SKU count, total quantity
- transition dialog:
  - shows selected count, SKU count, total quantity
  - shows current state and next state
  - single-row transitions allow partial quantity input
  - multi-row transitions use full row quantities
  - blocks mixed current states
  - blocks no next state
  - blocks entering `橙联在途` without shipment batch
  - posts to `/api/inventory-flow/transitions`

`头程物流` and `库存异常` tabs are still placeholders. They have UI shells but do not yet perform business actions.

## Environment Variables

`.env.example` was updated with inventory flow table IDs:

```text
LARK_TABLE_PURCHASE_BATCH=
LARK_TABLE_SHIPMENT_BATCH=
LARK_TABLE_INVENTORY_DETAIL=
LARK_TABLE_INVENTORY_EXCEPTION=
```

To test writes locally, `.env.local` needs:

```text
LARK_WRITE_ENABLED=true
LARK_TABLE_PURCHASE_BATCH=...
LARK_TABLE_SHIPMENT_BATCH=...
LARK_TABLE_INVENTORY_DETAIL=...
LARK_TABLE_INVENTORY_EXCEPTION=...
LARK_TABLE_STOCK_FLOW=...
LARK_TABLE_SKU_SUMMARY=...
```

Do not commit secrets.

## Current Recommended Next Step

Build `头程物流` creation and binding.

Why:

- Status transition now blocks `国内集货仓待发 -> 橙联在途` unless details have `当前物流批次`.
- Without shipment binding, the flow can progress only up to `国内集货仓待发`.
- Implementing shipment binding unlocks the first full path toward overseas transit.

Suggested next implementation:

1. Add API parser for shipment creation/binding in `src/lib/inventory-flow-api.ts`.
2. Add `POST /api/inventory-flow/shipments`.
3. Extend `InventoryBatchRepository` or add a new service function for:
   - create/upsert `21_头程物流批次`
   - bind selected `国内集货仓待发` details to `当前物流批次`
   - optionally support partial quantity binding by splitting detail
   - then transition bound details to `橙联在途`
4. Replace placeholder `shipments-tab.tsx` with:
   - logistics batch form
   - selectable `国内集货仓待发` detail list
   - create/bind/confirm shipment action
5. Add tests for:
   - binding only allowed from `国内集货仓待发`
   - partial binding splits details correctly
   - after binding, transition to `橙联在途` succeeds

## Known Gaps / Risks

- In-memory transaction store is not durable.
- Shipment and exception workflows are not implemented.
- The current Lark repository does broad list reads for upsert/idempotency. This is acceptable for current scale but may need filtering/indexing later.
- `src/middleware.ts` exists and `src/proxy.ts` is deleted; Next warns about middleware convention. It still builds.
- The user may still be on `/login`; use the local admin account after confirming the password with the project owner.
- `accounts` page requires admin. `车泉` is treated as admin by `getUserRole()`.

## Useful Commands

```bash
npm run dev
npm run lint
npm test
npm run build
git status --short
```

## Reference Planning Docs

Original planning/spec files:

- `docs/superpowers/specs/2026-06-02-inventory-batch-flow-design.md`
- `docs/superpowers/plans/2026-06-02-inventory-ledger-backend-plan.md`
- `docs/superpowers/plans/2026-06-02-inventory-flow-workbench-plan.md`
