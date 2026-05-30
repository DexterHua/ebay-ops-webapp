import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "烁立德运营中心 · eBay AI Operations",
  description: "烁立德eBay团队日常运营工具：库存监控、详情页生成、评论回复、选品助手、数据仪表盘",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex bg-white">
        <Sidebar />
        <main className="flex-1 ml-56 flex flex-col min-h-screen bg-white">
          <Header />
          <div className="flex-1 bg-gray-50/60 p-5">
            {children}
          </div>
        </main>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
