import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({
  jwtVerify: vi.fn(),
}));

vi.mock("jose", () => ({
  jwtVerify: auth.jwtVerify,
}));

vi.mock("@/lib/auth-config", () => ({
  getJwtSecret: () => new Uint8Array([1, 2, 3]),
}));

import { middleware } from "./middleware";

function request(pathname: string, origin = "https://internal.test"): NextRequest {
  const url = new URL(origin);
  return new NextRequest(`${origin}${pathname}`, {
    headers: { cookie: "auth_token=signed-token", host: url.host },
  });
}

beforeEach(() => {
  auth.jwtVerify.mockReset();
});

describe("middleware 登录拦截", () => {
  test("本地 127.0.0.1 访问会规范到 localhost，避免登录 cookie 分裂", async () => {
    const response = await middleware(request("/login", "http://127.0.0.1:3001"));

    await expect(response.text()).resolves.toContain("http://localhost:3001/login");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(auth.jwtVerify).not.toHaveBeenCalled();
  });

  test("管理员页面不在 middleware 中用 token 里的旧角色拦截", async () => {
    auth.jwtVerify.mockResolvedValue({
      payload: { name: "贺严", role: "operator", isAdmin: false, sessionVersion: 4 },
    });

    const response = await middleware(request("/dashboard"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
