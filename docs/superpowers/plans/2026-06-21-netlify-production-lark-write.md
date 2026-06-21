# Netlify Production 自动开启飞书写入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 GitHub `main` 触发的 Netlify Production Deploy 自动获得飞书写权限，同时保持本地、Deploy Preview 和 branch deploy 只读。

**Architecture:** 使用 Netlify 的 production deploy context 在 `netlify.toml` 中注入 `LARK_WRITE_ENABLED=true`，不修改应用内 `assertLarkWriteEnabled()` 的 fail-closed 保护。新增独立配置回归测试，锁定“Production 开启、全局不开启”的边界，并同步发布文档。

**Tech Stack:** Netlify TOML、Next.js 16、TypeScript、Vitest、npm release checks

---

## File Structure

- Modify `netlify.toml`: 仅在 Netlify production context 注入飞书写入开关。
- Create `src/lib/netlify-config.test.ts`: 读取并检查仓库中的 Netlify 配置，防止 Production 开关被移除或误放到全局 context。
- Modify `README.md`: 更新数据安全和环境变量说明。
- Modify `docs/deployment-reform.md`: 更新发布规则、Netlify UI 核对项和生产环境变量说明。

### Task 1: 锁定 Netlify Production 写入边界

**Files:**
- Create: `src/lib/netlify-config.test.ts`
- Modify: `netlify.toml`

- [ ] **Step 1: 写入失败的配置回归测试**

创建 `src/lib/netlify-config.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const netlifyToml = readFileSync(resolve(process.cwd(), "netlify.toml"), "utf8");

function getTomlSection(name: string): string {
  const header = `[${name}]`;
  const start = netlifyToml.indexOf(header);
  if (start < 0) return "";

  const remainder = netlifyToml.slice(start + header.length);
  const nextHeader = remainder.search(/\n\s*\[/);
  return nextHeader < 0 ? remainder : remainder.slice(0, nextHeader);
}

describe("Netlify 飞书写入配置", () => {
  it("只在 Production context 自动开启飞书写入", () => {
    expect(getTomlSection("context.production.environment")).toMatch(
      /^\s*LARK_WRITE_ENABLED\s*=\s*"true"\s*$/m,
    );
  });

  it("全局 build environment 不开启飞书写入", () => {
    expect(getTomlSection("build.environment")).not.toMatch(/LARK_WRITE_ENABLED/);
  });
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```bash
npm test -- src/lib/netlify-config.test.ts
```

Expected: 第一个测试 FAIL，提示空的 Production context 不匹配 `LARK_WRITE_ENABLED = "true"`；第二个测试 PASS。

- [ ] **Step 3: 在 Production context 开启飞书写入**

在 `netlify.toml` 的 `[build.environment]` 之后加入：

```toml
[context.production.environment]
  LARK_WRITE_ENABLED = "true"
```

完成后的配置保持 `NODE_VERSION` 在全局 build environment，而 `LARK_WRITE_ENABLED` 只出现在 production environment。

- [ ] **Step 4: 运行聚焦测试并确认通过**

Run:

```bash
npm test -- src/lib/netlify-config.test.ts
```

Expected: 2 tests PASS。

- [ ] **Step 5: 提交配置与测试**

```bash
git add netlify.toml src/lib/netlify-config.test.ts
git commit -m "fix: enable Lark writes in Netlify production"
```

### Task 2: 更新发布与安全文档

**Files:**
- Modify: `README.md`
- Modify: `docs/deployment-reform.md`

- [ ] **Step 1: 更新 README 的权限边界**

将数据安全中的写入说明改为：

```markdown
- 飞书写入在本地、Deploy Preview 和 branch deploy 中默认关闭；GitHub `main` 触发的 Netlify Production Deploy 通过 production context 自动设置 `LARK_WRITE_ENABLED=true`。
```

将环境变量表的 `LARK_WRITE_ENABLED` 说明改为：

```markdown
| `LARK_WRITE_ENABLED` | 是否允许写入飞书；本地和预览默认 `false`，Netlify Production 自动为 `true` |
```

- [ ] **Step 2: 更新 Netlify 发布手册**

在 `docs/deployment-reform.md` 中做以下精确调整：

1. 将禁止事项“Deploy Preview 或 branch deploy 不开启写入”保留并明确为只读边界。
2. 将 Netlify UI 设置第 9、10 项改为：

```markdown
9. Deploy Previews/branch deploy 不设置 `LARK_WRITE_ENABLED=true`，保持只读。
10. Production context 由仓库 `netlify.toml` 自动设置 `LARK_WRITE_ENABLED=true`；Netlify UI 不要用同名变量覆盖该值。
```

3. 将“飞书写入与自动扫描”中的开关说明改为：

```markdown
- `LARK_WRITE_ENABLED=false`：本地、preview、branch deploy 的默认只读状态
- `LARK_WRITE_ENABLED=true`：由 `netlify.toml` 的 Production context 自动注入，不需要每次发布手动开启
```

- [ ] **Step 3: 运行发布安全检查**

Run:

```bash
npm run release:check
```

Expected: exit 0；允许出现当前分支相关警告，但不得出现敏感文件、敏感实值或 Netlify 上传脚本错误。

- [ ] **Step 4: 运行完整测试**

Run:

```bash
npm test
```

Expected: 所有测试 PASS，包含 `src/lib/netlify-config.test.ts` 的 2 个测试。

- [ ] **Step 5: 运行 lint**

Run:

```bash
npm run lint
```

Expected: exit 0，无 ESLint error。

- [ ] **Step 6: 提交文档**

```bash
git add README.md docs/deployment-reform.md
git commit -m "docs: document Netlify production Lark writes"
```

### Task 3: 最终核验改动范围

**Files:**
- Verify: `netlify.toml`
- Verify: `src/lib/netlify-config.test.ts`
- Verify: `README.md`
- Verify: `docs/deployment-reform.md`

- [ ] **Step 1: 检查目标提交和工作区状态**

Run:

```bash
git log -3 --oneline
git status -sb
```

Expected: 最近提交包含 Production 配置/测试与文档更新；用户原有未提交文件仍保持原状，不进入本次提交。

- [ ] **Step 2: 检查最终 diff 中的权限边界**

Run:

```bash
git show --stat --oneline HEAD~1..HEAD
git show --format= -- netlify.toml src/lib/netlify-config.test.ts README.md docs/deployment-reform.md
```

Expected: `LARK_WRITE_ENABLED=true` 只位于 `[context.production.environment]`；没有飞书 Token、Secret、表 ID 或其他敏感实值。
