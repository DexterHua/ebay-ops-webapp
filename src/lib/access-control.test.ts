import { describe, expect, test } from "vitest";
import { MODULES } from "@/types";
import { canAccessPath, getVisibleModulesForRole } from "./access-control";

describe("访问权限规则", () => {
  test("管理员可以看到所有菜单", () => {
    expect(getVisibleModulesForRole("admin", MODULES).map((module) => module.path)).toEqual(
      MODULES.map((module) => module.path)
    );
  });

  test("运营和采购看不到运营仪表盘与账号管理菜单", () => {
    expect(getVisibleModulesForRole("operator", MODULES).map((module) => module.path)).not.toContain("/dashboard");
    expect(getVisibleModulesForRole("operator", MODULES).map((module) => module.path)).not.toContain("/accounts");
    expect(getVisibleModulesForRole("purchaser", MODULES).map((module) => module.path)).not.toContain("/dashboard");
    expect(getVisibleModulesForRole("purchaser", MODULES).map((module) => module.path)).not.toContain("/accounts");
  });

  test("运营和采购不能直接访问运营仪表盘与账号管理路由", () => {
    expect(canAccessPath("operator", "/dashboard")).toBe(false);
    expect(canAccessPath("operator", "/dashboard/sales")).toBe(false);
    expect(canAccessPath("operator", "/accounts")).toBe(false);
    expect(canAccessPath("purchaser", "/dashboard")).toBe(false);
    expect(canAccessPath("purchaser", "/accounts")).toBe(false);
  });

  test("运营和采购仍可访问普通业务路由", () => {
    expect(canAccessPath("operator", "/inventory")).toBe(true);
    expect(canAccessPath("operator", "/inventory-flow")).toBe(true);
    expect(canAccessPath("operator", "/sku-details")).toBe(true);
    expect(canAccessPath("purchaser", "/inventory")).toBe(true);
    expect(canAccessPath("purchaser", "/inventory-flow")).toBe(true);
    expect(canAccessPath("purchaser", "/sku-details")).toBe(true);
    expect(getVisibleModulesForRole("operator", MODULES).map((module) => module.path)).toContain("/sku-details");
    expect(getVisibleModulesForRole("purchaser", MODULES).map((module) => module.path)).toContain("/sku-details");
  });
});
