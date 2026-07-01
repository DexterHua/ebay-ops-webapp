# Account Store Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add account-level store assignment and enforce it in the header and single-store dashboard.

**Architecture:** Store assignment lives on the persisted `User` record as `storeIds?: StoreId[]`. Server helpers normalize historical users to all active stores, validate new assignments, and expose normalized store IDs through sessions and APIs. `/store/[id]` becomes a server component guard that renders the existing client dashboard only when the current user is assigned to the requested store.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, existing shadcn-style UI components.

---

## File Structure

- Modify `src/lib/users.ts`: add store ID validation, normalization, and persistence.
- Modify `src/lib/users.test.ts`: cover user store assignment, normalization, and session behavior.
- Modify `src/lib/session-server.ts`: include normalized `storeIds` in `SessionUser`.
- Modify `src/app/(main)/api/auth/me/route.ts`: return `storeIds`.
- Modify `src/app/(main)/api/auth/login/route.ts`: include `storeIds` in the login response.
- Modify `src/app/(main)/api/auth/users/route.ts`: accept `storeIds` when creating users.
- Modify `src/app/(main)/accounts/accounts-client.tsx`: add store assignment checkboxes and list display.
- Modify `src/components/layout/header.tsx`: filter store buttons with current user's `storeIds`.
- Move `src/app/(main)/store/[id]/page.tsx` to `src/app/(main)/store/[id]/store-page-client.tsx`: keep the existing dashboard as a client component.
- Create `src/app/(main)/store/[id]/page.tsx`: server guard for invalid, unauthenticated, and unauthorized store access.

## Task 1: User Store Assignment Model

**Files:**
- Modify: `src/lib/users.ts`
- Test: `src/lib/users.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests to `src/lib/users.test.ts`:

```ts
test("新增用户保存有效店铺分配并在列表中返回", async () => {
  expect(await addUser("店铺运营", "123456", "operator", ["NP", "SP"])).toEqual({ ok: true });

  expect(await listUsers()).toEqual([
    expect.objectContaining({ name: "店铺运营", storeIds: ["NP", "SP"] }),
  ]);
});

test("新增用户拒绝无效店铺分配", async () => {
  expect(await addUser("异常店铺", "123456", "operator", ["NP", "BAD"] as never)).toEqual({
    ok: false,
    error: "店铺分配无效",
  });
  expect(await listUsers()).toEqual([]);
});

test("历史账号没有店铺字段时兼容为全部活跃店铺", async () => {
  setUsers([{ name: "旧运营", password: "secret", createdAt: "2026-06-03", role: "operator" }]);

  expect(await listUsers()).toEqual([
    expect.objectContaining({ name: "旧运营", storeIds: ["NP", "VG", "TR", "SP", "NM"] }),
  ]);
});

test("显式空店铺分配表示没有单店看板权限", async () => {
  setUsers([{ name: "无店铺", password: "secret", createdAt: "2026-06-03", role: "operator", storeIds: [] }]);

  expect(await listUsers()).toEqual([
    expect.objectContaining({ name: "无店铺", storeIds: [] }),
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/users.test.ts`

Expected: FAIL because `addUser` does not accept or return `storeIds`.

- [ ] **Step 3: Implement user store helpers**

In `src/lib/users.ts`, import `STORES` and `StoreId`, add `storeIds?: StoreId[]` to `User`, add `isStoreId`, `normalizeStoreIdsInput`, and `getUserStoreIds`, then update `parseHashedUserSeed`, `listUsers`, and `addUser`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/users.test.ts`

Expected: PASS.

## Task 2: Session and API Surface

**Files:**
- Modify: `src/lib/session-server.ts`
- Modify: `src/app/(main)/api/auth/me/route.ts`
- Modify: `src/app/(main)/api/auth/login/route.ts`
- Modify: `src/app/(main)/api/auth/users/route.ts`
- Test: `src/lib/users.test.ts`

- [ ] **Step 1: Write failing session/API-adjacent tests**

Update existing session expectations in `src/lib/users.test.ts` to include `storeIds`. Add:

```ts
test("会话返回持久化账号的规范化店铺权限", async () => {
  setUsers([
    {
      name: "店铺运营",
      password: "secret",
      createdAt: "2026-06-03",
      role: "operator",
      sessionVersion: 1,
      storeIds: ["VG"],
    },
  ]);
  authToken.payload = { name: "店铺运营", sessionVersion: 1 };

  const { requireSession } = await import("./session-server");

  await expect(requireSession()).resolves.toEqual({
    name: "店铺运营",
    role: "operator",
    isAdmin: false,
    sessionVersion: 1,
    storeIds: ["VG"],
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/users.test.ts`

Expected: FAIL because session return objects do not include `storeIds`.

- [ ] **Step 3: Implement session/API changes**

Update `SessionUser` and `requireSession` to include `storeIds: getUserStoreIds(user)`. Update `/api/auth/me` and `/api/auth/login` responses to return `storeIds`. Update `/api/auth/users` to pass `body.storeIds` into `addUser`.

- [ ] **Step 4: Run tests**

Run: `npm test -- src/lib/users.test.ts`

Expected: PASS.

## Task 3: Account Management UI

**Files:**
- Modify: `src/app/(main)/accounts/accounts-client.tsx`

- [ ] **Step 1: Add typed UI state**

Import `STORES` and `StoreId`, extend `UserInfo` with `storeIds: StoreId[]`, add `newStoreIds` state, and update `mutateUsers` to accept string arrays.

- [ ] **Step 2: Add add-dialog store checkboxes**

Render a "店铺分配" section with one `Checkbox` per active store. Toggle IDs in `newStoreIds`.

- [ ] **Step 3: Send store assignment when creating**

Send `storeIds: newStoreIds` in the `add` mutation and reset `newStoreIds` to `[]` after success.

- [ ] **Step 4: Show assigned stores in the user list**

Show a compact row of assigned store names under each account. If the array is empty, display `未分配店铺`.

## Task 4: Header Store Filtering

**Files:**
- Modify: `src/components/layout/header.tsx`

- [ ] **Step 1: Add current-user store state**

Track `storeIds` from `/api/auth/me` as `StoreId[] | null`.

- [ ] **Step 2: Filter header stores**

Change `activeStores` to include only stores whose IDs are in `storeIds`. Before `/api/auth/me` returns, show no store buttons to avoid briefly exposing unauthorized stores.

## Task 5: Single-Store Dashboard Guard

**Files:**
- Move: `src/app/(main)/store/[id]/page.tsx` to `src/app/(main)/store/[id]/store-page-client.tsx`
- Create: `src/app/(main)/store/[id]/page.tsx`

- [ ] **Step 1: Move the existing client dashboard**

Move the current file to `store-page-client.tsx` and rename the default export to `StorePageClient`.

- [ ] **Step 2: Create server guard page**

Create a new server `page.tsx` that resolves `params`, finds the store, calls `requireSession`, and renders no-permission UI when `session.storeIds` does not include the requested `StoreId`.

- [ ] **Step 3: Render client dashboard only when authorized**

Pass the store ID to `StorePageClient` through a resolved prop or keep the client component signature compatible with the existing `params` promise.

## Task 6: Verification

**Files:**
- Existing test files and TypeScript project

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/lib/users.test.ts src/lib/stores.test.ts`

Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: PASS or only pre-existing warnings unrelated to touched files.

- [ ] **Step 3: Review changed files**

Run: `git diff -- src/lib/users.ts src/lib/users.test.ts src/lib/session-server.ts 'src/app/(main)/api/auth/me/route.ts' 'src/app/(main)/api/auth/login/route.ts' 'src/app/(main)/api/auth/users/route.ts' 'src/app/(main)/accounts/accounts-client.tsx' src/components/layout/header.tsx 'src/app/(main)/store/[id]/page.tsx' 'src/app/(main)/store/[id]/store-page-client.tsx'`

Expected: Diff only contains account store assignment changes.
