import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "台灣房地產新聞",
  description: "每日自動整理台灣房地產最新新聞，AI 篩選改寫，掌握房市動態。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
