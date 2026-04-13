"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

// ─── 型別 ────────────────────────────────────────────────────────────────────

interface FactCheckItem {
  item: string;
  original: string;
  rewritten: string;
  match: boolean;
}

interface RewriteResult {
  headlines: string[];
  subheadline?: string;
  lead: string;
  body: string;
  meta_description?: string;
  tags?: string[];
  fact_check?: FactCheckItem[];
}

interface Article {
  slug: string;
  title: string;
  original_title: string;
  original_url: string;
  source: string;
  published_at: string;
  body: string;
  original_body?: string | null;
}

// ─── 小元件 ──────────────────────────────────────────────────────────────────

function FactCheckTable({ checks }: { checks: FactCheckItem[] }) {
  if (!checks.length) return null;
  const hasFail = checks.some((c) => !c.match);
  return (
    <div className="mt-4">
      <div className={`flex items-center gap-2 mb-3 font-semibold text-sm ${hasFail ? "text-red-600" : "text-green-600"}`}>
        <span className="text-lg">{hasFail ? "⚠️" : "✅"}</span>
        事實核對 — {hasFail ? "有項目不一致，請人工確認" : "全部通過"}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100">
              {["核對項目", "原文", "改寫稿", ""].map((h, i) => (
                <th key={i} className="p-2 text-left border font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {checks.map((c, i) => (
              <tr key={i} className={c.match ? "" : "bg-red-50"}>
                <td className="p-2 border font-medium">{c.item}</td>
                <td className="p-2 border text-gray-600">{c.original}</td>
                <td className="p-2 border text-gray-600">{c.rewritten}</td>
                <td className="p-2 border text-center text-base">{c.match ? "✓" : "✗"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 主頁面 ──────────────────────────────────────────────────────────────────

export default function EditNewsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);

  const [result, setResult] = useState<RewriteResult | null>(null);
  const [pickedHeadline, setPickedHeadline] = useState(0);
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [viewMode, setViewMode] = useState<"split" | "original" | "rewritten">("split");

  useEffect(() => {
    fetch(`/api/admin/news/${slug}`)
      .then((r) => r.json())
      .then((data: Article) => {
        setArticle(data);
        setEditTitle(data.title ?? "");
        setEditBody(data.body ?? "");
        setLoading(false);
      });
  }, [slug]);

  const triggerRewrite = useCallback(async () => {
    setRewriting(true);
    setRewriteError("");
    try {
      const res = await fetch(`/api/admin/news-rewrite/${slug}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setRewriteError(data.error ?? "改寫失敗");
        return;
      }
      const r = data.result as RewriteResult;
      setResult(r);
      setPickedHeadline(0);
      if (r.headlines?.[0]) setEditTitle(r.headlines[0]);
      if (r.body) setEditBody(r.body);
    } catch (e) {
      setRewriteError(String(e));
    } finally {
      setRewriting(false);
    }
  }, [slug]);

  async function handleSave() {
    setSaving(true);
    await fetch(`/api/admin/news/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle, body: editBody }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const selectHeadline = (i: number) => {
    setPickedHeadline(i);
    if (result?.headlines[i]) setEditTitle(result.headlines[i]);
  };

  if (loading) return <div className="p-8 text-gray-400">載入中...</div>;
  if (!article) return <div className="p-8 text-red-500">文章不存在</div>;

  const isExclusive =
    article.original_title?.includes("獨家") || article.title?.includes("獨家");
  const hasOriginalBody = !!article.original_body && article.original_body.length > 50;
  const factCheckItems = result?.fact_check ?? [];
  const factFail = factCheckItems.some((c) => !c.match);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頂部 bar */}
      <div className="bg-white border-b px-6 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => router.push("/admin/news")} className="text-gray-500 hover:text-gray-800 text-sm shrink-0">
            ← 返回列表
          </button>
          <span className="text-gray-300">|</span>
          <span className="font-semibold text-gray-800 text-sm truncate">{article.original_title}</span>
          {isExclusive && (
            <span className="shrink-0 bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded animate-pulse">
              獨家
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <a href={article.original_url} target="_blank" rel="noreferrer"
            className="text-xs text-blue-500 hover:underline border border-blue-200 px-3 py-1.5 rounded">
            原文連結
          </a>
          <a href={`/news/${slug}`} target="_blank"
            className="text-xs border px-3 py-1.5 rounded hover:bg-gray-50">
            預覽
          </a>
          <button onClick={handleSave} disabled={saving}
            className="bg-blue-600 text-white text-sm px-4 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50 font-medium">
            {saved ? "✓ 已儲存" : saving ? "儲存中..." : "儲存"}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-5 space-y-4">

        {/* 文章資訊 */}
        <div className="bg-white rounded-lg border p-4 flex flex-wrap gap-4 text-sm text-gray-500">
          <span>來源：<strong className="text-gray-700">{article.source}</strong></span>
          <span>日期：<strong className="text-gray-700">{article.published_at}</strong></span>
          {!hasOriginalBody && (
            <span className="text-amber-600 text-xs bg-amber-50 px-2 py-1 rounded border border-amber-200">
              ⚠️ 此文章無原始內文（功能上線前已抓取），無法重新改寫
            </span>
          )}
        </div>

        {/* 操作列 */}
        <div className="bg-white rounded-lg border p-4 flex flex-wrap items-center gap-3">
          <button
            onClick={triggerRewrite}
            disabled={rewriting || !hasOriginalBody}
            className="bg-indigo-600 text-white px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium text-sm"
          >
            {rewriting ? "⟳ AI 改寫中..." : "🔥 重新 AI 改寫"}
          </button>

          <div className="flex items-center gap-0 ml-auto border rounded-lg overflow-hidden text-sm">
            {(["split", "original", "rewritten"] as const).map((m) => (
              <button key={m} onClick={() => setViewMode(m)}
                className={`px-3 py-1.5 ${viewMode === m ? "bg-gray-800 text-white" : "hover:bg-gray-100 text-gray-600"}`}>
                {m === "split" ? "左右對照" : m === "original" ? "原文" : "改寫稿"}
              </button>
            ))}
          </div>

          {rewriteError && (
            <div className="w-full text-red-600 text-xs bg-red-50 border border-red-200 rounded px-3 py-2">
              ❌ {rewriteError}
            </div>
          )}
        </div>

        {/* 標題候選 */}
        {result && result.headlines.length > 0 && (
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs font-bold text-indigo-600 uppercase tracking-wide mb-3">
              標題候選（點選採用）
            </div>
            <div className="space-y-2">
              {result.headlines.map((h, i) => (
                <div key={i} onClick={() => selectHeadline(i)}
                  className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                    pickedHeadline === i
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 hover:border-indigo-300"
                  }`}>
                  <div className="font-semibold text-gray-900">{h}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {h.replace(/[，。、！？⋯：；「」]/g, "").length} 字
                  </div>
                </div>
              ))}
            </div>
            {result.subheadline && (
              <div className="mt-3 text-sm text-gray-500 bg-gray-50 rounded p-2">
                副標：{result.subheadline}
              </div>
            )}
          </div>
        )}

        {/* 標題欄 */}
        <div className="bg-white rounded-lg border p-4">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">標題</label>
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* 左右對照 */}
        <div className={viewMode === "split" ? "grid grid-cols-2 gap-4" : ""}>

          {/* 左：原始抓取內文 */}
          {(viewMode === "split" || viewMode === "original") && (
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="bg-gray-700 text-white text-xs font-bold px-4 py-2 uppercase tracking-wide">
                原始抓取內文
              </div>
              <div className="p-4 max-h-[600px] overflow-y-auto">
                {hasOriginalBody ? (
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {article.original_body}
                  </p>
                ) : (
                  <p className="text-sm text-gray-400 italic">（無原始內文）</p>
                )}
              </div>
            </div>
          )}

          {/* 右：改寫稿 */}
          {(viewMode === "split" || viewMode === "rewritten") && (
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="bg-indigo-700 text-white text-xs font-bold px-4 py-2 uppercase tracking-wide flex items-center justify-between">
                <span>AI 改寫稿（可直接編輯）</span>
                {result && (
                  <span className={`text-xs font-normal px-2 py-0.5 rounded ${factFail ? "bg-red-500" : "bg-green-500"}`}>
                    {factFail ? "⚠ 核對有異" : "✓ 核對通過"}
                  </span>
                )}
              </div>
              <div className="p-4 space-y-3">
                {result?.lead && (
                  <div>
                    <div className="text-xs font-semibold text-gray-400 mb-1">首段</div>
                    <p className="text-sm text-gray-800 leading-relaxed bg-yellow-50 border border-yellow-200 rounded p-2">
                      {result.lead}
                    </p>
                  </div>
                )}
                <div>
                  <div className="text-xs font-semibold text-gray-400 mb-1">內文</div>
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={22}
                    className="w-full border rounded-lg p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                  />
                </div>
                {result?.meta_description && (
                  <div className="text-xs text-gray-500 bg-gray-50 rounded p-2">
                    <span className="font-semibold">Meta：</span>{result.meta_description}
                  </div>
                )}
                {result?.tags && result.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {result.tags.map((t, i) => (
                      <span key={i} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 事實核對表 */}
        {factCheckItems.length > 0 && (
          <div className="bg-white rounded-lg border p-4">
            <FactCheckTable checks={factCheckItems} />
          </div>
        )}

        {/* 底部儲存 */}
        <div className="flex gap-3 pb-10">
          <button onClick={handleSave} disabled={saving}
            className="bg-blue-600 text-white px-8 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
            {saved ? "✓ 已儲存" : saving ? "儲存中..." : "儲存"}
          </button>
          <a href={`/news/${slug}`} target="_blank"
            className="border px-6 py-2 rounded-lg hover:bg-gray-50 text-sm flex items-center">
            預覽文章
          </a>
        </div>
      </div>
    </div>
  );
}
