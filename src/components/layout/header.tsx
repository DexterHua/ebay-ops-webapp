"use client";

import { usePathname } from "next/navigation";
import { MODULES, STORES } from "@/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function Header() {
  const pathname = usePathname();
  const currentModule = MODULES.find(
    (m) => pathname === m.path || pathname.startsWith(m.path + "/")
  );

  const activeStores = STORES.filter((s) => s.active);

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
        {/* 店铺标签 */}
        <div className="flex items-center gap-1.5">
          {activeStores.map((store) => (
            <Badge
              key={store.id}
              variant="outline"
              className={cn(
                "text-[11px] h-5 px-2 border-gray-200 bg-white text-gray-500",
                "hover:border-gray-400 hover:text-gray-700 transition-colors"
              )}
            >
              {store.name}
            </Badge>
          ))}
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
