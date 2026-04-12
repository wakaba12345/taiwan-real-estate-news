import { NextRequest, NextResponse } from "next/server";
import { getSettings, updateSettings, getFetchLogs, initTables } from "@/lib/news-settings";

export async function GET() {
  await initTables();
  const [settings, logs] = await Promise.all([getSettings(), getFetchLogs(20)]);
  return NextResponse.json({ settings, logs });
}

export async function PATCH(req: NextRequest) {
  const data = await req.json();
  await updateSettings(data);
  return NextResponse.json({ ok: true });
}
