import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 text-center px-4">
      <h1 className="text-4xl font-bold">台灣房地產新聞</h1>
      <p className="text-gray-500 max-w-md">每日自動抓取 Google News → AI 篩選改寫 → 呈現最值得關注的台灣房市動態</p>
      <div className="flex gap-4">
        <Link
          href="/news"
          className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
        >
          瀏覽新聞
        </Link>
        <Link
          href="/admin/news"
          className="border px-6 py-3 rounded-lg hover:bg-gray-50 transition-colors"
        >
          後台管理
        </Link>
      </div>
    </main>
  );
}
