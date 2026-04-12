import { NextRequest, NextResponse } from "next/server";
import { getNewsArticle, updateNewsArticle, deleteNewsArticle } from "@/lib/news";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const article = await getNewsArticle(slug);
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(article);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const data = await req.json();
  await updateNewsArticle(slug, data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  await deleteNewsArticle(slug);
  return NextResponse.json({ ok: true });
}
