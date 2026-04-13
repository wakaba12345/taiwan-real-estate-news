import { NextRequest, NextResponse } from "next/server";

// 讓 Vercel 在 Pro/Fluid 計畫下可執行最長 300 秒
export const maxDuration = 300;
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

// 多個關鍵字 RSS 來源：涵蓋房地產各面向
const RSS_URLS = [
  // 房地產 / 房市
  "https://news.google.com/rss/search?q=%E5%8F%B0%E7%81%A3+%E6%88%BF%E5%9C%B0%E7%94%A2&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
  // 房價
  "https://news.google.com/rss/search?q=%E5%8F%B0%E7%81%A3+%E6%88%BF%E5%83%B7&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
  // 買房 / 購屋
  "https://news.google.com/rss/search?q=%E5%8F%B0%E7%81%A3+%E8%B3%BC%E5%B1%8B&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
  // 租屋 / 租金
  "https://news.google.com/rss/search?q=%E5%8F%B0%E7%81%A3+%E7%A7%9F%E5%B1%8B&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
  // 預售屋
  "https://news.google.com/rss/search?q=%E9%A0%90%E5%94%AE%E5%B1%8B&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
  // 囤房稅 / 房地合一
  "https://news.google.com/rss/search?q=%E5%9B%A4%E6%88%BF%E7%A8%85+OR+%E6%88%BF%E5%9C%B0%E5%90%88%E4%B8%80&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
  // 建商 / 建案
  "https://news.google.com/rss/search?q=%E5%8F%B0%E7%81%A3+%E5%BB%BA%E5%95%86+%E5%BB%BA%E6%A1%88&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
  // 土地
  "https://news.google.com/rss/search?q=%E5%8F%B0%E7%81%A3+%E5%9C%B0%E5%83%B7+%E5%9C%B0%E6%AE%B5&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
];

const GNEWS_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
};

const BLOCKED = [
  "udn.com",                  // 聯合報 / 經濟日報（含 house.udn.com / money.udn.com）
  "ctee.com.tw",              // 工商時報（反爬蟲封鎖）
  "twhg.com.tw",              // 台灣好省（JS 渲染，永遠 33 字）
  "farglory-realty.com.tw",   // 遠雄房地產（JS 渲染，永遠 44 字）
  "businessweekly.com.tw",    // 商業周刊（JS 渲染，永遠 28 字）
  "cw.com.tw",                // 天下雜誌（JS 渲染，0 字）
  "tw.stock.yahoo.com",       // Yahoo 股市（JS 渲染，2 字）
  "yam.com",
  "kimo.com",
  "msn.com",
  "smartnews.com",
];

const MODEL = "claude-haiku-4-5-20251001";

// 每次最多處理幾篇（避免 Vercel 504）
// 每篇最多 ~25s（resolve+爬文+AI），8篇 ≈ 200s < 300s maxDuration
const MAX_PER_RUN = 8;

// ─── 型別 ────────────────────────────────────────────────────────────────────

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  description?: string;
}

// ─── RSS 解析 ─────────────────────────────────────────────────────────────────

function parseRssXml(xml: string): RssItem[] {
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

async function fetchRss(): Promise<RssItem[]> {
  const results = await Promise.allSettled(
    RSS_URLS.map((url) =>
      fetch(url, { headers: GNEWS_HEADERS }).then((r) => r.text()).then(parseRssXml)
    )
  );

  const all: RssItem[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const item of r.value) {
        if (!seen.has(item.link)) {
          seen.add(item.link);
          all.push(item);
        }
      }
    }
  }
  return all;
}

function isBlocked(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BLOCKED.some((b) => hostname.includes(b));
  } catch {
    return false;
  }
}

// ─── Google News URL 解碼 ─────────────────────────────────────────────────────

// Google 同意 cookie，略過 GDPR 同意頁
const GNEWS_COOKIES = "CONSENT=YES+cb.20230629-07-p1.zh-TW+FX+119; SOCS=CAESEwgDEgk0MDc3MDEQ2A==";

function isExternalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return !h.includes("google.com") && !h.includes("gstatic.com") && !h.includes("googleapis.com");
  } catch { return false; }
}

// 遞迴掃描 JSON 結構，找第一個非 Google 的 http URL
function scanForUrl(obj: unknown): string | null {
  if (typeof obj === "string" && obj.startsWith("http") && isExternalUrl(obj)) return obj;
  if (Array.isArray(obj)) {
    for (const x of obj) { const r = scanForUrl(x); if (r) return r; }
  }
  return null;
}

async function resolveUrl(gnewsUrl: string, log?: (msg: string) => void): Promise<string | null> {
  const dbg = (msg: string) => { console.log("[resolve]", msg); log?.(`  [resolve] ${msg}`); };

  try {
    const base64 = new URL(gnewsUrl).pathname.split("/").pop();
    if (!base64) { dbg("no base64"); return null; }
    dbg(`id: ${base64.slice(0, 24)}…`);

    const articleUrl = `https://news.google.com/articles/${base64}`;
    const commonHeaders = {
      ...GNEWS_HEADERS,
      "Cookie": GNEWS_COOKIES,
    };

    // ── Method 1: batchexecute ──────────────────────────────────────────────
    try {
      const pageRes = await fetch(articleUrl, {
        headers: commonHeaders,
        signal: AbortSignal.timeout(8000),
      });
      dbg(`page ${pageRes.status}`);

      if (pageRes.ok) {
        const html = await pageRes.text();
        dbg(`html ${html.length} chars`);

        // regex 抓 signature / timestamp（比 querySelectorAll 更可靠）
        const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
        const timestamp  = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
        dbg(`sig=${signature ? "✓" : "✗"} ts=${timestamp ? "✓" : "✗"}`);

        if (signature && timestamp) {
          const payload = [
            "Fbv4je",
            `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${base64}",${timestamp},"${signature}"]`,
          ];
          const reqData = `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`;

          const batchRes = await fetch(
            "https://news.google.com/_/DotsSplashUi/data/batchexecute",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "User-Agent": GNEWS_HEADERS["User-Agent"],
                "Origin": "https://news.google.com",
                "Referer": articleUrl,
                "Cookie": GNEWS_COOKIES,
              },
              body: reqData,
              signal: AbortSignal.timeout(8000),
            }
          );
          dbg(`batch ${batchRes.status}`);

          if (batchRes.ok) {
            const text = await batchRes.text();
            dbg(`batch body ${text.length} chars: ${text.slice(0, 80).replace(/\n/g, "\\n")}`);

            // 嘗試解析每段 JSON（Google 回應格式：")]}'\n\n[...]"）
            for (const part of text.split("\n\n")) {
              try {
                const parsed = JSON.parse(part);
                if (!Array.isArray(parsed)) continue;
                for (const item of parsed) {
                  if (!Array.isArray(item) || typeof item[2] !== "string") continue;
                  try {
                    const inner = JSON.parse(item[2]);
                    const found = scanForUrl(inner);
                    if (found) { dbg(`batch ok: ${found.slice(0, 60)}`); return found; }
                  } catch { /* continue */ }
                }
              } catch { /* continue */ }
            }
            dbg("batch: no URL in response");
          }
        }

        // ── Method 2: HTML 掃描 ──────────────────────────────────────────────
        // canonical link
        const canonical =
          html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ??
          html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1];
        if (canonical && isExternalUrl(canonical)) { dbg(`canonical: ${canonical.slice(0, 60)}`); return canonical; }

        // data-url attribute
        const dataUrl = html.match(/data-url="(https?:\/\/[^"]+)"/)?.[1];
        if (dataUrl && isExternalUrl(dataUrl)) { dbg(`data-url: ${dataUrl.slice(0, 60)}`); return dataUrl; }

        // 找所有 href 外部連結
        for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
          if (isExternalUrl(m[1])) { dbg(`href: ${m[1].slice(0, 60)}`); return m[1]; }
        }
        dbg("no URL in HTML");
      }
    } catch (e) {
      dbg(`method1 err: ${e}`);
    }

    // ── Method 3: HTTP redirect (manual → follow) ───────────────────────────
    try {
      // 先看 Location header
      const manualRes = await fetch(gnewsUrl, {
        headers: commonHeaders,
        redirect: "manual",
        signal: AbortSignal.timeout(7000),
      });
      const loc = manualRes.headers.get("location");
      dbg(`manual redirect: ${loc ?? "none"}`);
      if (loc && isExternalUrl(loc)) return loc;

      // 再 follow redirect
      const followRes = await fetch(gnewsUrl, {
        headers: commonHeaders,
        redirect: "follow",
        signal: AbortSignal.timeout(7000),
      });
      dbg(`follow redirect: ${followRes.url.slice(0, 60)}`);
      if (isExternalUrl(followRes.url)) return followRes.url;
    } catch (e) {
      dbg(`method3 err: ${e}`);
    }

    dbg("all methods failed");
    return null;
  } catch (e) {
    console.error("resolveUrl fatal:", e);
    return null;
  }
}

// ─── 爬取文章內文 ─────────────────────────────────────────────────────────────

async function fetchArticleText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: GNEWS_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const root = parseHtml(html);

    // 移除所有非內容元素（含 noscript 追蹤 pixel）
    const junkSelectors = [
      "script", "style", "noscript", "iframe", "frame",
      "nav", "header", "footer", "aside",
      "figure", "form", "button", "input", "select", "textarea",
      '[class*="ad-"]', '[class*="-ad"]', '[id*="google_ad"]',
      '[class*="track"]', '[class*="pixel"]', '[class*="analytics"]',
      '[class*="social"]', '[class*="share"]', '[class*="comment"]',
      '[class*="relat"]', '[class*="recommend"]', '[class*="sidebar"]',
      '[class*="banner"]', '[class*="popup"]', '[class*="cookie"]',
      '[class*="newsletter"]', '[class*="subscribe"]', '[class*="modal"]',
    ];
    for (const sel of junkSelectors) {
      try {
        for (const el of root.querySelectorAll(sel)) el.remove();
      } catch { /* 部分 selector 不支援，跳過 */ }
    }

    // 找主要內容區（優先順序：article → 各種 content class → main → body）
    const articleEl =
      root.querySelector("article") ??
      root.querySelector('[class*="article-body"]') ??
      root.querySelector('[class*="article-content"]') ??
      root.querySelector('[class*="post-content"]') ??
      root.querySelector('[class*="entry-content"]') ??
      root.querySelector('[class*="news-content"]') ??
      root.querySelector('[class*="story-body"]') ??
      root.querySelector('[class*="article"]') ??
      root.querySelector("main") ??
      root.querySelector('[role="main"]') ??
      root.querySelector("body");

    // 逐段落抽取：只取 p / h1~h4，過濾雜訊短行
    const paragraphs: string[] = [];
    for (const p of articleEl?.querySelectorAll("p,h1,h2,h3,h4") ?? []) {
      const t = p.text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (t.length < 12) continue;
      if (/^https?:\/\//i.test(t)) continue; // 純網址行
      paragraphs.push(t);
    }

    let result: string;
    if (paragraphs.length >= 3) {
      result = paragraphs.join("\n\n");
    } else {
      // fallback：直接取 text，並清掉殘留 HTML tag 字串
      result = (articleEl?.text ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    return result.slice(0, 8000);
  } catch {
    return "";
  }
}

// ─── AI 函式 ──────────────────────────────────────────────────────────────────

// 在函數內建立，避免 env var 未設定時造成模組初始化錯誤
function getAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY 環境變數未設定");
  return new Anthropic({ apiKey: key });
}

async function filterNews(items: RssItem[]): Promise<number[]> {
  const prompts = await getPrompts();
  const numbered = items.map((it, i) => `${i + 1}. ${it.title}`).join("\n");
  const msg = await getAnthropic().messages.create({
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
  const msg = await getAnthropic().messages.create({
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
    const msg = await getAnthropic().messages.create({
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

async function runFetchNews(limit = MAX_PER_RUN) {
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

  // 4. 全部掃，只留成功的
  const candidates = deduped;
  log(`候選 ${candidates.length} 篇（全部掃，只儲存有全文的）`);

  // 5. 逐篇處理
  const saved: { title: string; slug: string }[] = [];

  for (const item of candidates) {
    try {
      // resolveUrl
      const realUrl = await resolveUrl(item.link, log);
      log(`resolveUrl: ${realUrl ? realUrl.slice(0, 80) : "失敗"}`);
      if (!realUrl) { log("跳過(無法解碼URL)"); continue; }
      if (isBlocked(realUrl)) {
        log(`跳過(解碼後封鎖域名): ${realUrl.slice(0, 60)}`);
        continue;
      }
      if (skipUrls.has(realUrl)) { log("跳過(已抓)"); continue; }

      // 爬取全文（沒有全文就跳過）
      const articleText = await fetchArticleText(realUrl);
      log(`內文長度: ${articleText.length}`);
      if (articleText.length < 100) { log("跳過(內文太短，可能有防爬蟲)"); continue; }

      const finalUrl = realUrl;

      // AI 改寫
      const result = await translateArticle(item.title, finalUrl, articleText);
      log(`AI改寫: ${result ? result.title.slice(0, 30) : "失敗(null)"}`);
      if (!result) continue;

      const pubDate = today;
      const slug = makeSlug(result.title, pubDate);

      await saveNewsArticle({
        slug,
        title: result.title,
        original_title: item.title,
        original_url: finalUrl,
        published_at: pubDate,
        fetched_at: new Date().toISOString(),
        source: item.source,
        cover_image: null,
        body: result.body,
        original_body: articleText,
      });

      await recordFetchHistory(item.link, today);
      if (finalUrl !== item.link) await recordFetchHistory(finalUrl, today);

      saved.push({ title: result.title, slug });
    } catch (err) {
      console.error("處理文章失敗:", item.title, err);
    }
  }

  // 7. 寄 email（暫時停用）
  // if (saved.length > 0 && settings.alertEmail) {
  //   try { await sendSummaryEmail(settings.alertEmail, saved, domain); } catch (e) {
  //     log(`Email 寄送失敗（不影響結果）：${e}`);
  //   }
  // }

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
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = typeof body.limit === "number" ? body.limit : MAX_PER_RUN;
    const result = await runFetchNews(limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
