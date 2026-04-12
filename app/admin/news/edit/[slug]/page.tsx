"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function EditNewsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/news/${slug}`)
      .then((r) => r.json())
      .then((data) => {
        setTitle(data.title ?? "");
        setBody(data.body ?? "");
        setLoading(false);
      });
  }, [slug]);

  async function save() {
    setSaving(true);
    await fetch(`/api/admin/news/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
    setSaving(false);
    router.push("/admin/news");
  }

  if (loading) return <div className="p-8 text-gray-400">載入中...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-800">
          ← 返回
        </button>
        <h1 className="text-xl font-bold">編輯新聞</h1>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">標題</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">內文（HTML）</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={20}
            className="w-full border rounded-lg p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "儲存中..." : "儲存"}
          </button>
          <a
            href={`/news/${slug}`}
            target="_blank"
            className="border px-6 py-2 rounded-lg hover:bg-gray-50 text-sm"
          >
            預覽文章
          </a>
        </div>
      </div>
    </div>
  );
}
