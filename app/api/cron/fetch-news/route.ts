import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import { parse as parseHtml } from "node-html-parser";
import {
  initNewsDb,
  saveNewsArticle,
  recordFetchHistory,
  getSkipUrls,
} from "@/lib/news";
import {
  initTables,
  getSettings,
  writeFetchLog,
  hasSentAlertToday,
  recordAlertSent,
} from "@/lib/news-settings";
import { getPrompts } from "@/lib/get-prompts";

// ─── 設定 ────────────────────────────────────────────────────────────────────

const RSS_URL =
  "https://news.google.com/rss/search?q=%E5%8F%B0%E7%81%A3+%E6%88%BF%E5%9C%B0%E7%94%A2&hl=zh-TW&gl=TW&ceid=TW:zh-Hant";

const GNEWS_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
};

const BLOCKED = [
  "yahoo.com",
  "yahoo.com.tw",
  "yam.com",
  "kimo.com",
  "msn.com",
  "smartnews.com",
];

const MODEL = "claude-haiku-4-5-20251001";

// ─── 型別 ────────────────────────────────────────────────────────────────────

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

// ─── RSS 解析 ─────────────────────────────────────────────────────────────────

async function fetchRss(): Promise<RssItem[]> {
  const res = await fetch(RSS_URL, { headers: GNEWS_HEADERS });
  const xml = await res.text();

  // node-html-parser 把 <link> 當 HTML void element，.text 永遠空白
  // 改用 regex 直接切割 <item>...</item> 區塊再解析
  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];

  return itemBlocks.map((block) => {
    const get = (tag: string) =>
      block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`))?.[1]?.trim() ??
      block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim() ?? "";

    const link = get("link");
    const sourceUrl = block.match(/source url="([^"]+)"/)?.[1] ?? "";
    const source =
      block.match(/<source[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/source>/)?.[1]?.trim() ?? sourceUrl;

    return {
      title: get("title"),
      link,
      pubDate: get("pubDate"),
      source,
    };
  }).filter((it) => it.link.startsWith("http"));
}

function isBlocked(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BLOCKED.some((b) => hostname.includes(b));
  } catch {
    return false;
  }
}

// ─── Google News URL 解碼 (三段 fallback) ────────────────────────────────────

async function resolveUrl(gnewsUrl: string): Promise<string | null> {
  try {
    const base64 = new URL(gnewsUrl).pathname.split("/").pop();
    if (!base64) return null;

    const articleUrl = `https://news.google.com/articles/${base64}`;

    // Method 1: batchexecute API
    try {
      const pageRes = await fetch(articleUrl, {
        headers: GNEWS_HEADERS,
        signal: AbortSignal.timeout(12000),
      });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const root = parseHtml(html);

        let signature: string | null = null;
        let timestamp: string | null = null;
        for (const el of root.querySelectorAll("[data-n-a-sg]")) {
          const sg = el.getAttribute("data-n-a-sg");
          const ts = el.getAttribute("data-n-a-ts");
          if (sg && ts) { signature = sg; timestamp = ts; break; }
        }

        if (signature && timestamp) {
          const payload = [
            "Fbv4je",
            `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${base64}",${timestamp},"${signature}"]`,
          ];
          const reqData = `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`;

          const decodeRes = await fetch(
            "https://news.google.com/_/DotsSplashUi/data/batchexecute",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "User-Agent": GNEWS_HEADERS["User-Agent"] as string,
                "Origin": "https://news.google.com",
                "Referer": "https://news.google.com/",
              },
              body: reqData,
              signal: AbortSignal.timeout(12000),
            }
          );
          if (decodeRes.ok) {
            const text = await decodeRes.text();
            const parts = text.split("\n\n");
            if (parts.length >= 2) {
              const parsed = JSON.parse(parts[1]);
              const inner = JSON.parse(parsed[0][2]);
              const resolved = inner[1] as string | null;
              if (resolved && !resolved.includes("news.google.com")) return resolved;
            }
          }
        }

        // Method 2: canonical or first external link
        const canonical = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1];
        if (canonical && !canonical.includes("news.google.com")) return canonical;

        const externalLink = html.match(/href="(https?:\/\/(?!(?:www\.)?(?:news\.)?google\.com)[^"]+)"/)?.[1];
        if (externalLink) return externalLink;
      }
    } catch {
      // fall through to Method 3
    }

    // Method 3: follow redirect from RSS link
    try {
      const redirectRes = await fetch(gnewsUrl, {
        headers: GNEWS_HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
      const finalUrl = redirectRes.url;
      if (finalUrl && !finalUrl.includes("news.google.com")) return finalUrl;
    } catch {
      // all methods exhausted
    }

    return null;
  } catch {
    return null;
  }
}

// ─── 爬取文章內文 ─────────────────────────────────────────────────────────────

async function fetchArticleText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: GNEWS_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    const html = await res.text();
    const root = parseHtml(html);

    // 移除 script / style / nav / header / footer
    for (const el of root.querySelectorAll("script,style,nav,header,footer,aside")) {
      el.remove();
    }

    const articleEl =
      root.querySelector("article") ??
      root.querySelector('[class*="article"]') ??
      root.querySelector('[class*="content"]') ??
      root.querySelector("main") ??
      root.querySelector("body");

    return (articleEl?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 8000);
  } catch {
    return "";
  }
}

// ─── AI 函式 ──────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function filterNews(items: RssItem[]): Promise<number[]> {
  const prompts = await getPrompts();
  const numbered = items.map((it, i) => `${i + 1}. ${it.title}`).join("\n");
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `${prompts.filter}\n\n新聞列表：\n${numbered}`,
      },
    ],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text : "";
  const match = text.match(/\{[\s\S]*"selected"[\s\S]*\}/);
  if (!match) return [0, 1, 2, 3, 4];
  const parsed = JSON.parse(match[0]) as { selected: number[] };
  return parsed.selected.map((n) => n - 1); // 0-indexed
}

async function translateTitles(
  items: RssItem[]
): Promise<Record<string, string>> {
  const prompts = await getPrompts();
  const titlesJson = JSON.stringify(items.map((it) => it.title));
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `${prompts.translate}\n\n標題列表（JSON 陣列）：\n${titlesJson}`,
      },
    ],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text : "[]";
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return {};

  const arr = JSON.parse(match[0]) as { original: string; translated: string }[];
  return Object.fromEntries(arr.map((x) => [x.original, x.translated]));
}

async function translateArticle(
  originalTitle: string,
  originalUrl: string,
  articleText: string
): Promise<{ title: string; body: string } | null> {
  try {
    const prompts = await getPrompts();
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `${prompts.article}\n\n原文標題：${originalTitle}\n原文網址：${originalUrl}\n\n原文內容：\n${articleText}`,
        },
      ],
    });

    const text = msg.content[0].type === "text" ? msg.content[0].text : "";
    const match = text.match(/\{[\s\S]*"title"[\s\S]*"body"[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as { title: string; body: string };
  } catch {
    return null;
  }
}

// ─── Slug 生成 ────────────────────────────────────────────────────────────────

function makeSlug(title: string, date: string): string {
  const dateStr = date.replace(/-/g, "").slice(0, 8);
  const hash = Buffer.from(title).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  return `${dateStr}-${hash}`.toLowerCase();
}

// ─── Email ────────────────────────────────────────────────────────────────────

async function sendSummaryEmail(
  to: string,
  saved: { title: string; slug: string }[],
  domain: string
) {
  const resend = new Resend(process.env.RESEND_API_KEY!);
  const list = saved
    .map((a) => `<li><a href="https://${domain}/news/${a.slug}">${a.title}</a></li>`)
    .join("");

  await resend.emails.send({
    from: `台灣房地產新聞 <noreply@${domain}>`,
    to,
    subject: `今日新聞已更新（${saved.length} 篇）`,
    html: `<h2>今日台灣房地產新聞</h2><ul>${list}</ul><p><a href="https://${domain}/admin/news">前往後台管理</a></p>`,
  });
}

async function sendAlertEmail(to: string, error: string, domain: string) {
  const resend = new Resend(process.env.RESEND_API_KEY!);
  await resend.emails.send({
    from: `台灣房地產新聞 <noreply@${domain}>`,
    to,
    subject: "【警告】新聞抓取失敗",
    html: `<p>新聞抓取發生錯誤：</p><pre>${error}</pre><p><a href="https://${domain}/admin/news">前往後台查看</a></p>`,
  });
}

// ─── 主要邏輯 ─────────────────────────────────────────────────────────────────

async function runFetchNews() {
  await initNewsDb();
  await initTables();

  const settings = await getSettings();
  const today = new Date().toISOString().slice(0, 10);
  const skipUrls = await getSkipUrls(today);
  const domain = process.env.NEXT_PUBLIC_DOMAIN ?? "localhost:3000";
  const debugLog: string[] = [];
  const log = (msg: string) => { console.log(msg); debugLog.push(msg); };

  // 1. 抓 RSS
  const allItems = await fetchRss();
  log(`RSS: ${allItems.length} 篇`);

  // 2. 過濾聚合器
  const filtered = allItems.filter((it) => !isBlocked(it.link));
  log(`過濾後: ${filtered.length} 篇`);

  // 3. 去重
  const deduped = filtered.filter((it) => !skipUrls.has(it.link));
  log(`去重後: ${deduped.length} 篇`);

  if (deduped.length === 0) {
    await writeFetchLog("success", 0, "無新文章");
    return { saved: 0, articles: [], debug: debugLog };
  }

  // 4. AI 篩選
  const topIndexes = await filterNews(deduped.slice(0, 30));
  log(`AI篩選索引: ${JSON.stringify(topIndexes)}`);
  const topItems = topIndexes
    .map((i) => deduped[i])
    .filter(Boolean)
    .slice(0, 5);
  log(`選出: ${topItems.length} 篇 [${topItems.map(t => t.title.slice(0, 20)).join(" | ")}]`);

  // 5. 翻譯標題（批量）
  const translations = await translateTitles(topItems);

  // 6. 逐篇處理
  const saved: { title: string; slug: string }[] = [];

  for (const item of topItems) {
    try {
      // resolveUrl
      const realUrl = await resolveUrl(item.link);
      if (!realUrl) { log(`跳過(無法解碼URL): ${item.title.slice(0,30)}`); continue; }
      log(`resolveUrl: ${realUrl.slice(0, 80)}`);
      if (skipUrls.has(realUrl)) { log("跳過(已抓)"); continue; }

      // 爬取內文
      const articleText = await fetchArticleText(realUrl);
      log(`內文長度: ${articleText.length}`);
      if (articleText.length < 100) { log("跳過(內文太短)"); continue; }

      // AI 改寫
      const result = await translateArticle(item.title, realUrl, articleText);
      log(`AI改寫: ${result ? result.title.slice(0, 30) : "失敗(null)"}`);
      if (!result) continue;

      const pubDate = today;
      const slug = makeSlug(result.title, pubDate);

      await saveNewsArticle({
        slug,
        title: result.title,
        original_title: item.title,
        original_url: realUrl,
        published_at: pubDate,
        fetched_at: new Date().toISOString(),
        source: item.source,
        cover_image: null,
        body: result.body,
      });

      await recordFetchHistory(item.link, today);
      if (realUrl !== item.link) await recordFetchHistory(realUrl, today);

      saved.push({ title: result.title, slug });
    } catch (err) {
      console.error("處理文章失敗:", item.title, err);
    }
  }

  // 7. 寄 email
  if (saved.length > 0 && settings.alertEmail) {
    await sendSummaryEmail(settings.alertEmail, saved, domain);
  }

  log(`完成，儲存 ${saved.length} 篇`);
  await writeFetchLog("success", saved.length, `已儲存 ${saved.length} 篇`);
  return { saved: saved.length, articles: saved, debug: debugLog };
}

// ─── Route handlers ───────────────────────────────────────────────────────────

function verifySecret(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  return !secret || auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifySecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runFetchNews();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("fetch-news error:", msg);

    try {
      await initTables();
      const settings = await getSettings();
      const today = new Date().toISOString().slice(0, 10);
      const domain = process.env.NEXT_PUBLIC_DOMAIN ?? "localhost:3000";
      await writeFetchLog("error", 0, msg);

      const alreadySent = await hasSentAlertToday(today);
      if (!alreadySent && settings.alertEmail) {
        await sendAlertEmail(settings.alertEmail, msg, domain);
        await recordAlertSent(today);
      }
    } catch {
      // ignore secondary errors
    }

    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// 後台手動觸發（不需要 token，由後台 UI 呼叫）
export async function POST(_req: NextRequest) {
  try {
    const result = await runFetchNews();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
