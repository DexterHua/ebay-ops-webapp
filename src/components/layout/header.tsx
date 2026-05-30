"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { MODULES, STORES } from "@/types";
import { cn } from "@/lib/utils";

const STORE_COLORS: Record<string, string> = {
  NP: "bg-blue-500 hover:bg-blue-600",
  VG: "bg-amber-500 hover:bg-amber-600",
  TR: "bg-emerald-500 hover:bg-emerald-600",
};

export function Header() {
  const pathname = usePathname();
  const currentModule = MODULES.find(
    (m) => pathname === m.path || pathname.startsWith(m.path + "/")
  );

  const activeStores = STORES.filter((s) => s.active);
  const activeStoreId = pathname.startsWith("/store/") ? pathname.split("/store/")[1] : null;

  return (
    <header className="h-12 border-b border-gray-200 bg-white flex items-center justify-between px-5 sticky top-0 z-10">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-900">
          {currentModule?.name || "🏠 首页"}
        </h2>
        {currentModule && (
          <span className="text-[11px] text-gray-400 hidden sm:inline">
            {currentModule.description}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* 店铺按钮 */}
        <div className="flex items-center gap-1.5">
          {activeStores.map((store) => {
            const isActive = activeStoreId === store.id;
            return (
              <Link
                key={store.id}
                href={`/store/${store.id}`}
                className={cn(
                  "text-[11px] h-5 px-2.5 rounded-full text-white font-medium transition-all cursor-pointer inline-flex items-center",
                  isActive
                    ? `${STORE_COLORS[store.id]} ring-1 ring-offset-1 shadow-sm`
                    : STORE_COLORS[store.id]
                )}
              >
                {store.name}
              </Link>
            );
          })}
        </div>

        {/* 用户 */}
        <div className="flex items-center gap-2 pl-3 border-l border-gray-200">
          <div className="w-6 h-6 rounded-md bg-gray-900 text-white text-[11px] flex items-center justify-center font-medium">
            车
          </div>
          <span className="text-[12px] text-gray-500 hidden md:block">车泉</span>
        </div>
      </div>
    </header>
  );
}
