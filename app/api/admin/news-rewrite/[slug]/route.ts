import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { neon } from "@neondatabase/serverless";
import { getNewsArticle, updateNewsArticle, initNewsDb } from "@/lib/news";
import { DEFAULT_REWRITE_PROMPT } from "@/lib/rewrite-prompt";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = "claude-haiku-4-5-20251001";
const sql = neon(process.env.DATABASE_URL!);

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
