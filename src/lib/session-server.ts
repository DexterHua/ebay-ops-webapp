import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { getJwtSecret } from "@/lib/auth-config";
import { getUserRole, getUsers, getUserSessionVersion, type UserRole } from "@/lib/users";

export interface SessionUser {
  name: string;
  isAdmin: boolean;
  role: UserRole;
  sessionVersion: number;
}

/** 读取并校验服务端会话，账号角色始终以持久化数据为准。 */
export async function requireSession(): Promise<SessionUser> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token) throw new Error("未登录");

	  const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ["HS256"] }).catch(() => {
	    throw new Error("登录状态已失效");
	  });
  const name = typeof payload.name === "string" ? payload.name : "";
  if (!name.trim()) throw new Error("登录状态无效");

	  const user = (await getUsers()).find(candidate => candidate.name === name && !candidate.deletedAt);
  if (!user) throw new Error("登录状态已失效");

  const sessionVersion = getUserSessionVersion(user);
  const tokenSessionVersion = payload.sessionVersion === undefined ? 0 : payload.sessionVersion;
  if (tokenSessionVersion !== sessionVersion) throw new Error("登录状态已失效");

  const role = getUserRole(user);
  return { name: user.name, role, isAdmin: role === "admin", sessionVersion };
}

/** 要求当前账号具备指定角色。 */
export async function requireRole(roles: readonly UserRole[]): Promise<SessionUser> {
  const session = await requireSession();
  if (!roles.includes(session.role)) throw new Error("权限不足");
  return session;
}

/** 要求当前账号为管理员。 */
export async function requireAdmin(): Promise<SessionUser> {
  return requireRole(["admin"]);
}
