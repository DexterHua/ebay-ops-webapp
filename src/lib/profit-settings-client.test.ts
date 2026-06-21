import { describe, expect, it } from "vitest";
import { DEFAULT_PROFIT_ASSUMPTIONS } from "./profit-calculator";
import {
  getProfitSettingsMode,
  hasUnsavedProfitSettings,
  isValidProfitSettingsDraft,
} from "./profit-settings-client";

describe("利润参数客户端状态", () => {
  it("按加载状态和管理员身份决定控件模式", () => {
    expect(getProfitSettingsMode({ isAdmin: false, loading: true })).toBe("loading");
    expect(getProfitSettingsMode({ isAdmin: true, loading: true })).toBe("loading");
    expect(getProfitSettingsMode({ isAdmin: false, loading: false })).toBe("readonly");
    expect(getProfitSettingsMode({ isAdmin: true, loading: false })).toBe("editable");
  });

  it("只在参数字段发生变化时标记为未保存", () => {
    const saved = { ...DEFAULT_PROFIT_ASSUMPTIONS };

    expect(hasUnsavedProfitSettings(saved, { ...saved })).toBe(false);
    expect(hasUnsavedProfitSettings(saved, { ...saved, exchangeRate: 7 })).toBe(true);
  });

  it("阻止无效汇率和合计超过 100% 的平台费率保存", () => {
    expect(isValidProfitSettingsDraft(DEFAULT_PROFIT_ASSUMPTIONS)).toBe(true);
    expect(isValidProfitSettingsDraft({ ...DEFAULT_PROFIT_ASSUMPTIONS, exchangeRate: 0 })).toBe(false);
    expect(isValidProfitSettingsDraft({
      ...DEFAULT_PROFIT_ASSUMPTIONS,
      ebayFeeRate: 0.6,
      advertisingRate: 0.3,
      returnRate: 0.1,
    })).toBe(false);
  });
});
