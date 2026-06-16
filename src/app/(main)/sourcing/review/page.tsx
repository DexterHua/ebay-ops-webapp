import { SourcingWorkbench } from "@/components/sourcing/sourcing-workbench";

export default function SourcingReviewPage() {
  return (
    <SourcingWorkbench
      filter="review"
      mode="review"
      title="初选处理"
      description="运营或主管填写是否入选、最高购入价格和初选备注。"
    />
  );
}
