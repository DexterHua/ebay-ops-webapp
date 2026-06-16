import { SourcingWorkbench } from "@/components/sourcing/sourcing-workbench";

export default function SourcingQuotePendingPage() {
  return (
    <SourcingWorkbench
      filter="quotePending"
      mode="quote"
      title="待询价清单"
      description="采购接收已入选商品，填写供应商和报价信息。"
    />
  );
}
