import { getAllNews } from "@/lib/news";
import { initNewsDb } from "@/lib/news";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "台灣房地產新聞 | 最新房市動態",
  description: "每日精選台灣房地產新聞，AI 整理改寫，掌握最新房市趨勢。",
};

export default async function NewsListPage() {
  await initNewsDb();
  const articles = await getAllNews(50);

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">台灣房地產新聞</h1>
        <p className="text-gray-500 mt-2 text-sm">每日精選，AI 整理改寫</p>
      </header>

      {articles.length === 0 ? (
        <p className="text-gray-400">目前尚無新聞，請稍後再來。</p>
      ) : (
        <div className="divide-y">
          {articles.map((a) => (
            <article key={a.slug} className="py-6">
              <Link href={`/news/${a.slug}`} className="group">
                <h2 className="text-lg font-semibold group-hover:text-blue-600 transition-colors leading-snug">
                  {a.title}
                </h2>
              </Link>
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                <span>{a.source}</span>
                <span>·</span>
                <span>{a.published_at}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
