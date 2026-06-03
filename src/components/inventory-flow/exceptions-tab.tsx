"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function ExceptionsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">库存异常</CardTitle>
        <CardDescription>待接入异常读取、补回与报损接口</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Input disabled placeholder="处理状态" />
          <Input disabled placeholder="异常类型" />
          <Input disabled placeholder="责任节点" />
          <Input disabled placeholder="SKU" />
        </div>
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
          <AlertTriangle className="mx-auto size-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">异常数据接口接入后显示差异记录</p>
          <p className="mt-1 text-xs text-slate-500">后续支持补回库存、确认报损和关闭异常</p>
        </div>
        <div className="flex justify-end">
          <Button disabled>
            <RotateCcw />
            处理异常
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
