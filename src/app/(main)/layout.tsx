import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#f7f8fa]">
      <Sidebar />
      <main className="flex min-h-screen min-w-0 flex-1 flex-col pb-20 lg:ml-64 lg:pb-0">
        <Header />
        <div className="flex-1 p-3 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
