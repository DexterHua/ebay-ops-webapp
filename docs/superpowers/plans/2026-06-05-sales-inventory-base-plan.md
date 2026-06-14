# Sales Inventory Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增补销售库存扫描所需的事务恢复上下文，创建可幂等更新的库存预警日志表及协作视图，并配置应用读取这些 Base 资源所需的环境变量。

**Architecture:** 复用现有 `07_销售日报`、`02_库存流水`、`18_SKU库存策略`、`19_SKU运营汇总`、`23_库存异常` 和 `24_库存流转事务`。在 `24_库存流转事务` 增加纯文本 JSON 恢复上下文，在新建的 `25_库存预警日志` 中分别保存扫描批次汇总与每日 SKU 预警；应用层以稳定业务键执行查询后创建或更新，不依赖 Base 唯一索引。本计划不修改高级角色权限、不写 `10_补货采购建议`、不删除任何表或字段，也不升级当前 `lark-cli 1.0.32`。

**Tech Stack:** 飞书多维表格 Base、`lark-cli 1.0.32`、Next.js 环境变量、Git

---

## Ownership And Boundaries

本计划由表结构子代理执行，范围仅包括：

- 给 `24_库存流转事务` 增加 `恢复上下文` 字段。
- 创建或补齐 `25_库存预警日志` 的字段和视图。
- 修改 `.env.example` 与本地 `.env.local` 中本计划负责的两个环境变量。
- 只读核验 Base 角色权限并记录风险，不执行 `role-update`、`role-create`、`advperm-enable` 或 `advperm-disable`。
- 向代理 1 提供字段契约；代理 1 负责在 `src/lib/lark-server.ts` 增加 `inventoryWarning` 表键。

明确排除：

- 不修改 `10_补货采购建议`，一期也不向该表写记录。
- 不创建飞书 Workflow。
- 不修改应用服务、API、测试或定时任务代码。
- 不删除、重命名或转换已有表、字段和视图。
- 不执行 `lark-cli update`。

## Confirmed Existing Resources

| 表名 | Table ID | 本次用途 |
| --- | --- | --- |
| `07_销售日报` | `LARK_TABLE_SALES` | 销售事实来源 |
| `02_库存流水` | `LARK_TABLE_STOCK_FLOW` | 写入 `订单出库` 流水 |
| `10_补货采购建议` | `LARK_TABLE_REPLENISH` | 一期不写 |
| `18_SKU库存策略` | `LARK_TABLE_STOCK_STRATEGY` | 读取安全库存和补货周期 |
| `19_SKU运营汇总` | `LARK_TABLE_SKU_SUMMARY` | 读取和更新库存、销量快照 |
| `23_库存异常` | `LARK_TABLE_INVENTORY_EXCEPTION` | 写入销售扣减异常 |
| `24_库存流转事务` | `LARK_TABLE_INVENTORY_TRANSACTION` | 幂等事务和恢复上下文 |

## Field Contracts

### `24_库存流转事务.恢复上下文`

| 属性 | 契约 |
| --- | --- |
| 字段名 | `恢复上下文` |
| Base 类型 | `text`，普通长文本 |
| 写入方 | 代理 1 实现的销售库存扫描服务 |
| 内容 | UTF-8 JSON 字符串 |
| 空值 | 尚未产生可恢复副作用时可为空 |
| 更新规则 | 每完成一个可恢复步骤后覆盖为最新完整快照，不做字符串拼接 |

JSON 顶层契约：

```json
{
  "version": 1,
  "salesRecordId": "rec_xxx",
  "sku": "SKU-001",
  "soldQuantity": 3,
  "salesDate": "2026-06-05",
  "allocation": {
    "summaryRecordId": "rec_summary",
    "stockFlowRecordId": "rec_flow",
    "beforeOrangeSellable": 10,
    "afterOrangeSellable": 7
  },
  "completedSteps": [
    "stock_flow_created",
    "summary_updated"
  ]
}
```

`stockFlowRecordId` 在流水尚未创建时为 `null`；`completedSteps` 只允许：

- `stock_flow_created`
- `summary_updated`
- `sales_summary_refreshed`
- `warning_written`
- `notification_sent`

Base 仅保存该 JSON，不解析其中字段。代理 1 必须负责 schema 版本、序列化、解析和恢复决策。

### `25_库存预警日志`

第一项 `预警编号` 为主字段。所有 number 字段均为普通数字，不使用公式或 lookup。

| 顺序 | 字段名 | Base 类型 | 配置或语义 |
| ---: | --- | --- | --- |
| 1 | `预警编号` | text | 扫描汇总：`SCANLOG-${scanId}`；SKU 预警：`WARN-${Asia/Shanghai YYYYMMDD}-${SKU}` |
| 2 | `记录类型` | select | `扫描汇总`、`库存预警` |
| 3 | `扫描批次号` | text | 接受带 UUID 的完整 scanId，例如 `SCAN-20260605-0900-550e8400-e29b-41d4-a716-446655440000` |
| 4 | `SKU` | text | 扫描汇总行留空，库存预警行必填 |
| 5 | `预警等级` | select | `异常`、`紧急`、`需采购`、`低库存` |
| 6 | `触发原因` | text | 本次命中的最高优先级条件与关键阈值 |
| 7 | `橙联可售` | number | precision `0` |
| 8 | `总可用库存` | number | precision `0` |
| 9 | `近7日日均销量` | number | precision `2` |
| 10 | `预计可售天数` | number | precision `2`；销量为 0 时不写 |
| 11 | `安全库存` | number | precision `0` |
| 12 | `补货周期天数` | number | precision `0` |
| 13 | `建议采购量` | number | precision `0`，非负 |
| 14 | `处理状态` | select | `待处理`、`已通知`、`已转采购`、`已关闭` |
| 15 | `处理备注` | text | 人工协作内容；自动重扫不得覆盖 |
| 16 | `失败原因` | text | 扫描、扣减或通知错误 |
| 17 | `处理销售记录数` | number | precision `0`，仅扫描汇总行 |
| 18 | `成功扣减数` | number | precision `0`，仅扫描汇总行 |
| 19 | `跳过数` | number | precision `0`，仅扫描汇总行 |
| 20 | `异常数` | number | precision `0`，仅扫描汇总行 |
| 21 | `预警SKU数` | number | precision `0`，仅扫描汇总行 |
| 22 | `通知消息ID` | text | 飞书消息 ID |
| 23 | `通知时间` | datetime | `yyyy-MM-dd HH:mm` |
| 24 | `创建时间` | created_at | `yyyy-MM-dd HH:mm`，系统只读 |
| 25 | `更新时间` | updated_at | `yyyy-MM-dd HH:mm`，系统只读 |

每日 SKU 预警的业务唯一键必须使用上海时区日期：

```text
WARN-${formatInTimeZone(now, "Asia/Shanghai", "yyyyMMdd")}-${SKU}
```

同一 SKU 在同一上海自然日内多次扫描时更新同一条预警，`扫描批次号` 更新为最近一次 scanId。不得把随机 UUID 或完整 scanId 放入 SKU 预警主键。扫描汇总使用 `SCANLOG-${scanId}`，因此每次扫描仍保留独立汇总记录。

自动重扫不得把人工状态 `已转采购` 或 `已关闭` 回退到 `待处理`，也不得覆盖 `处理备注`。

## Task 1: Read-Only Preflight And Baseline

**Files:**
- Read: `.env.local`
- Read: `docs/superpowers/specs/2026-06-04-sales-daily-inventory-scan-design.md`

- [ ] **Step 1: Confirm the CLI version without upgrading it**

Run:

```bash
lark-cli --version
```

Expected: current CLI reports `1.0.32`. If the command emits an update notice, record it and continue without running `lark-cli update`.

- [ ] **Step 2: Load local environment without printing secrets**

Run:

```bash
set -a
source .env.local
set +a
test -n "$LARK_BASE_TOKEN"
```

Expected: exit code `0`; terminal output must not contain the Base token.

- [ ] **Step 3: Confirm table identity serially**

Run:

```bash
lark-cli base +table-list \
  --base-token "$LARK_BASE_TOKEN" \
  --offset 0 \
  --limit 100 \
  --as user
```

Expected:

- Exactly one `24_库存流转事务` matching `LARK_TABLE_INVENTORY_TRANSACTION`.
- Zero or one `25_库存预警日志`.
- If more than one table has either target name, stop before all writes and report the duplicate IDs.

- [ ] **Step 4: Capture the current `24` field baseline**

Run:

```bash
lark-cli base +field-list \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$LARK_TABLE_INVENTORY_TRANSACTION" \
  --offset 0 \
  --limit 200 \
  --as user
```

Expected: the ten confirmed fields are present. Save the JSON output in the execution transcript; do not write it into the repository if it contains unrelated operational metadata.

- [ ] **Step 5: Read current roles for risk documentation only**

Run:

```bash
lark-cli base +role-list \
  --base-token "$LARK_BASE_TOKEN" \
  --as user
```

For each custom role returned, run:

```bash
lark-cli base +role-get \
  --base-token "$LARK_BASE_TOKEN" \
  --role-id "<confirmed-role-id>" \
  --as user
```

Expected: record whether the future `25_库存预警日志` is visible or editable after creation. Do not execute any role write command in this plan.

## Task 2: Idempotently Add `恢复上下文` To Table `24`

**Files:**
- No repository files

- [ ] **Step 1: Decide from the field baseline**

Use these exact branches:

1. No field named `恢复上下文`: continue to Step 2.
2. Exactly one `恢复上下文` with type `text`: skip creation and continue to Step 4.
3. More than one field named `恢复上下文`, or one field with a non-`text` type: stop. Do not rename, delete or convert any field.

- [ ] **Step 2: Preview the field creation**

Run:

```bash
lark-cli base +field-create \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$LARK_TABLE_INVENTORY_TRANSACTION" \
  --json '{"name":"恢复上下文","type":"text","description":"销售日报库存扣减的恢复上下文；保存 versioned sales allocation JSON，由扫描服务覆盖写入完整快照"}' \
  --as user \
  --dry-run
```

Expected: request targets `$LARK_TABLE_INVENTORY_TRANSACTION` and defines one `text` field named `恢复上下文`.

- [ ] **Step 3: Create the field after the main agent approves the dry-run**

Run the same command without `--dry-run`:

```bash
lark-cli base +field-create \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$LARK_TABLE_INVENTORY_TRANSACTION" \
  --json '{"name":"恢复上下文","type":"text","description":"销售日报库存扣减的恢复上下文；保存 versioned sales allocation JSON，由扫描服务覆盖写入完整快照"}' \
  --as user
```

Expected: response contains `created: true`.

- [ ] **Step 4: Verify the exact field**

First list fields again, copy the returned `fld...` ID for `恢复上下文`, then run:

```bash
lark-cli base +field-get \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$LARK_TABLE_INVENTORY_TRANSACTION" \
  --field-id "<恢复上下文字段ID>" \
  --as user
```

Expected: name is `恢复上下文`, type is `text`, and the description identifies versioned sales allocation JSON.

## Task 3: Idempotently Create Or Complete Table `25`

**Files:**
- No repository files

- [ ] **Step 1: Select the create or reconcile path**

From Task 1:

- If `25_库存预警日志` does not exist, use Step 2.
- If exactly one exists, set `WARNING_TABLE_ID` to its returned ID and skip to Step 4.
- If duplicates exist, stop without changing any duplicate table.

- [ ] **Step 2: Preview creation with the complete field contract**

Run:

```bash
WARNING_FIELDS_JSON='[
  {"name":"预警编号","type":"text","description":"扫描汇总使用 SCANLOG-${scanId}；SKU预警使用 WARN-${Asia/Shanghai YYYYMMDD}-${SKU}"},
  {"name":"记录类型","type":"select","multiple":false,"options":[{"name":"扫描汇总","hue":"Blue","lightness":"Light"},{"name":"库存预警","hue":"Orange","lightness":"Light"}]},
  {"name":"扫描批次号","type":"text","description":"完整 scanId，可包含 UUID"},
  {"name":"SKU","type":"text"},
  {"name":"预警等级","type":"select","multiple":false,"options":[{"name":"异常","hue":"Red","lightness":"Light"},{"name":"紧急","hue":"Orange","lightness":"Light"},{"name":"需采购","hue":"Yellow","lightness":"Light"},{"name":"低库存","hue":"Blue","lightness":"Light"}]},
  {"name":"触发原因","type":"text"},
  {"name":"橙联可售","type":"number","style":{"type":"plain","precision":0}},
  {"name":"总可用库存","type":"number","style":{"type":"plain","precision":0}},
  {"name":"近7日日均销量","type":"number","style":{"type":"plain","precision":2}},
  {"name":"预计可售天数","type":"number","style":{"type":"plain","precision":2}},
  {"name":"安全库存","type":"number","style":{"type":"plain","precision":0}},
  {"name":"补货周期天数","type":"number","style":{"type":"plain","precision":0}},
  {"name":"建议采购量","type":"number","style":{"type":"plain","precision":0}},
  {"name":"处理状态","type":"select","multiple":false,"options":[{"name":"待处理","hue":"Red","lightness":"Lighter"},{"name":"已通知","hue":"Blue","lightness":"Lighter"},{"name":"已转采购","hue":"Green","lightness":"Light"},{"name":"已关闭","hue":"Gray","lightness":"Light"}]},
  {"name":"处理备注","type":"text"},
  {"name":"失败原因","type":"text"},
  {"name":"处理销售记录数","type":"number","style":{"type":"plain","precision":0}},
  {"name":"成功扣减数","type":"number","style":{"type":"plain","precision":0}},
  {"name":"跳过数","type":"number","style":{"type":"plain","precision":0}},
  {"name":"异常数","type":"number","style":{"type":"plain","precision":0}},
  {"name":"预警SKU数","type":"number","style":{"type":"plain","precision":0}},
  {"name":"通知消息ID","type":"text"},
  {"name":"通知时间","type":"datetime","style":{"format":"yyyy-MM-dd HH:mm"}},
  {"name":"创建时间","type":"created_at","style":{"format":"yyyy-MM-dd HH:mm"}},
  {"name":"更新时间","type":"updated_at","style":{"format":"yyyy-MM-dd HH:mm"}}
]'

lark-cli base +table-create \
  --base-token "$LARK_BASE_TOKEN" \
  --name "25_库存预警日志" \
  --fields "$WARNING_FIELDS_JSON" \
  --view '[{"name":"全部预警","type":"grid"}]' \
  --as user \
  --dry-run
```

Expected: the request contains one table, 25 fields and one requested grid view. The first field is `预警编号`, allowing the CLI to rename the platform default primary field.

- [ ] **Step 3: Create the table after main-agent approval**

Run the Step 2 command without `--dry-run`.

Expected: capture the returned `tbl...` value as `WARNING_TABLE_ID`. Do not infer or hand-type this ID.

- [ ] **Step 4: Reconcile fields when the table already exists or creation was partially completed**

Run:

```bash
lark-cli base +field-list \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --offset 0 \
  --limit 200 \
  --as user
```

Compare all 25 fields by exact name, type, select options, precision and datetime format.

For each missing field, preview and then create only that field. Example for a missing text field:

```bash
lark-cli base +field-create \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --json '{"name":"失败原因","type":"text"}' \
  --as user \
  --dry-run
```

After approval, repeat without `--dry-run`.

For missing select, number, datetime, created_at or updated_at fields, use the exact JSON object from `WARNING_FIELDS_JSON`.

If a same-named field has a mismatched type, option set, precision or format, stop and report the mismatch. Do not call `field-update`, because an in-place type or option conversion could damage existing records.

- [ ] **Step 5: Verify all fields individually where configuration matters**

Use `field-list` to obtain IDs, then run `field-get` for:

- `预警编号`
- `记录类型`
- `预警等级`
- `处理状态`
- `预计可售天数`
- `通知时间`
- `创建时间`
- `更新时间`

Command template:

```bash
lark-cli base +field-get \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --field-id "<confirmed-field-id>" \
  --as user
```

Expected: every field matches the table contract exactly.

## Task 4: Idempotently Create And Configure Views

**Files:**
- No repository files

Target grid views:

1. `全部预警`
2. `扫描批次`
3. `紧急预警`
4. `待处理预警`
5. `已转采购`
6. `异常核查`

- [ ] **Step 1: Read existing views before every write**

Run:

```bash
lark-cli base +view-list \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --offset 0 \
  --limit 100 \
  --as user
```

For each target name:

- Zero matches: create it.
- One grid match: reuse its ID.
- Duplicate matches or a non-grid match: stop without deleting or renaming views.

- [ ] **Step 2: Create only missing views**

Command template:

```bash
lark-cli base +view-create \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --json '{"name":"扫描批次","type":"grid"}' \
  --as user
```

Repeat serially for each missing target name. Do not create views in parallel.

- [ ] **Step 3: Read each current filter before setting it**

Run:

```bash
lark-cli base +view-get-filter \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --view-id "<confirmed-view-id>" \
  --as user
```

Save each returned filter in the execution transcript before changing it.

- [ ] **Step 4: Apply filters using a controlled `1.0.32` compatibility sequence**

The current CLI documentation uses arrays for `select` values, but this Base has previously accepted single strings for some select/text-like filters. For every view:

1. Confirm the field type again with `field-get`.
2. Try the canonical array payload first.
3. Read the filter back with `view-get-filter`.
4. If `1.0.32` rejects only the value shape, retry the exact string fallback listed below.
5. Read back again and verify semantic equivalence.
6. Do not try unrelated payload shapes.

Canonical payloads:

```json
全部预警
{"logic":"and","conditions":[["记录类型","intersects",["库存预警"]]]}

扫描批次
{"logic":"and","conditions":[["记录类型","intersects",["扫描汇总"]]]}

紧急预警
{"logic":"and","conditions":[["记录类型","intersects",["库存预警"]],["预警等级","intersects",["紧急"]],["处理状态","disjoint",["已关闭"]]]}

待处理预警
{"logic":"and","conditions":[["记录类型","intersects",["库存预警"]],["处理状态","disjoint",["已转采购","已关闭"]]]}

已转采购
{"logic":"and","conditions":[["记录类型","intersects",["库存预警"]],["处理状态","intersects",["已转采购"]]]}

异常核查
{"logic":"and","conditions":[["记录类型","intersects",["库存预警"]],["预警等级","intersects",["异常"]],["处理状态","disjoint",["已关闭"]]]}
```

String fallbacks:

```json
全部预警
{"logic":"and","conditions":[["记录类型","intersects","库存预警"]]}

扫描批次
{"logic":"and","conditions":[["记录类型","intersects","扫描汇总"]]}

紧急预警
{"logic":"and","conditions":[["记录类型","intersects","库存预警"],["预警等级","intersects","紧急"],["处理状态","disjoint","已关闭"]]}

待处理预警
{"logic":"and","conditions":[["记录类型","intersects","库存预警"],["处理状态","disjoint","已转采购"],["处理状态","disjoint","已关闭"]]}

已转采购
{"logic":"and","conditions":[["记录类型","intersects","库存预警"],["处理状态","intersects","已转采购"]]}

异常核查
{"logic":"and","conditions":[["记录类型","intersects","库存预警"],["预警等级","intersects","异常"],["处理状态","disjoint","已关闭"]]}
```

Command template:

```bash
lark-cli base +view-set-filter \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --view-id "<confirmed-view-id>" \
  --json '<selected-payload>' \
  --as user
```

- [ ] **Step 5: Configure view sorting**

`扫描批次` sorts by `创建时间` descending. Warning views sort by `更新时间` descending and then `预警等级` ascending.

Scan summary command:

```bash
lark-cli base +view-set-sort \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --view-id "<扫描批次view-id>" \
  --json '{"sort_config":[{"field":"创建时间","desc":true}]}' \
  --as user
```

Warning view command:

```bash
lark-cli base +view-set-sort \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --view-id "<warning-view-id>" \
  --json '{"sort_config":[{"field":"更新时间","desc":true},{"field":"预警等级","desc":false}]}' \
  --as user
```

- [ ] **Step 6: Configure visible fields**

For `扫描批次`:

```json
{"visible_fields":["预警编号","扫描批次号","处理销售记录数","成功扣减数","跳过数","异常数","预警SKU数","失败原因","通知消息ID","通知时间","创建时间","更新时间"]}
```

For all warning views:

```json
{"visible_fields":["预警编号","扫描批次号","SKU","预警等级","触发原因","橙联可售","总可用库存","近7日日均销量","预计可售天数","安全库存","补货周期天数","建议采购量","处理状态","处理备注","失败原因","通知时间","更新时间"]}
```

Command template:

```bash
lark-cli base +view-set-visible-fields \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --view-id "<confirmed-view-id>" \
  --json '<visible-fields-payload>' \
  --as user
```

- [ ] **Step 7: Verify every view**

For each target view, run:

```bash
lark-cli base +view-get-filter \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --view-id "<confirmed-view-id>" \
  --as user

lark-cli base +view-get-sort \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --view-id "<confirmed-view-id>" \
  --as user

lark-cli base +view-get-visible-fields \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --view-id "<confirmed-view-id>" \
  --as user
```

Expected: filter semantics, sort order and field order match this task. Platform-created default views may remain; do not delete them.

## Task 5: Configure Environment Variables

**Files:**
- Modify: `.env.example`
- Modify locally: `.env.local`

- [ ] **Step 1: Confirm neither file has duplicate keys**

Run:

```bash
rg -n '^(LARK_TABLE_INVENTORY_WARNING|LARK_INVENTORY_ALERT_CHAT_ID)=' .env.example .env.local
```

Expected: zero or one occurrence per key in each file. If a file has duplicate occurrences, stop and resolve the duplicate manually without exposing existing values.

- [ ] **Step 2: Add the tracked example variables**

Apply this exact patch location under the other Lark table IDs:

```diff
 LARK_TABLE_INVENTORY_TRANSACTION=
+LARK_TABLE_INVENTORY_WARNING=
+
+# 可选：库存扫描出现异常、紧急或升级为需采购时发送到该飞书群
+LARK_INVENTORY_ALERT_CHAT_ID=
```

- [ ] **Step 3: Set the local table ID and optional chat configuration**

In `.env.local`:

```text
LARK_TABLE_INVENTORY_WARNING=<WARNING_TABLE_ID returned by Base>
LARK_INVENTORY_ALERT_CHAT_ID=
```

If the deployment owner has supplied a confirmed `oc_...` chat ID, use it instead of an empty value. Do not discover or guess a chat ID as part of this plan. Preserve every unrelated line and secret in `.env.local`.

- [ ] **Step 4: Verify without printing values**

Run:

```bash
for key in LARK_TABLE_INVENTORY_WARNING LARK_INVENTORY_ALERT_CHAT_ID; do
  count=$(rg -c "^${key}=" .env.local)
  printf '%s occurrences=%s\n' "$key" "$count"
done
```

Expected: each key has exactly one occurrence. Then compare the warning table value in memory to `WARNING_TABLE_ID` without printing either value:

```bash
set -a
source .env.local
set +a
test "$LARK_TABLE_INVENTORY_WARNING" = "$WARNING_TABLE_ID"
```

Expected: exit code `0`.

- [ ] **Step 5: Commit only the tracked environment template change**

Before committing:

```bash
git status --short
git diff -- .env.example
```

Expected: `.env.example` contains only the two new keys; unrelated dirty files remain unstaged.

Commit:

```bash
git add .env.example
git commit -m "chore: document inventory warning base config"
```

Do not add `.env.local`.

## Task 6: Final Structural And Permission Verification

**Files:**
- No repository files

- [ ] **Step 1: Verify the aggregate structure of tables `24` and `25`**

Run:

```bash
lark-cli base +table-get \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$LARK_TABLE_INVENTORY_TRANSACTION" \
  --as user

lark-cli base +table-get \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --as user
```

Expected:

- Table `24` contains exactly one `恢复上下文` text field.
- Table `25` contains the 25 contracted fields.
- All six named grid views exist exactly once.

- [ ] **Step 2: Re-run field and view lists to detect partial writes**

Run:

```bash
lark-cli base +field-list \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --offset 0 \
  --limit 200 \
  --as user

lark-cli base +view-list \
  --base-token "$LARK_BASE_TOKEN" \
  --table-id "$WARNING_TABLE_ID" \
  --offset 0 \
  --limit 100 \
  --as user
```

Expected: no duplicate contracted field or target view names.

- [ ] **Step 3: Read permissions without changing them**

Re-run `role-list` and `role-get` from Task 1.

Record:

- Which roles can see `25_库存预警日志`.
- Which roles can edit records or views.
- Whether the scheduled runtime identity can read the six source tables and write tables `02`、`19`、`23`、`24`、`25`.

If permissions are insufficient, report this as a deployment blocker to the main agent. Do not repair permissions within this plan.

- [ ] **Step 4: Confirm that no prohibited operations occurred**

Review the execution transcript and ensure it contains none of:

- `lark-cli update`
- `table-delete`
- `field-delete`
- `view-delete`
- `role-update`
- `role-create`
- `advperm-enable`
- `advperm-disable`
- writes to `10_补货采购建议`

- [ ] **Step 5: Deliver the contract to agents 1 and 3**

Provide agent 1:

- `WARNING_TABLE_ID`
- field IDs for `预警编号`、`扫描批次号`、`处理状态`、`处理备注`、`通知消息ID`、`通知时间`
- the `恢复上下文` field ID
- the exact daily warning key and scan summary key formats
- confirmation that `10_补货采购建议` is out of scope
- confirmation that agent 1 owns the `inventoryWarning` key in `TABLE_ENV_KEYS`

Provide agent 3:

- the two environment variable names
- the UUID-bearing scanId example
- the stable daily warning ID example
- verification that `预计可售天数` is omitted when daily sales are zero
- the rule preserving `已转采购`、`已关闭` and `处理备注`
- the permission-read result and any deployment blocker

## Idempotency And Recovery Rules

1. Every table, field and view operation begins with a list/get read.
2. A single exact match is reused; no match is created; duplicate matches stop execution.
3. Same-name field type or configuration mismatches stop execution. No automatic field conversion is allowed.
4. View filters are read before and after changes. Only the documented canonical and string fallback payloads may be attempted.
5. Failed view configuration does not justify deleting or recreating the view.
6. `25_库存预警日志` is never deleted, including during partial setup.
7. `24_库存流转事务.恢复上下文` is never removed after application code begins writing it.
8. Existing role configuration remains untouched.
9. `.env.local` changes are local and uncommitted; `.env.example` is the only tracked implementation file owned by this plan.
10. If setup stops midway, rerun from Task 1; the read-before-write branches safely resume missing work.

## Risks For Main-Agent Review

1. Base does not enforce uniqueness for `预警编号`; agent 1 must perform complete unique lookup and fail on duplicate matches.
2. One daily SKU warning row means later scans overwrite operational metrics for that day. This is intentional; per-scan history remains available through `SCANLOG-${scanId}`.
3. The `恢复上下文` text field stores opaque JSON. Invalid or oversized JSON must be rejected by agent 1 before writing.
4. Current custom-role permissions do not automatically guarantee access to newly created tables. This plan only reports the condition; deployment remains blocked until an authorized owner resolves it outside this scope.
5. `lark-cli 1.0.32` may require scalar strings instead of arrays in some filter payloads. The controlled read, canonical attempt, scalar fallback and read-back sequence prevents guessing.
6. `10_补货采购建议` lacks SKU and quantity fields, so writing it in phase one would be non-idempotent and is prohibited.
7. `LARK_INVENTORY_ALERT_CHAT_ID` may remain empty. Agent 1 must treat that as notifications disabled rather than a scan failure.
