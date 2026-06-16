# 库存流转网页工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增移动端和桌面端均可用的“库存流转”模块，让采购员和运营通过批量操作完成采购入库、状态推进、物流合并、海外仓签收上架和异常处理。

**Architecture:** 页面以四个标签组织工作：采购批次、批次流转、头程物流、库存异常。页面只调用后端 API，不直接写飞书；所有高风险库存变化在提交前显示影响数量并二次确认。

**Tech Stack:** Next.js 16 App Router、React 19、现有 Base UI 组件、Tailwind CSS、Sonner、Lucide React、Browser 插件验收。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `src/app/(main)/inventory-flow/page.tsx` | 页面容器、四个标签与数据刷新 |
| `src/components/inventory-flow/purchase-batches-tab.tsx` | 采购批次批量录入 |
| `src/components/inventory-flow/flow-details-tab.tsx` | 明细筛选、多选和批量推进 |
| `src/components/inventory-flow/shipments-tab.tsx` | 头程物流批次与跨采购批次合并 |
| `src/components/inventory-flow/exceptions-tab.tsx` | 异常查看、补回和报损 |
| `src/components/inventory-flow/transition-dialog.tsx` | 推进前影响范围确认与部分数量 |
| `src/components/inventory-flow/types.ts` | 页面数据类型和 API DTO |
| `src/components/ui/checkbox.tsx` | 可复用复选框 |
| `src/types/index.ts` | 增加库存流转导航 |
| `src/components/layout/module-icons.tsx` | 增加库存流转图标 |

## Task 1: 增加导航与页面骨架

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/components/layout/module-icons.tsx`
- Create: `src/app/(main)/inventory-flow/page.tsx`

- [ ] **Step 1: 增加导航模块**

在 `MODULES` 中将库存流转放在库存监控之后：

```ts
{ id: "inventoryFlow", name: "库存流转", path: "/inventory-flow", description: "采购批次、头程物流与库存状态批量推进" },
```

- [ ] **Step 2: 增加图标**

在 `module-icons.tsx` 引入 `Boxes` 并增加：

```tsx
case "inventoryFlow": return <Boxes {...props} />;
```

- [ ] **Step 3: 创建页面骨架**

页面必须包含：

```tsx
<Tabs defaultValue="purchases">
  <TabsList>
    <TabsTrigger value="purchases">采购批次</TabsTrigger>
    <TabsTrigger value="flow">批次流转</TabsTrigger>
    <TabsTrigger value="shipments">头程物流</TabsTrigger>
    <TabsTrigger value="exceptions">库存异常</TabsTrigger>
  </TabsList>
  <TabsContent value="purchases"><PurchaseBatchesTab /></TabsContent>
  <TabsContent value="flow"><FlowDetailsTab /></TabsContent>
  <TabsContent value="shipments"><ShipmentsTab /></TabsContent>
  <TabsContent value="exceptions"><ExceptionsTab /></TabsContent>
</Tabs>
```

- [ ] **Step 4: 验证**

Run:

```bash
npm run lint
npm run build
```

Expected: PASS；桌面侧栏和移动端底栏出现“库存流转”。

- [ ] **Step 5: 提交**

```bash
git add src/types/index.ts src/components/layout/module-icons.tsx 'src/app/(main)/inventory-flow/page.tsx'
git commit -m "feat: 增加库存流转工作台导航"
```

## Task 2: 实现采购批次批量录入

**Files:**
- Create: `src/components/inventory-flow/types.ts`
- Create: `src/components/inventory-flow/purchase-batches-tab.tsx`

- [ ] **Step 1: 定义 DTO**

```ts
export interface PurchaseBatchItemDraft {
  sku: string;
  productName: string;
  quantity: number;
  existingSku: boolean;
}

export interface PurchaseBatchDraft {
  purchaseBatchNo: string;
  supplier: string;
  orderedAt: string;
  items: PurchaseBatchItemDraft[];
}
```

- [ ] **Step 2: 实现表单**

表单包含：采购批次号、供应商、下单日期、SKU 搜索框、中文品名、数量、添加行按钮、批量明细列表、保存按钮。

已有 SKU 联想使用：

```ts
const skuResponse = await fetch("/api/lark?table=sku&limit=500");
```

保存使用：

```ts
await fetch("/api/inventory-flow/purchase-batches", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(draft),
});
```

已有 SKU 行默认锁定品名；点击“更新基础资料”才跳转现有数据录入页并带查询参数：

```ts
router.push(`/data-entry?sku=${encodeURIComponent(item.sku)}&editMaster=1`);
```

- [ ] **Step 3: 增加输入校验**

保存前必须阻止：

```text
采购批次号为空
供应商为空
明细为空
SKU 为空
数量不是正整数
新 SKU 缺少中文品名
同一批次内 SKU 重复
```

- [ ] **Step 4: 浏览器验证**

使用 Browser 插件打开：

```text
http://localhost:3000/inventory-flow
```

验证桌面宽度和手机宽度下均可添加多行 SKU，并能看到保存前校验。

- [ ] **Step 5: 提交**

```bash
git add src/components/inventory-flow
git commit -m "feat: 增加采购批次批量录入"
```

## Task 3: 实现批次流转多选与部分推进

**Files:**
- Create: `src/components/ui/checkbox.tsx`
- Create: `src/components/inventory-flow/flow-details-tab.tsx`
- Create: `src/components/inventory-flow/transition-dialog.tsx`

- [ ] **Step 1: 创建复选框组件**

使用原生受控 checkbox，保持依赖最小：

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Checkbox(props: React.ComponentProps<"input">) {
  return <input type="checkbox" className={cn("h-4 w-4 rounded border-slate-300 accent-orange-500", props.className)} {...props} />;
}
```

- [ ] **Step 2: 加载明细并提供筛选**

读取：

```ts
fetch("/api/inventory-flow/data?resource=details")
```

筛选字段：

```text
当前状态、采购批次号、物流批次号、SKU
```

默认隐藏 `是否完成=true` 的记录。

- [ ] **Step 3: 实现多选推进确认框**

确认框必须展示：

```text
选中明细数
SKU 数
总件数
当前状态
允许的下一状态
```

单行时允许修改本次推进数量；多行默认整行推进。

提交 DTO：

```ts
{
  transactionId: crypto.randomUUID(),
  nextState,
  items: selected.map((item) => ({
    detailId: item.recordId,
    version: item.版本号,
    quantity: quantities[item.recordId] || item.当前数量,
  })),
}
```

- [ ] **Step 4: 阻止非法操作**

前端先提示，服务端仍必须再次校验：

```text
不同当前状态的明细不能在同一次操作中推进
推进数量必须大于 0 且不超过当前数量
进入橙联在途前必须绑定物流批次
已完成明细不能再次推进
```

- [ ] **Step 5: 浏览器验证**

验证：

```text
可筛选待包装明细
可多选并看到合计件数
单行 100 件可填写 80 件推进
确认框清楚显示剩余 20 件
取消确认不会写入飞书
```

- [ ] **Step 6: 提交**

```bash
git add src/components/ui/checkbox.tsx src/components/inventory-flow/flow-details-tab.tsx src/components/inventory-flow/transition-dialog.tsx
git commit -m "feat: 增加批次库存多选推进"
```

## Task 4: 实现头程物流批次操作

**Files:**
- Create: `src/components/inventory-flow/shipments-tab.tsx`

- [ ] **Step 1: 创建物流批次表单**

字段：

```text
物流批次号、承运商、跟踪号、发出日期、预计到仓日期
```

保存到：

```ts
fetch("/api/inventory-flow/shipments", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(draft),
});
```

- [ ] **Step 2: 支持跨采购批次选择**

筛选 `当前状态=国内集货仓待发` 的明细，按采购批次分组显示。允许同时勾选多个采购批次的明细并绑定同一物流批次。

绑定使用：

```ts
await fetch("/api/inventory-flow/shipments", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    transactionId: crypto.randomUUID(),
    shipmentBatchNo,
    items: selectedDetails.map(({ detailId, version, quantity }) => ({ detailId, version, quantity })),
  }),
});
```

- [ ] **Step 3: 增加整批动作**

物流卡片提供：

```text
确认发运 -> 橙联在途
确认海外仓签收 -> 海外仓待上架
确认全部上架 -> 橙联可售
```

每次动作都先打开确认框；出现差异时切换为 SKU 明细输入模式。

海外仓签收或上架差异提交时，为每条明细同时传递预期 `quantity` 与实收 `actualQuantity`。页面明确显示差额将进入库存异常，不能把少收数量静默丢弃。

- [ ] **Step 4: 浏览器验证**

验证两个采购批次的明细可绑定同一个物流批次，且手机端操作按钮不溢出屏幕。

- [ ] **Step 5: 提交**

```bash
git add src/components/inventory-flow/shipments-tab.tsx
git commit -m "feat: 增加头程物流批次工作台"
```

## Task 5: 实现库存异常处理

**Files:**
- Create: `src/components/inventory-flow/exceptions-tab.tsx`

- [ ] **Step 1: 加载异常列表**

读取：

```ts
fetch("/api/inventory-flow/data?resource=exceptions")
```

按 `处理状态`、`责任节点`、`负责人`、`创建时间` 提供筛选。

- [ ] **Step 2: 增加管理员处理动作**

处理框要求填写备注，并提供：

```text
补回库存
确认报损
```

补回库存时必须选择目标位置。

- [ ] **Step 3: 保存**

```ts
await fetch("/api/inventory-flow/exceptions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ exceptionId, action, targetLocation, note }),
});
```

- [ ] **Step 4: 浏览器验证**

普通用户只能查看；管理员可以打开处理框。取消操作不会写入飞书。

- [ ] **Step 5: 提交**

```bash
git add src/components/inventory-flow/exceptions-tab.tsx
git commit -m "feat: 增加库存异常处理界面"
```

## Task 6: 接通数据录入页与看板口径

**Files:**
- Modify: `src/app/(main)/data-entry/page.tsx`
- Modify: `src/app/(main)/inventory/page.tsx`
- Modify: `src/app/(main)/dashboard/page.tsx`
- Modify: `src/app/(main)/page.tsx`

- [ ] **Step 1: 调整零散库存流水说明**

库存流水标签增加提示：

```text
批量采购和批次物流请前往“库存流转”。本表单仅用于零散库存调整和历史补录。
```

- [ ] **Step 2: 看板增加国内集货仓**

库存页和看板增加 `国内集货仓` 卡片，汇总展示口径：

```text
本地库存 + 国内集货仓 + 橙联在途 + 橙联可售
```

- [ ] **Step 3: 首页增加入口**

首页模块说明中增加：

```text
库存流转：采购批次、头程物流、批量状态推进和库存异常。
```

- [ ] **Step 4: 支持 SKU 基础资料显式更新入口**

数据录入页读取采购批次页带入的查询参数：

```text
?sku=<SKU>&editMaster=1
```

仅在 `editMaster=1` 时预填 SKU 并显示“正在更新 SKU 基础资料”提示。编辑态必须携带已有 `recordId`，锁定 SKU 编码，并让保存路由调用 `updateLarkRecord()`；禁止再次调用新增记录逻辑生成重复 SKU。采购批次录入中的既有 SKU 始终默认只读引用，不因采购入库隐式覆盖 `01_SKU主数据`。

- [ ] **Step 5: 浏览器验证**

使用 Browser 插件依次打开：

```text
http://localhost:3000/
http://localhost:3000/dashboard
http://localhost:3000/inventory
http://localhost:3000/data-entry
http://localhost:3000/inventory-flow
```

同时验证桌面和手机宽度。

- [ ] **Step 6: 提交**

```bash
git add 'src/app/(main)'
git commit -m "feat: 接通库存流转入口与看板口径"
```

## Task 7: 端到端验收与生产构建

**Files:**
- No code changes unless verification finds a defect

- [ ] **Step 1: 运行静态检查**

```bash
npm test
npm run lint
git diff --check
npm run build
```

Expected: 全部通过。

- [ ] **Step 2: 用测试 SKU 验收正常链路**

执行前向用户确认允许写入测试记录。使用明确标记的测试批次：

```text
采购批次：TEST-PO-20260602
物流批次：TEST-SHIP-20260602
SKU：使用用户确认的测试 SKU
```

验证：

```text
批量入库 -> 本地仓待清点
推进 -> 待包装
部分 80/100 推进 -> 已发往国内集货仓
绑定物流 -> 国内集货仓待发 -> 橙联在途
签收 -> 海外仓待上架
上架 -> 橙联可售
```

- [ ] **Step 3: 验收异常链路**

创建预期 `100`、实收 `97` 的测试场景，验证 `-3` 件进入异常暂存，再分别测试补回和报损。

- [ ] **Step 4: 浏览器截图验收**

使用 Browser 插件截图：

```text
采购批次表单
批次流转多选确认框
头程物流跨采购批次选择
库存异常处理框
看板国内集货仓卡片
手机端库存流转页
```

- [ ] **Step 5: 最终提交**

```bash
git status --short
git log --oneline -12
```

只提交本轮功能文件，不混入用户未确认的其他改动。
