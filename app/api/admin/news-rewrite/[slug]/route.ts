import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { neon } from "@neondatabase/serverless";
import { getNewsArticle, updateNewsArticle, initNewsDb } from "@/lib/news";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = "claude-haiku-4-5-20251001";
const sql = neon(process.env.DATABASE_URL!);

export const DEFAULT_REWRITE_PROMPT = `你是風傳媒的房地產線資深編輯，專門改寫來自各媒體的房地產新聞，讓它變成更易讀、更有深度的報導。

## 改寫原則

### 標題（最重要）
- 吸睛、讓讀者想點進來看
- 不超過30字（含標點）
- 包含核心 SEO 關鍵字（如：房價、預售屋、地段、坪數等）
- 不可聳動造謠，但要讓讀者覺得「跟我有關」

### 首段
- 場景開頭或驚人事實開頭
- 80～120字
- 讓讀者想繼續看

### 段落結構
- 每 2～3 段加一個 <h2> 小標
- 每個 <p> 段落不超過 4 行
- 小標要能獨立閱讀就懂主題
- 段落之間必須用 </p><p> 分隔，不可連成一大段

### SEO
- 自然嵌入房地產關鍵字
- 文末提供 meta description（120字內）
- 提供 3～5 個推薦標籤

## 絕對禁止
- 不可新增原文沒有的數字、案例、統計資料
- 不可更改人名、機構名、地址、價格、坪數、日期等任何數字
- 不可自行補充任何房地產知識或市場分析
- 不可捏造任何人沒說過的話

## 輸出格式（嚴格遵守此 JSON，不要任何 markdown 或反引號）

{
  "headlines": ["標題候選1", "標題候選2", "標題候選3"],
  "subheadline": "副標（一句話補充）",
  "lead": "改寫後首段（80-120字）",
  "body": "完整改寫內文（HTML格式，使用 <h2> 作小標、<p> 作段落，每段不超過4行，<strong> 加粗重點）",
  "meta_description": "SEO meta description（120字內）",
  "tags": ["標籤1", "標籤2", "標籤3"],
  "fact_check": [
    {"item": "核對項目說明", "original": "原文中的文字", "rewritten": "改寫稿中對應文字", "match": true}
  ]
}

fact_check 必須涵蓋原文中所有：人名、機構／建商名稱、地址／地段、價格／坪數／任何數字、日期、政策名稱。逐一比對確認改寫稿沒有變動或新增。`;

async function getRewritePrompt(): Promise<string> {
  try {
    const rows = await sql`SELECT value FROM news_prompts WHERE key = 'rewrite'`;
    if (rows[0]?.value) return rows[0].value as string;
  } catch {}
  return DEFAULT_REWRITE_PROMPT;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  await initNewsDb();

  const article = await getNewsArticle(slug);
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const originalBody = article.original_body;
  if (!originalBody || originalBody.length < 50) {
    return NextResponse.json({ error: "原始內文不存在，無法重新改寫（此文章在功能上線前已抓取）" }, { status: 400 });
  }

  try {
    const prompt = await getRewritePrompt();
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `${prompt}\n\n原文標題：${article.original_title}\n原文來源：${article.source}\n原文網址：${article.original_url}\n\n原文內容：\n${originalBody}`,
        },
      ],
    });

    const raw = msg.content[0].type === "text" ? msg.content[0].text : "";
    let parsed: Record<string, unknown>;
    try {
      let s = raw.trim();
      if (s.startsWith("```")) s = s.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      const match = s.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("no JSON found");
      parsed = JSON.parse(match[0]);
    } catch {
      return NextResponse.json({ error: "AI 回應格式錯誤", raw }, { status: 500 });
    }

    return NextResponse.json({ ok: true, result: parsed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// 儲存選定的改寫結果
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { title, body } = await req.json();
  await initNewsDb();
  await updateNewsArticle(slug, { title, body });
  return NextResponse.json({ ok: true });
}
