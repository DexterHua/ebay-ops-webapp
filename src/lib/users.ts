// ============================================================
// 用户管理 — Netlify Blobs / Cloudflare KV 优先，本地 JSON 文件回退
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { STORES, type StoreId } from "@/types";

const USER_FILE = join(process.cwd(), "data", "users.json");
const USER_KV_KEY = "users";

interface UsersKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

interface UsersBlobStore {
  get(key: string, options?: { type?: "json"; consistency?: "strong" | "eventual" }): Promise<unknown | null>;
  setJSON(key: string, value: unknown): Promise<unknown>;
}

export interface User {
  name: string;
  password: string; // sha256 哈希
  createdAt: string;
  role?: UserRole;
  storeIds?: StoreId[];
  sessionVersion?: number;
  deletedAt?: string;
}

export type UserRole = "admin" | "purchaser" | "operator";

const ACTIVE_STORE_IDS = STORES.filter((store) => store.active).map((store) => store.id);

/** 判断是否为受支持的账号角色。 */
export function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "purchaser" || value === "operator";
}

/** 判断是否为当前支持的活跃店铺 ID。 */
export function isStoreId(value: unknown): value is StoreId {
  return typeof value === "string" && ACTIVE_STORE_IDS.includes(value as StoreId);
}

/** 获取账号角色，兼容历史数据与固定管理员账号。 */
export function getUserRole(user: Pick<User, "name" | "role">): UserRole {
  if (user.name === "车泉") return "admin";
  return isUserRole(user.role) ? user.role : "operator";
}

/** 获取账号会话版本，历史缺省兼容为 0，但已存在的损坏值必须阻断登录。 */
export function getUserSessionVersion(user: Pick<User, "sessionVersion">): number {
  if (user.sessionVersion === undefined) return 0;
  if (typeof user.sessionVersion === "number" && Number.isInteger(user.sessionVersion) && user.sessionVersion >= 0) {
    return user.sessionVersion;
  }
  throw new Error("账号会话版本损坏");
}

/** 获取账号可访问店铺，历史缺省账号兼容为全部活跃店铺。 */
export function getUserStoreIds(user: Pick<User, "storeIds">): StoreId[] {
  if (user.storeIds === undefined) return [...ACTIVE_STORE_IDS];
  if (!Array.isArray(user.storeIds)) return [];
  const allowed = new Set(user.storeIds.filter(isStoreId));
  return ACTIVE_STORE_IDS.filter((storeId) => allowed.has(storeId));
}

function normalizeStoreIdsInput(value: unknown): StoreId[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isStoreId)) return null;
  const allowed = new Set(value);
  return ACTIVE_STORE_IDS.filter((storeId) => allowed.has(storeId));
}

function hashPassword(pw: string): string {
  return crypto.createHash("sha256").update(pw + "solid-salt").digest("hex");
}

const PASSWORD_HASH_PATTERN = /^[a-f0-9]{64}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseHashedUserSeed(raw: string): User[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AUTH_USERS_JSON 用户种子无效");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("AUTH_USERS_JSON 用户种子无效");
  }

  const names = new Set<string>();
  return parsed.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("AUTH_USERS_JSON 用户种子无效");
    }
    const user = value as Partial<User>;
    const normalizedName = typeof user.name === "string" ? user.name.trim() : "";
    const validSessionVersion = user.sessionVersion === undefined || (
      typeof user.sessionVersion === "number" &&
      Number.isInteger(user.sessionVersion) &&
      user.sessionVersion >= 0
    );
    if (
      !normalizedName ||
      names.has(normalizedName) ||
      typeof user.password !== "string" ||
      !PASSWORD_HASH_PATTERN.test(user.password) ||
      typeof user.createdAt !== "string" ||
      !DATE_PATTERN.test(user.createdAt) ||
      (user.role !== undefined && !isUserRole(user.role)) ||
      (user.storeIds !== undefined && (!Array.isArray(user.storeIds) || !user.storeIds.every(isStoreId))) ||
      !validSessionVersion ||
      (user.deletedAt !== undefined && typeof user.deletedAt !== "string")
    ) {
      throw new Error("AUTH_USERS_JSON 用户种子无效");
    }
    names.add(normalizedName);
    return { ...user, name: normalizedName } as User;
  });
}

/** Netlify 环境始终使用站点级 Blobs，避免用户数据随部署切换而丢失。 */
async function getNetlifyUsersStore(): Promise<UsersBlobStore | null> {
  const netlifyBlobsContext = (globalThis as typeof globalThis & { netlifyBlobsContext?: string }).netlifyBlobsContext;
  if (process.env.NETLIFY !== "true" && !process.env.NETLIFY_BLOBS_CONTEXT && !netlifyBlobsContext) return null;

  const { getStore } = await import("@netlify/blobs");
  return getStore("users");
}

/** Workers 中使用 KV，本地开发环境继续使用 JSON。 */
async function getUsersKv(): Promise<UsersKv | null> {
  if (process.env.NODE_ENV !== "production") return null;

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const kv = (env as CloudflareEnv & { USERS_KV?: UsersKv }).USERS_KV;
    if (!kv) throw new Error("USERS_KV 未配置");
    return kv;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Cloudflare 用户存储不可用");
  }
}

/** 读取本地用户，仅用于本地开发回退。 */
function getLocalUsers(): User[] {
  if (!existsSync(USER_FILE)) return [];
  try {
    return JSON.parse(readFileSync(USER_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function isActiveUser(user: Pick<User, "deletedAt">): boolean {
  return !user.deletedAt;
}

let userWriteQueue = Promise.resolve();

async function mutateUsers<T>(mutator: (users: User[]) => Promise<T> | T): Promise<T> {
  const run = userWriteQueue.then(async () => {
    const users = await seedUsers();
    const result = await mutator(users);
    await saveUsers(users);
    return result;
  });
  userWriteQueue = run.then(() => undefined, () => undefined);
  return run;
}

/** 读取全部用户。 */
export async function getUsers(): Promise<User[]> {
  const store = await getNetlifyUsersStore();
  if (store) return (await store.get(USER_KV_KEY, { type: "json", consistency: "strong" }) as User[] | null) || [];

  const kv = await getUsersKv();
  if (!kv) return getLocalUsers();
  return JSON.parse(await kv.get(USER_KV_KEY) || "[]");
}

/** 保存用户列表。 */
async function saveUsers(users: User[]): Promise<void> {
  const store = await getNetlifyUsersStore();
  if (store) {
    await store.setJSON(USER_KV_KEY, users);
    return;
  }

  const kv = await getUsersKv();
  if (kv) {
    await kv.put(USER_KV_KEY, JSON.stringify(users));
    return;
  }
  const dir = join(process.cwd(), "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(USER_FILE, JSON.stringify(users, null, 2), "utf-8");
}

/** 初始化：从环境变量 seed 到当前存储。 */
export async function seedUsers(): Promise<User[]> {
  const existing = await getUsers();
  if (existing.length > 0) return existing;

  const hashedSeed = process.env.AUTH_USERS_JSON?.trim();
  if (hashedSeed) {
    const seeded = parseHashedUserSeed(hashedSeed);
    await saveUsers(seeded);
    return seeded;
  }

  const raw = process.env.AUTH_USERS || "";
  const seeded = raw.split(",").map(s => s.trim()).filter(Boolean).map(s => {
    const [name, pw] = s.split(":");
    return {
      name,
      password: hashPassword(pw || "123456"),
      createdAt: new Date().toISOString().slice(0, 10),
      role: name === "车泉" ? "admin" as const : "operator" as const,
      sessionVersion: 0,
    };
  });

  if (seeded.length > 0) {
    await saveUsers(seeded);
  }
  return seeded;
}

/** 验证登录 */
export async function verifyUser(name: string, password: string): Promise<User | null> {
  const users = await seedUsers();
  const u = users.find(u => u.name === name && isActiveUser(u));
  if (!u) return null;
  if (u.password !== hashPassword(password)) return null;
  return u;
}

/** 列出所有用户（不含密码） */
export async function listUsers(): Promise<Omit<User, "password">[]> {
  return (await seedUsers()).filter(isActiveUser).map(user => ({
    name: user.name,
    createdAt: user.createdAt,
    role: getUserRole(user),
    storeIds: getUserStoreIds(user),
    sessionVersion: getUserSessionVersion(user),
  }));
}

/** 新增用户 */
export async function addUser(
  name: string,
  password: string,
  role: unknown = "operator",
  storeIds?: unknown
): Promise<{ ok: boolean; error?: string }> {
  if (!isUserRole(role)) {
    return { ok: false, error: "角色无效" };
  }
  const normalizedStoreIds = normalizeStoreIdsInput(storeIds);
  if (normalizedStoreIds === null) {
    return { ok: false, error: "店铺分配无效" };
  }
  return mutateUsers(users => {
    const existing = users.find(u => u.name === name);
    if (existing && isActiveUser(existing)) {
      return { ok: false, error: "用户已存在" };
    }
    const createdAt = new Date().toISOString().slice(0, 10);
    if (existing) {
      const nextVersion = getUserSessionVersion(existing) + 1;
      existing.password = hashPassword(password);
      existing.createdAt = createdAt;
      existing.role = role;
      if (normalizedStoreIds === undefined) {
        delete existing.storeIds;
      } else {
        existing.storeIds = normalizedStoreIds;
      }
      existing.sessionVersion = nextVersion;
      delete existing.deletedAt;
      return { ok: true };
    }
    users.push({
      name,
      password: hashPassword(password),
      createdAt,
      role,
      ...(normalizedStoreIds === undefined ? {} : { storeIds: normalizedStoreIds }),
      sessionVersion: 0,
    });
    return { ok: true };
  });
}

/** 编辑用户角色和店铺权限。 */
export async function updateUserPermissions(
  name: string,
  role: unknown,
  storeIds: unknown
): Promise<{ ok: boolean; error?: string }> {
  if (name === "车泉") return { ok: false, error: "不允许修改管理员账号权限" };
  if (!isUserRole(role)) {
    return { ok: false, error: "角色无效" };
  }
  const normalizedStoreIds = normalizeStoreIdsInput(storeIds);
  if (normalizedStoreIds === null) {
    return { ok: false, error: "店铺分配无效" };
  }
  return mutateUsers(users => {
    const user = users.find(u => u.name === name && isActiveUser(u));
    if (!user) return { ok: false, error: "用户不存在" };
    user.role = role;
    if (normalizedStoreIds === undefined) {
      delete user.storeIds;
    } else {
      user.storeIds = normalizedStoreIds;
    }
    user.sessionVersion = getUserSessionVersion(user) + 1;
    return { ok: true };
  });
}

/** 删除用户（禁止删除管理员 车泉） */
export async function removeUser(name: string): Promise<{ ok: boolean; error?: string }> {
  if (name === "车泉") return { ok: false, error: "不允许删除管理员账号" };
  return mutateUsers(users => {
    const user = users.find(u => u.name === name && isActiveUser(u));
    if (!user) return { ok: false, error: "用户不存在" };
    user.sessionVersion = getUserSessionVersion(user) + 1;
    user.deletedAt = new Date().toISOString();
    return { ok: true };
  });
}

/** 重置密码 */
export async function resetPassword(name: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  return mutateUsers(users => {
    const u = users.find(u => u.name === name && isActiveUser(u));
    if (!u) return { ok: false, error: "用户不存在" };
    u.password = hashPassword(newPassword);
    u.sessionVersion = getUserSessionVersion(u) + 1;
    return { ok: true };
  });
}

/** 用户自行修改登录密码，必须校验原密码。 */
export async function changePassword(
  name: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  return mutateUsers(users => {
    const u = users.find(user => user.name === name && isActiveUser(user));
    if (!u || u.password !== hashPassword(currentPassword)) {
      return { ok: false, error: "原密码不正确" };
    }
    if (currentPassword === newPassword) {
      return { ok: false, error: "新密码不能与原密码相同" };
    }
    u.password = hashPassword(newPassword);
    u.sessionVersion = getUserSessionVersion(u) + 1;
    return { ok: true };
  });
}

/** 判断是否管理员 */
export function isAdmin(name: string): boolean {
  return name === "车泉";
}
