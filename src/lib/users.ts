// ============================================================
// 用户管理 — JSON 文件持久化
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import crypto from "crypto";

const USER_FILE = join(process.cwd(), "data", "users.json");

export interface User {
  name: string;
  password: string; // sha256 哈希
  createdAt: string;
}

function hashPassword(pw: string): string {
  return crypto.createHash("sha256").update(pw + "solid-salt").digest("hex");
}

/** 读取全部用户 */
export function getUsers(): User[] {
  if (!existsSync(USER_FILE)) return [];
  try {
    return JSON.parse(readFileSync(USER_FILE, "utf-8"));
  } catch {
    return [];
  }
}

/** 保存用户列表 */
function saveUsers(users: User[]): void {
  const dir = join(process.cwd(), "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(USER_FILE, JSON.stringify(users, null, 2), "utf-8");
}

/** 初始化：从环境变量 seed 到 JSON */
export function seedUsers(): User[] {
  const existing = getUsers();
  if (existing.length > 0) return existing;

  const raw = process.env.AUTH_USERS || "";
  const seeded = raw.split(",").map(s => s.trim()).filter(Boolean).map(s => {
    const [name, pw] = s.split(":");
    return { name, password: hashPassword(pw || "123456"), createdAt: new Date().toISOString().slice(0, 10) };
  });

  if (seeded.length > 0) {
    saveUsers(seeded);
  }
  return seeded;
}

/** 验证登录 */
export function verifyUser(name: string, password: string): User | null {
  const users = seedUsers();
  const u = users.find(u => u.name === name);
  if (!u) return null;
  if (u.password !== hashPassword(password)) return null;
  return u;
}

/** 列出所有用户（不含密码） */
export function listUsers(): Omit<User, "password">[] {
  return seedUsers().map(({ name, createdAt }) => ({ name, createdAt }));
}

/** 新增用户 */
export function addUser(name: string, password: string): { ok: boolean; error?: string } {
  const users = seedUsers();
  if (users.find(u => u.name === name)) {
    return { ok: false, error: "用户已存在" };
  }
  users.push({ name, password: hashPassword(password), createdAt: new Date().toISOString().slice(0, 10) });
  saveUsers(users);
  return { ok: true };
}

/** 删除用户（禁止删除管理员 车泉） */
export function removeUser(name: string): { ok: boolean; error?: string } {
  if (name === "车泉") return { ok: false, error: "不允许删除管理员账号" };
  const users = seedUsers();
  const idx = users.findIndex(u => u.name === name);
  if (idx === -1) return { ok: false, error: "用户不存在" };
  users.splice(idx, 1);
  saveUsers(users);
  return { ok: true };
}

/** 重置密码 */
export function resetPassword(name: string, newPassword: string): { ok: boolean; error?: string } {
  const users = seedUsers();
  const u = users.find(u => u.name === name);
  if (!u) return { ok: false, error: "用户不存在" };
  u.password = hashPassword(newPassword);
  saveUsers(users);
  return { ok: true };
}

/** 判断是否管理员 */
export function isAdmin(name: string): boolean {
  return name === "车泉";
}
