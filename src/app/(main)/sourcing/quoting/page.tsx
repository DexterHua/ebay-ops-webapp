import { SourcingWorkbench } from "@/components/sourcing/sourcing-workbench";

export default function SourcingQuotingPage() {
  return (
    <SourcingWorkbench
      filter="quoting"
      mode="quote"
      title="询价中"
      description="继续维护供应商和报价，供应商与报价齐全后自动进入已完成。"
    />
  );
}
