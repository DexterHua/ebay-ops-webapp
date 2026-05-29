"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MODULES } from "@/types";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 h-screen bg-gray-950 text-gray-100 flex flex-col fixed left-0 top-0 border-r border-gray-800">
      {/* Logo区域 */}
      <div className="px-5 py-5 border-b border-gray-800">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="text-xl">🏪</span>
          <div>
            <h1 className="text-sm font-bold leading-tight">eBay 运营中心</h1>
            <p className="text-[10px] text-gray-400 leading-tight">AI-Powered Operations</p>
          </div>
        </Link>
      </div>

      {/* 导航 */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {MODULES.map((mod) => {
          const isActive = pathname === mod.path || pathname.startsWith(mod.path + "/");
          return (
            <Link
              key={mod.id}
              href={mod.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150",
                isActive
                  ? "bg-gray-800 text-white font-medium shadow-sm"
                  : "text-gray-400 hover:text-white hover:bg-gray-800/60"
              )}
            >
              <span className="text-base">{mod.name.split(" ")[0]}</span>
              <span>{mod.name.split(" ").slice(1).join(" ")}</span>
            </Link>
          );
        })}
      </nav>

      {/* 底部状态 */}
      <div className="px-5 py-3 border-t border-gray-800">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
          飞书已连接
        </div>
        <p className="text-[10px] text-gray-600 mt-0.5">
          NewPower / VelocityGear / TitanRig · 运营中
        </p>
      </div>
    </aside>
  );
}
