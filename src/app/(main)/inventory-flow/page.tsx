"use client";

import { Boxes } from "lucide-react";
import { ExceptionsTab } from "@/components/inventory-flow/exceptions-tab";
import { FlowDetailsTab } from "@/components/inventory-flow/flow-details-tab";
import { PurchaseBatchesTab } from "@/components/inventory-flow/purchase-batches-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function InventoryFlowPage() {
  return (
    <div className="app-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="page-kicker">Inventory Flow</p>
          <h1 className="page-title">库存流转</h1>
          <p className="page-description">采购批次与库存状态批量推进，发运物流在批次流转中完成</p>
        </div>
        <div className="hidden rounded-lg border border-orange-100 bg-orange-50 p-2 text-orange-700 sm:block">
          <Boxes className="size-5" />
        </div>
      </div>

      <Tabs defaultValue="purchases">
        <TabsList className="flex w-full justify-start overflow-x-auto">
          <TabsTrigger value="purchases">采购批次</TabsTrigger>
          <TabsTrigger value="flow">批次流转</TabsTrigger>
          <TabsTrigger value="exceptions">库存异常</TabsTrigger>
        </TabsList>
        <TabsContent value="purchases">
          <PurchaseBatchesTab />
        </TabsContent>
        <TabsContent value="flow">
          <FlowDetailsTab />
        </TabsContent>
        <TabsContent value="exceptions">
          <ExceptionsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
