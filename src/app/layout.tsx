import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "烁立德运营中心 · eBay AI Operations",
  description: "烁立德eBay团队日常运营工具",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="h-full bg-white">
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
