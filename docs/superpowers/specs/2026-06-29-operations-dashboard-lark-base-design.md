# Operations Dashboard Lark Base Design

## Goal

Turn the current operating dashboard outline into a Feishu Base-first design. Feishu Base dashboard is the primary operating dashboard for management and daily review. Base should own the stable calculations, views, summary tables, and alert source records; the web app should only supplement data import, automation status, and custom drill-downs that Base cannot express well.

This design builds on the existing app concepts:

- `07_销售日报` is the sales fact table.
- `02_库存流水` is the inventory movement ledger.
- `18_SKU库存策略` stores replenishment and safety-stock rules.
- `19_SKU运营汇总` stores SKU inventory and sales snapshots.
- `22_SKU批次库存明细` remains the authoritative inventory detail ledger.
- `25_库存预警日志` stores generated warning records.

## Core Decisions

1. Use USD as the default dashboard reporting currency. Sales prices are USD; purchase prices are RMB and must be converted through a monthly exchange rate before profit is calculated.
2. Use `净销售额_USD` as the primary revenue metric for profit and margin. Keep `销售额_USD` as gross revenue before refunds.
3. Treat `订单手续费_USD` as the unified 店小秘 fee field. It already includes platform fees and advertising spend, so the dashboard must not add a separate ad-fee line.
4. Put row-level calculations in Base formula fields on `07_销售日报`.
5. Put period-level calculations in summary tables that are refreshed by the app service or Base automation.
6. Use Feishu Base dashboard as the main dashboard surface. Use Base views and dashboard table blocks for drill-downs and alerts.
7. Use web pages only as supplemental tools for import, automation monitoring, or custom visualization that cannot be built in Base.
8. Keep all formula field names in Chinese and stable, because Base dashboard `data_config` depends on exact field names.

## Metric Vocabulary

| Metric | Definition | Owner |
| --- | --- | --- |
| `销售额_USD` | Gross sales before refunds | Imported source field |
| `退款金额_USD` | Refund amount for the same sales row | Imported source field |
| `净销售额_USD` | `销售额_USD - 退款金额_USD` | Base formula |
| `单品采购价_RMB` | One unit purchase price from SKU master data | Stored in `01_SKU主数据` |
| `采购成本_RMB` | `售出数量 * 单品采购价_RMB` | Base formula |
| `采购成本_USD` | `采购成本_RMB / USD_CNY汇率` | Base formula |
| `订单手续费_USD` | 店小秘 order fee, including platform fees and advertising spend | Imported source field |
| `头程费用_RMB` | `售出数量 * 20` | Base formula |
| `头程费用_USD` | Fixed RMB first-mile cost converted to USD | Base formula |
| `总费用_USD` | Order fee, fulfillment, first-mile, and other operating fees | Base formula |
| `总成本_USD` | `采购成本_USD + 总费用_USD` | Base formula |
| `净利润_USD` | `净销售额_USD - 总成本_USD` | Base formula |
| `净利润率` | `净利润_USD / 净销售额_USD` | Base formula |
| `费用率` | `总费用_USD / 净销售额_USD` | Base formula |
| `周环比` | `(本期 - 上期) / 上期` | Period summary table |

## Base Tables

### `07_销售日报`

This remains the canonical sales fact table. Each row should represent one store, SKU, and order line from 店小秘 or manual entry.

Required stored fields:

| Field | Type | Notes |
| --- | --- | --- |
| `日期` | datetime | Sales/shipping date, day precision |
| `店铺` | select | `Solidparts`, `NewPower`, `VelocityGear`, `TitanRig`, `Nexusmoto` |
| `SKU` | text or link | Prefer link to `01_SKU主数据` once migration is safe |
| `商品名称` | text | Imported snapshot for readable reports |
| `售出数量` | number | Positive integer |
| `销售额_USD` | number/currency | Gross sales amount. Existing `销售额` can remain as a compatibility alias during migration |
| `退款金额_USD` | number/currency | Defaults to 0 |
| `USD_CNY汇率` | number | Monthly rate, meaning `1 USD = X RMB`; copied from `30_月度汇率` |
| `单品采购价_RMB` | number/currency | Copied from `01_SKU主数据` for the sale date/import moment |
| `订单手续费_USD` | number/currency | 店小秘 `订单手续费`; includes platform fees and ad spend |
| `橙联履约费_USD` | number/currency | Last-mile/fulfillment fee |
| `其他费用_USD` | number/currency | Optional, defaults to 0 |
| `导入Key` | text | Stable duplicate key; split out from `备注` when ready |
| `备注` | text | Source provenance only |

Formula fields:

| Field | Formula expression |
| --- | --- |
| `净销售额_USD` | `IFERROR([销售额_USD] - [退款金额_USD], 0)` |
| `采购成本_RMB` | `IFERROR([售出数量] * [单品采购价_RMB], 0)` |
| `采购成本_USD` | `IF([USD_CNY汇率] = 0, 0, [采购成本_RMB] / [USD_CNY汇率])` |
| `头程费用_RMB` | `IFERROR([售出数量] * 20, 0)` |
| `头程费用_USD` | `IF([USD_CNY汇率] = 0, 0, [头程费用_RMB] / [USD_CNY汇率])` |
| `总费用_USD` | `IFERROR([订单手续费_USD] + [橙联履约费_USD] + [头程费用_USD] + [其他费用_USD], 0)` |
| `总成本_USD` | `IFERROR([采购成本_USD] + [总费用_USD], 0)` |
| `净利润_USD` | `IFERROR([净销售额_USD] - [总成本_USD], 0)` |
| `净利润率` | `IF([净销售额_USD] = 0, 0, [净利润_USD] / [净销售额_USD])` |
| `费用率` | `IF([净销售额_USD] = 0, 0, [总费用_USD] / [净销售额_USD])` |
| `日期_天` | `TEXT([日期], "YYYY-MM-DD")` |
| `日期_周` | `TEXT(YEAR([日期]), "0000") & "-W" & TEXT(WEEKNUM([日期]), "00")` |
| `日期_月` | `TEXT([日期], "YYYY-MM")` |

Terminology note: the earlier "line total or unit cost" question referred only to the cost field on `07_销售日报`. With the clarified RMB purchase-price model, use `01_SKU主数据.单品采购价_RMB` as the one-unit purchase price and calculate each sales row's total purchase cost as `售出数量 * 单品采购价_RMB`. This avoids needing the import file to know whether its cost column is line-level or unit-level.

Implementation note: if current data still uses `销售额`, `退款金额`, or `eBay费用`, keep compatibility fields during migration, but make the canonical dashboard fields explicit with currency suffixes such as `销售额_USD`, `退款金额_USD`, and `订单手续费_USD`.

### `01_SKU主数据`

This table should hold durable SKU attributes used across finance, listing, and inventory.

Recommended additions:

| Field | Type | Notes |
| --- | --- | --- |
| `SKU` | text | Unique business key |
| `商品名称` | text | Main product name |
| `单品采购价_RMB` | number/currency | One-unit purchase price in RMB |
| `毛重g` | number | Kept for logistics reference, not used in first-mile fee calculation |
| `运营负责人` | user | For alert routing |
| `销售状态` | select | Active, Watching, Clearance, Discontinued |

First-mile fee rule: use a fixed `20 RMB` per sold item in `07_销售日报`, not SKU weight.

### `30_月度汇率`

Add this table for monthly exchange rates. The app service should update it from the Bank of China foreign exchange quotation once per month, then summary and import workflows should copy the relevant rate into sales rows. Copying the rate onto each `07_销售日报` row creates an audit trail and prevents old profit from changing unexpectedly when a future exchange-rate row is corrected.

Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `月份` | text | Example: `2026-06` |
| `USD_CNY汇率` | number | `1 USD = X RMB` |
| `来源` | text | `中国银行外汇牌价` or manual |
| `来源URL` | text | Bank of China quotation page or archived fetch URL |
| `牌价日期` | datetime | The first working day quotation date used for this month |
| `牌价时间` | text | Publication time from the source row |
| `原始中行折算价` | number | BOC publishes `100 USD = X RMB`; keep the raw value for audit |
| `更新时间` | datetime | When this rate was last refreshed |
| `是否锁定` | checkbox | Finance can lock a month after closing |
| `备注` | text | Manual adjustment notes |

Workflow:

1. On the first working day of each month, fetch the USD row from Bank of China foreign exchange quotation.
2. Use `中行折算价` as the accounting rate source.
3. Because BOC publishes the quotation as `100 foreign currency = X RMB`, calculate `USD_CNY汇率 = 原始中行折算价 / 100`.
4. If the first calendar day is not a working day or BOC has no quotation yet, use the first later date in that month with a USD quotation.
5. If multiple quotations exist on that source date, use the first quotation published at or after 09:30 China time; if unavailable, use the earliest available quotation that day.
6. Store the raw `牌价日期`, `牌价时间`, `原始中行折算价`, and `来源URL`.
7. Do not overwrite a locked month.
8. When importing sales rows, set `USD_CNY汇率` from the matching month.
9. If a rate is corrected before lock, rerun the sales and summary rebuild for that month.

### `19_SKU运营汇总`

This table should continue to be rebuilt by automation, not manually maintained. Extend it from inventory-only summary into SKU operating summary.

Existing fields should remain:

- `SKU`
- `本地库存`
- `国内集货仓`
- `橙联在途`
- `橙联可售`
- `异常暂存`
- `总可用库存`
- `累计销量`
- `近7日日均销量`

Recommended additions:

| Field | Type | Owner |
| --- | --- | --- |
| `近30天销量` | number | Automation from `07_销售日报` |
| `近30天净销售额_USD` | number/currency | Automation |
| `近30天净利润_USD` | number/currency | Automation |
| `近30天利润率` | formula | Base formula on summary row |
| `最后销售日期` | datetime | Automation |
| `无销售天数` | formula | Base formula |
| `占用资金_RMB` | formula | Base formula |
| `滞销状态` | formula/select | Base formula or automation |
| `库存预警状态` | formula/select | Base formula or automation |
| `库存缺口` | formula | Base formula |
| `可售天数` | formula | Base formula |

Formula fields:

| Field | Formula expression |
| --- | --- |
| `近30天利润率` | `IF([近30天净销售额_USD] = 0, 0, [近30天净利润_USD] / [近30天净销售额_USD])` |
| `无销售天数` | `IF(ISBLANK([最后销售日期]), 9999, DAYS(TODAY(), [最后销售日期]))` |
| `占用资金_RMB` | `IFERROR([总可用库存] * [单品采购价_RMB], 0)` |
| `库存缺口` | `MAX([安全库存] - [橙联可售], 0)` |
| `可售天数` | `IF([近7日日均销量] = 0, 9999, [橙联可售] / [近7日日均销量])` |
| `滞销状态` | `IFS([总可用库存] <= 0, "无库存", [无销售天数] > 60, "严重滞销", [无销售天数] >= 30, "需关注", TRUE(), "正常")` |
| `库存预警状态` | `IFS([橙联可售] <= 0, "缺货", [库存缺口] > 0, "低于安全库存", [可售天数] <= [补货周期天数], "需补货", TRUE(), "正常")` |

If `安全库存`, `补货周期天数`, or `单品采购价_RMB` live in `18_SKU库存策略` or `01_SKU主数据`, either copy them into `19_SKU运营汇总` during rebuild or use link-field chained formulas. Copying during rebuild is simpler and more dashboard-friendly.

### `26_经营日汇总`

Add this table for dashboard KPIs and trend charts. One row per `日期 + 店铺`.

Fields:

| Field | Type | Owner |
| --- | --- | --- |
| `汇总日期` | datetime | Automation |
| `日期_天` | text | Automation or formula |
| `日期_周` | text | Automation or formula |
| `日期_月` | text | Automation or formula |
| `店铺` | select | Automation |
| `订单数` | number | Count distinct order/import keys when available |
| `售出数量` | number | Sum |
| `销售额_USD` | number/currency | Sum from `07_销售日报` |
| `退款金额_USD` | number/currency | Sum |
| `净销售额_USD` | number/currency | Sum |
| `采购成本_RMB` | number/currency | Sum |
| `采购成本_USD` | number/currency | Sum |
| `订单手续费_USD` | number/currency | Sum; includes platform fees and ad spend |
| `橙联履约费_USD` | number/currency | Sum |
| `头程费用_RMB` | number/currency | Sum |
| `头程费用_USD` | number/currency | Sum |
| `其他费用_USD` | number/currency | Sum |
| `总费用_USD` | number/currency | Sum |
| `总成本_USD` | number/currency | Sum |
| `净利润_USD` | number/currency | Sum |
| `净利润率` | formula | Base formula |
| `费用率` | formula | Base formula |
| `退款率` | formula | Base formula |
| `客单价_USD` | formula | Base formula |

Formula fields:

| Field | Formula expression |
| --- | --- |
| `净利润率` | `IF([净销售额_USD] = 0, 0, [净利润_USD] / [净销售额_USD])` |
| `费用率` | `IF([净销售额_USD] = 0, 0, [总费用_USD] / [净销售额_USD])` |
| `退款率` | `IF([销售额_USD] = 0, 0, [退款金额_USD] / [销售额_USD])` |
| `客单价_USD` | `IF([订单数] = 0, 0, [净销售额_USD] / [订单数])` |

### `27_经营周期汇总`

Add this table for KPI cards and week-over-week metrics. One row per `周期类型 + 周期编号 + 店铺`, plus `全部店铺` rows.

Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `周期类型` | select | `周`, `月`, `自定义` |
| `周期编号` | text | Example: `2026-W27`, `2026-06` |
| `周期开始` | datetime | Inclusive |
| `周期结束` | datetime | Inclusive |
| `店铺` | select | Include `全部店铺` |
| `订单数` | number | Sum |
| `售出数量` | number | Sum |
| `销售额_USD` | number/currency | Sum |
| `退款金额_USD` | number/currency | Sum |
| `净销售额_USD` | number/currency | Sum |
| `订单手续费_USD` | number/currency | Sum |
| `橙联履约费_USD` | number/currency | Sum |
| `头程费用_USD` | number/currency | Sum |
| `总费用_USD` | number/currency | Sum |
| `净利润_USD` | number/currency | Sum |
| `净利润率` | formula | Same ratio |
| `费用率` | formula | Same ratio |
| `退款率` | formula | Same ratio |
| `客单价_USD` | formula | Same ratio |
| `活跃SKU数` | number | Automation |
| `负利润订单数` | number | Automation |
| `高费用率订单数` | number | Automation |
| `库存预警SKU数` | number | Automation from `19_SKU运营汇总` |
| `滞销SKU数` | number | Automation from `19_SKU运营汇总` |
| `滞销占用资金_RMB` | number/currency | Automation from `19_SKU运营汇总` |
| `上期净销售额_USD` | number/currency | Automation fills from previous period |
| `上期净利润_USD` | number/currency | Automation |
| `上期总费用_USD` | number/currency | Automation |
| `销售额环比` | formula | KPI delta |
| `净利润环比` | formula | KPI delta |
| `总费用环比` | formula | KPI delta |

Formula fields:

| Field | Formula expression |
| --- | --- |
| `净利润率` | `IF([净销售额_USD] = 0, 0, [净利润_USD] / [净销售额_USD])` |
| `费用率` | `IF([净销售额_USD] = 0, 0, [总费用_USD] / [净销售额_USD])` |
| `退款率` | `IF([销售额_USD] = 0, 0, [退款金额_USD] / [销售额_USD])` |
| `客单价_USD` | `IF([订单数] = 0, 0, [净销售额_USD] / [订单数])` |
| `销售额环比` | `IF([上期净销售额_USD] = 0, 0, ([净销售额_USD] - [上期净销售额_USD]) / [上期净销售额_USD])` |
| `净利润环比` | `IF([上期净利润_USD] = 0, 0, ([净利润_USD] - [上期净利润_USD]) / [上期净利润_USD])` |
| `总费用环比` | `IF([上期总费用_USD] = 0, 0, ([总费用_USD] - [上期总费用_USD]) / [上期总费用_USD])` |

### `28_SKU周期汇总`

Add this table for best sellers, profit contribution, and slow-moving SKU lists. One row per `周期类型 + 周期编号 + 店铺 + SKU`.

Fields:

| Field | Type | Owner |
| --- | --- | --- |
| `周期类型` | select | Automation |
| `周期编号` | text | Automation |
| `店铺` | select | Automation |
| `SKU` | text/link | Automation |
| `商品名称` | text | Automation |
| `订单数` | number | Count |
| `售出数量` | number | Sum |
| `退款金额_USD` | number/currency | Sum |
| `净销售额_USD` | number/currency | Sum |
| `订单手续费_USD` | number/currency | Sum |
| `橙联履约费_USD` | number/currency | Sum |
| `头程费用_USD` | number/currency | Sum |
| `其他费用_USD` | number/currency | Sum |
| `总费用_USD` | number/currency | Sum |
| `净利润_USD` | number/currency | Sum |
| `净利润率` | formula | Base formula |
| `费用率` | formula | Base formula |
| `退款率` | formula | Base formula |
| `利润排名` | number | Automation after sorting |
| `利润贡献占比` | number/progress | Automation |
| `累计利润贡献占比` | number/progress | Automation |
| `当前库存` | number | Copied from `19_SKU运营汇总` |
| `最后销售日期` | datetime | Copied from `19_SKU运营汇总` |
| `无销售天数` | number | Copied or formula |
| `占用资金_RMB` | number/currency | Copied or formula |
| `滞销状态` | select/text | Copied or formula |

Formula field:

| Field | Formula expression |
| --- | --- |
| `净利润率` | `IF([净销售额_USD] = 0, 0, [净利润_USD] / [净销售额_USD])` |
| `费用率` | `IF([净销售额_USD] = 0, 0, [总费用_USD] / [净销售额_USD])` |
| `退款率` | `IF([净销售额_USD] = 0, 0, [退款金额_USD] / [净销售额_USD])` |

`利润排名`, `利润贡献占比`, and `累计利润贡献占比` should be automation-filled rather than formula-filled because they depend on period-wide ordering and cumulative sums.

## Views

Recommended Base views:

| Table | View | Filter and sort |
| --- | --- | --- |
| `07_销售日报` | `负利润订单` | `净利润_USD < 0`, sorted by `净利润_USD` ascending |
| `07_销售日报` | `高费用率订单` | `费用率 > 0.25`, sorted by `费用率` descending |
| `07_销售日报` | `退款异常订单` | `退款金额_USD > 0`, sorted by `退款金额_USD` descending |
| `07_销售日报` | `缺成本订单` | `单品采购价_RMB is empty` or `USD_CNY汇率 is empty` |
| `19_SKU运营汇总` | `库存预警` | `库存预警状态 != 正常`, sorted by `库存缺口` descending |
| `19_SKU运营汇总` | `滞销SKU` | `滞销状态 != 正常`, sorted by `占用资金_RMB` descending |
| `28_SKU周期汇总` | `畅销SKU_TOP10` | Current period, sorted by `净利润_USD` descending |
| `28_SKU周期汇总` | `利润率异常SKU` | `净销售额_USD > 0` and `净利润率 < 0.1` |
| `28_SKU周期汇总` | `手续费率异常SKU` | `费用率 > 0.25`, sorted by `费用率` descending |

## Dashboard Mapping

Use Feishu Base dashboard as the primary dashboard. Its blocks should read `26_经营日汇总`, `27_经营周期汇总`, `28_SKU周期汇总`, and `19_SKU运营汇总`; avoid reading raw sales rows for every component.

The web app may remain as a supplemental operations console for import logs, automation controls, record repair, and custom charts that Base cannot support, but it must not define separate KPI logic. Base formulas and summary tables remain the source of truth.

### Filters

Base dashboard filters should map to:

- `店铺`
- `周期类型`
- `周期编号`
- `日期_天` or date range if supported by the current dashboard UI

### KPI Cards

Source: `27_经营周期汇总`.

| Card | Base block type | Field |
| --- | --- | --- |
| `净销售额_USD` | `statistics` | `净销售额_USD`, `SUM` |
| `销售额_USD` | `statistics` | `销售额_USD`, `SUM` |
| `订单数` | `statistics` | `订单数`, `SUM` |
| `售出数量` | `statistics` | `售出数量`, `SUM` |
| `净利润_USD` | `statistics` | `净利润_USD`, `SUM` |
| `净利润率` | `statistics` | Use period summary row value; avoid averaging row-level margin |
| `总费用_USD` | `statistics` | `总费用_USD`, `SUM` |
| `费用率` | `statistics` | Use period summary row value; avoid averaging row-level fee rate |
| `退款率` | `statistics` | Use period summary row value |
| `库存预警SKU数` | `statistics` | `库存预警SKU数`, `SUM` |
| `滞销SKU数` | `statistics` | `滞销SKU数`, `SUM` |

If Base statistics cannot show week-over-week deltas natively, show `销售额环比`, `净利润环比`, and `总费用环比` as adjacent statistics cards or a compact table block in the Base dashboard.

### Charts

| Original block | Recommended Base block | Source table | Notes |
| --- | --- | --- | --- |
| Sales trend | `combo` or `line` | `26_经营日汇总` | Series: `净销售额_USD`; optional `净利润_USD` as second series |
| Order and quantity trend | `combo` | `26_经营日汇总` | Series: `订单数`, `售出数量`, and `客单价_USD` |
| Fee composition | `ring` | `29_利润拆解` | Categories: `订单手续费_USD`, `橙联履约费_USD`, `头程费用_USD`, `其他费用_USD` |
| Store comparison | `bar` | `27_经营周期汇总` | Group by `店铺`, series `净销售额_USD` and `净利润_USD` |
| Store quality comparison | `bar` | `27_经营周期汇总` | Group by `店铺`, series `退款率`, `费用率`, `净利润率` |
| Profit waterfall | Not native | `29_利润拆解` | Approximate in Base with ordered bar/table blocks; use web only as optional supplemental custom rendering |
| Cost composition | `ring` | `29_利润拆解` | Use category rows to avoid multiple hardcoded series |
| Best SKU Top 10 | Table block or view | `28_SKU周期汇总` | Sort by `净利润_USD`; use a dedicated Base view if block-level limit is weak |
| SKU risk table | Table block or view | `28_SKU周期汇总` | Sort by low margin, high fee rate, high refund rate |
| Slow-moving SKU | Table block or view | `19_SKU运营汇总` or `28_SKU周期汇总` | View is better than chart |
| Inventory risk summary | `bar` or table | `19_SKU运营汇总` | Group by `库存预警状态` and `滞销状态` |
| Inventory alert banner | View + Lark notification | `19_SKU运营汇总` / `25_库存预警日志` | Use Base view and message push |

### Expanded Dashboard Content

The operating dashboard should include more than top-line finance charts. Recommended first-screen and drill-down sections:

| Section | Purpose | Key information |
| --- | --- | --- |
| `经营总览` | Fast executive readout | `净销售额_USD`, `净利润_USD`, `净利润率`, `订单数`, `售出数量`, `费用率`, `退款率`, `库存预警SKU数` |
| `销售结构` | Understand growth source | Sales trend, order trend, store comparison, active SKU count, top contributing stores |
| `利润与费用` | Explain profit movement | Profit decomposition, `订单手续费_USD`, fulfillment fee, fixed first-mile fee, cost share, fee-rate trend |
| `SKU表现` | Find products to scale or fix | Top profit SKUs, top sales SKUs, low-margin SKUs, high-fee-rate SKUs, refund SKUs |
| `库存风险` | Connect sales to stock action | Low-stock list, stockout SKUs, sellable days, slow-moving SKUs, `滞销占用资金_RMB` |
| `异常与待办` | Turn dashboard into action | Negative-profit orders, missing cost rows, missing exchange-rate rows, high fee-rate orders, warning status |
| `数据健康` | Make numbers trustworthy | Last import time, current exchange-rate month, missing purchase price count, duplicate import count, summary rebuild time |

The Base dashboard should provide the management-facing summary charts, KPI cards, and drill-down view links. The web app can provide operational repair screens, import diagnostics, and optional custom visuals when Base dashboard blocks are too limited, but those screens should read the same Base-owned metrics.

### Optional `29_利润拆解`

Create this if the Base dashboard needs fee/cost ring charts and waterfall-like profit decomposition.

Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `周期编号` | text | Same as `27_经营周期汇总` |
| `店铺` | select | Include `全部店铺` |
| `类别` | select | `销售额_USD`, `退款金额_USD`, `采购成本_USD`, `订单手续费_USD`, `橙联履约费_USD`, `头程费用_USD`, `其他费用_USD`, `净利润_USD` |
| `方向` | select | `收入`, `扣减`, `结果` |
| `金额` | number/currency | Positive display amount |
| `排序` | number | 10, 20, 30... |

This table makes ring, bar, and custom waterfall rendering much easier because chart categories are rows, not fields.

## Automation And Lark Linkage

### Import-time calculation

When 店小秘 sales imports are written to `07_销售日报`, stored fields should be complete enough for formulas to calculate immediately. The import route should add or preserve:

- `销售额_USD`
- `退款金额_USD`
- `USD_CNY汇率`
- `单品采购价_RMB`
- `订单手续费_USD`
- `橙联履约费_USD`
- `其他费用_USD`
- `导入Key`

The existing import path currently maps `订单总价` to `销售额`, `退款费用` to `退款金额`, `订单手续费` to `eBay费用`, and `营销费用` to `广告费`. The next schema update should write canonical USD fields while keeping compatibility aliases for old data until the dashboard is switched over. Because 店小秘 `订单手续费` already includes platform fees and advertising spend, `营销费用` should not be added again to the profit formula unless finance later confirms it is a separate, non-overlapping fee.

Purchase cost should not depend on the 店小秘 cost column unless finance confirms its meaning. The safer default is:

1. Maintain `01_SKU主数据.单品采购价_RMB`.
2. Copy that value into `07_销售日报.单品采购价_RMB` at import time.
3. Let Base formulas calculate `采购成本_RMB` and `采购成本_USD`.

### Scheduled summary rebuild

Run a scheduled rebuild after imports and at least once daily:

1. Read changed `07_销售日报` rows for the affected date range.
2. Rebuild `26_经营日汇总` by `日期 + 店铺`.
3. Rebuild current and previous rows in `27_经营周期汇总`.
4. Rebuild `28_SKU周期汇总` for current week/month.
5. Rebuild `29_利润拆解` for the same periods if that table is used.
6. Rebuild or patch `19_SKU运营汇总` fields that depend on sales history: `近30天销量`, `近30天净销售额_USD`, `近30天净利润_USD`, `最后销售日期`.

The automation should upsert by stable business keys, not create duplicate summary rows:

- `日汇总Key = 日期_天 + ":" + 店铺`
- `周期汇总Key = 周期类型 + ":" + 周期编号 + ":" + 店铺`
- `SKU周期Key = 周期类型 + ":" + 周期编号 + ":" + 店铺 + ":" + SKU`
- `利润拆解Key = 周期编号 + ":" + 店铺 + ":" + 类别`

### Warning workflow

Inventory and operations warnings should be generated into records, then pushed to Lark groups.

Trigger conditions:

| Warning | Source | Condition |
| --- | --- | --- |
| Low stock | `19_SKU运营汇总` | `库存预警状态 != 正常` |
| Severe slow-moving | `19_SKU运营汇总` | `滞销状态 = 严重滞销` |
| Negative-profit order | `07_销售日报` | `净利润_USD < 0` |
| High fee rate | `07_销售日报` | `费用率 > 0.25` |
| Store profit drop | `27_经营周期汇总` | `净利润环比 < -0.2` |

Message routing:

- SKU-specific alerts go to `运营负责人` if available, plus the operations group.
- Finance anomalies go to the finance group.
- Daily digest goes to the management group at 09:30 Asia/Shanghai.

Message format:

- Title: warning type and period.
- Body: SKU/store, current value, threshold, suggested action.
- Link: Base record share link or dashboard URL.

### Ownership and permissions

| Role | Recommended access |
| --- | --- |
| 管理层 | Read dashboards and summary tables |
| 运营 | Edit SKU master, inventory strategy, and sales source records |
| 财务 | Edit fee, cost, exchange-rate, and assumption tables |
| App service/bot | Write summary tables, warnings, inventory ledgers |
| General users | Read-only on formula and summary fields |

## Currency Handling

Sales prices are USD and purchase prices are RMB. The dashboard should report operating performance in USD, while keeping RMB purchase and inventory exposure fields for finance and procurement.

Recommended approach:

1. Store sales-side fields in USD: `销售额_USD`, `退款金额_USD`, `订单手续费_USD`, `橙联履约费_USD`, `其他费用_USD`.
2. Store purchase-side fields in RMB: `单品采购价_RMB`, `采购成本_RMB`, `头程费用_RMB`, `占用资金_RMB`.
3. Store `USD_CNY汇率` on every sales row, copied from `30_月度汇率` by `日期_月`.
4. Convert cost-side metrics to USD through Base formulas: `采购成本_USD = 采购成本_RMB / USD_CNY汇率`, `头程费用_USD = 头程费用_RMB / USD_CNY汇率`.
5. Use only USD fields in KPI cards, trends, store comparison, profit, margin, and fee-rate charts.
6. Use RMB fields in inventory capital occupation and procurement views.

Monthly exchange-rate update:

1. The app service fetches Bank of China USD quotation once per month on the first working day.
2. It reads the USD row's `中行折算价` and stores both the raw BOC value and `USD_CNY汇率 = 原始中行折算价 / 100`.
3. It upserts `30_月度汇率`.
4. Finance may lock the month after review.
5. Sales imports and monthly rebuilds copy the locked or current monthly rate into sales rows.
6. If the source is temporarily unavailable, use the previous month rate and mark the row/source note for finance review.

## Implementation Order

1. **Rename and normalize cost fields**
   - Treat `01_SKU主数据.单品采购价_RMB` as the one-unit purchase price.
   - Rename or map `eBay费用` to canonical `订单手续费_USD`; do not separately add `广告费_USD`.
   - Add `其他费用_USD`, `USD_CNY汇率`, and `导入Key`.

2. **Add formula fields to `07_销售日报`**
   - `净销售额_USD`, `采购成本_RMB`, `采购成本_USD`, `头程费用_RMB`, `头程费用_USD`, `总费用_USD`, `总成本_USD`, `净利润_USD`, `净利润率`, `费用率`, `日期_天`, `日期_周`, `日期_月`.

3. **Extend `19_SKU运营汇总`**
   - Add sales/profit snapshots and status formulas.
   - Keep automation as the writer for calculated snapshot values.

4. **Create support and summary tables**
   - `30_月度汇率`
   - `26_经营日汇总`
   - `27_经营周期汇总`
   - `28_SKU周期汇总`
   - Optional `29_利润拆解`

5. **Build dashboards and views**
   - Start with KPI cards, sales trend, store comparison, fee/cost ring, best SKU view, slow-moving SKU view, and inventory warning view.
   - Keep Feishu Base dashboard as the main dashboard; approximate profit waterfall with `29_利润拆解` using ordered bar and table blocks.
   - Use the web app only for supplemental import diagnostics, automation controls, or optional custom visuals that read the same Base summary tables.

6. **Add scheduled rebuild and alert pushes**
   - Rebuild summaries after sales import.
   - Run daily reconciliation.
   - Push warnings to Lark groups.
