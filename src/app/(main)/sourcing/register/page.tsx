import { SourcingForm } from "@/components/sourcing/sourcing-form";

export default function SourcingRegisterPage() {
  return (
    <div className="app-page max-w-4xl">
      <div>
        <p className="page-kicker">Sourcing Workflow</p>
        <h1 className="page-title">选品登记</h1>
        <p className="page-description">录入候选商品，提交后自动进入初选待处理。</p>
      </div>
      <SourcingForm />
    </div>
  );
}
