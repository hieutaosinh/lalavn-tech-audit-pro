# Audit Pro — Lalavn Deep Audit

Bộ audit SEO + GEO chuyên sâu, dùng cho **khách hàng trả tiền**. Standalone repo, không AI, không DB, không browser automation.

> Phiên bản v0.5 — alignment với [Google AI Optimization Guide chính thức (May 2026)](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide). Bổ sung 7 nhóm check Google explicitly khuyến nghị + flag `googleOfficial:true` cho mỗi issue tag rõ source authority.

## What's new in v0.5 (Google Search Central docs alignment)

Module mới `lib/google-ai-guide.mjs` cover các check Google publish trong Search Central documentation chính thức (gồm AI Optimization Guide May 15, 2026 và các trang foundational khác):

### Indexability & crawlability (Google Search Essentials)
- **Googlebot access detection** — riêng biệt với AI bots; nếu Googlebot bị block thì site KHÔNG có trong cả Google Search lẫn AI Overviews/AI Mode (hơn cả block GPTBot/ClaudeBot).
- **Preview controls audit** — `nosnippet`, `max-snippet:0/N`, `max-image-preview:none`, `data-nosnippet`. Đây là Google official "kill switch" cho AI Overviews — phổ biến nhất là set nhầm rồi quên.
- **Soft 404 detection** — page trả HTTP 200 nhưng nội dung "not found / 404" → Google không index. Phổ biến trong SPA chưa SSR error state.
- **Crawl budget waste** — flag URL search/filter/cart/utm tracking nên Disallow trong robots.txt.

### JavaScript SEO (Search Central JS guide)
- **SPA empty root detection** — `<div id="root"></div>` rỗng = Googlebot phải đợi render queue, chậm + không reliable. Khuyến nghị SSR/SSG.
- **JS-heavy thin HTML** — script bytes >> body text bytes → có thể là SPA chưa render.
- **Crawlable links audit** — `<a>` không có href, `javascript:` links, `onclick` trên span/div thay vì `<a href>`. Google explicit: chỉ `<a href>` mới crawlable.

### Pagination (Search Central pagination doc)
- **Pagination canonical** — paginated URL (`/page/2/`, `?page=3`) phải self-canonical chứ không trỏ về page 1. Google deprecated rel=next/prev (2019).
- Phát hiện: `?page=N`, `/page/N/`, `?offset=`, `?start=`.

### Structured data for AI Overviews citation
- **Article schema completeness** — Google ưu tiên cite Article có image ≥1200×630, author.url, publisher.logo, dateModified, mainEntityOfPage.
- **Product schema completeness for AI Mode shopping** — offers (price/currency/availability), brand, gtin/sku, aggregateRating.

### Page experience (Core Web Vitals + UX signals)
- **Content freshness** — dateModified vs current date; flag content > 12 tháng (warning > 24 tháng).
- **Intrusive interstitial heuristic** — phát hiện popup/paywall che mobile viewport.

### AI Mode "query fan-out" support
- **Topic cluster coverage** — pillar có ≥ 5 internal link tới subtopic. Google AI Mode dùng query fan-out — site có cluster mạnh sẽ cover nhiều subquery hơn.

> **Tag `googleOfficial: true`**: Mỗi issue mới có flag `googleOfficial: true` trong JSON output → exec summary tag rõ "Google AI Optimization Guide compliance" để khách phân biệt với các check generic GEO/AEO.

### Note về quan điểm Google chính thức vs check generic GEO/AEO

Google explicit nói các tactic như `llms.txt`, content chunking, "AI-friendly schema" KHÔNG cần thiết cho **Google AI Overviews/AI Mode**. Tuy nhiên các check GEO hiện có trong audit-pro (llms.txt, citability score, FAQ, direct-answer) **vẫn có giá trị** cho **ChatGPT Search, Perplexity, Claude, Gemini** — các engine khác Google. Audit-pro phục vụ cả 2 mục tiêu:
1. Tuân thủ guide Google chính thức (issues `googleOfficial: true`)
2. Tối ưu cho engine AI ngoài Google (issues `area: ai-search` không có flag này)

> **Note về FAQ rich result**: Google deprecated FAQ rich result từ 07/05/2026. Audit-pro vẫn check FAQPage schema — không phải để có rich result trên Google nữa, mà vì ChatGPT/Perplexity/Claude vẫn cite từ FAQ format rất tích cực.



## What's new in v0.4

- **HTTP security headers + compression**: HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, gzip/brotli — từ response headers homepage.
- **Redirect chain tracking**: phát hiện chain ≥ 3 hops, 302 dùng sai chỗ, internal-link-to-redirect (lãng phí crawl budget).
- **Mixed content scan**: trang HTTPS load resource HTTP — Chrome block hoặc cảnh báo.
- **Sitemap quality**: cross-validate URL trong sitemap có 404, noindex, hoặc canonical sai không.
- **Hreflang reciprocity**: A↔B phải khai báo qua lại, kiểm tra x-default + format ISO 639.
- **A11y baseline**: `<html lang>`, viewport meta, form input labels, empty button/link.
- **GEO Trust Signals**: phát hiện trang About/Contact/Privacy/Terms + sameAs platforms (LinkedIn, Wikipedia, Crunchbase) trong Organization schema.
- **Direct-answer paragraph detection**: 30-100 từ ngay sau H2 — format ChatGPT/Perplexity cite nhiều nhất.
- **CSV export**: `pages.csv`, `issues.csv`, `action-plan.csv` cho khách filter/pivot trong Excel.
- **Per-page score**: trang nào yếu nhất được sort lên đầu báo cáo.
- **Bug fix**: `NL_STR` temporal-dead-zone error trong `run.mjs` đã được sửa (v0.3 crash khi crawl xong).

## Khác gì so với bản Quick (Free)?

| | Quick Audit (Free) | Audit Pro |
|---|---|---|
| Crawl | 1-hop từ homepage hoặc sitemap | **BFS đệ quy theo depth + concurrency** |
| robots.txt | Chỉ check tồn tại | **Tôn trọng Disallow rules** |
| Content | Word count nhẹ | **Thin content + heading hierarchy + content ratio** |
| Image | Alt count | **Alt + dimensions + format + lazy + lossless detection** |
| Link | Internal/external count | **Broken link checker + anchor diversity + nofollow ratio + orphan pages** |
| Schema | Parse OK? | **Required fields validation theo schema.org** |
| Performance | Response time | **Core Web Vitals thật từ PageSpeed Insights API (lab + field)** |
| **GEO Readiness** | Không có | **GEO Score 0-100 + 12 check (llms.txt, AI bots access, citability, E-E-A-T, FAQ coverage, chunkability...)** |
| Báo cáo | 1 HTML cơ bản | **Cover page + Exec Summary + GEO Section + Action Plan P0/P1/P2 + Compare** |
| Branding | Không | **Logo, màu, tên qua config.json** |

## GEO (Generative Engine Optimization) — USP cho 2026

Đây là phần khác biệt lớn nhất so với mọi audit tool hiện tại — kể cả các tool trả phí lớn như Sitebulb / Screaming Frog. Audit Pro kiểm tra site có sẵn sàng được **AI Search engine** (ChatGPT Search, Perplexity, Google AI Overview, Claude, Gemini) **trích dẫn** trong câu trả lời hay không.

12 check offline (không cần API):

1. **`llms.txt`** — chuẩn mới, đa số site chưa có
2. **AI bots access trong `robots.txt`** — phát hiện block GPTBot, ClaudeBot, PerplexityBot...
3. **Citability score** — site có dễ trích dẫn không
4. **Statistics density** — số liệu cụ thể (LLM ưa cite số/năm/%)
5. **Citations** — pattern "theo X / nguồn:" / "according to..."
6. **Definitions** — pattern "X là Y" (LLM cite nhiều khi trả lời "X là gì")
7. **TL;DR / summary** ở đầu bài
8. **FAQ section** — format LLM rất ưa
9. **Last updated date** — LLM ưu tiên content mới
10. **Author bio + Person schema** — E-E-A-T (LLM cần biết "ai viết")
11. **Chunkability** — H2 có tự đứng độc lập không (LLM tách bài theo H2)
12. **Schema cho AI** — Article, FAQPage, HowTo, Organization, Person

Output có **GEO Score 0-100** song song với SEO Score, plus action plan riêng cho `area: ai-search`.

## Yêu cầu

- Node.js 20+ (dùng native fetch, AbortController)
- `cheerio` + `fast-xml-parser` (đã khai báo trong `package.json`)

```bash
npm install
```

## Branding (cấu hình trước khi chạy lần đầu)

Copy file mẫu → sửa giá trị:

```bash
cp config.example.json config.json
```

Sửa các trường trong `config.json`:

```jsonc
{
  "brand": {
    "name": "Lalavn Deep Audit",       // tên hiển thị ở header báo cáo
    "tagline": "Báo cáo SEO chuyên sâu",
    "logoText": "Lalavn",              // dùng nếu chưa có ảnh logo
    "logoUrl": "",                     // hoặc URL public ảnh logo (PNG/SVG)
    "primaryColor": "#0f172a",         // màu chính của báo cáo
    "accentColor": "#2563eb",
    "website": "https://lalavn.com",
    "email": "hello@lalavn.com",
    "footer": "Bảo mật. Chỉ dùng nội bộ giữa Lalavn và khách hàng."
  }
}
```

> Tool tự fallback về `config.example.json` nếu chưa có `config.json`. Khi bạn tạo `config.json` riêng, file đó sẽ được ưu tiên (đã được `.gitignore`).

### Khi có logo

Upload logo lên 1 URL public bất kỳ (vd: GitHub raw, Cloudflare R2, Imgur), paste URL vào `brand.logoUrl`. Tool sẽ tự dùng ảnh thay cho text.

## Chạy

### Audit cơ bản

```bash
node run.mjs --url https://customer-site.com
```

Mặc định:
- Crawl tối đa 200 URL, depth 3, 5 concurrency
- Có gọi PSI cho 5 URL đầu tiên (mobile + desktop)
- Có check broken external link

### Override thông số

```bash
# Audit nhanh hơn (ít URL, không PSI, không broken link)
node run.mjs --url https://site.com \
  --max-urls 30 \
  --no-psi \
  --no-broken-links

# Audit thật sâu cho khách lớn
node run.mjs --url https://site.com \
  --max-urls 500 \
  --max-depth 5
```

### Compare với audit trước (báo cáo định kỳ)

Tự tìm audit gần nhất:

```bash
node run.mjs --url https://site.com --auto-compare
```

Hoặc chỉ định file cụ thể:

```bash
node run.mjs --url https://site.com \
  --compare-with sites/site-com/audits/2026-04-17/report.json
```

→ Báo cáo sẽ có thêm section "So sánh với lần audit trước": Δ score, vấn đề mới, vấn đề đã sửa.

### Cho nhiều khách (multi-tenant)

Mỗi khách dùng `--client-slug` riêng:

```bash
node run.mjs --url https://acme.com --client-slug acme-corp
node run.mjs --url https://beta.com --client-slug beta-inc
```

Output sẽ được tách:

```
sites/acme-corp/audits/YYYY-MM-DD/
sites/beta-inc/audits/YYYY-MM-DD/
```

## Output structure

```
sites/<client-slug>/audits/YYYY-MM-DD/
├── report.json       # Toàn bộ data (cho agent đọc, hoặc lưu trữ)
├── report.html       # Báo cáo Pro để gửi khách (Print → Save as PDF)
├── report.md         # Markdown ngắn gọn cho dev/manager
├── pages.csv         # 1 row / page (URL + score + issue counts) — cho Excel filter
├── issues.csv        # 1 row / issue (URL + severity + code + message) — cho dev assign
└── action-plan.csv   # 1 row / task (priority + title + effort + impact) — cho PM
```

> **Custom output dir**: dùng `--out /custom/path` để override hoàn toàn vị trí lưu.
>
> **Tắt CSV**: thêm `--no-csv` nếu chỉ cần HTML/JSON/MD.

### Cấu trúc report.html

1. **Cover page** — logo, tên khách, ngày, score
2. **Executive Summary** — 1 trang cho boss của khách (top 3 vấn đề + quick wins + impact estimate)
3. **Sức khoẻ kỹ thuật** — site-level checks + Core Web Vitals từ PSI
4. **GEO Readiness** — 12 check + GEO Score
5. **Top issues** — 10 vấn đề phổ biến nhất
6. **Phân tích từng trang** — bảng chi tiết, expand để xem issue
7. **Action plan** — P0/P1/P2 với effort + impact estimate (gồm GEO rules)
8. **So sánh với audit trước** (nếu có) — diff issues, score trend

### In ra PDF

Mở `report.html` trong Chrome → `Ctrl+P` (hoặc Cmd+P) → "Save as PDF":

- Margins: Default
- Background graphics: ✓ ON (quan trọng để giữ cover page colors)
- Paper size: A4

Bạn sẽ có 1 PDF nhiều trang đẹp như deliverable consulting.

## PageSpeed Insights — lưu ý

PSI là API free của Google, **không bắt buộc API key**. Tuy nhiên:

| | Không key | Có key (free) |
|---|---|---|
| Quota | Share theo IP, dễ bị 429 | 25,000 query/ngày |
| Tốc độ | Chậm hơn | Bình thường |

### Khi cần API key

Nếu audit nhiều khách hằng tuần → nên đăng ký key:

1. https://console.cloud.google.com/ → tạo project
2. APIs & Services → Library → "PageSpeed Insights API" → Enable
3. APIs & Services → Credentials → Create Credentials → API key
4. Set env var:
   ```bash
   export PSI_API_KEY=AIza...
   ```

Tool tự pick env var, không cần đổi code.

## Các flag CLI đầy đủ

| Flag | Mô tả | Default |
|---|---|---|
| `--url URL` | Target URL | bắt buộc |
| `--client-slug SLUG` | Folder khách | derive từ domain |
| `--config FILE` | Path tới config.json | auto detect |
| `--max-urls N` | Override max URL crawl | 200 |
| `--max-depth N` | Override depth | 3 |
| `--no-psi` | Bỏ PageSpeed Insights | (PSI on) |
| `--no-broken-links` | Bỏ broken link check | (on) |
| `--no-csv` | Bỏ CSV export | (CSV on) |
| `--compare-with FILE` | Path tới report.json cũ | — |
| `--auto-compare` | Tự tìm audit gần nhất | off |
| `--out DIR` | Override output dir | derive từ client-slug |

## Architecture

```
audit-pro/
├── run.mjs                 # CLI entry — orchestrate các module
├── config.example.json     # Template config (commit)
├── config.json             # Config thật của bạn (gitignored)
├── package.json
├── README.md
└── lib/
    ├── crawler.mjs            # BFS, concurrency, robots.txt, redirect chain tracking
    ├── checks.mjs             # Per-page + site-level analysis, hreflang, internal links
    ├── geo.mjs                # GEO Readiness — 12 check cho AI Search + trust signals
    ├── google-ai-guide.mjs    # Google official Search Central docs compliance (v0.5)
    ├── psi.mjs                # PageSpeed Insights wrapper
    ├── security-headers.mjs   # HTTP security headers + compression analysis
    ├── sitemap-quality.mjs    # Cross-validate sitemap URL với crawl results
    ├── csv-export.mjs         # CSV exports cho khách enterprise
    ├── compare.mjs            # Diff with previous audit
    ├── action-plan.mjs        # Rule-based P0/P1/P2 generator
    └── render.mjs             # HTML + Markdown renderer
```

## Cron mẫu cho audit định kỳ khách

```bash
# /etc/cron.d/audit-pro-acme
# Audit Acme Corp mỗi sáng thứ Hai 6h
0 6 * * 1 USER cd /home/USER/audit-pro && PSI_API_KEY=xxx /usr/bin/node run.mjs --url https://acme.com --client-slug acme-corp --auto-compare >> logs/audit-acme.log 2>&1
```

## Tích hợp với agent (openclaw + GPT)

Workflow đề xuất:

```
1. Cron chạy audit-pro hằng tuần cho mỗi khách
2. Agent đọc report.json (đặc biệt actionPlan.byPriority.P0)
3. Agent tự tạo task trong system của khách (Trello/Notion/Sheet)
4. Agent gửi exec summary qua email/Telegram cho khách
5. Tuần sau: --auto-compare → khách thấy được tiến độ rõ ràng
```

→ Audit Pro = "giác quan", agent = "tay chân", bạn = "não".

## Ranh giới (chưa có)

- [ ] PDF render tự động (hiện cần Chrome → Print). Sẽ thêm Puppeteer nếu cần.
- [ ] Headless browser audit (cho SPA/React). Hiện chỉ crawl static HTML.
- [ ] Backlink data (cần Ahrefs/Semrush API trả phí).
- [ ] AI Overview vulnerability check (cần SERP API).
- [ ] Auto schedule + email delivery.
- [x] ~~Internationalization checks (hreflang reciprocity).~~ **v0.4 đã có.**
- [x] ~~HTTP security headers + compression.~~ **v0.4 đã có.**
- [x] ~~Mixed content + redirect chain detection.~~ **v0.4 đã có.**
- [x] ~~CSV export + per-page score.~~ **v0.4 đã có.**

## License

Private / proprietary. Internal use only.
