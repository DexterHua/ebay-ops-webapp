"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowRight, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !password.trim()) {
      toast.error("请输入姓名和密码");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), password }),
      });
      const json = await res.json();

      if (json.ok) {
        toast.success(`欢迎，${json.name}`);
        router.push("/");
        router.refresh();
      } else {
        toast.error(json.error || "登录失败");
      }
    } catch {
      toast.error("服务异常，请重试");
    }
    setLoading(false);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#101722] px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(245,158,11,0.18),transparent_28rem),radial-gradient(circle_at_85%_80%,rgba(71,85,105,0.22),transparent_30rem)]" />
      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-[28px] border border-white/10 bg-white shadow-2xl shadow-black/20 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="hidden min-h-[560px] flex-col justify-between bg-[#17202d] p-10 text-white lg:flex">
          <div>
            <div className="flex items-center gap-3">
              <Image src="/logo.png" alt="烁立德" width={52} height={52} className="h-13 w-13 rounded-2xl object-cover" />
              <div>
                <h1 className="text-base font-semibold tracking-tight">烁立德运营中心</h1>
                <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">Solid Operations</p>
              </div>
            </div>
            <h2 className="mt-20 max-w-sm text-4xl font-semibold leading-[1.18] tracking-tight">
              让每一项运营决策
              <span className="block text-orange-400">清晰、准确、可执行</span>
            </h2>
            <p className="mt-5 max-w-sm text-sm leading-7 text-slate-400">
              面向跨境汽摩配业务的一体化工作台，连接库存、商品、客服与运营流程。
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="h-4 w-4 text-orange-400" />
            <span>仅限内部团队安全访问</span>
          </div>
        </div>
        <div className="flex items-center justify-center px-6 py-10 sm:px-12">
          <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 lg:hidden">
          <div className="mb-4 h-14 w-14 overflow-hidden rounded-2xl ring-1 ring-slate-200">
            <Image src="/logo.png" alt="烁立德" width={56} height={56} className="h-full w-full object-cover" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">烁立德运营中心</h1>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Solid Operations</p>
        </div>

        {/* 表单 */}
        <Card className="border-0 bg-transparent p-0 shadow-none">
          <CardHeader className="px-0 pb-5">
            <p className="page-kicker">Secure Access</p>
            <CardTitle className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">登录运营工作台</CardTitle>
            <CardDescription className="text-sm">使用内部账号继续访问</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <form onSubmit={handleLogin} className="space-y-3.5">
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-500">姓名</span>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  name="username"
                  placeholder="请输入中文姓名"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  inputMode="text"
                  lang="zh-CN"
                  spellCheck={false}
                  className="h-11 pl-10"
                />
                </div>
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-500">密码</span>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="password"
                  placeholder="密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="h-11 pl-10"
                />
                </div>
              </label>
              <Button type="submit" disabled={loading} className="mt-2 h-11 w-full">
                {loading ? "验证中…" : "进入系统"}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 flex items-center gap-1.5 text-[11px] text-slate-400 lg:hidden">
          <ShieldCheck className="h-3.5 w-3.5" />
          仅限内部团队安全访问
        </p>
          </div>
        </div>
      </div>
    </div>
  );
}
