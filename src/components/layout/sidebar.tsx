"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MODULES } from "@/types";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 h-screen bg-white text-gray-700 flex flex-col fixed left-0 top-0 border-r border-gray-200">
      {/* Logo 区域 */}
      <div className="px-5 py-4 border-b border-gray-100">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="烁立德"
            width={36}
            height={36}
            className="rounded-md shrink-0"
          />
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-tight">烁立德运营中心</h1>
            <p className="text-[10px] text-gray-400 leading-tight">Solid eCom Operations</p>
          </div>
        </Link>
      </div>

      {/* 导航 */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {MODULES.map((mod) => {
          const isActive = pathname === mod.path || pathname.startsWith(mod.path + "/");
          const icon = mod.name.split(" ")[0];
          const label = mod.name.split(" ").slice(1).join(" ");
          return (
            <Link
              key={mod.id}
              href={mod.path}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-all duration-150",
                isActive
                  ? "bg-gray-900 text-white font-medium shadow-sm"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              )}
            >
              <span className="text-base w-5 text-center shrink-0">{icon}</span>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* 底部状态 */}
      <div className="px-4 py-3 border-t border-gray-100">
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
          <span>飞书已连接</span>
        </div>
        <p className="text-[10px] text-gray-300 mt-0.5">
          NewPower · VelocityGear · TitanRig
        </p>
      </div>
    </aside>
  );
}
