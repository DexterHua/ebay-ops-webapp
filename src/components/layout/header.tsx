"use client";

import { usePathname } from "next/navigation";
import { MODULES } from "@/types";
import { Badge } from "@/components/ui/badge";

export function Header() {
  const pathname = usePathname();
  const currentModule = MODULES.find(
    (m) => pathname === m.path || pathname.startsWith(m.path + "/")
  );

  return (
    <header className="h-14 border-b border-gray-200 bg-white flex items-center justify-between px-6 sticky top-0 z-10">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-gray-900">
          {currentModule?.name || "🏠 运营总览"}
        </h2>
        {currentModule && (
          <Badge variant="secondary" className="text-xs font-normal">
            {currentModule.description}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* 快筛 */}
        <div className="flex items-center gap-2">
          {["A店-主力店", "B店-测款店", "C店-利润店"].map((store) => (
            <Badge
              key={store}
              variant="outline"
              className="text-xs cursor-pointer hover:bg-gray-50"
            >
              {store}
            </Badge>
          ))}
        </div>
        {/* 用户区（占位） */}
        <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
          <div className="w-7 h-7 rounded-full bg-gray-800 text-white text-xs flex items-center justify-center font-medium">
            车
          </div>
          <span className="text-sm text-gray-600 hidden md:block">车泉</span>
        </div>
      </div>
    </header>
  );
}
