import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const netlifyToml = readFileSync(resolve(process.cwd(), "netlify.toml"), "utf8");

function getTomlSection(name: string): string {
  const header = `[${name}]`;
  const start = netlifyToml.indexOf(header);
  if (start < 0) return "";

  const remainder = netlifyToml.slice(start + header.length);
  const nextHeader = remainder.search(/\n\s*\[/);
  return nextHeader < 0 ? remainder : remainder.slice(0, nextHeader);
}

describe("Netlify 飞书写入配置", () => {
  it("只在 Production context 自动开启飞书写入", () => {
    expect(getTomlSection("context.production.environment")).toMatch(
      /^\s*LARK_WRITE_ENABLED\s*=\s*"true"\s*$/m,
    );
  });

  it("全局 build environment 不开启飞书写入", () => {
    expect(getTomlSection("build.environment")).not.toMatch(/LARK_WRITE_ENABLED/);
  });
});
