# Netlify Git Release Reform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the project toward GitHub `main` based Netlify production releases while protecting Netlify Blobs users, local user files, and Lark Base credentials from accidental publish or deploy.

**Architecture:** Add a local release safety checker that inspects only repository files and Git metadata, then document the manual Netlify UI steps that cannot be performed safely by automation. The checker blocks tracked secrets/runtime files and warns about direct Netlify deploy scripts or stale local Netlify linkage.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Node.js CLI script, Netlify Git-based deploys.

---

### Task 1: Release Safety Checker

**Files:**
- Create: `src/lib/release-safety.ts`
- Create: `src/lib/release-safety.test.ts`
- Create: `scripts/check-release-safety.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write tests for repository safety rules**

Create tests that verify:
- tracked `.env`, `.env.local`, `data/users.json`, and `.netlify/state.json` are release blockers
- sensitive Netlify/Lark env templates are present and empty in `.env.example`
- package scripts containing `netlify deploy` are release blockers
- stale `.netlify/state.json` site IDs are warnings rather than blockers

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run: `npm test -- src/lib/release-safety.test.ts`

Expected: FAIL because `src/lib/release-safety.ts` does not exist yet.

- [ ] **Step 3: Implement checker and CLI**

Implement pure TypeScript checks in `src/lib/release-safety.ts`, then add a Node CLI that reads `.env.example`, `.netlify/state.json`, `package.json`, and `git ls-files`.

- [ ] **Step 4: Run the targeted test and confirm it passes**

Run: `npm test -- src/lib/release-safety.test.ts`

Expected: PASS.

### Task 2: Deployment Runbook

**Files:**
- Create: `docs/deployment-reform.md`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add required production env placeholders**

Add empty placeholders for Lark OpenAPI and secondary Base configuration:
- `LARK_APP_ID=`
- `LARK_APP_SECRET=`
- `LARK_BASE_FINANCE=`
- `LARK_TABLE_FINANCE=`

- [ ] **Step 2: Write the runbook**

Document:
- keep the existing Netlify site `ebay-ops-webapp-v1`
- set Netlify production branch to `main`
- keep `develop` local-only unless branch deploys are deliberately enabled
- keep Netlify Blobs user data on the existing site
- store Lark/JWT secrets only in Netlify environment variables
- use OpenAPI credentials in production instead of relying on `lark-cli`
- keep preview/branch contexts read-only with `LARK_WRITE_ENABLED=false`

- [ ] **Step 3: Link the runbook from README**

Add `npm run release:check` and the release runbook to the verification/release notes.

### Task 3: Verify Without Netlify Usage

**Files:**
- No code changes beyond Tasks 1-2.

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- src/lib/release-safety.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the local safety check**

Run: `npm run release:check`

Expected: no Netlify deploy, no build, no upload. The command should report local warnings only if the current branch is not a release branch or local `.netlify/state.json` is stale.

- [ ] **Step 3: Report remaining manual steps**

Report that Netlify UI Git connection, production branch selection, environment variable values, and optional `.netlify/state.json` relink still require user-controlled action.
