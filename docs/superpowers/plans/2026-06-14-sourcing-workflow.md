# Sourcing Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WebApp sourcing registration form that writes candidate product records to the existing Feishu `16_选品池` workflow table.

**Architecture:** Reuse the existing generic Lark write API and the existing `/data-entry` page instead of adding a new module. The backend gets a new `sourcing` Lark table mapping, the save-record route accepts that table and normalizes workflow date fields, and the client form submits the operator-entered fields plus current-user registration metadata.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, existing shadcn-style UI components, existing `lark-server.ts` CLI/OpenAPI abstraction.

---

## File Structure

- Modify `src/lib/lark-server.ts`: add `sourcing` to `TABLE_ENV_KEYS` so `getLarkTableId("sourcing")` reads `LARK_TABLE_SOURCING`.
- Modify `src/lib/lark-server.test.ts`: extend the environment-variable mapping test to cover `sourcing`.
- Create `src/app/(main)/api/lark/save-record/route.test.ts`: unit-test that `table: "sourcing"` is accepted and that `登记时间` is normalized before calling `createLarkRecords`.
- Modify `src/app/(main)/api/lark/save-record/route.ts`: add `sourcing` to `TABLE_MAP` and add sourcing date fields to `DATE_FIELDS`.
- Modify `src/app/(main)/data-entry/page.tsx`: add a `选品登记` tab and `SourcingForm` component using the existing `useSubmit` helper and UI components.
- No changes to `.env.example` are required because `LARK_TABLE_SOURCING` already exists.

## Task 1: Add Backend Table Mapping

**Files:**
- Modify: `src/lib/lark-server.test.ts`
- Modify: `src/lib/lark-server.ts`

- [ ] **Step 1: Write the failing table mapping test**

In `src/lib/lark-server.test.ts`, extend the existing `it.each` in `describe("飞书表格环境变量", ...)` so it includes sourcing:

```ts
describe("飞书表格环境变量", () => {
  it.each([
    ["sourcing", "LARK_TABLE_SOURCING"],
    ["purchaseBatch", "LARK_TABLE_PURCHASE_BATCH"],
    ["shipmentBatch", "LARK_TABLE_SHIPMENT_BATCH"],
    ["inventoryDetail", "LARK_TABLE_INVENTORY_DETAIL"],
    ["inventoryException", "LARK_TABLE_INVENTORY_EXCEPTION"],
  ] as const)("%s 使用 %s", (table, envKey) => {
    vi.stubEnv(envKey, `${table}-table-id`);

    expect(getLarkTableId(table)).toBe(`${table}-table-id`);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- src/lib/lark-server.test.ts
```

Expected: FAIL with a TypeScript or runtime error showing `sourcing` is not assignable to `LarkTable` or has no configured table env key.

- [ ] **Step 3: Implement the minimal table mapping**

In `src/lib/lark-server.ts`, add `sourcing` to `TABLE_ENV_KEYS` near the existing business tables:

```ts
const TABLE_ENV_KEYS = {
  sku: "LARK_TABLE_SKU",
  sales: "LARK_TABLE_SALES",
  stockFlow: "LARK_TABLE_STOCK_FLOW",
  issues: "LARK_TABLE_ISSUES",
  competitors: "LARK_TABLE_COMPETITORS",
  replenish: "LARK_TABLE_REPLENISH",
  listing: "LARK_TABLE_LISTING",
  sourcing: "LARK_TABLE_SOURCING",
  flow: "LARK_TABLE_FLOW",
  strategy: "LARK_TABLE_STOCK_STRATEGY",
  summary: "LARK_TABLE_SKU_SUMMARY",
  purchaseBatch: "LARK_TABLE_PURCHASE_BATCH",
  shipmentBatch: "LARK_TABLE_SHIPMENT_BATCH",
  inventoryDetail: "LARK_TABLE_INVENTORY_DETAIL",
  inventoryException: "LARK_TABLE_INVENTORY_EXCEPTION",
  inventoryTransaction: "LARK_TABLE_INVENTORY_TRANSACTION",
  inventoryWarning: "LARK_TABLE_INVENTORY_WARNING",
  finance: "LARK_TABLE_FINANCE",
} as const;
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
npm test -- src/lib/lark-server.test.ts
```

Expected: PASS for `src/lib/lark-server.test.ts`.

- [ ] **Step 5: Commit backend mapping**

Run:

```bash
git add src/lib/lark-server.ts src/lib/lark-server.test.ts
git commit -m "feat: map sourcing lark table"
```

## Task 2: Add Save-Record API Coverage

**Files:**
- Create: `src/app/(main)/api/lark/save-record/route.test.ts`
- Modify: `src/app/(main)/api/lark/save-record/route.ts`

- [ ] **Step 1: Write the failing route test**

Create `src/app/(main)/api/lark/save-record/route.test.ts`:

```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lark = vi.hoisted(() => ({
  assertLarkWriteEnabled: vi.fn(),
  createLarkRecords: vi.fn(),
  resolveLarkUserReference: vi.fn(),
  syncSalesSummary: vi.fn(),
  syncStockSummaryFromFlow: vi.fn(),
}));

vi.mock("@/lib/lark-server", () => ({
  assertLarkWriteEnabled: lark.assertLarkWriteEnabled,
  createLarkRecords: lark.createLarkRecords,
  resolveLarkUserReference: lark.resolveLarkUserReference,
  syncSalesSummary: lark.syncSalesSummary,
  syncStockSummaryFromFlow: lark.syncStockSummaryFromFlow,
}));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("https://internal.test/api/lark/save-record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  lark.assertLarkWriteEnabled.mockReset();
  lark.createLarkRecords.mockReset();
  lark.createLarkRecords.mockResolvedValue(["rec-sourcing-1"]);
  lark.resolveLarkUserReference.mockReset();
  lark.syncSalesSummary.mockReset();
  lark.syncStockSummaryFromFlow.mockReset();
});

describe("save-record sourcing", () => {
  it("accepts sourcing records and normalizes registration time", async () => {
    const response = await POST(request({
      table: "sourcing",
      fields: {
        OEM码: "84306-0E010",
        英文名称: "Clock Spring",
        中文名称: "方向盘游丝",
        登记人: "运营",
        登记时间: "2026/06/14",
        选品阶段: "初选待处理",
      },
    }));
    const json = await response.json() as { success?: boolean; recordIds?: string[] };

    expect(response.status).toBe(200);
    expect(json).toEqual({ success: true, table: "sourcing", recordIds: ["rec-sourcing-1"] });
    expect(lark.createLarkRecords).toHaveBeenCalledWith("sourcing", [{
      OEM码: "84306-0E010",
      英文名称: "Clock Spring",
      中文名称: "方向盘游丝",
      登记人: "运营",
      登记时间: Date.parse("2026-06-14T00:00:00+08:00"),
      选品阶段: "初选待处理",
    }]);
    expect(lark.syncSalesSummary).not.toHaveBeenCalled();
    expect(lark.syncStockSummaryFromFlow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the route test and verify it fails**

Run:

```bash
npm test -- 'src/app/(main)/api/lark/save-record/route.test.ts'
```

Expected: FAIL with `未知表: sourcing` or an assertion that `createLarkRecords` was not called with `"sourcing"`.

- [ ] **Step 3: Implement sourcing support in the route**

In `src/app/(main)/api/lark/save-record/route.ts`, update the maps:

```ts
const TABLE_MAP: Record<string, LarkTable> = {
  skuMaster: "sku",
  sales: "sales",
  stockFlow: "stockFlow",
  issues: "issues",
  competitors: "competitors",
  replenish: "replenish",
  sourcing: "sourcing",
};

const DATE_FIELDS: Partial<Record<LarkTable, string[]>> = {
  sales: ["日期"],
  stockFlow: ["日期"],
  issues: ["创建日期"],
  competitors: ["记录日期"],
  sourcing: ["登记时间", "初选时间", "询价时间"],
};
```

- [ ] **Step 4: Run the route test and verify it passes**

Run:

```bash
npm test -- 'src/app/(main)/api/lark/save-record/route.test.ts'
```

Expected: PASS for the new route test.

- [ ] **Step 5: Run backend tests together**

Run:

```bash
npm test -- src/lib/lark-server.test.ts 'src/app/(main)/api/lark/save-record/route.test.ts'
```

Expected: PASS for both test files.

- [ ] **Step 6: Commit API support**

Run:

```bash
git add 'src/app/(main)/api/lark/save-record/route.ts' 'src/app/(main)/api/lark/save-record/route.test.ts'
git commit -m "feat: allow sourcing record saves"
```

## Task 3: Add Sourcing Form to Data Entry

**Files:**
- Modify: `src/app/(main)/data-entry/page.tsx`

- [ ] **Step 1: Re-read the current page before editing**

Run:

```bash
sed -n '1,460p' 'src/app/(main)/data-entry/page.tsx'
```

Expected: confirm the current tabs are `sku`, `sales`, `issues`, and `competitors`; preserve any uncommitted user edits already present in this file.

- [ ] **Step 2: Add the tab trigger and content**

In `DataEntryPage`, update the `TabsList` and add the content immediately after the competitor tab content:

```tsx
<TabsList className="flex w-full justify-start overflow-x-auto">
  <TabsTrigger value="sku">SKU 主数据</TabsTrigger>
  <TabsTrigger value="sales">销售日报</TabsTrigger>
  <TabsTrigger value="issues">客服异常</TabsTrigger>
  <TabsTrigger value="competitors">竞品</TabsTrigger>
  <TabsTrigger value="sourcing">选品登记</TabsTrigger>
</TabsList>
```

```tsx
<TabsContent value="competitors">
  <CompetitorForm skuList={skuList} today={today} />
</TabsContent>
<TabsContent value="sourcing">
  <SourcingForm />
</TabsContent>
```

- [ ] **Step 3: Add the SourcingForm component**

Append this component before `CompetitorForm` or after it in `src/app/(main)/data-entry/page.tsx`; keep it in the same file to match the existing data-entry pattern:

```tsx
// ==============================================================
//  选品登记
// ==============================================================
function SourcingForm() {
  const { submitting, submit } = useSubmit();
  const defaultForm = {
    OEM码: "",
    品牌: "",
    商品链接: "",
    英文名称: "",
    中文名称: "",
    近90天销量: "",
    eBay平均售价: "",
    选品备注: "",
  };
  const [form, setForm] = useState(defaultForm);

  const f = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm({ ...form, [key]: event.target.value });
    },
  });

  const parseOptionalInteger = (value: string) => {
    if (!value.trim()) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };

  const parseOptionalMoney = (value: string) => {
    if (!value.trim()) return undefined;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : Number.NaN;
  };

  const handleSubmit = async () => {
    if (!form.OEM码.trim() || !form.英文名称.trim() || !form.中文名称.trim()) {
      toast.error("请填写 OEM码、英文名称和中文名称");
      return;
    }

    const sales90 = parseOptionalInteger(form.近90天销量);
    if (Number.isNaN(sales90)) {
      toast.error("近90天销量必须是整数");
      return;
    }

    const ebayAveragePrice = parseOptionalMoney(form.eBay平均售价);
    if (Number.isNaN(ebayAveragePrice)) {
      toast.error("eBay平均售价必须是数字");
      return;
    }

    const me = await fetch("/api/auth/me").then((response) => response.json()).catch(() => null) as { name?: string | null } | null;
    if (!me?.name) {
      toast.error("登录状态失效，请重新登录");
      return;
    }

    const payload: Record<string, unknown> = {
      OEM码: form.OEM码.trim(),
      品牌: form.品牌.trim(),
      商品链接: form.商品链接.trim(),
      英文名称: form.英文名称.trim(),
      中文名称: form.中文名称.trim(),
      选品备注: form.选品备注.trim(),
      登记人: me.name,
      登记时间: new Date().toISOString(),
      选品阶段: "初选待处理",
    };
    if (sales90 !== undefined) payload.近90天销量 = sales90;
    if (ebayAveragePrice !== undefined) payload.eBay平均售价 = ebayAveragePrice;

    const ok = await submit("sourcing", payload);
    if (ok) setForm({ ...defaultForm });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">选品登记</CardTitle>
        <CardDescription>登记候选商品，写入 16_选品池，并进入初选待处理视图。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">商品身份</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="text-[10px] text-gray-400">OEM码 *</label>
              <Input {...f("OEM码")} placeholder="如 84306-0E010" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">品牌</label>
              <Input {...f("品牌")} placeholder="Toyota / Honda" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">商品链接</label>
              <Input {...f("商品链接")} placeholder="https://www.ebay.com/itm/..." />
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">商品名称</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] text-gray-400">英文名称 *</label>
              <Input {...f("英文名称")} placeholder="Steering Wheel Clock Spring" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">中文名称 *</label>
              <Input {...f("中文名称")} placeholder="方向盘游丝" />
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">市场数据与备注</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] text-gray-400">近90天销量</label>
              <Input {...f("近90天销量")} type="number" min="0" step="1" placeholder="如 120" />
            </div>
            <div>
              <label className="text-[10px] text-gray-400">eBay平均售价 ($)</label>
              <Input {...f("eBay平均售价")} type="number" min="0" step="0.01" placeholder="如 29.99" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] text-gray-400">备注</label>
              <Input {...f("选品备注")} placeholder="竞争情况、车型适配、风险点等" />
            </div>
          </div>
        </div>

        <Button onClick={handleSubmit} disabled={submitting} className="w-full">
          {submitting ? "提交中..." : "提交选品记录"}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run lint on the touched page**

Run:

```bash
npm run lint -- 'src/app/(main)/data-entry/page.tsx'
```

Expected: PASS, or ESLint reports only pre-existing issues unrelated to the new `SourcingForm`. If ESLint reports a new hook/type/import issue, fix it before continuing.

- [ ] **Step 5: Commit the form**

Run:

```bash
git add 'src/app/(main)/data-entry/page.tsx'
git commit -m "feat: add sourcing registration form"
```

## Task 4: Full Verification

**Files:**
- Verify all modified files from Tasks 1-3.

- [ ] **Step 1: Run all unit tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Check worktree**

Run:

```bash
git status -sb
```

Expected: branch is ahead by the new commits; unrelated pre-existing changes may still be listed and must not be reverted.

- [ ] **Step 4: Final implementation summary**

Report:

```text
Implemented sourcing workflow WebApp integration:
- Added sourcing Lark table mapping.
- Added save-record API support and tests.
- Added 选品登记 tab in 数据录入.
- Verified with npm test and npm run lint.
```
