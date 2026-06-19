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

  test("选品流程作为普通一级菜单展示并包含子流程入口", () => {
    const sourcing = MODULES.find((module) => module.id === "sourcing") as
      | { path: string; adminOnly?: boolean; children?: Array<{ path: string; name: string }> }
      | undefined;

    expect(sourcing?.path).toBe("/sourcing");
    expect(sourcing?.adminOnly).toBeUndefined();
    expect(sourcing?.children?.map((item) => [item.name, item.path])).toEqual([
      ["选品登记", "/sourcing/register"],
      ["初选处理", "/sourcing/review"],
      ["待询价清单", "/sourcing/quote-pending"],
      ["利润评估", "/sourcing/quoting"],
      ["已完成", "/sourcing/completed"],
      ["未入选", "/sourcing/rejected"],
    ]);
    expect(getVisibleModulesForRole("operator", MODULES).map((module) => module.path)).toContain("/sourcing");
    expect(getVisibleModulesForRole("purchaser", MODULES).map((module) => module.path)).toContain("/sourcing");
  });
});
