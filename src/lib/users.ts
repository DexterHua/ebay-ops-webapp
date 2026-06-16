// ============================================================
// 用户管理 — Netlify Blobs / Cloudflare KV 优先，本地 JSON 文件回退
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import crypto from "crypto";

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
  sessionVersion?: number;
  deletedAt?: string;
}

export type UserRole = "admin" | "purchaser" | "operator";

/** 判断是否为受支持的账号角色。 */
export function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "purchaser" || value === "operator";
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

function hashPassword(pw: string): string {
  return crypto.createHash("sha256").update(pw + "solid-salt").digest("hex");
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
    sessionVersion: getUserSessionVersion(user),
  }));
}

/** 新增用户 */
export async function addUser(name: string, password: string, role: unknown = "operator"): Promise<{ ok: boolean; error?: string }> {
  if (!isUserRole(role)) {
    return { ok: false, error: "角色无效" };
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
      existing.sessionVersion = nextVersion;
      delete existing.deletedAt;
      return { ok: true };
    }
    users.push({ name, password: hashPassword(password), createdAt, role, sessionVersion: 0 });
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
