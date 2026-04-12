import { getAllNews } from "@/lib/news";
import { initTables, getFetchLogs } from "@/lib/news-settings";
import { initNewsDb } from "@/lib/news";
import NewsClient from "./NewsClient";

export const dynamic = "force-dynamic";

export default async function AdminNewsPage() {
  await initNewsDb();
  await initTables();
  const [articles, logs] = await Promise.all([getAllNews(100), getFetchLogs(20)]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">台灣房地產新聞管理</h1>
      <NewsClient articles={articles} logs={logs} />
    </div>
  );
}
