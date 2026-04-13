import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export interface NewsArticle {
  slug: string;
  title: string;
  original_title: string;
  original_url: string;
  published_at: string;
  fetched_at: string | null;
  source: string;
  cover_image: string | null;
  body: string;
  original_body?: string | null;
  created_at?: string;
}

export async function initNewsDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS news_articles (
      slug         TEXT PRIMARY KEY,
      title        TEXT NOT NULL DEFAULT '',
      original_title TEXT NOT NULL DEFAULT '',
      original_url TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL DEFAULT '',
      fetched_at   TEXT,
      source       TEXT NOT NULL DEFAULT '',
      cover_image  TEXT,
      body         TEXT NOT NULL DEFAULT '',
      original_body TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // 向後相容：已存在的表補欄位
  await sql`ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS original_body TEXT`;

  await sql`
    CREATE TABLE IF NOT EXISTS news_fetch_history (
      url          TEXT PRIMARY KEY,
      fetch_date   TEXT NOT NULL,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

export async function saveNewsArticle(article: Omit<NewsArticle, "created_at">) {
  await sql`
    INSERT INTO news_articles (slug, title, original_title, original_url, published_at, fetched_at, source, cover_image, body, original_body)
    VALUES (
      ${article.slug},
      ${article.title},
      ${article.original_title},
      ${article.original_url},
      ${article.published_at},
      ${article.fetched_at},
      ${article.source},
      ${article.cover_image ?? null},
      ${article.body},
      ${article.original_body ?? null}
    )
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      body = EXCLUDED.body,
      original_body = COALESCE(EXCLUDED.original_body, news_articles.original_body),
      fetched_at = EXCLUDED.fetched_at,
      cover_image = EXCLUDED.cover_image
  `;
}

export async function recordFetchHistory(url: string, fetchDate: string) {
  await sql`
    INSERT INTO news_fetch_history (url, fetch_date)
    VALUES (${url}, ${fetchDate})
    ON CONFLICT (url) DO NOTHING
  `;
}

export async function getSkipUrls(today: string): Promise<Set<string>> {
  const rows = await sql`
    SELECT url FROM news_fetch_history WHERE fetch_date = ${today}
  `;
  const fromArticles = await sql`
    SELECT original_url FROM news_articles WHERE published_at = ${today}
  `;
  const urls = new Set<string>();
  for (const r of rows) urls.add(r.url as string);
  for (const r of fromArticles) urls.add(r.original_url as string);
  return urls;
}

export async function getAllNews(limit = 50): Promise<NewsArticle[]> {
  const rows = await sql`
    SELECT * FROM news_articles
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as NewsArticle[];
}

export async function getNewsArticle(slug: string): Promise<NewsArticle | null> {
  const rows = await sql`
    SELECT * FROM news_articles WHERE slug = ${slug} LIMIT 1
  `;
  return (rows[0] as NewsArticle) ?? null;
}

export async function updateNewsArticle(
  slug: string,
  data: Partial<Pick<NewsArticle, "title" | "body" | "cover_image">>
) {
  await sql`
    UPDATE news_articles
    SET
      title = COALESCE(${data.title ?? null}, title),
      body = COALESCE(${data.body ?? null}, body),
      cover_image = COALESCE(${data.cover_image ?? null}, cover_image)
    WHERE slug = ${slug}
  `;
}

export async function deleteNewsArticle(slug: string) {
  await sql`DELETE FROM news_articles WHERE slug = ${slug}`;
}
