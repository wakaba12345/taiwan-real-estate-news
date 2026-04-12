"use client";

import { useState } from "react";

interface Article {
  slug: string;
  title: string;
  original_title: string;
  source: string;
  published_at: string;
  created_at?: string;
}

interface FetchLog {
  id: number;
  run_at: string;
  status: string;
  articles_saved: number;
  message: string;
}

interface Props {
  articles: Article[];
  logs: FetchLog[];
}

export default function NewsClient({ articles: initial, logs: initialLogs }: Props) {
  const [articles, setArticles] = useState(initial);
  const [logs, setLogs] = useState(initialLogs);
  const [triggering, setTriggering] = useState(false);
  const [msg, setMsg] = useState("");

  async function triggerFetch() {
    setTriggering(true);
    setMsg("正在抓取新聞，請稍候...");
    try {
      const res = await fetch("/api/cron/fetch-news", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setMsg(`✅ 完成！已儲存 ${data.saved} 篇新聞`);
        // 重新載入文章列表
        const r = await fetch("/api/admin/news");
        setArticles(await r.json());
        const s = await fetch("/api/admin/news-settings");
        const sd = await s.json();
        setLogs(sd.logs);
      } else {
        setMsg(`❌ 失敗：${data.error}`);
      }
    } catch (e) {
      setMsg(`❌ 錯誤：${e}`);
    } finally {
      setTriggering(false);
    }
  }

  async function deleteArticle(slug: string) {
    if (!confirm("確定要刪除這篇新聞？")) return;
    await fetch(`/api/admin/news/${slug}`, { method: "DELETE" });
    setArticles((prev) => prev.filter((a) => a.slug !== slug));
  }

  return (
    <div>
      {/* 手動觸發 */}
      <div className="mb-8 flex items-center gap-4">
        <button
          onClick={triggerFetch}
          disabled={triggering}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {triggering ? "抓取中..." : "立即抓取新聞"}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>

      {/* 文章列表 */}
      <div className="mb-10">
        <h2 className="text-xl font-semibold mb-4">新聞列表（{articles.length} 篇）</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left p-3 border">標題</th>
                <th className="text-left p-3 border w-32">來源</th>
                <th className="text-left p-3 border w-28">日期</th>
                <th className="text-left p-3 border w-28">操作</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.slug} className="hover:bg-gray-50">
                  <td className="p-3 border">
                    <div className="font-medium">{a.title}</div>
                    <div className="text-xs text-gray-400 mt-1">{a.original_title}</div>
                  </td>
                  <td className="p-3 border text-gray-500">{a.source}</td>
                  <td className="p-3 border text-gray-500">{a.published_at}</td>
                  <td className="p-3 border">
                    <div className="flex gap-2">
                      <a
                        href={`/admin/news/edit/${a.slug}`}
                        className="text-blue-600 hover:underline"
                      >
                        編輯
                      </a>
                      <a href={`/news/${a.slug}`} target="_blank" className="text-green-600 hover:underline">
                        預覽
                      </a>
                      <button
                        onClick={() => deleteArticle(a.slug)}
                        className="text-red-500 hover:underline"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {articles.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-gray-400">
                    尚無新聞，點擊「立即抓取」開始
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 執行記錄 */}
      <div>
        <h2 className="text-xl font-semibold mb-4">執行記錄</h2>
        <div className="space-y-2">
          {logs.map((log) => (
            <div
              key={log.id}
              className={`flex items-center gap-4 p-3 rounded-lg text-sm border ${
                log.status === "success" ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
              }`}
            >
              <span className={log.status === "success" ? "text-green-600" : "text-red-600"}>
                {log.status === "success" ? "✅" : "❌"}
              </span>
              <span className="text-gray-500 w-44 shrink-0">
                {new Date(log.run_at).toLocaleString("zh-TW")}
              </span>
              <span className="text-gray-700">{log.message}</span>
              <span className="ml-auto text-gray-500">{log.articles_saved} 篇</span>
            </div>
          ))}
          {logs.length === 0 && (
            <p className="text-gray-400 text-sm">尚無執行記錄</p>
          )}
        </div>
      </div>
    </div>
  );
}
