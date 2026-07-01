# Operations Dashboard Handoff - 2026-06-30

## Feishu Base

Primary Base wiki URL:

`https://hcnx0b06nnwp.feishu.cn/wiki/ErTEwLjR0iuPnPkx30Zc0zzcnwE`

Resolved Base token:

`RveVbcouwa06KcsDXcIc45AInkg`

Existing source tables:

| Table | Table ID | Purpose |
| --- | --- | --- |
| `01_SKU主数据` | `tbl6w66MyySgO75J` | SKU purchase price and product master data |
| `07_销售日报` | `tbl65ySLOb7YOXN1` | Raw sales fact table |
| `19_SKU运营汇总` | `tblaVriWnH87co3h` | SKU inventory and rolling operations summary |

Created operations tables:

| Table | Table ID | Env key |
| --- | --- | --- |
| `30_月度汇率` | `tbllKxiZNEyPUiMx` | `LARK_TABLE_MONTHLY_EXCHANGE_RATE` |
| `26_经营日汇总` | `tblCiiuCUiK8sRGC` | `LARK_TABLE_OPERATING_DAY_SUMMARY` |
| `27_经营周期汇总` | `tblHg3FTEb9RcLzw` | `LARK_TABLE_OPERATING_PERIOD_SUMMARY` |
| `28_SKU周期汇总` | `tblaXecW6kEuY2sp` | `LARK_TABLE_SKU_PERIOD_SUMMARY` |
| `29_利润拆解` | `tbl8331L7D5W8KOB` | `LARK_TABLE_PROFIT_BREAKDOWN` |

## Metric Rules

- Purchase price is RMB.
- Sales, refunds, order fees, fulfillment fees, and other imported fees are USD.
- `USD_CNY汇率` means `1 USD = X RMB`.
- Monthly exchange rate should use Bank of China exchange quotation from the first business day of each month.
- First-mile freight is fixed at `20 RMB` per sold unit.
- Store advertising cost is included in 店小秘 exported `订单手续费_USD`, together with platform fees.
- Calculated fields should stay in Feishu Base wherever practical. The web app writes normalized stored fields and rebuilds summary tables.

## Web App Integration

Added table mapping keys:

| Internal key | Env key |
| --- | --- |
| `exchangeRate` | `LARK_TABLE_MONTHLY_EXCHANGE_RATE` |
| `operatingDaySummary` | `LARK_TABLE_OPERATING_DAY_SUMMARY` |
| `operatingPeriodSummary` | `LARK_TABLE_OPERATING_PERIOD_SUMMARY` |
| `skuPeriodSummary` | `LARK_TABLE_SKU_PERIOD_SUMMARY` |
| `profitBreakdown` | `LARK_TABLE_PROFIT_BREAKDOWN` |

Added rebuild endpoint:

`POST /api/operations-dashboard/rebuild`

Manual mode requires an admin session. Scheduled mode accepts:

`Authorization: Bearer ${OPERATIONS_DASHBOARD_REBUILD_SECRET}`

The rebuild reads sales rows and SKU summary snapshots, then upserts:

- `26_经营日汇总`
- `27_经营周期汇总`
- `28_SKU周期汇总`
- `29_利润拆解`
- selected rolling fields on `19_SKU运营汇总`

## Dashboard Blocks To Create

Created dashboard:

| Dashboard | Dashboard ID | URL |
| --- | --- | --- |
| `运营总看板_Base主看板` | `blkIc5Q1gXOhJJV5` | `https://hcnx0b06nnwp.feishu.cn/wiki/ErTEwLjR0iuPnPkx30Zc0zzcnwE?table=blkIc5Q1gXOhJJV5` |

`data_config.table_name` uses table names, not table IDs.

Created first dashboard blocks:

| Block | Type | Data source |
| --- | --- | --- |
| `看板说明` | `text` | Text only |
| `销售额` | `statistics` | `27_经营周期汇总`, sum `净销售额_USD` |
| `净利润` | `statistics` | `27_经营周期汇总`, sum `净利润_USD` |
| `订单数` | `statistics` | `27_经营周期汇总`, sum `订单数` |
| `销售与利润趋势` | `line` | `26_经营日汇总`, series `净销售额_USD`, `净利润_USD`, group by `日期_天` |
| `店铺利润对比` | `column` | `27_经营周期汇总`, series `净销售额_USD`, `净利润_USD`, group by `店铺` |
| `费用构成` | `ring` | `29_利润拆解`, sum `金额`, group by `类别`, filter `方向 = 扣减` |
| `SKU利润TOP` | `bar` | `28_SKU周期汇总`, sum `净利润_USD`, group by `SKU` |

After block creation, run dashboard arrange.

## Verification

Passing:

```bash
npm test -- src/app/'(main)'/api/operations-dashboard/rebuild/route.test.ts src/lib/operations-dashboard-lark-repository.test.ts src/lib/operations-dashboard-rebuild.test.ts src/lib/operations-dashboard.test.ts src/lib/release-safety.test.ts
npm test -- src/lib/sales-daily-import.test.ts src/app/'(main)'/api/sales/import/route.test.ts
```

Known unrelated failures:

```bash
npx tsc --noEmit
```

Currently fails only in `src/lib/cloudflare-sales-scan.test.ts` lines 54-60.

```bash
npm test -- src/lib/lark-server.test.ts
```

Currently has an unrelated media download assertion failure in `飞书素材下载 > 使用 tenant token 下载素材二进制内容`.
