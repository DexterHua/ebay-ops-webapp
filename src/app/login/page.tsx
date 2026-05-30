"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="w-full max-w-sm px-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto rounded-xl bg-white/10 flex items-center justify-center mb-4">
            <img src="/logo.png" alt="Logo" className="h-8 w-8 object-contain" />
          </div>
          <h1 className="text-lg font-bold text-white">烁立德运营中心</h1>
          <p className="text-xs text-gray-400 mt-1">Solid eCom Operations</p>
        </div>

        {/* 表单 */}
        <Card className="border-0 shadow-xl bg-white/95 backdrop-blur">
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-base">登录</CardTitle>
            <CardDescription className="text-xs">请输入姓名和密码</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-3.5">
              <div>
                <Input
                  type="text"
                  placeholder="姓名"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  autoComplete="name"
                  className="h-10"
                />
              </div>
              <div>
                <Input
                  type="password"
                  placeholder="密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="h-10"
                />
              </div>
              <Button type="submit" disabled={loading} className="w-full h-10">
                {loading ? "验证中…" : "进入系统"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-gray-500 mt-5">
          仅限内部团队使用
        </p>
      </div>
    </div>
  );
}
