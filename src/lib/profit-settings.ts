import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_PROFIT_ASSUMPTIONS,
  type ProfitAssumptions,
} from "@/lib/profit-calculator";

const SETTINGS_FILE = join(process.cwd(), "data", "profit-settings.json");
const SETTINGS_KEY = "current";

const ASSUMPTION_KEYS: Array<keyof ProfitAssumptions> = [
  "exchangeRate",
  "firstMileCnyPerKg",
  "lastMileUsdPerKg",
  "tariffRate",
  "warehouseInboundUsd",
  "warehouseHandlingUsd",
  "ebayFeeRate",
  "advertisingRate",
  "returnRate",
];

interface ProfitSettingsBlobStore {
  get(key: string, options?: { type?: "json"; consistency?: "strong" | "eventual" }): Promise<unknown | null>;
  setJSON(key: string, value: unknown): Promise<unknown>;
}

export interface ProfitSettingsSnapshot {
  assumptions: ProfitAssumptions;
  updatedAt: string | null;
  updatedBy: string | null;
}

function defaultSnapshot(): ProfitSettingsSnapshot {
  return {
    assumptions: { ...DEFAULT_PROFIT_ASSUMPTIONS },
    updatedAt: null,
    updatedBy: null,
  };
}

export function validateProfitAssumptions(value: unknown): ProfitAssumptions {
  if (!value || typeof value !== "object") throw new Error("成本参数不完整");
  const record = value as Record<string, unknown>;
  const assumptions = {} as ProfitAssumptions;

  for (const key of ASSUMPTION_KEYS) {
    const fieldValue = record[key];
    if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
      throw new Error("成本参数不完整");
    }
    if (key === "exchangeRate" && fieldValue <= 0) throw new Error("汇率必须大于 0");
    if (fieldValue < 0) throw new Error("成本参数不能小于 0");
    assumptions[key] = fieldValue;
  }

  const variableRate = assumptions.ebayFeeRate + assumptions.advertisingRate + assumptions.returnRate;
  if (variableRate >= 1 - Number.EPSILON * 4) throw new Error("平台费率合计必须小于 100%");
  return assumptions;
}

function parseSnapshot(value: unknown): ProfitSettingsSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  try {
    return {
      assumptions: validateProfitAssumptions(record.assumptions),
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
      updatedBy: typeof record.updatedBy === "string" ? record.updatedBy : null,
    };
  } catch {
    return null;
  }
}

async function getNetlifyProfitSettingsStore(): Promise<ProfitSettingsBlobStore | null> {
  const netlifyBlobsContext = (globalThis as typeof globalThis & { netlifyBlobsContext?: string }).netlifyBlobsContext;
  if (process.env.NETLIFY !== "true" && !process.env.NETLIFY_BLOBS_CONTEXT && !netlifyBlobsContext) return null;

  const { getStore } = await import("@netlify/blobs");
  return getStore("profit-settings");
}

function readLocalSnapshot(): ProfitSettingsSnapshot {
  if (!existsSync(SETTINGS_FILE)) return defaultSnapshot();
  try {
    const parsed = parseSnapshot(JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")));
    return parsed || defaultSnapshot();
  } catch {
    return defaultSnapshot();
  }
}

export async function getProfitSettings(): Promise<ProfitSettingsSnapshot> {
  const store = await getNetlifyProfitSettingsStore();
  if (!store) return readLocalSnapshot();

  const stored = await store.get(SETTINGS_KEY, { type: "json", consistency: "strong" });
  return parseSnapshot(stored) || defaultSnapshot();
}

let settingsWriteQueue = Promise.resolve();

export async function saveProfitSettings(assumptionsValue: unknown, updatedBy: string): Promise<ProfitSettingsSnapshot> {
  const assumptions = validateProfitAssumptions(assumptionsValue);
  const actor = updatedBy.trim();
  if (!actor) throw new Error("缺少修改人");

  const snapshot: ProfitSettingsSnapshot = {
    assumptions,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };

  const run = settingsWriteQueue.then(async () => {
    const store = await getNetlifyProfitSettingsStore();
    if (store) {
      await store.setJSON(SETTINGS_KEY, snapshot);
      return snapshot;
    }

    const directory = join(process.cwd(), "data");
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    writeFileSync(SETTINGS_FILE, JSON.stringify(snapshot, null, 2), "utf-8");
    return snapshot;
  });
  settingsWriteQueue = run.then(() => undefined, () => undefined);
  return run;
}
