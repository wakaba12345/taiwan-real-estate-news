import { neon } from "@neondatabase/serverless";
import defaultPrompts from "@/lib/news-prompt.json";

const sql = neon(process.env.DATABASE_URL!);

export async function getPrompts(): Promise<typeof defaultPrompts> {
  try {
    const rows = await sql`SELECT key, value FROM news_prompts`;
    if (rows.length === 0) return defaultPrompts;
    const result: Record<string, string> = {};
    for (const r of rows) result[r.key as string] = r.value as string;
    return {
      translate: result.translate ?? defaultPrompts.translate,
      filter: result.filter ?? defaultPrompts.filter,
      article: result.article ?? defaultPrompts.article,
    };
  } catch {
    return defaultPrompts;
  }
}
