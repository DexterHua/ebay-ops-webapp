import { SourcingWorkbench } from "@/components/sourcing/sourcing-workbench";

export default function SourcingRejectedPage() {
  return (
    <SourcingWorkbench
      filter="rejected"
      mode="readonly"
      title="未入选"
      description="查看初选未入选的候选商品和原因。"
    />
  );
}
