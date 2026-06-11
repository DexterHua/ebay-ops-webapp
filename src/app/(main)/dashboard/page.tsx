import { redirect } from "next/navigation";
import DashboardClient from "./dashboard-client";
import { requireAdmin } from "@/lib/session-server";

export default async function DashboardPage() {
  try {
    await requireAdmin();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    redirect(message === "权限不足" ? "/" : "/login");
  }

  return <DashboardClient />;
}
