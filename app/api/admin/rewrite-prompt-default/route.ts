import { NextResponse } from "next/server";
import { DEFAULT_REWRITE_PROMPT } from "@/app/api/admin/news-rewrite/[slug]/route";

export async function GET() {
  return NextResponse.json({ prompt: DEFAULT_REWRITE_PROMPT });
}
