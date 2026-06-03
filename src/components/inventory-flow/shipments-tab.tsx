"use client";

import { PackagePlus, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function ShipmentsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">头程物流</CardTitle>
        <CardDescription>待接入物流批次创建与明细绑定接口</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Input disabled placeholder="物流批次号" />
          <Input disabled placeholder="承运商" />
          <Input disabled placeholder="跟踪号" />
          <Input disabled type="date" />
        </div>
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
          <Truck className="mx-auto size-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">物流批次接口接入后可合并多个采购批次</p>
          <p className="mt-1 text-xs text-slate-500">后续将从国内集货仓待发明细中选择发运 SKU</p>
        </div>
        <div className="flex justify-end">
          <Button disabled>
            <PackagePlus />
            创建物流批次
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
