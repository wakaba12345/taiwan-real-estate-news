import { NextResponse } from "next/server";
import { DEFAULT_REWRITE_PROMPT } from "@/lib/rewrite-prompt";

export async function GET() {
  return NextResponse.json({ prompt: DEFAULT_REWRITE_PROMPT });
}
