"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
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
    const normalizedName = name.trim();
    const normalizedPassword = password.trim();

    if (!normalizedName || !normalizedPassword) {
      toast.error("请输入姓名和密码");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalizedName, password: normalizedPassword }),
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) as { ok?: boolean; name?: string; error?: string } : {};

      if (res.ok && json.ok) {
        toast.success(`欢迎，${json.name}`);
        router.push("/");
        router.refresh();
      } else {
        toast.error(json.error || `登录失败（${res.status}）`);
      }
    } catch (error) {
      toast.error("服务异常，请重试", {
        description: error instanceof Error ? error.message : "请刷新页面后再试",
      });
    }
    setLoading(false);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#101722] px-4 py-8 sm:px-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(245,158,11,0.2),transparent_24rem),radial-gradient(circle_at_82%_80%,rgba(71,85,105,0.24),transparent_28rem)]" />
      <section className="relative grid w-full max-w-[25rem] overflow-hidden rounded-3xl bg-white shadow-2xl shadow-black/25 lg:max-w-4xl lg:grid-cols-[1.08fr_0.92fr]">
        <div className="hidden min-h-[560px] flex-col justify-between bg-[#17202d] p-10 text-white lg:flex">
          <div>
            <div className="flex items-center gap-3">
              <Image src="/logo.png" alt="烁立德" width={52} height={52} className="h-13 w-13 rounded-2xl object-cover" priority />
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

        <div className="px-7 py-8 sm:px-9 sm:py-10 lg:flex lg:items-center lg:px-12">
          <div className="w-full">
            <div className="mb-8 lg:hidden">
              <div className="mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
                <Image src="/logo.png" alt="烁立德" width={64} height={64} className="h-full w-full object-cover" priority />
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-950">烁立德运营中心</h1>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Solid Operations</p>
            </div>

            <div className="mb-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-600">Secure Access</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">登录运营工作台</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">使用内部账号继续访问</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-500">姓名</span>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
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
                    className="h-12 rounded-xl pl-10 text-[15px]"
                  />
                </div>
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-medium text-slate-500">密码</span>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="password"
                    placeholder="密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="h-12 rounded-xl pl-10 text-[15px]"
                  />
                </div>
              </label>
              <Button type="submit" disabled={loading} className="mt-3 h-12 w-full rounded-xl text-base font-semibold">
                {loading ? "验证中…" : "进入系统"}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </Button>
            </form>

            <p className="mt-6 flex items-center gap-1.5 text-[12px] text-slate-400 lg:hidden">
              <ShieldCheck className="h-3.5 w-3.5" />
              仅限内部团队安全访问
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
