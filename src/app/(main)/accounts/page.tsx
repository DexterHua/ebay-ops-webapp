import { redirect } from "next/navigation";
import AccountsClient from "./accounts-client";
import { requireAdmin } from "@/lib/session-server";

export default async function AccountsPage() {
  try {
    await requireAdmin();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    redirect(message === "权限不足" ? "/" : "/login");
  }

  return <AccountsClient />;
}
