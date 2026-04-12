# 自動新聞抓取系統 — 移植藍圖

此文件說明如何在新的 Next.js 專案中，複製一套「自動抓取 Google News → AI 篩選 → AI 改寫 → 存 Neon DB」的新聞系統。  
原始專案：`japanlive-v2`（日本不動產）。  
新專案目標：**台灣房地產新聞**，讀者為對台灣房市有興趣的人。

---

## 系統架構總覽

```
Vercel Cron (每天定時)
  └─ GET /api/cron/fetch-news
        │
        ├─ 1. 抓 Google News RSS → 解析成 RssItem[]
        ├─ 2. 過濾聚合器網站（Yahoo、MSN 等）
        ├─ 3. Claude Haiku：從標題列表篩選 5 則最重要的
        ├─ 4. 對每則新聞：resolveUrl() 解碼 Google News 短網址
        ├─ 5. fetchArticleText() 爬取原文內文
        ├─ 6. Claude Haiku：批量翻譯標題
        ├─ 7. Claude Haiku：改寫成繁體中文報導（HTML）
        ├─ 8. 存入 Neon DB（news_articles 表）
        └─ 9. 寄送摘要 email（Resend）
```

管理員也可在後台手動觸發（POST /api/cron/fetch-news）。

---

## 需要的環境變數

```
DATABASE_URL          # Neon Postgres 連線字串
ANTHROPIC_API_KEY     # Claude API
RESEND_API_KEY        # 寄信用（成功/失敗通知）
CRON_SECRET           # Vercel cron 呼叫的 Bearer token
```

---

## 需要的 npm 套件

```bash
npm install @neondatabase/serverless @anthropic-ai/sdk resend node-html-parser
```

---

## 第一步：修改 RSS 來源

**原始（日本不動產）：**
```
https://news.google.com/rss/search?q=%E4%B8%8D%E5%8B%95%E7%94%A3&hl=ja&gl=JP&ceid=JP:ja
```

**新的（台灣房地產）：**
```
https://news.google.com/rss/search?q=%E5%8F%B0%E7%81%A3+%E6%88%BF%E5%9C%B0%E7%94%A2&hl=zh-TW&gl=TW&ceid=TW:zh-Hant
```
> 搜尋關鍵字為「台灣 房地產」，可依需求調整，例如加上「房價」「買房」「租屋」等。  
> 多個關鍵字用 `+` 連接，中文要 URL encode。

---

## 第二步：建立資料庫 lib（`lib/news.ts`）

直接複製原始碼，不需要改動。這個檔案負責：
- 自動建立 `news_articles` 和 `news_fetch_history` 兩張資料表
- CRUD：`saveNewsArticle`, `getAllNews`, `getNewsArticle`, `deleteNewsArticle` 等
- 去重：`getSkipUrls(today)` 回傳今天已處理過的 URL 集合

**資料表結構（自動建立，不需手動 migration）：**
```sql
CREATE TABLE IF NOT EXISTS news_articles (
  slug         TEXT PRIMARY KEY,
  title        TEXT NOT NULL DEFAULT '',
  original_title TEXT NOT NULL DEFAULT '',
  original_url TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT '',
  fetched_at   TEXT,
  source       TEXT NOT NULL DEFAULT '',
  cover_image  TEXT,
  body         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS news_fetch_history (
  url          TEXT PRIMARY KEY,
  fetch_date   TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 第三步：建立 cron 設定 lib（`lib/news-settings.ts`）

直接複製原始碼，修改下列預設值：

```ts
// 改成你的 email
const DEFAULT_SETTINGS: NewsCronSettings = {
  fetchHoursJst: [9, 18],   // 台灣時間與 JST 相同（UTC+8 = UTC+9 -1hr），可自訂
  alertEmail: "你的email@gmail.com",
};

// initTables() 裡的 INSERT 也要同步修改 email
await sql`
  INSERT INTO news_cron_settings (id, fetch_hours_jst, alert_email)
  VALUES (1, '{9,18}', '你的email@gmail.com')
  ON CONFLICT (id) DO NOTHING
`;
```

這個 lib 負責：
- `news_cron_settings`：排程設定（可從後台 UI 調整）
- `news_fetch_log`：每次執行記錄
- `news_alert_log`：避免重複寄 alert email

---

## 第四步：建立 AI 提示詞（`lib/news-prompt.json`）

以下是針對**台灣房地產新聞**調整後的提示詞，直接建立此檔案：

```json
{
  "translate": "你是專業的翻譯，專精台灣房地產領域。請將以下新聞標題翻譯成繁體中文（若原文已是中文則直接回傳）。\n\n翻譯規則：\n1. 保持房地產專業術語準確（如：容積率、地坪、建坪、預售屋、實坪）\n2. 簡潔有力，適合台灣讀者閱讀\n3. 要是自然的台灣中文\n\n請以 JSON 陣列格式回覆：\n[{\"original\":\"原標題\",\"translated\":\"中文翻譯\"}]",

  "filter": "你是一位專精台灣房地產市場的編輯，目標讀者是「持有或考慮購買台灣不動產的人」。\n\n請從以下新聞標題中，挑選出最重要、最值得關注的 5 則新聞。\n\n篩選標準（優先順序）：\n1. 房價趨勢、市場走向（六都、熱門區域）\n2. 政策變動、稅制（房地合一、囤房稅、信用管制）\n3. 利率、貸款、打房措施\n4. 租賃市場動態（租金走勢、包租代管）\n5. 重大開發案、都市計畫、捷運效應\n6. 具警示或教育價值的個案（糾紛、詐騙、法拍）\n\n排除：\n- 與房地產完全無關的社會新聞\n- 廣告、廣編稿（標題含「PR」「廣告」「贊助」或明顯推銷）\n\n請回覆被選中的新聞編號（從1開始），以 JSON 格式：\n{\"selected\":[1,3,5,7,8]}",

  "article": "你是一位資深的台灣房地產財經媒體編輯。目標讀者是關心台灣房市的一般民眾和投資者。\n\n請根據以下新聞原文，以「改寫式編譯」撰寫一篇繁體中文報導，風格參考台灣財經媒體（如商周、經濟日報、住展）。\n\n撰寫規則：\n1. 標題重新下，要吸引台灣讀者，不要直譯原標題\n2. 內文用自然的繁體中文改寫，要像台灣記者寫的稿，不要生硬\n3. 保留所有關鍵數據（金額、百分比、日期、地名、坪數）\n4. 專業術語使用台灣慣用說法\n5. 要很專業、只講確定的事實，不要說教\n6. 文末保留原文資訊，格式為：<p class=\"text-xs text-gray-400 mt-6\">參考資料來源：<a href=\"{originalUrl}\" target=\"_blank\" rel=\"noopener noreferrer\">{originalTitle}</a></p>\n7. 文章用 HTML 格式，使用 <h2>、<p>、<ul><li> 等標籤\n8. 文章長度不要超過1200字，簡潔但完整\n9. 語氣專業、精準、不囉唆，但一定要容易懂\n10. 不要有翻譯味和AI味，「禁止使用破折號--」，也不要「不是...而是」「儘管...」的句型\n\n請嚴格以 JSON 格式回覆：\n{\"title\":\"重新下的中文標題\",\"body\":\"<h2>小標題</h2><p>內容...</p><p class=\\\"text-xs text-gray-400 mt-6\\\">資料來源：<a href=\\\"{url}\\\" target=\\\"_blank\\\">原文標題</a></p>\"}"
}
```

---

## 第五步：建立 cron route（`app/api/cron/fetch-news/route.ts`）

複製原始 `app/api/cron/fetch-news/route.ts`，需要修改的地方：

### 5-1. RSS_URL（第一步已說明）
```ts
const RSS_URL =
  "https://news.google.com/rss/search?q=%E5%8F%B0%E7%81%A3+%E6%88%BF%E5%9C%B0%E7%94%A2&hl=zh-TW&gl=TW&ceid=TW:zh-Hant";
```

### 5-2. GNEWS_HEADERS 的 Accept-Language
```ts
const GNEWS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...",
  "Accept": "text/html,application/xhtml+xml",
  "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",   // 改成中文優先
};
```

### 5-3. BLOCKED 聚合器清單（台灣版）
```ts
const BLOCKED = [
  "yahoo", "yahoo.com.tw", "yam.com", "kimo",
  "msn", "msn.com",
  "udn.com/news/plus",   // 付費牆（可選）
  "smartnews", "antenna",
];
```
> 注意：udn、聯合、中時、蘋果、自由等主流媒體**不要**擋，他們有完整內文。

### 5-4. 去重的 key（title 重複偵測）
台灣新聞標題多為中文，原本的 regex 已適用：
```ts
const key = item.title
  .replace(/[\s\u3000、。！？・「」『』（）\-–—:：]/g, "")
  .slice(0, 30);
```

### 5-5. Email 寄件人與後台連結（全文搜尋 `japanlive.info` 替換成你的網域）
```ts
from: "你的品牌名稱 <noreply@你的網域>",
// 後台連結也一起換
href="https://你的網域/admin/news"
```

### 5-6. `resolveUrl()` 函式 — **完整保留，不要改**
這是整個系統最複雜的部分，用三段式 fallback 解碼 Google News 短網址：
1. **Method 1**：讀取文章頁面的 `data-n-a-sg` / `data-n-a-ts` 屬性，呼叫 `batchexecute` API 解碼
2. **Method 2**：抓頁面裡的 `canonical` 標籤或第一個外部連結
3. **Method 3**：直接 follow redirect

Google 會不定期改變 HTML 結構，三層 fallback 確保大多數情況下都能解出真實 URL。

---

## 第六步：設定 Vercel Cron（`vercel.json`）

```json
{
  "crons": [
    {
      "path": "/api/cron/fetch-news",
      "schedule": "0 1 * * *"
    }
  ]
}
```

> `0 1 * * *` = UTC 01:00 = 台灣時間 09:00，每天早上九點抓一次。  
> 可加第二次：`"0 10 * * *"` = UTC 10:00 = 台灣時間 18:00。  
> Vercel cron 使用 UTC，台灣 UTC+8，換算時減 8 小時。

---

## 第七步：後台管理頁面

複製以下檔案（UI 邏輯完全通用，只需換文案/網域）：

| 原始路徑 | 說明 |
|---|---|
| `app/admin/news/page.tsx` | 新聞列表、手動觸發、執行記錄 |
| `app/admin/news/NewsClient.tsx` | 新聞管理 client component |
| `app/admin/news/edit/[slug]/page.tsx` | 編輯單篇新聞 |
| `app/api/admin/news/[slug]/route.ts` | 新聞 CRUD API |
| `app/api/admin/news-settings/route.ts` | 排程設定 API |
| `app/api/admin/news-prompt/route.ts` | 編輯提示詞 API |

---

## 第八步：前台新聞頁面

複製以下檔案（或自行設計 UI）：

| 原始路徑 | 說明 |
|---|---|
| `app/[locale]/news/page.tsx` | 新聞列表頁 |
| `app/[locale]/news/[slug]/page.tsx` | 新聞詳細頁 |

如果新專案**不需要多語系**，把 `[locale]` 去掉，改成直接放在 `app/news/` 下即可。  
`getAllNews()` 和 `getNewsArticle(slug)` 直接從 lib 引入，不需要修改。

---

## AI 模型說明

三個步驟都使用 `claude-haiku-4-5-20251001`（最便宜、速度快）：

| 步驟 | 用途 | max_tokens |
|---|---|---|
| `filterNews` | 從 20+ 則標題挑 5 則 | 512 |
| `translateTitles` | 批量翻譯標題 | 2048 |
| `translateArticle` | 改寫成完整報導 | 4096 |

每次執行約消耗 **3–5 次 API 呼叫**，費用極低。

---

## 完整執行流程（再確認）

1. Vercel Cron 每天定時呼叫 `GET /api/cron/fetch-news`（帶 `Authorization: Bearer {CRON_SECRET}`）
2. 抓 RSS → 解析 → 過濾 → AI 篩選 5 則
3. 對每則：resolveUrl → fetchArticleText → AI 改寫
4. 跳過已抓過的 URL（`news_fetch_history` + `news_articles` 聯集去重）
5. 存入 `news_articles`
6. 成功：寄摘要 email；失敗：寄 alert email
7. 寫 log 到 `news_fetch_log`

---

## 常見問題

**Q：為什麼 resolveUrl 這麼複雜？**  
A：Google News 的 RSS `<link>` 是包裝過的短網址，不是真實文章 URL。直接爬這個 URL 拿不到內文，必須先解碼。Google 約每隔幾個月就會改一次 HTML 結構，三層 fallback 是穩定運作的關鍵。

**Q：fetchArticleText 有時候拿不到內文怎麼辦？**  
A：程式會跳過內文少於 100 字的文章（`if (originalText.length > 100)`）。付費牆網站（如部分聯合報內容）本來就無法爬取，屬於正常現象。

**Q：Neon 資料表需要手動建立嗎？**  
A：不需要。`lib/news.ts` 的 `initNewsDb()` 和 `lib/news-settings.ts` 的 `initTables()` 都會在第一次呼叫時自動 `CREATE TABLE IF NOT EXISTS`。

**Q：CRON_SECRET 怎麼用？**  
A：在 Vercel 環境變數設定任意字串，Vercel 呼叫 cron 時會自動帶上 `Authorization: Bearer {CRON_SECRET}` header。Route 會驗證這個 header，防止外部隨意觸發。
