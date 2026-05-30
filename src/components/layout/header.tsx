"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { MODULES, STORES } from "@/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STORE_COLORS: Record<string, string> = {
  NP: "bg-blue-500 hover:bg-blue-600",
  VG: "bg-amber-500 hover:bg-amber-600",
  TR: "bg-emerald-500 hover:bg-emerald-600",
};

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [userName, setUserName] = useState("");

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      if (d.name) setUserName(d.name);
    }).catch(() => {});
  }, []);

  const currentModule = MODULES.find(
    (m) => pathname === m.path || pathname.startsWith(m.path + "/")
  );

  const activeStores = STORES.filter((s) => s.active);
  const activeStoreId = pathname.startsWith("/store/") ? pathname.split("/store/")[1] : null;

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    toast.success("已退出登录");
    router.push("/login");
    router.refresh();
  };

  const initial = userName ? userName.slice(0, 1) : "?";

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
          <div className="w-6 h-6 rounded-md bg-gray-800 text-white text-[11px] flex items-center justify-center font-medium">
            {initial}
          </div>
          <span className="text-[12px] text-gray-500 hidden md:block">{userName}</span>
          <button
            onClick={handleLogout}
            className="text-[11px] text-gray-400 hover:text-red-500 ml-1 hidden md:block transition-colors"
            title="退出登录"
          >
            退出
          </button>
        </div>
      </div>
    </header>
  );
}
