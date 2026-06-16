import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Next 开发服务配置", () => {
  it("允许 127.0.0.1 访问开发资源，避免登录页退回原生表单提交", () => {
    expect(nextConfig.allowedDevOrigins).toContain("127.0.0.1");
  });
});
