import { NextResponse } from "next/server";
import { getAllNews } from "@/lib/news";
import { initNewsDb } from "@/lib/news";

export async function GET() {
  await initNewsDb();
  const articles = await getAllNews(100);
  return NextResponse.json(articles);
}
