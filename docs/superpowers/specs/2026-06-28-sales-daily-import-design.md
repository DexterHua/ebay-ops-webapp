# Sales Daily Import Mode Design

## Goal

Replace the manual Sales Daily entry form with an import-first workflow for 店小秘 daily sales exports. The import should create normalized `07_销售日报` records, then reuse the existing sales inventory scan so sales reduce sellable inventory and refresh store/SKU sales metrics.

## Source File Shape

The current 店小秘 export is an `.xlsx` workbook with one sheet. Row 1 is the header, row 2 is a total row beginning with `合计($)`, and rows after that are order/SKU lines.

Required source columns:

- `发货日期`
- `订单号`
- `商品SKU`
- `销量`
- `店铺`
- `订单总价`

Optional mapped source columns:

- `订单手续费`
- `营销费用`
- `物流费用`
- `采购成本`
- `退款费用`
- `利润`
- `平台SKU`
- `平台`
- `交易号`
- `运单号`
- `发货仓库`

## Field Mapping

Import rows map to `07_销售日报` like this:

- `日期`: `发货日期`, normalized to the same timestamp format used by `save-record`
- `SKU`: `商品SKU`, trimmed and uppercased
- `商品名称`: looked up from loaded SKU master options when possible, otherwise blank
- `店铺`: normalized to the app store names, including `Newpower -> NewPower` and `SolidParts -> Solidparts`
- `售出数量`: `销量`
- `销售额`: `订单总价`
- `eBay费用`: `订单手续费`
- `广告费`: `营销费用`
- `橙联履约费`: `物流费用`
- `商品成本`: `采购成本`
- `退款金额`: `退款费用`
- `备注`: import provenance including 店小秘订单号、交易号、运单号、平台、仓库

## Import Flow

1. User selects a 店小秘 `.xlsx` export in `数据录入 -> 销售日报`.
2. The UI uploads the file to a new server route for preview.
3. The server parses and validates rows without writing anything when `commit=false`.
4. The UI shows counts, date range, stores, rows ready to import, duplicates, and validation errors.
5. User clicks Import.
6. The server parses again, skips duplicates, writes valid rows to `07_销售日报`, then triggers the existing sales inventory scan.
7. The response reports created sales rows, skipped duplicates, validation failures, and inventory scan results.

## Deduplication

Duplicate detection should be based on a stable import key derived from source facts:

`店小秘:${订单号}:${商品SKU}:${发货日期}`

For now this key is stored inside `备注`, so the route can detect already-imported records by scanning existing `07_销售日报` remarks before writing. This avoids adding a new Base field before the user tests the path.

## Inventory And Sales Effects

The import route does not directly edit inventory quantities. It writes sales facts first, then calls the existing `runSalesInventoryScan` workflow. That workflow already:

- deducts from `橙联可售` inventory details,
- writes `16_库存流水`,
- updates `19_SKU运营汇总` inventory and sales metrics,
- creates shortage exceptions and warnings if sellable stock is insufficient.

This keeps manual and imported sales using the same inventory accounting path.

## Error Handling

- Reject files that are not `.xlsx`.
- Reject sheets missing required headers.
- Skip the total row and empty rows.
- Validate SKU, quantity, date, store, and numeric fields per row.
- Do not write anything in preview mode.
- In commit mode, write valid non-duplicate rows only. If some rows are invalid, return them in the report instead of blocking the whole file.

## Testing

Add tests for:

- minimal `.xlsx` parsing from OOXML sheet data,
- 店小秘 row normalization and required-column validation,
- preview route behavior with no writes,
- commit route writing sales rows and invoking inventory scan,
- duplicate detection through existing sales remarks.
