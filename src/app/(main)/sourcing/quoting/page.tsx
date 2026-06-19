import { SourcingWorkbench } from "@/components/sourcing/sourcing-workbench";

export default function SourcingQuotingPage() {
  return (
    <SourcingWorkbench
      filter="profitReview"
      mode="profitReview"
      title="利润评估"
      description="根据供应商报价和最高购入价判断是否入选，推进到已完成或未入选。"
    />
  );
}
