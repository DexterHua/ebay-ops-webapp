export type AccessRole = "admin" | "purchaser" | "operator";

type ModuleWithAccess = {
  path: string;
  adminOnly?: boolean;
};

const ADMIN_ONLY_PATHS = ["/dashboard", "/accounts"] as const;

export function isAccessRole(value: unknown): value is AccessRole {
  return value === "admin" || value === "purchaser" || value === "operator";
}

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function canAccessPath(role: AccessRole, pathname: string): boolean {
  return role === "admin" || !isAdminOnlyPath(pathname);
}

export function getVisibleModulesForRole<T extends ModuleWithAccess>(role: AccessRole | null, modules: readonly T[]): T[] {
  return modules.filter((module) => !module.adminOnly || role === "admin");
}
