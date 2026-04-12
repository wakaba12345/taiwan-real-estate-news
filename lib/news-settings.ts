import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export interface NewsCronSettings {
  fetchHoursJst: number[];
  alertEmail: string;
}

export interface NewsFetchLog {
  id: number;
  run_at: string;
  status: "success" | "error";
  articles_saved: number;
  message: string;
}

const DEFAULT_SETTINGS: NewsCronSettings = {
  fetchHoursJst: [9, 18],
  alertEmail: "your-email@gmail.com",
};

export async function initTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS news_cron_settings (
      id              INTEGER PRIMARY KEY,
      fetch_hours_jst INTEGER[] NOT NULL DEFAULT '{9,18}',
      alert_email     TEXT NOT NULL DEFAULT '',
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS news_fetch_log (
      id              SERIAL PRIMARY KEY,
      run_at          TIMESTAMPTZ DEFAULT NOW(),
      status          TEXT NOT NULL,
      articles_saved  INTEGER NOT NULL DEFAULT 0,
      message         TEXT NOT NULL DEFAULT ''
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS news_alert_log (
      id         SERIAL PRIMARY KEY,
      alert_date TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    INSERT INTO news_cron_settings (id, fetch_hours_jst, alert_email)
    VALUES (1, '{9,18}', 'your-email@gmail.com')
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function getSettings(): Promise<NewsCronSettings> {
  const rows = await sql`SELECT * FROM news_cron_settings WHERE id = 1`;
  if (!rows[0]) return DEFAULT_SETTINGS;
  const r = rows[0] as { fetch_hours_jst: number[]; alert_email: string };
  return {
    fetchHoursJst: r.fetch_hours_jst,
    alertEmail: r.alert_email,
  };
}

export async function updateSettings(settings: Partial<NewsCronSettings>) {
  await sql`
    UPDATE news_cron_settings
    SET
      fetch_hours_jst = COALESCE(${settings.fetchHoursJst ?? null}::integer[], fetch_hours_jst),
      alert_email     = COALESCE(${settings.alertEmail ?? null}, alert_email),
      updated_at      = NOW()
    WHERE id = 1
  `;
}

export async function writeFetchLog(
  status: "success" | "error",
  articlesSaved: number,
  message: string
) {
  await sql`
    INSERT INTO news_fetch_log (status, articles_saved, message)
    VALUES (${status}, ${articlesSaved}, ${message})
  `;
}

export async function getFetchLogs(limit = 20): Promise<NewsFetchLog[]> {
  const rows = await sql`
    SELECT * FROM news_fetch_log ORDER BY run_at DESC LIMIT ${limit}
  `;
  return rows as NewsFetchLog[];
}

export async function hasSentAlertToday(today: string): Promise<boolean> {
  const rows = await sql`
    SELECT id FROM news_alert_log WHERE alert_date = ${today} LIMIT 1
  `;
  return rows.length > 0;
}

export async function recordAlertSent(today: string) {
  await sql`
    INSERT INTO news_alert_log (alert_date) VALUES (${today})
  `;
}
