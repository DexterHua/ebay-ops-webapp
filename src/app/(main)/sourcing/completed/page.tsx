import { SourcingWorkbench } from "@/components/sourcing/sourcing-workbench";

export default function SourcingCompletedPage() {
  return (
    <SourcingWorkbench
      filter="completed"
      mode="readonly"
      title="已完成"
      description="查看已经完成询价的选品记录。"
    />
  );
}
