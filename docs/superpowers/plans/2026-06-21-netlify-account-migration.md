# Netlify Account Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the verified `main` application to the new Netlify account while preserving the exact user records and enabling production Feishu reads and writes.

**Architecture:** Seed an empty Netlify Blobs user store from a validated `AUTH_USERS_JSON` secret containing existing password hashes, without changing the legacy `AUTH_USERS` path or overwriting non-empty stores. Configure the new site before one production deployment, and keep Feishu writes production-only through explicit configuration plus the Netlify `CONTEXT=production` fallback.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Netlify Blobs, Netlify MCP deployment, Feishu OpenAPI.

---

### Task 1: Preserve Hashed Users During Empty-Site Bootstrap

**Files:**
- Modify: `src/lib/users.test.ts`
- Modify: `src/lib/users.ts`

- [ ] **Step 1: Write failing tests for exact JSON seed import**

Add tests under `describe("用户持久化")` that set `process.env.NETLIFY = "true"`, provide an `AUTH_USERS_JSON` array with exact SHA-256 hashes, roles, dates, session versions, and a deleted tombstone, then assert `seedUsers()` returns and writes the exact array through `netlifyUsersStore.setJSON("users", seed)`.

Add `seedUsers` to the existing import list from `./users` before writing the tests.

```ts
test("Netlify 空 Blobs 从 AUTH_USERS_JSON 原样迁移哈希用户", async () => {
  process.env.NETLIFY = "true";
  const seeded: User[] = [
    {
      name: "管理员",
      password: "a".repeat(64),
      createdAt: "2026-06-01",
      role: "admin",
      sessionVersion: 3,
    },
  ];
  process.env.AUTH_USERS_JSON = JSON.stringify(seeded);

  await expect(seedUsers()).resolves.toEqual(seeded);
  expect(netlifyUsersStore.setJSON).toHaveBeenCalledWith("users", seeded);
});
```

Add tests proving an existing Blob store is never overwritten and malformed hashes or duplicate names reject initialization.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- src/lib/users.test.ts`

Expected: FAIL because `seedUsers()` ignores `AUTH_USERS_JSON`.

- [ ] **Step 3: Implement strict JSON seed validation**

Add a private parser in `src/lib/users.ts` that accepts an array only, requires unique non-empty names, a 64-character lowercase/uppercase hexadecimal password hash, `YYYY-MM-DD` creation date, supported optional role, non-negative integer optional session version, and string optional deletion date.

```ts
const PASSWORD_HASH_PATTERN = /^[a-f0-9]{64}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseHashedUserSeed(raw: string): User[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("AUTH_USERS_JSON 用户种子无效");
  const names = new Set<string>();
  return parsed.map((value) => {
    if (!value || typeof value !== "object") throw new Error("AUTH_USERS_JSON 用户种子无效");
    const user = value as Partial<User>;
    if (!user.name?.trim() || names.has(user.name) || !PASSWORD_HASH_PATTERN.test(user.password || "") ||
        !DATE_PATTERN.test(user.createdAt || "") || (user.role !== undefined && !isUserRole(user.role)) ||
        (user.sessionVersion !== undefined && getUserSessionVersion(user) !== user.sessionVersion) ||
        (user.deletedAt !== undefined && typeof user.deletedAt !== "string")) {
      throw new Error("AUTH_USERS_JSON 用户种子无效");
    }
    names.add(user.name);
    return { ...user, name: user.name } as User;
  });
}
```

In `seedUsers()`, check the existing store first, then prefer non-empty `AUTH_USERS_JSON`; save the validated users unchanged. Preserve the current `AUTH_USERS` fallback.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/lib/users.test.ts`

Expected: all user tests PASS.

- [ ] **Step 5: Commit the user migration implementation**

```bash
git add src/lib/users.ts src/lib/users.test.ts
git commit -m "feat: seed hashed users into Netlify Blobs"
```

### Task 2: Keep Release Safety Aware of the New Secret

**Files:**
- Modify: `.env.example`
- Modify: `src/lib/release-safety.ts`
- Modify: `src/lib/release-safety.test.ts`

- [ ] **Step 1: Write the failing release-safety expectation**

Add `AUTH_USERS_JSON=` to `COMPLETE_ENV_EXAMPLE` and assert a real value is rejected in the existing sensitive-template test.

```ts
expect(
  analyzeReleaseSafety({
    ...baseInput,
    envExample: COMPLETE_ENV_EXAMPLE.replace("AUTH_USERS_JSON=", "AUTH_USERS_JSON=[real-users]"),
  }).errors
).toContain(".env.example 中的 AUTH_USERS_JSON 必须保留为空模板");
```

- [ ] **Step 2: Run the release-safety test and verify RED**

Run: `npm test -- src/lib/release-safety.test.ts`

Expected: FAIL because `AUTH_USERS_JSON` is not yet a required empty secret template.

- [ ] **Step 3: Add the empty template and protected key**

Add `AUTH_USERS_JSON=` immediately after `AUTH_USERS=` in `.env.example` and add `"AUTH_USERS_JSON"` to `REQUIRED_EMPTY_ENV_KEYS` in `src/lib/release-safety.ts`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- src/lib/release-safety.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the release-safety update**

```bash
git add .env.example src/lib/release-safety.ts src/lib/release-safety.test.ts
git commit -m "chore: protect hashed user seed configuration"
```

### Task 3: Verify and Integrate Into Main

**Files:**
- Verify: all repository files
- Merge: `codex/netlify-lark-production-fallback` into `main`

- [ ] **Step 1: Run the complete verification floor**

Run:

```bash
npm test
npm run lint
npm run release:check
npm run build
git diff --check
```

Expected: 0 failures; production build completes; release check reports no tracked local secrets.

- [ ] **Step 2: Review the exact branch delta**

Run:

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
git ls-files .env.local data/users.json .netlify/state.json
```

Expected: only migration code, tests, safe templates, and approved docs are changed; the sensitive-file command prints nothing.

- [ ] **Step 3: Merge locally into main without pushing**

```bash
git switch main
git merge --ff-only codex/netlify-lark-production-fallback
```

Expected: fast-forward to the migration commits.

- [ ] **Step 4: Re-run tests and release safety on merged main**

Run: `npm test && npm run lint && npm run release:check`

Expected: PASS before any external site mutation.

### Task 4: Create and Configure the New Netlify Site

**Files:**
- Read only: `.env.local`
- Read only: `data/users.json`
- Create remotely: Netlify site `ebay-ops-webapp-main`

- [ ] **Step 1: Create the site in the new team**

Use the Netlify project updater with team slug `axin0825` and project name `ebay-ops-webapp-main`. Record the returned site ID and confirm the project list contains exactly the new site before configuration.

- [ ] **Step 2: Build the exact secret payloads locally without printing values**

Parse `.env.local` as dotenv-style key/value data. Select all non-empty keys except `LARK_CLI_PATH` and `LARK_EXTRA_PATH`. Parse `data/users.json`, preserve every record, and serialize it unchanged as `AUTH_USERS_JSON`. Confirm the serialized records match the source by SHA-256 fingerprint and count without emitting hashes or values.

- [ ] **Step 3: Configure environment variables before deployment**

Upsert each selected value to the new site with production context and default scopes. Upsert `AUTH_USERS_JSON` as a secret and `LARK_WRITE_ENABLED=true`. Do not set `AUTH_USERS`; do not expose any value in tool output or the final response.

- [ ] **Step 4: Confirm configuration completeness without broad secret listing**

Track successful upsert acknowledgements for every expected key. Required keys are `JWT_SECRET`, `DEEPSEEK_API_KEY`, `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_BASE_TOKEN`, all non-empty `LARK_TABLE_*` values from local configuration, `AUTH_USERS_JSON`, and `LARK_WRITE_ENABLED`. Stop before deployment if any upsert fails.

### Task 5: Deploy Once and Verify Production

**Files:**
- Deploy source: clean temporary Git worktree at `/private/tmp/ebay-ops-netlify-main`

- [ ] **Step 1: Create a clean deploy source**

```bash
git worktree add --detach /private/tmp/ebay-ops-netlify-main main
```

Expected: clean tracked source without `.env.local`, `data/users.json`, `.next`, or repository `node_modules`.

- [ ] **Step 2: Generate and run one Netlify production deployment command**

Request the authenticated deploy command for the new site ID, then run it exactly once from `/private/tmp/ebay-ops-netlify-main`. Do not retry automatically if it fails.

Expected: one production deploy reaches `ready` with the current `main` commit and Next.js plugin success.

- [ ] **Step 3: Verify deploy integrity**

Read the deploy record and confirm `state=ready`, `context=production`, no error message, one server handler, and zero secret-scan matches.

- [ ] **Step 4: Initialize the exact user Blob without creating a session**

POST one invalid login for an existing seeded username using a deliberately wrong password. Expected: 401. This invokes `seedUsers()`, writes the exact JSON seed only because the Blob store is empty, and creates no session cookie.

- [ ] **Step 5: Verify Feishu read and write authorization without data mutation**

Use the local Feishu credentials to acquire a tenant token. For each configured table, run a one-record read request; for write-critical tables, call `batch_create` with an empty `records` array and require API success with zero created records. Never send business fields.

- [ ] **Step 6: Verify the application write gate**

POST `/api/inventory/sales-scan` with a deliberately invalid bearer token. Expected: HTTP 401 authentication error, not HTTP 500 “飞书写入已关闭”. The request stops before repository construction and cannot write records.

- [ ] **Step 7: Clean temporary deployment state**

Remove the temporary worktree only after all read-only verification completes:

```bash
git worktree remove /private/tmp/ebay-ops-netlify-main
git worktree prune
```

Keep `main` and the new Netlify site intact.
