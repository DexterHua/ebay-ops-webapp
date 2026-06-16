"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MODULES } from "@/types";
import { ModuleIcon } from "@/components/layout/module-icons";
import { Activity, CircleHelp } from "lucide-react";
import { getVisibleModulesForRole, isAccessRole, type AccessRole } from "@/lib/access-control";

function isActivePath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const [role, setRole] = useState<AccessRole | null>(null);
  const [larkStatus, setLarkStatus] = useState<"checking" | "readonly" | "connected" | "offline">("checking");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { setRole(isAccessRole(d.role) ? d.role : null); })
      .catch(() => {});

    fetch("/api/lark/status")
      .then((r) => r.json())
      .then((d) => setLarkStatus(d.connected ? (d.readOnly ? "readonly" : "connected") : "offline"))
      .catch(() => setLarkStatus("offline"));
  }, []);

  const modules = getVisibleModulesForRole(role, MODULES);

  return (
    <>
    <aside className="fixed left-0 top-0 hidden h-screen w-64 flex-col border-r border-slate-200/80 bg-white text-slate-700 lg:flex">
      {/* Logo 区域 */}
      <div className="border-b border-slate-100 px-5 py-5">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="烁立德"
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-xl object-cover shadow-sm ring-1 ring-slate-200"
          />
          <div>
            <h1 className="text-sm font-semibold leading-tight tracking-tight text-slate-900">烁立德运营中心</h1>
            <p className="mt-1 text-[10px] font-medium uppercase leading-tight tracking-[0.12em] text-slate-400">Solid Operations</p>
          </div>
        </Link>
      </div>

      {/* 导航 */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">工作台</p>
        {modules.map((mod) => {
          const children = "children" in mod ? mod.children : undefined;
          const isActive = isActivePath(pathname, mod.path);
          return (
            <div key={mod.id}>
              <Link
                href={children?.[0]?.path || mod.path}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-all duration-150",
                  isActive
                    ? "bg-orange-50 font-semibold text-orange-700"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <ModuleIcon moduleId={mod.id} className={cn("h-4 w-4 shrink-0", isActive && "text-orange-500")} strokeWidth={1.8} />
                <span>{mod.name}</span>
              </Link>
              {children && isActive && (
                <div className="mt-1 space-y-0.5 pl-8">
                  {children.map((child) => {
                    const childActive = isActivePath(pathname, child.path);
                    return (
                      <Link
                        key={child.id}
                        href={child.path}
                        className={cn(
                          "block rounded-lg px-3 py-1.5 text-[12px] transition-colors",
                          childActive
                            ? "bg-orange-100 font-medium text-orange-700"
                            : "text-slate-400 hover:bg-slate-50 hover:text-slate-700",
                        )}
                      >
                        {child.name}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* 底部状态 */}
      <div className="border-t border-slate-100 px-4 py-4">
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          <Activity className="h-3.5 w-3.5 text-orange-500" />
          <span>系统运行正常</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className={cn(
            "w-1.5 h-1.5 rounded-full inline-block",
            larkStatus === "checking" && "bg-gray-300 animate-pulse",
            larkStatus === "readonly" && "bg-amber-500",
            larkStatus === "connected" && "bg-emerald-500",
            larkStatus === "offline" && "bg-red-500",
          )} />
          <span>
            {larkStatus === "checking" && "飞书连接检测中"}
            {larkStatus === "readonly" && "飞书已连接（只读）"}
            {larkStatus === "connected" && "飞书已连接"}
            {larkStatus === "offline" && "飞书未连接"}
          </span>
        </div>
        <p className="mt-1 text-[10px] text-slate-300">
          NewPower · VelocityGear · TitanRig · Solidparts · Nexusmoto
        </p>
        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-300">
          <CircleHelp className="h-3 w-3" />
          <span>内部运营工作台</span>
        </div>
      </div>
    </aside>
    <nav
      aria-label="移动端导航"
      className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-slate-200 bg-white/95 px-1 py-1 shadow-[0_-6px_20px_rgba(15,23,42,0.05)] backdrop-blur lg:hidden"
    >
      {modules.map((mod) => {
        const children = "children" in mod ? mod.children : undefined;
        const isActive = isActivePath(pathname, mod.path);
        return (
          <Link
            key={mod.id}
            href={children?.[0]?.path || mod.path}
            className={cn(
              "flex min-w-[4.5rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 text-[10px] transition-colors",
              isActive ? "bg-orange-50 text-orange-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            )}
          >
            <ModuleIcon moduleId={mod.id} className="h-4 w-4" strokeWidth={1.8} />
            <span className="whitespace-nowrap">{mod.name}</span>
          </Link>
        );
      })}
    </nav>
    </>
  );
}
