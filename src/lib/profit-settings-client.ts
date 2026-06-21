import type { ProfitAssumptions } from "@/lib/profit-calculator";

export type ProfitSettingsMode = "loading" | "readonly" | "editable";

export function getProfitSettingsMode(input: { isAdmin: boolean; loading: boolean }): ProfitSettingsMode {
  if (input.loading) return "loading";
  return input.isAdmin ? "editable" : "readonly";
}

export function hasUnsavedProfitSettings(saved: ProfitAssumptions, draft: ProfitAssumptions): boolean {
  return saved.exchangeRate !== draft.exchangeRate
    || saved.firstMileCnyPerKg !== draft.firstMileCnyPerKg
    || saved.lastMileUsdPerKg !== draft.lastMileUsdPerKg
    || saved.tariffRate !== draft.tariffRate
    || saved.warehouseInboundUsd !== draft.warehouseInboundUsd
    || saved.warehouseHandlingUsd !== draft.warehouseHandlingUsd
    || saved.ebayFeeRate !== draft.ebayFeeRate
    || saved.advertisingRate !== draft.advertisingRate
    || saved.returnRate !== draft.returnRate;
}

export function isValidProfitSettingsDraft(draft: ProfitAssumptions): boolean {
  const values = Object.values(draft);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return false;
  if (draft.exchangeRate <= 0) return false;
  const variableRate = draft.ebayFeeRate + draft.advertisingRate + draft.returnRate;
  return variableRate < 1 - Number.EPSILON * 4;
}
