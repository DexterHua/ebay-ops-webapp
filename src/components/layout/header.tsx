"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { MODULES, STORES } from "@/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ModuleIcon } from "@/components/layout/module-icons";
import { KeyRound, LogOut, Store } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const STORE_COLORS: Record<string, string> = {
  NP: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
  VG: "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100",
  TR: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
};

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

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

  const closeChangePassword = () => {
    setShowChangePassword(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("请完整填写密码信息");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("新密码至少需要 6 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    setChangingPassword(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
        signal: controller.signal,
      });
      const json = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !json?.ok) throw new Error(json?.error || `请求失败 (${response.status})`);
      toast.success("登录密码已修改");
      closeChangePassword();
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "请求超时，请稍后重试"
        : error instanceof Error ? error.message : "修改密码失败，请稍后重试";
      toast.error("修改失败", { description: message });
    } finally {
      clearTimeout(timeout);
      setChangingPassword(false);
    }
  };

  const initial = userName ? userName.slice(0, 1) : "?";
  return (
    <>
      <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-2 border-b border-slate-200/80 bg-white/95 px-3 py-2 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="hidden h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-600 sm:flex">
            <ModuleIcon moduleId={currentModule?.id || "dashboard"} className="h-4 w-4" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900">
            {currentModule?.name || "首页"}
          </h2>
          {currentModule && (
            <span className="hidden text-[11px] text-gray-400 xl:inline">
              {currentModule.description}
            </span>
          )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* 店铺按钮 */}
          <div className="hidden items-center gap-1 sm:flex">
            <Store className="mr-1 h-3.5 w-3.5 text-slate-400" />
            {activeStores.map((store) => {
              const isActive = activeStoreId === store.id;
              return (
                <Link
                  key={store.id}
                  href={`/store/${store.id}`}
                  className={cn(
                    "inline-flex h-7 cursor-pointer items-center rounded-lg border px-2 text-[10px] font-medium transition-all sm:px-2.5 sm:text-[11px]",
                    isActive
                      ? `${STORE_COLORS[store.id]} ring-1 ring-orange-200 ring-offset-1`
                      : STORE_COLORS[store.id]
                  )}
                >
                  <span className="sm:hidden">{store.id}</span>
                  <span className="hidden sm:inline">{store.name}</span>
                </Link>
              );
            })}
          </div>

          {/* 用户 */}
          <div className="flex items-center gap-1.5 border-l border-gray-200 pl-2 sm:gap-2 sm:pl-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-[11px] font-medium text-white">
              {initial}
            </div>
            <span className="hidden text-[12px] text-gray-500 lg:block">{userName}</span>
            <button
              onClick={() => setShowChangePassword(true)}
              className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-orange-50 hover:text-orange-600"
              title="修改登录密码"
            >
              <KeyRound className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleLogout}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
              title="退出登录"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <Dialog open={showChangePassword} onOpenChange={(open) => open ? setShowChangePassword(true) : closeChangePassword()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>修改登录密码</DialogTitle>
            <DialogDescription>请输入原密码，并设置至少 6 位的新密码。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <Input placeholder="原密码" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
            <Input placeholder="新密码" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            <Input placeholder="确认新密码" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeChangePassword} disabled={changingPassword}>取消</Button>
            <Button onClick={handleChangePassword} disabled={changingPassword}>
              {changingPassword ? "保存中…" : "确认修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
