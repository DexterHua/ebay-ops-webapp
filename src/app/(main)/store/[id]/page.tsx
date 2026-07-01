import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { requireSession } from "@/lib/session-server";
import { STORES } from "@/types";
import StorePageClient from "./store-page-client";

export default async function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = STORES.find((item) => item.id === id && item.active);
  if (!store) notFound();

  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession();
  } catch {
    redirect("/login");
  }

  if (!session.storeIds.includes(store.id)) {
    return (
      <div className="app-page flex min-h-[60vh] max-w-2xl items-center justify-center">
        <div className="w-full rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-base font-semibold text-slate-900">无权访问该店铺</h1>
          <p className="mt-2 text-sm text-slate-500">
            当前账号未分配 {store.name}，因此无法查看该单店经营看板。
          </p>
          <Link
            href="/dashboard"
            className="mt-5 inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-600 transition-colors hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600"
          >
            <ArrowLeft className="h-4 w-4" />
            返回运营仪表盘
          </Link>
        </div>
      </div>
    );
  }

  return <StorePageClient storeId={store.id} />;
}
