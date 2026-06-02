# 库存批次账本与服务端编排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在飞书中建立批次库存账本，并让服务端安全地完成批量进货、部分数量拆分、跨仓成对流水、期初余额初始化和汇总重建。

**Architecture:** `22_SKU批次库存明细` 是当前库存位置的权威账本，`02_库存流水` 是只追加的事件日志，`19_SKU运营汇总` 从明细重算。网页服务端负责状态机、幂等事务号和版本校验；飞书公式只做展示，避免用飞书工作流承担核心扣增。

**Tech Stack:** Next.js 16 App Router、TypeScript、Vitest、飞书多维表格 OpenAPI、现有 `lark-cli` 本地回退。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `src/lib/inventory-flow.ts` | 七段状态机、位置映射、拆分规则和汇总计算，保持纯函数 |
| `src/lib/inventory-flow.test.ts` | 状态机、部分流转、成对流水、期初余额和汇总单元测试 |
| `src/lib/session-server.ts` | 从 JWT Cookie 读取当前用户与角色 |
| `src/lib/inventory-batch-server.ts` | 飞书记录编排、幂等、版本校验、汇总重建 |
| `src/lib/inventory-batch-server.test.ts` | 使用内存仓库验证幂等和失败恢复 |
| `src/app/(main)/api/inventory-flow/data/route.ts` | 读取采购批次、物流批次、明细和异常 |
| `src/app/(main)/api/inventory-flow/purchase-batches/route.ts` | 创建采购批次与入库明细 |
| `src/app/(main)/api/inventory-flow/shipments/route.ts` | 创建头程物流批次并绑定待发明细 |
| `src/app/(main)/api/inventory-flow/transitions/route.ts` | 批量推进和部分数量拆分 |
| `src/app/(main)/api/inventory-flow/exceptions/route.ts` | 异常补回或报损 |
| `src/app/(main)/api/inventory-flow/opening-balances/route.ts` | 预览和执行期初余额初始化 |
| `.env.example` | 新增四张表的环境变量 |
| `README.md` | 环境变量与上线顺序说明 |

## Task 1: 引入轻量单元测试

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: 安装 Vitest**

Run:

```bash
npm install --save-dev vitest
```

Expected: `package.json` 和 `package-lock.json` 更新，安装完成无错误。

- [ ] **Step 2: 增加测试命令**

在 `package.json` 的 `scripts` 中加入：

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: 创建 Vitest 配置**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 4: 验证测试命令**

Run:

```bash
npm test
```

Expected: 命令成功运行；尚无测试文件时输出 `No test files found`，退出码可能为 `1`，属于预期。

- [ ] **Step 5: 提交**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "test: 增加库存流转单元测试基础设施"
```

## Task 2: 实现库存状态机纯函数

**Files:**
- Create: `src/lib/inventory-flow.ts`
- Create: `src/lib/inventory-flow.test.ts`

- [ ] **Step 1: 先写失败测试**

```ts
import { describe, expect, it } from "vitest";
import {
  buildLocationLedger,
  createOpeningDetails,
  planDetailTransition,
  summarizeDetails,
  validateNextState,
} from "@/lib/inventory-flow";

describe("inventory flow", () => {
  it("只允许按顺序推进", () => {
    expect(validateNextState("本地仓待清点", "待包装")).toBe(true);
    expect(validateNextState("本地仓待清点", "橙联可售")).toBe(false);
  });

  it("跨仓推进生成一减一增成对流水", () => {
    expect(buildLocationLedger("待包装", "已发往国内集货仓", 80)).toEqual([
      { 库存位置: "本地仓", 数量变动: -80 },
      { 库存位置: "国内集货仓", 数量变动: 80 },
    ]);
  });

  it("同一仓内状态推进不产生库存扣增", () => {
    expect(buildLocationLedger("本地仓待清点", "待包装", 80)).toEqual([]);
  });

  it("部分数量推进会保留剩余明细", () => {
    const result = planDetailTransition({
      detail: { 明细编号: "LOT-1", SKU: "SKU-1", 当前数量: 100, 当前状态: "待包装", 版本号: 1 },
      quantity: 80,
      nextState: "已发往国内集货仓",
      movedDetailId: "LOT-2",
      transactionId: "MOVE-1",
      operator: "车泉",
      now: 1780400000000,
    });
    expect(result.sourceUpdate.当前数量).toBe(20);
    expect(result.sourceUpdate.当前状态).toBe("待包装");
    expect(result.movedCreate?.当前数量).toBe(80);
    expect(result.movedCreate?.当前状态).toBe("已发往国内集货仓");
  });

  it("整行推进只更新原明细，不创建重复明细", () => {
    const result = planDetailTransition({
      detail: { 明细编号: "LOT-1", SKU: "SKU-1", 当前数量: 100, 当前状态: "待包装", 版本号: 1 },
      quantity: 100,
      nextState: "已发往国内集货仓",
      movedDetailId: "LOT-2",
      transactionId: "MOVE-2",
      operator: "车泉",
      now: 1780400000000,
    });
    expect(result.sourceUpdate.明细编号).toBe("LOT-1");
    expect(result.sourceUpdate.当前数量).toBe(100);
    expect(result.sourceUpdate.当前状态).toBe("已发往国内集货仓");
    expect(result.movedCreate).toBeUndefined();
  });

  it("期初余额按三个已有位置创建明细", () => {
    expect(createOpeningDetails({
      SKU: "SKU-1",
      中文品名: "方向游丝",
      本地库存: 10,
      橙联在途: 20,
      橙联可售: 30,
    }, "20260602")).toHaveLength(3);
  });

  it("从明细重算汇总", () => {
    expect(summarizeDetails([
      { SKU: "SKU-1", 当前数量: 10, 异常数量: 0, 当前状态: "待包装" },
      { SKU: "SKU-1", 当前数量: 20, 异常数量: 0, 当前状态: "橙联在途" },
      { SKU: "SKU-1", 当前数量: 30, 异常数量: 2, 当前状态: "橙联可售" },
    ])).toEqual({
      "SKU-1": { 本地库存: 10, 国内集货仓: 0, 橙联在途: 20, 橙联可售: 30, 异常暂存: 2, 总可用库存: 60, 账面总量: 62 },
    });
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- src/lib/inventory-flow.test.ts
```

Expected: FAIL，提示无法找到 `@/lib/inventory-flow`。

- [ ] **Step 3: 写最小实现**

```ts
export const INVENTORY_STATES = [
  "本地仓待清点",
  "待包装",
  "已发往国内集货仓",
  "国内集货仓待发",
  "橙联在途",
  "海外仓待上架",
  "橙联可售",
] as const;

export type InventoryState = typeof INVENTORY_STATES[number];
export type InventoryLocation = "本地仓" | "国内集货仓" | "橙联在途" | "橙联可售" | "异常暂存";

export interface InventoryDetail {
  明细编号?: string;
  SKU: string;
  中文品名快照?: string;
  当前数量: number;
  异常数量?: number;
  当前状态: InventoryState;
  版本号?: number;
  最近操作人?: string;
  最近更新时间?: number;
  最近流转事务号?: string;
  备注?: string;
}

const LOCATION_BY_STATE: Record<InventoryState, InventoryLocation> = {
  本地仓待清点: "本地仓",
  待包装: "本地仓",
  已发往国内集货仓: "国内集货仓",
  国内集货仓待发: "国内集货仓",
  橙联在途: "橙联在途",
  海外仓待上架: "橙联在途",
  橙联可售: "橙联可售",
};

export function validateNextState(current: InventoryState, next: InventoryState): boolean {
  return INVENTORY_STATES.indexOf(next) === INVENTORY_STATES.indexOf(current) + 1;
}

export function buildLocationLedger(current: InventoryState, next: InventoryState, quantity: number) {
  const from = LOCATION_BY_STATE[current];
  const to = LOCATION_BY_STATE[next];
  return from === to ? [] : [
    { 库存位置: from, 数量变动: -quantity },
    { 库存位置: to, 数量变动: quantity },
  ];
}

export function planDetailTransition(input: {
  detail: InventoryDetail;
  quantity: number;
  nextState: InventoryState;
  movedDetailId: string;
  transactionId: string;
  operator: string;
  now: number;
}) {
  if (!validateNextState(input.detail.当前状态, input.nextState)) throw new Error("非法状态推进");
  if (input.quantity <= 0 || input.quantity > input.detail.当前数量) throw new Error("流转数量超限");
  const common = {
    最近操作人: input.operator,
    最近更新时间: input.now,
    最近流转事务号: input.transactionId,
    版本号: (input.detail.版本号 || 0) + 1,
  };
  if (input.quantity === input.detail.当前数量) {
    return {
      sourceUpdate: { ...input.detail, ...common, 当前状态: input.nextState },
      movedCreate: undefined,
    };
  }
  return {
    sourceUpdate: { ...input.detail, ...common, 当前数量: input.detail.当前数量 - input.quantity },
    movedCreate: {
      ...input.detail,
      ...common,
      明细编号: input.movedDetailId,
      原始数量: input.quantity,
      当前数量: input.quantity,
      当前状态: input.nextState,
    },
  };
}

export function createOpeningDetails(summary: { SKU: string; 中文品名?: string; 本地库存?: number; 橙联在途?: number; 橙联可售?: number }, suffix: string): InventoryDetail[] {
  return ([
    ["本地库存", "本地仓待清点"],
    ["橙联在途", "橙联在途"],
    ["橙联可售", "橙联可售"],
  ] as const).flatMap(([field, state], index) => {
    const quantity = summary[field] || 0;
    return quantity > 0 ? [{
      明细编号: `OPEN-${suffix}-${summary.SKU}-${index + 1}`,
      SKU: summary.SKU,
      中文品名快照: summary.中文品名,
      当前数量: quantity,
      当前状态: state,
      版本号: 1,
      备注: "期初库存导入",
    }] : [];
  });
}

export function summarizeDetails(details: Array<Pick<InventoryDetail, "SKU" | "当前数量" | "当前状态" | "异常数量">>) {
  const result: Record<string, { 本地库存: number; 国内集货仓: number; 橙联在途: number; 橙联可售: number; 异常暂存: number; 总可用库存: number; 账面总量: number }> = {};
  for (const detail of details) {
    const summary = result[detail.SKU] ||= { 本地库存: 0, 国内集货仓: 0, 橙联在途: 0, 橙联可售: 0, 异常暂存: 0, 总可用库存: 0, 账面总量: 0 };
    const field = LOCATION_BY_STATE[detail.当前状态];
    if (field !== "异常暂存") summary[field] += detail.当前数量;
    summary.异常暂存 += detail.异常数量 || 0;
    summary.总可用库存 = summary.本地库存 + summary.国内集货仓 + summary.橙联在途 + summary.橙联可售;
    summary.账面总量 = summary.总可用库存 + summary.异常暂存;
  }
  return result;
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
npm test -- src/lib/inventory-flow.test.ts
```

Expected: PASS，7 个测试通过。

- [ ] **Step 5: 提交**

```bash
git add src/lib/inventory-flow.ts src/lib/inventory-flow.test.ts
git commit -m "feat: 增加库存批次状态机与汇总纯函数"
```

## Task 3: 建立飞书表结构并调整权限

**Files:**
- Modify: `.env.example`
- Modify locally only: `.env.local`
- Modify: `README.md`

- [ ] **Step 1: 读取现有结构并保存只读快照**

Run sequentially:

```bash
lark-cli base +table-list --base-token "$LARK_BASE_TOKEN" --as user
lark-cli base +field-list --base-token "$LARK_BASE_TOKEN" --table-id tbl7aa7a0MaSsUSr --as user
lark-cli base +field-list --base-token "$LARK_BASE_TOKEN" --table-id tblaVriWnH87co3h --as user
```

Expected: 返回当前表清单、`02_库存流水` 和 `19_SKU运营汇总` 字段。不要并发执行这些 list 命令。

- [ ] **Step 2: 向用户展示外部写入清单并再次确认**

确认范围必须包含：

```text
新建：20_采购批次、21_头程物流批次、22_SKU批次库存明细、23_库存异常
扩展：02_库存流水、19_SKU运营汇总
权限：普通用户对 02、19、20、21、22、23 只读；Editor 对新增表 manage
数据：本步骤不写业务记录
```

- [ ] **Step 3: 创建四张空表**

用户确认后，逐条执行：

```bash
lark-cli base +table-create --base-token "$LARK_BASE_TOKEN" --name "20_采购批次" --fields '[{"name":"采购批次号","type":"text"},{"name":"供应商","type":"text"},{"name":"采购员","type":"user","multiple":false},{"name":"下单日期","type":"datetime"},{"name":"预计到货日期","type":"datetime"},{"name":"实际到货日期","type":"datetime"},{"name":"批次状态","type":"select","multiple":false,"options":[{"name":"待录入"},{"name":"处理中"},{"name":"部分发出"},{"name":"已完成"},{"name":"异常"}]},{"name":"备注","type":"text"}]' --as user
lark-cli base +table-create --base-token "$LARK_BASE_TOKEN" --name "21_头程物流批次" --fields '[{"name":"物流批次号","type":"text"},{"name":"承运商","type":"text"},{"name":"跟踪号","type":"text"},{"name":"发出日期","type":"datetime"},{"name":"预计到仓日期","type":"datetime"},{"name":"实际签收日期","type":"datetime"},{"name":"物流状态","type":"select","multiple":false,"options":[{"name":"待组建"},{"name":"国内集货仓待发"},{"name":"橙联在途"},{"name":"海外仓待上架"},{"name":"已完成"},{"name":"异常"}]},{"name":"备注","type":"text"}]' --as user
lark-cli base +table-create --base-token "$LARK_BASE_TOKEN" --name "22_SKU批次库存明细" --fields '[{"name":"明细编号","type":"text"},{"name":"来源采购批次号","type":"text"},{"name":"当前物流批次号","type":"text"},{"name":"SKU","type":"text"},{"name":"中文品名快照","type":"text"},{"name":"原始数量","type":"number"},{"name":"当前数量","type":"number"},{"name":"异常数量","type":"number"},{"name":"当前状态","type":"select","multiple":false,"options":[{"name":"本地仓待清点"},{"name":"待包装"},{"name":"已发往国内集货仓"},{"name":"国内集货仓待发"},{"name":"橙联在途"},{"name":"海外仓待上架"},{"name":"橙联可售"}]},{"name":"是否完成","type":"checkbox"},{"name":"最近操作人","type":"text"},{"name":"最近更新时间","type":"datetime"},{"name":"最近流转事务号","type":"text"},{"name":"版本号","type":"number"},{"name":"备注","type":"text"}]' --as user
lark-cli base +table-create --base-token "$LARK_BASE_TOKEN" --name "23_库存异常" --fields '[{"name":"异常编号","type":"text"},{"name":"来源明细编号","type":"text"},{"name":"SKU","type":"text"},{"name":"异常类型","type":"select","multiple":false,"options":[{"name":"清点差异"},{"name":"集货仓签收差异"},{"name":"海外仓签收差异"},{"name":"上架差异"},{"name":"报损"},{"name":"其他"}]},{"name":"责任节点","type":"text"},{"name":"预期数量","type":"number"},{"name":"实收数量","type":"number"},{"name":"差异数量","type":"number"},{"name":"处理状态","type":"select","multiple":false,"options":[{"name":"待处理"},{"name":"处理中"},{"name":"已补回"},{"name":"已报损"},{"name":"已关闭"}]},{"name":"负责人","type":"user","multiple":false},{"name":"创建时间","type":"datetime"},{"name":"关闭时间","type":"datetime"},{"name":"备注","type":"text"}]' --as user
```

Expected: 每条命令返回新 `table_id`。记录四个 ID。

- [ ] **Step 4: 增加关联字段与展示公式**

将 Task 3 Step 3 返回的真实表 ID 填入以下本地 shell 变量，再逐条执行。变量值必须是 `tbl...`，不能填写表名：

```bash
lark-cli base +field-create --base-token "$LARK_BASE_TOKEN" --table-id "$TABLE_INVENTORY_DETAIL" --json "{\"name\":\"来源采购批次\",\"type\":\"link\",\"link_table\":\"$TABLE_PURCHASE_BATCH\",\"bidirectional\":true,\"bidirectional_link_field_name\":\"SKU批次明细\"}" --as user
lark-cli base +field-create --base-token "$LARK_BASE_TOKEN" --table-id "$TABLE_INVENTORY_DETAIL" --json "{\"name\":\"当前物流批次\",\"type\":\"link\",\"link_table\":\"$TABLE_SHIPMENT_BATCH\",\"bidirectional\":true,\"bidirectional_link_field_name\":\"SKU批次明细\"}" --as user
lark-cli base +field-create --base-token "$LARK_BASE_TOKEN" --table-id "$TABLE_PURCHASE_BATCH" --json '{"name":"SKU种类数","type":"formula","expression":"[SKU批次明细].[SKU].UNIQUE().COUNTA()"}' --as user --i-have-read-guide
lark-cli base +field-create --base-token "$LARK_BASE_TOKEN" --table-id "$TABLE_PURCHASE_BATCH" --json '{"name":"采购总件数","type":"formula","expression":"[SKU批次明细].[原始数量].LISTCOMBINE().SUM()"}' --as user --i-have-read-guide
lark-cli base +field-create --base-token "$LARK_BASE_TOKEN" --table-id "$TABLE_PURCHASE_BATCH" --json '{"name":"待处理件数","type":"formula","expression":"[SKU批次明细].FILTER(CurrentValue.[是否完成] = FALSE()).[当前数量].LISTCOMBINE().SUM()"}' --as user --i-have-read-guide
lark-cli base +field-create --base-token "$LARK_BASE_TOKEN" --table-id "$TABLE_SHIPMENT_BATCH" --json '{"name":"来源采购批次","type":"formula","expression":"[SKU批次明细].[来源采购批次号].UNIQUE().ARRAYJOIN(\",\")"}' --as user --i-have-read-guide
lark-cli base +field-create --base-token "$LARK_BASE_TOKEN" --table-id "$TABLE_SHIPMENT_BATCH" --json '{"name":"SKU种类数","type":"formula","expression":"[SKU批次明细].[SKU].UNIQUE().COUNTA()"}' --as user --i-have-read-guide
lark-cli base +field-create --base-token "$LARK_BASE_TOKEN" --table-id "$TABLE_SHIPMENT_BATCH" --json '{"name":"发运总件数","type":"formula","expression":"[SKU批次明细].[当前数量].LISTCOMBINE().SUM()"}' --as user --i-have-read-guide
```

Expected: 关联字段和公式字段创建成功。若公式解析失败，停止写入并根据 CLI 返回修正表达式，不跳过字段。

- [ ] **Step 5: 扩展现有流水与汇总字段**

使用 `+field-create` 逐项增加：

```text
02_库存流水：
流转事务号(text)、流水唯一键(text)、来源明细编号(text)、来源采购批次(text)、
头程物流批次(text)、前状态(text)、后状态(text)、操作时间(datetime)

19_SKU运营汇总：
国内集货仓(number)、异常暂存(number)、账面总量(number)
```

`账面总量` 使用公式：

```bash
lark-cli base +field-create --base-token "$LARK_BASE_TOKEN" --table-id tblaVriWnH87co3h --json '{"name":"账面总量","type":"formula","expression":"[总可用库存] + [异常暂存]"}' --as user --i-have-read-guide
```

- [ ] **Step 6: 更新高级权限**

先回读 `普通用户` 与 `Editor`：

```bash
lark-cli base +role-get --base-token "$LARK_BASE_TOKEN" --role-id roldQWZlZeU --as user
lark-cli base +role-get --base-token "$LARK_BASE_TOKEN" --role-id rolFGYTAGVA --as user
```

将 `+role-get` 返回的既有 `table_rule_map` 与以下新增规则合并，向用户展示完整差异并再次确认后执行 `+role-update`。严禁用只有新增表的片段覆盖原有权限：

```text
普通用户：02、19、20、21、22、23 -> read_only
Editor：20、21、22、23 -> manage
```

`table_rule_map` 的键使用真实 `table_id`。角色写入后立即再次 `+role-get` 校验既有规则仍然存在。

- [ ] **Step 7: 保存环境变量**

在 `.env.example` 增加：

```dotenv
LARK_TABLE_PURCHASE_BATCH=
LARK_TABLE_SHIPMENT_BATCH=
LARK_TABLE_INVENTORY_DETAIL=
LARK_TABLE_INVENTORY_EXCEPTION=
```

在本机 `.env.local` 填写 Task 3 Step 3 返回的真实 ID，不提交密钥和本机环境文件。

- [ ] **Step 8: 回读验证**

Run sequentially:

```bash
lark-cli base +field-list --base-token "$LARK_BASE_TOKEN" --table-id "$TABLE_PURCHASE_BATCH" --as user
lark-cli base +field-list --base-token "$LARK_BASE_TOKEN" --table-id "$TABLE_SHIPMENT_BATCH" --as user
lark-cli base +field-list --base-token "$LARK_BASE_TOKEN" --table-id "$TABLE_INVENTORY_DETAIL" --as user
lark-cli base +field-list --base-token "$LARK_BASE_TOKEN" --table-id "$TABLE_INVENTORY_EXCEPTION" --as user
```

Expected: 字段完整，普通用户只读，Editor 管理权限完整。

- [ ] **Step 9: 更新 README 并提交**

记录新增环境变量、期初余额初始化和角色权限要求。

```bash
git add .env.example README.md
git commit -m "docs: 增加库存批次账本环境配置"
```

## Task 4: 扩展飞书服务端基础能力

**Files:**
- Modify: `src/lib/lark-server.ts`

- [ ] **Step 1: 增加四张表映射**

在 `TABLE_ENV_KEYS` 中增加：

```ts
purchaseBatch: "LARK_TABLE_PURCHASE_BATCH",
shipmentBatch: "LARK_TABLE_SHIPMENT_BATCH",
inventoryDetail: "LARK_TABLE_INVENTORY_DETAIL",
inventoryException: "LARK_TABLE_INVENTORY_EXCEPTION",
```

- [ ] **Step 2: 增加批量更新和按字段查找**

```ts
export async function updateLarkRecords(
  table: LarkTable,
  updates: Array<{ recordId: string; fields: Record<string, unknown> }>,
): Promise<void> {
  for (const update of updates) {
    await updateLarkRecord(table, update.recordId, update.fields);
  }
}

export async function findLarkRecordByText(
  table: LarkTable,
  field: string,
  value: string,
): Promise<LarkRecord | undefined> {
  const { records } = await listLarkRecords(table);
  return records.find((record) => toLarkText(record.fields[field]).trim() === value);
}
```

- [ ] **Step 3: 扩展汇总位置**

将 `syncStockSummaryFromFlow()` 的位置映射扩展为：

```ts
const summaryFieldByLocation = {
  本地仓: "本地库存",
  本地库存: "本地库存",
  国内集货仓: "国内集货仓",
  橙联在途: "橙联在途",
  橙联可售: "橙联可售",
  异常暂存: "异常暂存",
} as const;
```

计算 `总可用库存` 时只包含本地、国内集货仓、橙联在途和橙联可售；同时写入 `账面总量`。

- [ ] **Step 4: 运行验证**

Run:

```bash
npm test
npm run lint
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/lark-server.ts
git commit -m "feat: 扩展飞书库存批次表访问能力"
```

## Task 5: 增加服务端会话与用户角色

**Files:**
- Create: `src/lib/session-server.ts`
- Modify: `src/lib/users.ts`
- Modify: `src/app/(main)/api/auth/login/route.ts`
- Modify: `src/app/(main)/api/auth/me/route.ts`
- Modify: `src/app/(main)/api/auth/users/route.ts`
- Modify: `src/app/(main)/accounts/page.tsx`

- [ ] **Step 1: 扩展用户角色**

在 `src/lib/users.ts` 中增加：

```ts
export type UserRole = "admin" | "purchaser" | "operator";

export interface User {
  name: string;
  password: string;
  createdAt: string;
  role?: UserRole;
}

export function getUserRole(user: Pick<User, "name" | "role">): UserRole {
  if (user.name === "车泉") return "admin";
  return user.role || "operator";
}
```

`addUser()` 接受可选角色，既有用户没有 `role` 时按 `operator` 兼容。

- [ ] **Step 2: 创建服务端会话 helper**

```ts
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { getJwtSecret } from "@/lib/auth-config";
import type { UserRole } from "@/lib/users";

export interface SessionUser {
  name: string;
  role: UserRole;
  isAdmin: boolean;
}

export async function requireSession(): Promise<SessionUser> {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) throw new Error("请先登录");
  const { payload } = await jwtVerify(token, getJwtSecret());
  return {
    name: String(payload.name || ""),
    role: (payload.role as UserRole) || (payload.isAdmin ? "admin" : "operator"),
    isAdmin: Boolean(payload.isAdmin),
  };
}

export async function requireAdmin(): Promise<SessionUser> {
  const session = await requireSession();
  if (!session.isAdmin) throw new Error("仅管理员可执行此操作");
  return session;
}
```

- [ ] **Step 3: 让登录签发 JWT 时写入角色**

修改登录路由，使 JWT payload 包含：

```ts
{ name: user.name, isAdmin: isAdmin(user.name), role: getUserRole(user) }
```

- [ ] **Step 4: 更新账号管理页**

新增用户时增加角色下拉框：`采购员` 对应 `purchaser`，`运营` 对应 `operator`。管理员账号仍由系统固定识别。

- [ ] **Step 5: 验证**

Run:

```bash
npm run lint
npm run build
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/lib/session-server.ts src/lib/users.ts 'src/app/(main)/api/auth' 'src/app/(main)/accounts/page.tsx'
git commit -m "feat: 增加库存流转用户角色"
```

## Task 6: 实现批次编排服务

**Files:**
- Create: `src/lib/inventory-batch-server.ts`
- Create: `src/lib/inventory-batch-server.test.ts`

- [ ] **Step 1: 先写内存仓库测试**

测试必须覆盖：

```ts
it("重复事务号不会重复扣增库存");
it("版本号不一致时拒绝推进");
it("部分数量推进会创建新明细并保留剩余明细");
it("跨仓推进会写入一减一增两条流水");
it("从明细重建汇总不会累加旧快照");
it("期初余额预览不会写入任何记录");
it("海外仓实收少于预期时创建异常并暂存差额");
it("绑定物流批次时允许跨采购批次合并");
```

仓库接口固定为：

```ts
export interface InventoryRepository {
  listDetails(): Promise<InventoryDetailRecord[]>;
  createDetails(records: InventoryDetailRecord[]): Promise<void>;
  updateDetails(records: InventoryDetailRecord[]): Promise<void>;
  listFlowsByTransaction(transactionId: string): Promise<InventoryFlowRecord[]>;
  createFlows(records: InventoryFlowRecord[]): Promise<void>;
  createExceptions(records: InventoryExceptionRecord[]): Promise<void>;
  upsertSummaries(records: InventorySummaryRecord[]): Promise<void>;
}
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
npm test -- src/lib/inventory-batch-server.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现服务**

导出以下函数：

```ts
export async function transitionInventory(repo: InventoryRepository, input: {
  transactionId: string;
  operator: string;
  nextState: InventoryState;
  items: Array<{ detailId: string; version: number; quantity: number; actualQuantity?: number }>;
}): Promise<{ idempotent: boolean }>;

export async function bindShipmentBatch(repo: InventoryRepository, input: {
  transactionId: string;
  operator: string;
  shipmentBatchNo: string;
  items: Array<{ detailId: string; version: number; quantity: number }>;
}): Promise<{ idempotent: boolean }>;

export async function rebuildInventorySummary(repo: InventoryRepository): Promise<void>;

export function previewOpeningBalances(
  summaries: Array<{ SKU: string; 中文品名?: string; 本地库存?: number; 橙联在途?: number; 橙联可售?: number }>,
  suffix: string,
): InventoryDetailRecord[];
```

`transitionInventory()` 必须按以下顺序执行：

```text
1. 如果事务号已有完整流水，直接 rebuild summary 并返回 idempotent=true。
2. 校验每个明细版本号、目标状态和数量。
3. 对部分推进创建新明细，对整行推进更新原明细。
4. 使用 流水唯一键 = 事务号 + 明细编号 + 库存位置 + 数量变动 写成对流水。
5. 当进入海外仓节点且 `actualQuantity < quantity` 时，将差额写入异常数量并创建 `23_库存异常`。
6. 从全部明细重建汇总，不继续累加旧快照。
```

`bindShipmentBatch()` 只允许处理 `国内集货仓待发` 明细；整行绑定时更新原明细，部分数量绑定时拆分新明细。新明细和原明细都必须保留来源采购批次号，允许同一物流批次合并多个采购批次。

- [ ] **Step 4: 运行测试**

Run:

```bash
npm test -- src/lib/inventory-batch-server.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/inventory-batch-server.ts src/lib/inventory-batch-server.test.ts
git commit -m "feat: 实现库存批次幂等编排服务"
```

## Task 7: 接入飞书仓库与 API 路由

**Files:**
- Create: `src/lib/lark-inventory-repository.ts`
- Create: `src/app/(main)/api/inventory-flow/data/route.ts`
- Create: `src/app/(main)/api/inventory-flow/purchase-batches/route.ts`
- Create: `src/app/(main)/api/inventory-flow/shipments/route.ts`
- Create: `src/app/(main)/api/inventory-flow/transitions/route.ts`
- Create: `src/app/(main)/api/inventory-flow/exceptions/route.ts`
- Create: `src/app/(main)/api/inventory-flow/opening-balances/route.ts`

- [ ] **Step 1: 实现飞书仓库适配器**

`src/lib/lark-inventory-repository.ts` 将 `InventoryRepository` 映射到：

```ts
listLarkRecords("inventoryDetail")
createLarkRecords("inventoryDetail", records)
updateLarkRecords("inventoryDetail", updates)
listLarkRecords("stockFlow")
createLarkRecords("stockFlow", records)
createLarkRecords("inventoryException", records)
listLarkRecords("summary")
updateLarkRecord("summary", recordId, fields)
createLarkRecords("summary", records)
```

所有错误必须包含表名，例如：

```ts
throw new Error(`22_SKU批次库存明细写入失败：${message}`);
```

- [ ] **Step 2: 创建数据读取接口**

`GET /api/inventory-flow/data?resource=details` 支持：

```text
purchases -> purchaseBatch
shipments -> shipmentBatch
details -> inventoryDetail
exceptions -> inventoryException
```

路由必须先调用 `requireSession()`。

- [ ] **Step 3: 创建采购批次接口**

`POST /api/inventory-flow/purchase-batches` 接收：

```ts
{
  purchaseBatchNo: string;
  supplier: string;
  orderedAt: string;
  items: Array<{ sku: string; productName: string; quantity: number }>;
}
```

保存 `20` 后，为每个 item 创建 `22` 明细，状态固定为 `本地仓待清点`；写本地仓正数流水；最后从明细重建 `19`。

- [ ] **Step 4: 创建物流批次接口**

`POST /api/inventory-flow/shipments` 接收：

```ts
{
  shipmentBatchNo: string;
  carrier: string;
  trackingNo: string;
  shippedAt: string;
  estimatedArrivalAt?: string;
}
```

保存为 `21_头程物流批次`，初始状态 `待组建`。

`PATCH /api/inventory-flow/shipments` 接收：

```ts
{
  transactionId: string;
  shipmentBatchNo: string;
  items: Array<{ detailId: string; version: number; quantity: number }>;
}
```

调用 `bindShipmentBatch()`，将多个采购批次中的 `国内集货仓待发` 明细绑定到同一个物流批次。

- [ ] **Step 5: 创建推进接口**

`POST /api/inventory-flow/transitions` 接收：

```ts
{
  transactionId: string;
  nextState: InventoryState;
  items: Array<{ detailId: string; version: number; quantity: number; actualQuantity?: number }>;
}
```

调用 `transitionInventory()`，操作人必须取自 `requireSession()`，不能相信客户端传入姓名。
海外仓签收或上架时，若传入 `actualQuantity` 且小于预期 `quantity`，服务端必须自动创建 `23_库存异常` 并把差额计入异常暂存。

- [ ] **Step 6: 创建异常处理接口**

`POST /api/inventory-flow/exceptions` 仅管理员可调用，接收：

```ts
{
  exceptionId: string;
  action: "补回库存" | "确认报损";
  targetLocation?: "本地仓" | "国内集货仓" | "橙联在途" | "橙联可售";
  note: string;
}
```

补回库存时写异常暂存减少和目标位置增加的成对流水；确认报损时只写异常暂存减少流水并保留报损记录。

- [ ] **Step 7: 创建期初余额接口**

`GET /api/inventory-flow/opening-balances` 仅管理员可调用，返回预览：

```ts
{ skuCount: number; detailCount: number; totals: { 本地库存: number; 橙联在途: number; 橙联可售: number } }
```

`POST` 仅管理员可调用：

```text
1. 如果 22 已存在任何“期初库存导入”记录则拒绝重复执行。
2. 从 19 生成明细。
3. 写入 22。
4. 从 22 重算 19。
5. 比较迁移前后总量，不一致则返回明确错误。
```

- [ ] **Step 8: 运行验证**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: 全部通过。

- [ ] **Step 9: 提交**

```bash
git add src/lib/lark-inventory-repository.ts 'src/app/(main)/api/inventory-flow'
git commit -m "feat: 接入飞书库存批次 API"
```

## Task 8: 执行期初余额初始化与只读验收

**Files:**
- No code changes

- [ ] **Step 1: 预览初始化**

登录管理员账号后请求：

```bash
curl -sS -b /private/tmp/solid-auth-cookie.txt http://localhost:3000/api/inventory-flow/opening-balances
```

Expected: 返回 `skuCount: 51`，并显示本地库存、橙联在途、橙联可售总量。该请求只读。

- [ ] **Step 2: 向用户展示预览并再次确认写入**

明确说明：

```text
将向 22_SKU批次库存明细 写入期初余额明细；
不会修改 19 的现有库存数值；
写入后会重算并比对；
不会伪造历史采购或物流流水。
```

- [ ] **Step 3: 用户确认后执行**

```bash
curl -sS -X POST -b /private/tmp/solid-auth-cookie.txt http://localhost:3000/api/inventory-flow/opening-balances
```

Expected: 返回写入明细数和迁移前后相同的汇总总量。

- [ ] **Step 4: 只读回查**

```bash
lark-cli base +record-list --base-token "$LARK_BASE_TOKEN" --table-id "$TABLE_INVENTORY_DETAIL" --limit 200 --format json --as user
```

Expected: 所有期初余额明细备注为 `期初库存导入`，无采购批次和物流批次伪造值。

- [ ] **Step 5: 最终提交**

```bash
git status --short
npm test
npm run lint
npm run build
```

Expected: 测试、Lint 和构建均通过；工作区仅保留用户原有未提交改动。

- [ ] **Step 6: 部署前同步生产环境变量**

如本轮包含 Netlify 或 Cloudflare 生产部署，先向用户展示将新增的四个非密钥表 ID 环境变量并再次确认，再同步：

```text
LARK_TABLE_PURCHASE_BATCH
LARK_TABLE_SHIPMENT_BATCH
LARK_TABLE_INVENTORY_DETAIL
LARK_TABLE_INVENTORY_EXCEPTION
```

同步后执行一次生产环境只读状态检查，不在部署步骤中自动写业务记录。
