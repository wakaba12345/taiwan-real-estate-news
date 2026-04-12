import { getNewsArticle, getAllNews } from "@/lib/news";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getNewsArticle(slug);
  if (!article) return {};
  return {
    title: `${article.title} | 台灣房地產新聞`,
    description: article.original_title,
  };
}

export default async function NewsArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = await getNewsArticle(slug);
  if (!article) notFound();

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <nav className="mb-6">
        <Link href="/news" className="text-sm text-blue-600 hover:underline">
          ← 返回新聞列表
        </Link>
      </nav>

      <article>
        <h1 className="text-2xl font-bold leading-tight mb-4">{article.title}</h1>

        <div className="flex items-center gap-3 text-xs text-gray-400 mb-8 pb-6 border-b">
          <span>{article.source}</span>
          <span>·</span>
          <span>{article.published_at}</span>
        </div>

        <div
          className="prose prose-gray max-w-none text-[15px] leading-relaxed
            [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2
            [&_p]:mb-4 [&_ul]:pl-5 [&_ul]:list-disc [&_li]:mb-1"
          dangerouslySetInnerHTML={{ __html: article.body }}
        />
      </article>
    </div>
  );
}
