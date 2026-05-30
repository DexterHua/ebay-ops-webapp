import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex">
      <Sidebar />
      <main className="flex-1 ml-56 flex flex-col min-h-screen bg-white">
        <Header />
        <div className="flex-1 bg-gray-50/60 p-5">{children}</div>
      </main>
    </div>
  );
}
