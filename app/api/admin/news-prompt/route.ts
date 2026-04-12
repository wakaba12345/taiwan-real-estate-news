import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function initPromptsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS news_prompts (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

export async function GET() {
  await initPromptsTable();
  const rows = await sql`SELECT key, value FROM news_prompts`;
  if (rows.length === 0) {
    // 回傳預設值（從靜態 JSON 讀取）
    const defaults = await import("@/lib/news-prompt.json");
    return NextResponse.json(defaults);
  }
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key as string] = r.value as string;
  return NextResponse.json(result);
}

export async function PATCH(req: NextRequest) {
  await initPromptsTable();
  const data = await req.json() as Record<string, string>;
  for (const [key, value] of Object.entries(data)) {
    await sql`
      INSERT INTO news_prompts (key, value)
      VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;
  }
  return NextResponse.json({ ok: true });
}
