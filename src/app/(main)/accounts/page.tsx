"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

interface UserInfo { name: string; createdAt: string; }

export default function AccountsPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // 新增表单
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPass, setNewPass] = useState("");
  const [saving, setSaving] = useState(false);

  // 重置密码表单
  const [resetTarget, setResetTarget] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState("");
  const [showDelete, setShowDelete] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const [meRes, usersRes] = await Promise.all([
        fetch("/api/auth/me").then(r => r.json()),
        fetch("/api/auth/users").then(r => r.json()),
      ]);
      setIsAdmin(!!meRes.isAdmin);
      if (usersRes.ok && usersRes.users) {
        setUsers(usersRes.users);
      }
    } catch {
      toast.error("加载失败");
    }
    setLoading(false);
  }, []);

  const refreshUsers = () => {
    setLoading(true);
    void fetchUsers();
  };

  useEffect(() => {
    const timer = setTimeout(() => { void fetchUsers(); }, 0);
    return () => clearTimeout(timer);
  }, [fetchUsers]);

  // 新增用户
  const handleAdd = async () => {
    if (!newName.trim() || !newPass.trim()) { toast.error("请填写姓名和密码"); return; }
    setSaving(true);
    const res = await fetch("/api/auth/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", name: newName.trim(), password: newPass }),
    });
    const json = await res.json();
    if (json.ok) { toast.success("用户已创建"); setShowAdd(false); setNewName(""); setNewPass(""); refreshUsers(); }
    else { toast.error(json.error); }
    setSaving(false);
  };

  // 删除用户
  const handleDelete = async () => {
    setSaving(true);
    const res = await fetch("/api/auth/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", name: deleteTarget }),
    });
    const json = await res.json();
    if (json.ok) { toast.success("用户已删除"); setShowDelete(false); setDeleteTarget(""); refreshUsers(); }
    else { toast.error(json.error); }
    setSaving(false);
  };

  // 重置密码
  const handleReset = async () => {
    if (!newPassword.trim()) { toast.error("请输入新密码"); return; }
    setSaving(true);
    const res = await fetch("/api/auth/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resetPassword", name: resetTarget, password: newPassword }),
    });
    const json = await res.json();
    if (json.ok) { toast.success(`密码已重置`); setShowReset(false); setResetTarget(""); setNewPassword(""); }
    else { toast.error(json.error); }
    setSaving(false);
  };

  if (!isAdmin) return <div className="py-20 text-center text-gray-400">仅管理员可访问</div>;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">👥 账号管理</h1>
          <p className="text-gray-500 mt-1 text-sm">管理系统登录账号 · 仅管理员可操作</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>+ 新增用户</Button>
      </div>

      {/* 用户列表 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">用户列表</CardTitle>
          <CardDescription className="text-xs">共 {users.length} 个账号</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : (
            <div className="space-y-1">
              {users.map((u) => (
                <div key={u.name} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-gray-800 text-white text-xs flex items-center justify-center font-medium">
                      {u.name.slice(0, 1)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{u.name}</span>
                        {u.name === "车泉" && <Badge className="text-[10px] bg-purple-100 text-purple-700 border-0">管理员</Badge>}
                      </div>
                      <p className="text-[11px] text-gray-400">创建于 {u.createdAt}</p>
                    </div>
                  </div>
                  {u.name !== "车泉" && (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setResetTarget(u.name); setNewPassword(""); setShowReset(true); }}>
                        重置密码
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs text-red-500 hover:text-red-700 hover:border-red-200" onClick={() => { setDeleteTarget(u.name); setShowDelete(true); }}>
                        删除
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 新增用户弹窗 */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>新增用户</DialogTitle><DialogDescription>输入姓名和初始密码</DialogDescription></DialogHeader>
          <div className="space-y-3 py-3">
            <Input placeholder="姓名" value={newName} onChange={e => setNewName(e.target.value)} />
            <Input placeholder="初始密码" type="password" value={newPass} onChange={e => setNewPass(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>取消</Button>
            <Button onClick={handleAdd} disabled={saving}>{saving ? "创建中…" : "创建"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置密码弹窗 */}
      <Dialog open={showReset} onOpenChange={setShowReset}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>重置密码</DialogTitle><DialogDescription>为 {resetTarget} 设置新密码</DialogDescription></DialogHeader>
          <div className="space-y-3 py-3">
            <Input placeholder="新密码" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReset(false)}>取消</Button>
            <Button onClick={handleReset} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>确认删除</DialogTitle><DialogDescription className="text-red-600">确定要删除用户「{deleteTarget}」吗？此操作不可撤销。</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
