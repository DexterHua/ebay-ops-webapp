import crypto from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

const localUsers = vi.hoisted(() => ({
  json: "[]",
}));

const authToken = vi.hoisted(() => ({
  payload: {} as Record<string, unknown>,
  value: "signed-token",
  jwtVerify: vi.fn(),
}));

const netlifyUsersStore = vi.hoisted(() => ({
  get: vi.fn(),
  setJSON: vi.fn(),
}));

const cloudflareUsersKv = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => localUsers.json),
  writeFileSync: vi.fn((_path: string, value: string) => {
    localUsers.json = value;
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => authToken.value ? { value: authToken.value } : undefined),
  })),
}));

vi.mock("jose", () => ({
  jwtVerify: authToken.jwtVerify,
}));

vi.mock("@netlify/blobs", () => ({
  getStore: vi.fn(() => netlifyUsersStore),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: cloudflareUsersKv.getCloudflareContext,
}));

import {
  addUser,
  changePassword,
  getUsers,
  getUserRole,
  getUserSessionVersion,
  isUserRole,
  listUsers,
  removeUser,
  resetPassword,
  verifyUser,
  type User,
} from "./users";

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "solid-salt").digest("hex");
}

function setUsers(users: User[]): void {
  localUsers.json = JSON.stringify(users);
}

beforeEach(() => {
  localUsers.json = "[]";
  authToken.payload = {};
  authToken.value = "signed-token";
  authToken.jwtVerify.mockReset();
  authToken.jwtVerify.mockImplementation(async () => ({ payload: authToken.payload }));
  delete process.env.AUTH_USERS;
  delete process.env.NETLIFY;
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  process.env.JWT_SECRET = "test-secret-with-at-least-32-characters";
  netlifyUsersStore.get.mockReset();
  netlifyUsersStore.get.mockResolvedValue(null);
  netlifyUsersStore.setJSON.mockReset();
  netlifyUsersStore.setJSON.mockResolvedValue({ modified: true });
  cloudflareUsersKv.getCloudflareContext.mockReset();
  cloudflareUsersKv.getCloudflareContext.mockResolvedValue({ env: {} });
});

describe("用户角色 helper", () => {
  test("仅接受受支持的角色", () => {
    expect(isUserRole("admin")).toBe(true);
    expect(isUserRole("purchaser")).toBe(true);
    expect(isUserRole("operator")).toBe(true);
    expect(isUserRole("viewer")).toBe(false);
    expect(isUserRole(undefined)).toBe(false);
  });

  test("固定管理员始终回退为 admin", () => {
    expect(getUserRole({ name: "车泉" })).toBe("admin");
    expect(getUserRole({ name: "车泉", role: "operator" })).toBe("admin");
  });

  test("普通用户保留合法角色，缺省或非法角色回退为 operator", () => {
    expect(getUserRole({ name: "采购员", role: "purchaser" })).toBe("purchaser");
    expect(getUserRole({ name: "旧账号" })).toBe("operator");
    expect(getUserRole({ name: "异常账号", role: "viewer" as never })).toBe("operator");
  });

  test("会话版本缺省为 0", () => {
    expect(getUserSessionVersion({})).toBe(0);
    expect(getUserSessionVersion({ sessionVersion: 3 })).toBe(3);
    expect(() => getUserSessionVersion({ sessionVersion: "bad" as never })).toThrow("账号会话版本损坏");
  });
});

describe("用户持久化", () => {
  test("列表返回规范化角色和会话版本，但不返回密码", async () => {
    setUsers([
      { name: "车泉", password: "secret", createdAt: "2026-06-03" },
      { name: "旧账号", password: "secret", createdAt: "2026-06-03" },
    ]);

    expect(await listUsers()).toEqual([
      { name: "车泉", createdAt: "2026-06-03", role: "admin", sessionVersion: 0 },
      { name: "旧账号", createdAt: "2026-06-03", role: "operator", sessionVersion: 0 },
    ]);
  });

  test("新增用户默认是 operator 且会话版本为 0", async () => {
    expect(await addUser("新运营", "123456")).toEqual({ ok: true });

    expect(await listUsers()).toEqual([
      expect.objectContaining({ name: "新运营", role: "operator", sessionVersion: 0 }),
    ]);
  });

  test("新增用户接受管理员、采购员或运营角色", async () => {
    expect(await addUser("新管理员", "123456", "admin")).toEqual({ ok: true });
    expect(await addUser("新采购", "123456", "purchaser")).toEqual({ ok: true });
    expect(await addUser("异常角色", "123456", "viewer" as never)).toEqual({ ok: false, error: "角色无效" });

    expect(await listUsers()).toEqual([
      expect.objectContaining({ name: "新管理员", role: "admin" }),
      expect.objectContaining({ name: "新采购", role: "purchaser" }),
    ]);
  });

  test("重置密码后递增旧数据的会话版本", async () => {
    setUsers([{ name: "旧账号", password: hashPassword("old-password"), createdAt: "2026-06-03" }]);

    expect(await resetPassword("旧账号", "new-password")).toEqual({ ok: true });
    expect(await listUsers()).toEqual([
      expect.objectContaining({ name: "旧账号", sessionVersion: 1 }),
    ]);
  });

  test("自行修改密码成功后递增会话版本", async () => {
    setUsers([
      {
        name: "采购员",
        password: hashPassword("old-password"),
        createdAt: "2026-06-03",
        sessionVersion: 4,
      },
    ]);

    expect(await changePassword("采购员", "old-password", "new-password")).toEqual({ ok: true });
    expect(await listUsers()).toEqual([
      expect.objectContaining({ name: "采购员", sessionVersion: 5 }),
    ]);
  });

  test("删除用户后保留版本墓碑并禁止继续登录", async () => {
    setUsers([
      {
        name: "运营",
        password: hashPassword("old-password"),
        createdAt: "2026-06-03",
        sessionVersion: 0,
      },
    ]);

    expect(await removeUser("运营")).toEqual({ ok: true });

    expect(await listUsers()).toEqual([]);
    expect(await verifyUser("运营", "old-password")).toBeNull();
    expect(JSON.parse(localUsers.json)).toEqual([
      expect.objectContaining({ name: "运营", deletedAt: expect.any(String), sessionVersion: 1 }),
    ]);
  });

  test("删除后重建同名账号会递增版本，避免旧 JWT 复活", async () => {
    setUsers([
      {
        name: "运营",
        password: hashPassword("old-password"),
        createdAt: "2026-06-03",
        sessionVersion: 0,
      },
    ]);

    expect(await removeUser("运营")).toEqual({ ok: true });
    expect(await addUser("运营", "new-password", "operator")).toEqual({ ok: true });

    expect(await listUsers()).toEqual([
      expect.objectContaining({ name: "运营", sessionVersion: 2 }),
    ]);
  });

  test("Netlify 用户存储读取异常会抛出而不是回退 seed", async () => {
    process.env.NETLIFY = "true";
    process.env.AUTH_USERS = "车泉:123456";
    netlifyUsersStore.get.mockRejectedValue(new Error("blob unavailable"));

    await expect(getUsers()).rejects.toThrow("blob unavailable");
    await expect(addUser("运营", "123456")).rejects.toThrow("blob unavailable");
    expect(localUsers.json).toBe("[]");
  });

  test("生产 Cloudflare 上下文异常会抛出而不是回退本地 JSON", async () => {
    try {
      vi.stubEnv("NODE_ENV", "production");
      process.env.AUTH_USERS = "车泉:123456";
      cloudflareUsersKv.getCloudflareContext.mockRejectedValue(new Error("cloudflare unavailable"));

      await expect(getUsers()).rejects.toThrow("cloudflare unavailable");
      expect(localUsers.json).toBe("[]");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("服务端会话", () => {
  test("以持久化账号角色为准并限制 JWT 算法", async () => {
    setUsers([
      {
        name: "采购员",
        password: "secret",
        createdAt: "2026-06-03",
        role: "purchaser",
        sessionVersion: 2,
      },
    ]);
    authToken.payload = { name: "采购员", role: "admin", isAdmin: true, sessionVersion: 2 };

    const { requireSession } = await import("./session-server");

    await expect(requireSession()).resolves.toEqual({
      name: "采购员",
      role: "purchaser",
      isAdmin: false,
      sessionVersion: 2,
    });
    expect(authToken.jwtVerify).toHaveBeenCalledWith(
      "signed-token",
      expect.any(Uint8Array),
      { algorithms: ["HS256"] }
    );
  });

  test("旧 token 与旧用户数据均按会话版本 0 兼容", async () => {
    setUsers([{ name: "旧账号", password: "secret", createdAt: "2026-06-03" }]);
    authToken.payload = { name: "旧账号" };

    const { requireSession } = await import("./session-server");

    await expect(requireSession()).resolves.toEqual({
      name: "旧账号",
      role: "operator",
      isAdmin: false,
      sessionVersion: 0,
    });
  });

  test("拒绝会话版本已过期的 token", async () => {
    setUsers([
      { name: "运营", password: "secret", createdAt: "2026-06-03", sessionVersion: 3 },
    ]);
    authToken.payload = { name: "运营", sessionVersion: 2 };

    const { requireSession } = await import("./session-server");

    await expect(requireSession()).rejects.toThrow("登录状态已失效");
  });

  test("JWT 校验失败统一视为登录状态失效", async () => {
    authToken.jwtVerify.mockRejectedValue(new Error("signature failed"));

    const { requireSession } = await import("./session-server");

    await expect(requireSession()).rejects.toThrow("登录状态已失效");
  });

  test("拒绝持久化会话版本损坏的账号", async () => {
    setUsers([
      { name: "运营", password: "secret", createdAt: "2026-06-03", sessionVersion: "bad" as never },
    ]);
    authToken.payload = { name: "运营", sessionVersion: 0 };

    const { requireSession } = await import("./session-server");

    await expect(requireSession()).rejects.toThrow("账号会话版本损坏");
  });

  test("删除后重建同名账号不会让旧 token 重新生效", async () => {
    setUsers([
      {
        name: "运营",
        password: hashPassword("old-password"),
        createdAt: "2026-06-03",
        sessionVersion: 0,
      },
    ]);
    expect(await removeUser("运营")).toEqual({ ok: true });
    expect(await addUser("运营", "new-password", "operator")).toEqual({ ok: true });
    authToken.payload = { name: "运营", sessionVersion: 0 };

    const { requireSession } = await import("./session-server");

    await expect(requireSession()).rejects.toThrow("登录状态已失效");
  });

  test("拒绝账号已删除的 token", async () => {
    setUsers([]);
    authToken.payload = { name: "已删除账号", sessionVersion: 0 };

    const { requireSession } = await import("./session-server");

    await expect(requireSession()).rejects.toThrow("登录状态已失效");
  });

  test("拒绝姓名为空字符串的 token", async () => {
    authToken.payload = { name: "", sessionVersion: 0 };

    const { requireSession } = await import("./session-server");

    await expect(requireSession()).rejects.toThrow("登录状态无效");
  });

  test("固定管理员可通过管理员校验", async () => {
    setUsers([{ name: "车泉", password: "secret", createdAt: "2026-06-03" }]);
    authToken.payload = { name: "车泉" };

    const { requireAdmin } = await import("./session-server");

    await expect(requireAdmin()).resolves.toEqual({
      name: "车泉",
      role: "admin",
      isAdmin: true,
      sessionVersion: 0,
    });
  });

  test("改密接口必须拒绝会话版本过期的 token", async () => {
    setUsers([
      {
        name: "运营",
        password: hashPassword("old-password"),
        createdAt: "2026-06-03",
        sessionVersion: 2,
      },
    ]);
    authToken.payload = { name: "运营", sessionVersion: 1 };

    const { POST } = await import("../app/(main)/api/auth/change-password/route");
    const response = await POST({
      json: async () => ({ currentPassword: "old-password", newPassword: "new-password" }),
    } as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "登录状态已失效，请重新登录",
    });
  });
});
