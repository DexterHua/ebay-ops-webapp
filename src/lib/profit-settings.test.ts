import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROFIT_ASSUMPTIONS } from "./profit-calculator";

const localProfitSettings = vi.hoisted(() => ({
  exists: false,
  json: "",
}));

const netlifyProfitSettingsStore = vi.hoisted(() => ({
  get: vi.fn(),
  setJSON: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn((path: string) => path.endsWith("profit-settings.json") ? localProfitSettings.exists : true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => localProfitSettings.json),
  writeFileSync: vi.fn((_path: string, value: string) => {
    localProfitSettings.exists = true;
    localProfitSettings.json = value;
  }),
}));

vi.mock("@netlify/blobs", () => ({
  getStore: vi.fn(() => netlifyProfitSettingsStore),
}));

import {
  getProfitSettings,
  saveProfitSettings,
  validateProfitAssumptions,
} from "./profit-settings";

beforeEach(() => {
  localProfitSettings.exists = false;
  localProfitSettings.json = "";
  delete process.env.NETLIFY;
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  netlifyProfitSettingsStore.get.mockReset();
  netlifyProfitSettingsStore.get.mockResolvedValue(null);
  netlifyProfitSettingsStore.setJSON.mockReset();
  netlifyProfitSettingsStore.setJSON.mockResolvedValue({ modified: true });
});

describe("利润成本参数校验", () => {
  it("接受完整且有效的默认参数", () => {
    expect(validateProfitAssumptions(DEFAULT_PROFIT_ASSUMPTIONS)).toEqual(DEFAULT_PROFIT_ASSUMPTIONS);
  });

  it("拒绝缺失字段、无效汇率和过高的平台费率", () => {
    expect(() => validateProfitAssumptions({ exchangeRate: 6.76 })).toThrow("成本参数不完整");
    expect(() => validateProfitAssumptions({ ...DEFAULT_PROFIT_ASSUMPTIONS, exchangeRate: 0 })).toThrow("汇率必须大于 0");
    expect(() => validateProfitAssumptions({
      ...DEFAULT_PROFIT_ASSUMPTIONS,
      ebayFeeRate: 0.5,
      advertisingRate: 0.4,
      returnRate: 0.1,
    })).toThrow("平台费率合计必须小于 100%");
  });
});

describe("利润成本参数持久化", () => {
  it("首次使用时返回代码默认值", async () => {
    await expect(getProfitSettings()).resolves.toEqual({
      assumptions: DEFAULT_PROFIT_ASSUMPTIONS,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("本地保存后可重新读取，并记录修改人", async () => {
    const saved = await saveProfitSettings({
      ...DEFAULT_PROFIT_ASSUMPTIONS,
      exchangeRate: 7,
    }, "车泉");

    expect(saved).toMatchObject({
      assumptions: { ...DEFAULT_PROFIT_ASSUMPTIONS, exchangeRate: 7 },
      updatedBy: "车泉",
    });
    expect(saved.updatedAt).toEqual(expect.any(String));
    await expect(getProfitSettings()).resolves.toEqual(saved);
  });

  it("损坏的本地配置回退到代码默认值", async () => {
    localProfitSettings.exists = true;
    localProfitSettings.json = "{broken";

    await expect(getProfitSettings()).resolves.toEqual({
      assumptions: DEFAULT_PROFIT_ASSUMPTIONS,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("Netlify 环境使用站点级 Blob 强一致读取和保存", async () => {
    process.env.NETLIFY = "true";
    const stored = {
      assumptions: { ...DEFAULT_PROFIT_ASSUMPTIONS, exchangeRate: 6.9 },
      updatedAt: "2026-06-20T10:00:00.000Z",
      updatedBy: "车泉",
    };
    netlifyProfitSettingsStore.get.mockResolvedValue(stored);

    await expect(getProfitSettings()).resolves.toEqual(stored);
    expect(netlifyProfitSettingsStore.get).toHaveBeenCalledWith("current", {
      type: "json",
      consistency: "strong",
    });

    const next = await saveProfitSettings(DEFAULT_PROFIT_ASSUMPTIONS, "车泉");
    expect(netlifyProfitSettingsStore.setJSON).toHaveBeenCalledWith("current", next);
  });

  it("参数无效时不执行任何写入", async () => {
    await expect(saveProfitSettings({
      ...DEFAULT_PROFIT_ASSUMPTIONS,
      exchangeRate: -1,
    }, "车泉")).rejects.toThrow("汇率必须大于 0");

    expect(localProfitSettings.exists).toBe(false);
    expect(netlifyProfitSettingsStore.setJSON).not.toHaveBeenCalled();
  });
});
