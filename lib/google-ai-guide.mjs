/**
 * Google AI Optimization Guide compliance checks (v0.5).
 *
 * Refs:
 *   - https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
 *   - https://developers.google.com/search/docs/appearance/ai-features
 *   - Google blog: "Top ways to ensure your content performs well in Google's AI experiences"
 *
 * Google's official position (May 2026): AI Overviews/AI Mode dùng RAG trên
 * chính Search index. Không có "AEO/GEO" magic — chỉ cần SEO truyền thống
 * tốt + một số preview controls đúng + Googlebot crawl được.
 *
 * Module này check những thứ Google explicitly khuyến nghị mà các module
 * khác chưa cover:
 *   - Googlebot crawl access (riêng biệt với AI bots)
 *   - Preview controls: nosnippet / max-snippet / data-nosnippet
 *   - Article/Product schema completeness cho AI cite
 *   - dateModified freshness
 *   - Intrusive interstitial heuristic
 *   - Crawl budget waste (admin/cart/checkout in robots.txt for ecommerce)
 *
 * Tất cả check đều có flag `googleOfficial: true` trong issue payload để
 * report có thể tag "Google official guidance" trong UI.
 */

let _cheerio = null;
async function getCheerio() {
  if (!_cheerio) _cheerio = await import("cheerio");
  return _cheerio;
}

// ─────────────────────────────────────────────────────────────────
// Check 1: Googlebot access in robots.txt
// Independent of AI bots. Google guide explicit: "make sure Googlebot
// can crawl your site" — without this, NO AI Overview citation possible.
// ─────────────────────────────────────────────────────────────────
const GOOGLE_BOTS = ["Googlebot", "Googlebot-Image", "Googlebot-News", "Googlebot-Video"];

export function analyzeGooglebotAccess(robotsTxt) {
  const result = {
    googlebotBlocked: false,
    googlebotPartiallyBlocked: false,
    blockedSections: [],
    issues: [],
  };
  if (!robotsTxt?.exists) return result;

  const text = robotsTxt.raw || "";
  let activeUA = null;
  let activeIsGoogle = false;
  const blocked = [];

  for (const lineRaw of String(text).split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();

    if (key === "user-agent") {
      activeUA = val;
      activeIsGoogle = GOOGLE_BOTS.some((b) => b.toLowerCase() === val.toLowerCase());
      continue;
    }

    if (activeIsGoogle && key === "disallow" && val) {
      if (val === "/") {
        result.googlebotBlocked = true;
        result.issues.push({
          severity: "critical",
          code: "GOOGLEBOT_BLOCKED",
          message: `robots.txt block toàn bộ ${activeUA} (Disallow: /) — site sẽ KHÔNG xuất hiện trong cả Google Search lẫn AI Overviews/AI Mode`,
          area: "indexability",
          googleOfficial: true,
        });
      } else {
        blocked.push({ ua: activeUA, path: val });
      }
    }
  }

  // Phân tích các path bị block: nếu chứa root sections như /blog, /products
  // → cảnh báo. Skip /admin, /cart, /checkout, /search vì là intentional.
  const intentional = /\/(admin|wp-admin|cart|checkout|search|login|signup|account|api)\/?$/i;
  const concerning = blocked.filter((b) => !intentional.test(b.path));
  result.blockedSections = blocked;
  if (concerning.length > 0 && !result.googlebotBlocked) {
    result.googlebotPartiallyBlocked = true;
    result.issues.push({
      severity: "warning",
      code: "GOOGLEBOT_PARTIAL_BLOCK",
      message: `Googlebot bị block ở ${concerning.length} đường dẫn quan trọng (${concerning.slice(0, 3).map((b) => b.path).join(", ")}${concerning.length > 3 ? "..." : ""})`,
      area: "indexability",
      googleOfficial: true,
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Check 2: Preview controls (per-page)
// Google explicitly: nosnippet / max-snippet:0 = không xuất hiện trong
// AI Overviews. data-nosnippet để loại 1 phần content khỏi snippet.
// Đây là cause #1 vô tình tự loại site khỏi AI Overviews.
// ─────────────────────────────────────────────────────────────────
export async function analyzePreviewControls(page) {
  const issues = [];
  const signals = {
    nosnippet: false,
    maxSnippet: null,
    maxImagePreview: null,
    maxVideoPreview: null,
    dataNosnippetCount: 0,
    aiOverviewEligible: true,
  };

  if (!page.html) return { issues, signals };

  const cheerio = await getCheerio();
  const $ = cheerio.load(page.html);

  // Combine meta robots + X-Robots-Tag header
  const metaRobots = ($('meta[name="robots"]').attr("content") || "").toLowerCase();
  const metaGoogleBot = ($('meta[name="googlebot"]').attr("content") || "").toLowerCase();
  const xRobotsHeader = (page.headers?.["x-robots-tag"] || "").toLowerCase();
  const allDirectives = [metaRobots, metaGoogleBot, xRobotsHeader].filter(Boolean).join(", ");

  // nosnippet
  if (/\bnosnippet\b/.test(allDirectives)) {
    signals.nosnippet = true;
    signals.aiOverviewEligible = false;
    issues.push({
      severity: "warning",
      code: "NOSNIPPET_PRESENT",
      message: "Trang có directive nosnippet — Google sẽ không hiển thị snippet và không cite trong AI Overviews. Nếu vô tình set, gỡ ngay.",
      area: "indexability",
      googleOfficial: true,
    });
  }

  // max-snippet
  const maxSnippetMatch = allDirectives.match(/max-snippet\s*:\s*(-?\d+)/);
  if (maxSnippetMatch) {
    const v = parseInt(maxSnippetMatch[1], 10);
    signals.maxSnippet = v;
    if (v === 0) {
      signals.aiOverviewEligible = false;
      issues.push({
        severity: "warning",
        code: "MAX_SNIPPET_ZERO",
        message: "max-snippet:0 — tương đương nosnippet, loại trang khỏi AI Overviews",
        area: "indexability",
        googleOfficial: true,
      });
    } else if (v > 0 && v < 50) {
      issues.push({
        severity: "info",
        code: "MAX_SNIPPET_TOO_SHORT",
        message: `max-snippet:${v} — quá ngắn để AI cite có ý nghĩa, nên ≥ 160 hoặc dùng -1 (unlimited)`,
        area: "indexability",
        googleOfficial: true,
      });
    }
  }

  // max-image-preview
  const maxImgMatch = allDirectives.match(/max-image-preview\s*:\s*(none|standard|large)/);
  if (maxImgMatch) {
    signals.maxImagePreview = maxImgMatch[1];
    if (maxImgMatch[1] === "none") {
      issues.push({
        severity: "info",
        code: "MAX_IMAGE_PREVIEW_NONE",
        message: "max-image-preview:none — Google không dùng image trong AI Overviews/snippet, giảm visual citation",
        area: "indexability",
        googleOfficial: true,
      });
    }
  }

  // data-nosnippet (đoạn content cụ thể bị loại)
  const dataNs = $("[data-nosnippet]");
  signals.dataNosnippetCount = dataNs.length;
  if (dataNs.length >= 5) {
    issues.push({
      severity: "info",
      code: "MANY_DATA_NOSNIPPET",
      message: `${dataNs.length} elements có data-nosnippet — phần lớn nội dung bị loại khỏi snippet/AI cite`,
      area: "indexability",
      googleOfficial: true,
    });
  }

  return { issues, signals };
}

// ─────────────────────────────────────────────────────────────────
// Check 3: Article schema completeness for AI Overviews citation
// Google guide: AI Overviews ưu tiên cite Article có image hero,
// author URL, dateModified, publisher.logo.
// ─────────────────────────────────────────────────────────────────
export function analyzeArticleSchemaForAI(schemas) {
  const issues = [];
  const signals = { articlesChecked: 0, articlesIncomplete: 0, missingFields: [] };
  if (!schemas) return { issues, signals };

  for (const s of schemas) {
    if (!s.valid || !s.item) continue;
    const t = Array.isArray(s.type) ? s.type[0] : s.type;
    if (!/^(Article|BlogPosting|NewsArticle)$/.test(t)) continue;

    signals.articlesChecked++;
    const item = s.item;
    const missing = [];
    // image required for AI Overview hero
    if (!item.image) missing.push("image");
    else {
      // Should be ≥1200×630 ideally — only check structure though
      const img = Array.isArray(item.image) ? item.image[0] : item.image;
      if (typeof img === "object" && (img.width && img.height)) {
        const w = parseInt(img.width, 10), h = parseInt(img.height, 10);
        if (w < 1200 || h < 630) {
          issues.push({
            severity: "info",
            code: "ARTICLE_IMAGE_SMALL",
            message: `Article image ${w}×${h} — Google khuyến nghị ≥ 1200×630 cho AI Overview hero`,
            area: "schema",
            googleOfficial: true,
          });
        }
      }
    }
    // author should have @type Person + url for E-E-A-T
    if (item.author) {
      const author = Array.isArray(item.author) ? item.author[0] : item.author;
      if (typeof author === "object") {
        if (!author.url && !author["@id"]) missing.push("author.url");
        if (!author["@type"]) missing.push("author.@type");
      } else if (typeof author === "string") {
        // Plain string is technically valid but weak signal
        issues.push({
          severity: "info",
          code: "ARTICLE_AUTHOR_PLAIN_STRING",
          message: "author là plain string, nên dùng object {@type:'Person', name, url} để tăng E-E-A-T signal",
          area: "schema",
          googleOfficial: true,
        });
      }
    } else {
      missing.push("author");
    }
    // publisher (Article SHOULD have)
    if (!item.publisher) missing.push("publisher");
    else if (typeof item.publisher === "object" && !item.publisher.logo) {
      missing.push("publisher.logo");
    }
    // dateModified - critical for freshness signal
    if (!item.dateModified) missing.push("dateModified");
    // mainEntityOfPage helps Google identify canonical entity
    if (!item.mainEntityOfPage) missing.push("mainEntityOfPage");

    if (missing.length > 0) {
      signals.articlesIncomplete++;
      signals.missingFields.push(...missing);
      issues.push({
        severity: "info",
        code: "ARTICLE_SCHEMA_INCOMPLETE_FOR_AI",
        message: `Article schema thiếu ${missing.join(", ")} — giảm khả năng được AI Overviews cite`,
        area: "schema",
        googleOfficial: true,
      });
    }
  }

  return { issues, signals };
}

// ─────────────────────────────────────────────────────────────────
// Check 4: Product schema completeness cho AI shopping
// AI Mode shopping (cả Google AI Mode lẫn Perplexity Shopping) rely
// nặng vào structured product data.
// ─────────────────────────────────────────────────────────────────
export function analyzeProductSchemaForAI(schemas) {
  const issues = [];
  const signals = { productsChecked: 0, productsIncomplete: 0 };
  if (!schemas) return { issues, signals };

  for (const s of schemas) {
    if (!s.valid || !s.item) continue;
    const t = Array.isArray(s.type) ? s.type[0] : s.type;
    if (t !== "Product") continue;

    signals.productsChecked++;
    const item = s.item;
    const missing = [];
    if (!item.offers) missing.push("offers");
    else {
      const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
      if (typeof offer === "object") {
        if (!offer.price && !offer.priceSpecification) missing.push("offers.price");
        if (!offer.priceCurrency) missing.push("offers.priceCurrency");
        if (!offer.availability) missing.push("offers.availability");
      }
    }
    if (!item.image) missing.push("image");
    if (!item.brand) missing.push("brand");
    // Identifier: gtin, mpn, or sku
    if (!item.gtin && !item.gtin8 && !item.gtin13 && !item.gtin14 && !item.mpn && !item.sku && !item.productID) {
      missing.push("gtin/mpn/sku");
    }
    if (!item.aggregateRating && !item.review) {
      issues.push({
        severity: "info",
        code: "PRODUCT_NO_RATING",
        message: "Product schema không có aggregateRating/review — giảm trust trong AI shopping cite",
        area: "schema",
        googleOfficial: true,
      });
    }

    if (missing.length > 0) {
      signals.productsIncomplete++;
      issues.push({
        severity: "warning",
        code: "PRODUCT_SCHEMA_INCOMPLETE",
        message: `Product schema thiếu ${missing.join(", ")} — Google AI Mode shopping yêu cầu các field này`,
        area: "schema",
        googleOfficial: true,
      });
    }
  }

  return { issues, signals };
}

// ─────────────────────────────────────────────────────────────────
// Check 5: Content freshness — dateModified vs current date
// Google guide: ưu tiên content fresh trong AI features
// ─────────────────────────────────────────────────────────────────
export function analyzeFreshness(schemas, now = new Date()) {
  const issues = [];
  const signals = { ageMonths: null, dateModified: null, datePublished: null };
  if (!schemas) return { issues, signals };

  // Find Article-like schema
  let modified = null, published = null;
  for (const s of schemas) {
    if (!s.valid || !s.item) continue;
    const t = Array.isArray(s.type) ? s.type[0] : s.type;
    if (!/^(Article|BlogPosting|NewsArticle)$/.test(t)) continue;
    modified = modified || s.item.dateModified;
    published = published || s.item.datePublished;
  }
  if (!modified && !published) return { issues, signals };

  signals.dateModified = modified;
  signals.datePublished = published;

  const dateStr = modified || published;
  let date;
  try { date = new Date(dateStr); } catch { return { issues, signals }; }
  if (isNaN(date.getTime())) return { issues, signals };

  const ageDays = (now.getTime() - date.getTime()) / 86400000;
  const ageMonths = Math.round(ageDays / 30);
  signals.ageMonths = ageMonths;

  if (ageMonths >= 24) {
    issues.push({
      severity: "info",
      code: "CONTENT_VERY_STALE",
      message: `Content cập nhật cuối cách đây ${ageMonths} tháng — Google ưu tiên content fresh trong AI Overviews, cân nhắc refresh hoặc redirect`,
      area: "content",
      googleOfficial: true,
    });
  } else if (ageMonths >= 12) {
    issues.push({
      severity: "info",
      code: "CONTENT_STALE",
      message: `Content cập nhật cuối cách đây ${ageMonths} tháng — cân nhắc cập nhật dateModified và refresh nội dung`,
      area: "content",
      googleOfficial: true,
    });
  }

  // Mismatch: datePublished mới hơn dateModified (nghi vấn)
  if (modified && published) {
    const m = new Date(modified).getTime();
    const p = new Date(published).getTime();
    if (!isNaN(m) && !isNaN(p) && m < p) {
      issues.push({
        severity: "info",
        code: "DATE_MODIFIED_BEFORE_PUBLISHED",
        message: "dateModified cũ hơn datePublished — schema có thể sai",
        area: "schema",
        googleOfficial: true,
      });
    }
  }

  return { issues, signals };
}

// ─────────────────────────────────────────────────────────────────
// Check 6: Intrusive interstitial heuristic
// Google's mobile-first signal — large overlay che main content trên
// mobile = page experience penalty.
// Heuristic: detect modal/overlay element có position:fixed,
// z-index cao, và chiếm > 50% viewport. Best-effort vì không render JS.
// ─────────────────────────────────────────────────────────────────
export async function analyzeInterstitial(page) {
  const issues = [];
  const signals = { suspectedInterstitial: false, suspectCount: 0 };
  if (!page.html) return { issues, signals };

  const cheerio = await getCheerio();
  const $ = cheerio.load(page.html);

  // Heuristic: tìm element có class/id chứa "popup", "modal", "interstitial",
  // "overlay", "newsletter-popup", "subscribe-popup", "cookie-wall"
  // (cookie banner OK theo Google trừ phi block content). Không thể đo
  // pixel, nên chỉ flag để dev tự verify.
  const suspectSelectors = [
    "[class*='interstitial']",
    "[class*='popup-fullscreen']",
    "[class*='subscribe-popup']",
    "[class*='newsletter-popup']",
    "[class*='paywall']",
    "[id*='interstitial']",
    "[id*='subscribe-popup']",
    "[id*='newsletter-popup']",
  ];
  let count = 0;
  for (const sel of suspectSelectors) {
    count += $(sel).length;
  }
  signals.suspectCount = count;
  if (count >= 1) {
    signals.suspectedInterstitial = true;
    issues.push({
      severity: "info",
      code: "POSSIBLE_INTERSTITIAL",
      message: `Phát hiện ${count} element có vẻ là intrusive interstitial (newsletter popup, paywall, …) — kiểm tra trên mobile, nếu che > 50% viewport thì là page experience penalty`,
      area: "user-experience",
      googleOfficial: true,
    });
  }

  return { issues, signals };
}

// ─────────────────────────────────────────────────────────────────
// Check 7: Crawl budget waste — pages indexable nhưng không nên
// (search results, faceted filters, /cart, /checkout, internal search)
// Google guide: nên Disallow trong robots.txt để Googlebot focus crawl.
// ─────────────────────────────────────────────────────────────────
const CRAWL_WASTE_PATTERNS = [
  { name: "internal search", pattern: /[?&](q|search|s)=/i },
  { name: "faceted filter", pattern: /[?&](color|size|filter|sort|price)=/i },
  { name: "session id", pattern: /[?&](sid|sessionid|phpsessid)=/i },
  { name: "tracking params", pattern: /[?&](utm_|fbclid|gclid|msclkid)=/i },
  { name: "cart/checkout", pattern: /\/(cart|checkout|basket|gio-hang|thanh-toan)/i },
  { name: "user account", pattern: /\/(account|my-account|profile|tai-khoan|ho-so)\/?$/i },
];

export function analyzeCrawlBudgetWaste(pages) {
  const issues = [];
  const summary = {};
  let total = 0;

  for (const p of pages) {
    const url = p.finalUrl || p.url;
    for (const { name, pattern } of CRAWL_WASTE_PATTERNS) {
      if (pattern.test(url)) {
        summary[name] = (summary[name] || 0) + 1;
        total++;
      }
    }
  }

  if (total >= 5) {
    const breakdown = Object.entries(summary)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    issues.push({
      severity: "info",
      code: "CRAWL_BUDGET_WASTE",
      message: `${total} URL có vẻ lãng phí crawl budget (${breakdown}) — Google guide khuyến nghị Disallow trong robots.txt để bot focus crawl page có giá trị`,
      area: "indexability",
      googleOfficial: true,
    });
  }

  return { issues, summary, total };
}

// ─────────────────────────────────────────────────────────────────
// Check 8: Topic cluster coverage (query fan-out support)
// Google AI Mode dùng "query fan-out" — 1 user query → nhiều subquery.
// Site có pillar + cluster sẽ cover nhiều subquery → ưu thế.
// Heuristic: pillar URL (depth 0-1) có ≥ 5 internal link tới subtopic
// có cùng prefix path.
// ─────────────────────────────────────────────────────────────────
export function analyzeTopicClusters(pages, signalsByUrl) {
  const issues = [];
  const summary = { pillarsFound: 0, weakPillars: 0 };

  // Tìm potential pillar: depth 0-1, wordCount ≥ 1000
  const candidates = pages.filter((p) => {
    const sig = signalsByUrl.get(p.finalUrl);
    return p.depth <= 1 && sig?.wordCount >= 1000;
  });

  for (const pillar of candidates) {
    summary.pillarsFound++;
    const pillarUrl = pillar.finalUrl;
    const pillarPath = (() => {
      try { return new URL(pillarUrl).pathname.replace(/\/$/, ""); }
      catch { return null; }
    })();
    if (!pillarPath) continue;

    const sig = signalsByUrl.get(pillarUrl);
    const internalLinks = sig?.linksRaw?.filter((l) => l.internal) || [];
    // Đếm link trỏ tới sub-page (cùng prefix path nhưng deeper)
    let subLinks = 0;
    for (const l of internalLinks) {
      try {
        const subPath = new URL(l.href).pathname;
        if (subPath !== pillarPath && subPath.startsWith(pillarPath + "/")) {
          subLinks++;
        }
      } catch {}
    }
    if (subLinks < 5) {
      summary.weakPillars++;
    }
  }

  if (summary.pillarsFound >= 3 && summary.weakPillars >= summary.pillarsFound * 0.5) {
    issues.push({
      severity: "info",
      code: "WEAK_TOPIC_CLUSTERS",
      message: `${summary.weakPillars}/${summary.pillarsFound} trang dài có thể là pillar nhưng < 5 internal link tới subtopic — Google AI Mode dùng query fan-out, site có topic cluster mạnh sẽ cover nhiều subquery`,
      area: "internal-linking",
      googleOfficial: true,
    });
  }

  return { issues, summary };
}

// ─────────────────────────────────────────────────────────────────
// Check 9: JavaScript rendering / SPA empty body
// Google guide: Googlebot có render JS, nhưng yêu cầu best practices.
// SPA với <div id="root"></div> rỗng = Google nhận HTML rỗng và phải đợi
// render queue (chậm + không phải lúc nào cũng work). Detect:
// - Body có ít content text (< 100 từ) nhưng có `<script>` lớn
// - Có root container empty (<div id="root|app|__next"></div>)
// ─────────────────────────────────────────────────────────────────
const SPA_ROOT_SELECTORS = "#root, #app, #__next, #__nuxt, [id$=root], [data-reactroot]";

export async function analyzeJSRendering(page) {
  const issues = [];
  const signals = { isLikelySPA: false, emptyRoot: false, htmlBytes: 0, scriptBytes: 0 };
  if (!page.html) return { issues, signals };

  const cheerio = await getCheerio();
  const $ = cheerio.load(page.html);

  signals.htmlBytes = Buffer.byteLength(page.html, "utf8");
  let scriptBytes = 0;
  $("script").each((_, el) => {
    const code = $(el).html() || "";
    scriptBytes += Buffer.byteLength(code, "utf8");
  });
  signals.scriptBytes = scriptBytes;

  // Empty SPA root detection: nếu có root container và bên trong gần như rỗng
  const $root = $(SPA_ROOT_SELECTORS);
  if ($root.length > 0) {
    const rootText = $root.first().text().replace(/\s+/g, " ").trim();
    const rootChildren = $root.first().children().length;
    if (rootText.length < 50 && rootChildren < 3) {
      signals.emptyRoot = true;
      signals.isLikelySPA = true;
      issues.push({
        severity: "warning",
        code: "SPA_EMPTY_ROOT",
        message: `Trang có vẻ là SPA với container root rỗng (#root/#app/#__next) — Googlebot crawl HTML thấy gần như rỗng và phải đợi render queue. Cân nhắc SSR/SSG (Next.js, Nuxt, Astro) hoặc dynamic rendering`,
        area: "javascript-seo",
        googleOfficial: true,
      });
    }
  }

  // Heuristic: nếu script bytes >> body text bytes → có thể là SPA chưa render
  const $clone = cheerio.load(page.html);
  $clone("script, style, noscript").remove();
  const bodyText = $clone("body").text().replace(/\s+/g, " ").trim();
  const bodyTextBytes = Buffer.byteLength(bodyText, "utf8");
  if (scriptBytes > bodyTextBytes * 5 && bodyTextBytes < 1000 && bodyTextBytes > 0) {
    signals.isLikelySPA = true;
    if (!signals.emptyRoot) {
      issues.push({
        severity: "info",
        code: "JS_HEAVY_THIN_HTML",
        message: `HTML body text rất ít (${bodyTextBytes}B) nhưng inline JavaScript ${Math.round(scriptBytes/1024)}KB — có thể là SPA chưa SSR. Googlebot sẽ render nhưng quá trình chậm hơn HTML thông thường.`,
        area: "javascript-seo",
        googleOfficial: true,
      });
    }
  }

  return { issues, signals };
}

// ─────────────────────────────────────────────────────────────────
// Check 10: Soft 404 detection
// Google guide: page trả 200 nhưng nội dung "not found" / "page doesn't exist"
// → Google coi là soft 404, không index, lãng phí crawl budget.
// ─────────────────────────────────────────────────────────────────
const SOFT_404_PHRASES = [
  /\bpage not found\b/i,
  /\bnot found\b/i,
  /\b404\b/i,
  /\bdoesn['']?t exist\b/i,
  /trang (bạn tìm |này )?(không (tồn tại|tìm thấy)|không có)/i,
  /không tìm thấy trang/i,
  /trang đã bị xoá/i,
  /content (không|not) (tồn tại|exist|available)/i,
  /\bcurrently unavailable\b/i,
];

export async function analyzeSoft404(page) {
  const issues = [];
  const signals = { isSoft404: false };
  if (!page.html || page.status !== 200) return { issues, signals };

  const cheerio = await getCheerio();
  const $ = cheerio.load(page.html);

  // Lấy title + h1 + body intro để check
  const title = ($("head > title").first().text() || "").toLowerCase();
  const h1 = ($("h1").first().text() || "").toLowerCase();
  const $clone = cheerio.load(page.html);
  $clone("script, style, nav, footer, header, aside").remove();
  const intro = $clone("body").text().replace(/\s+/g, " ").trim().slice(0, 500).toLowerCase();

  let matches = 0;
  for (const pattern of SOFT_404_PHRASES) {
    if (pattern.test(title) || pattern.test(h1) || pattern.test(intro)) {
      matches++;
    }
  }
  // Cần ít nhất 2 dấu hiệu (vd: title + h1) để giảm false positive
  if (matches >= 2) {
    signals.isSoft404 = true;
    issues.push({
      severity: "warning",
      code: "SOFT_404",
      message: `Trang trả HTTP 200 nhưng nội dung báo "not found / 404 / không tồn tại" — Google coi là soft 404, không index. Phải trả status 404/410 thật, hoặc redirect 301 về trang phù hợp.`,
      area: "indexability",
      googleOfficial: true,
    });
  }

  return { issues, signals };
}

// ─────────────────────────────────────────────────────────────────
// Check 11: Pagination canonical
// Google deprecated rel=next/prev (2019). Best practice mới:
//   - Mỗi paginated URL có self-canonical (KHÔNG canonical về page 1)
//   - Có crawlable <a href> đến mọi page trong dãy
// Thường thấy: site set canonical của /page/2/ về /page/1/ → Google chỉ
// index page 1, mất content ở các page sau.
// ─────────────────────────────────────────────────────────────────
const PAGINATION_PATTERNS = [
  /[/?](page|pg|p)[/=]\d+/i,
  /[/?]offset[=]\d+/i,
  /[/?]start[=]\d+/i,
];

function isPaginatedUrl(url) {
  return PAGINATION_PATTERNS.some((p) => p.test(url));
}

function paginationBaseUrl(url) {
  // Strip pagination param to find "page 1"
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/(page|pg|p)\/\d+\/?$/i, "/");
    u.pathname = path;
    u.searchParams.delete("page");
    u.searchParams.delete("pg");
    u.searchParams.delete("p");
    u.searchParams.delete("offset");
    u.searchParams.delete("start");
    return u.toString().replace(/\/$/, "");
  } catch { return null; }
}

export function analyzePaginationCanonical(pages, signalsByUrl) {
  const issues = [];
  const summary = { paginatedUrls: 0, badCanonicals: 0, examples: [] };

  for (const p of pages) {
    const url = p.finalUrl || p.url;
    if (!isPaginatedUrl(url)) continue;
    summary.paginatedUrls++;

    const sig = signalsByUrl.get(url);
    if (!sig?.canonical) continue;
    let canonAbs;
    try { canonAbs = new URL(sig.canonical, url).toString().replace(/\/$/, ""); }
    catch { continue; }

    const cleanUrl = url.replace(/\/$/, "");
    if (canonAbs === cleanUrl) continue; // self-canonical OK

    const base = paginationBaseUrl(url);
    if (base && (canonAbs === base || canonAbs.replace(/\/$/, "") === base.replace(/\/$/, ""))) {
      // Canonical trỏ về page 1 → Google sẽ chỉ index page 1
      summary.badCanonicals++;
      if (summary.examples.length < 5) summary.examples.push({ url, canonical: canonAbs });
    }
  }

  if (summary.badCanonicals >= 3) {
    issues.push({
      severity: "warning",
      code: "PAGINATION_CANONICAL_TO_PAGE_1",
      message: `${summary.badCanonicals} paginated URL có canonical trỏ về page 1 — Google chỉ index page 1, mất content ở page 2+. Best practice (2025): self-canonical mỗi paginated URL.`,
      area: "indexability",
      googleOfficial: true,
    });
  }

  return { issues, summary };
}

// ─────────────────────────────────────────────────────────────────
// Check 12: Crawlable links best practices
// Google guide /links-crawlable: link phải là <a href="URL">. JS navigation
// qua onclick/router không được crawl. Phát hiện:
//  - Element có onclick mà không có <a href>
//  - <a> không có href attribute
//  - <a href="javascript:..."> hoặc href="#" hoặc href=""
// ─────────────────────────────────────────────────────────────────
export async function analyzeCrawlableLinks(page) {
  const issues = [];
  const signals = { aWithoutHref: 0, jsLinks: 0, hashOnlyLinks: 0, onclickNonAnchor: 0 };
  if (!page.html) return { issues, signals };

  const cheerio = await getCheerio();
  const $ = cheerio.load(page.html);

  // <a> không có href
  $("a:not([href])").each(() => signals.aWithoutHref++);
  // <a href="javascript:..."> hoặc "#" rỗng
  $("a[href]").each((_, el) => {
    const h = ($(el).attr("href") || "").trim();
    if (/^javascript:/i.test(h)) signals.jsLinks++;
    else if (h === "#" || h === "") signals.hashOnlyLinks++;
  });
  // Element có onclick mà không phải <a> hoặc <button>
  $("[onclick]").each((_, el) => {
    if (el.tagName !== "a" && el.tagName !== "button") signals.onclickNonAnchor++;
  });

  if (signals.onclickNonAnchor >= 5) {
    issues.push({
      severity: "warning",
      code: "JS_NAVIGATION_ON_NON_ANCHOR",
      message: `${signals.onclickNonAnchor} elements (span/div) có onclick — Googlebot không crawl được làm navigation. Dùng <a href="..."> để link crawlable, có thể stylize bằng CSS giống button.`,
      area: "javascript-seo",
      googleOfficial: true,
    });
  }
  if (signals.jsLinks >= 3) {
    issues.push({
      severity: "info",
      code: "JAVASCRIPT_HREF",
      message: `${signals.jsLinks} link href="javascript:..." — không crawl được, không có anchor text value. Dùng <button> nếu là action, <a href="real-url"> nếu là navigation.`,
      area: "javascript-seo",
      googleOfficial: true,
    });
  }
  if (signals.aWithoutHref >= 5) {
    issues.push({
      severity: "info",
      code: "ANCHOR_WITHOUT_HREF",
      message: `${signals.aWithoutHref} thẻ <a> không có href — không crawl được, không có giá trị SEO. Dùng <button> nếu là action, hoặc thêm href.`,
      area: "javascript-seo",
      googleOfficial: true,
    });
  }

  return { issues, signals };
}

// ─────────────────────────────────────────────────────────────────
// Aggregate: chạy tất cả check site-level + page-level cần thiết
// ─────────────────────────────────────────────────────────────────
export function analyzeSiteForGoogleAI({ robotsTxt, pages, signalsByUrl }) {
  const issues = [];
  const summary = {};

  const gb = analyzeGooglebotAccess(robotsTxt);
  issues.push(...gb.issues);
  summary.googlebot = {
    blocked: gb.googlebotBlocked,
    partiallyBlocked: gb.googlebotPartiallyBlocked,
    blockedSections: gb.blockedSections.slice(0, 10),
  };

  const cb = analyzeCrawlBudgetWaste(pages);
  issues.push(...cb.issues);
  summary.crawlBudget = { wasteUrls: cb.total, breakdown: cb.summary };

  const tc = analyzeTopicClusters(pages, signalsByUrl);
  issues.push(...tc.issues);
  summary.topicClusters = tc.summary;

  const pc = analyzePaginationCanonical(pages, signalsByUrl);
  issues.push(...pc.issues);
  summary.pagination = pc.summary;

  return { issues, summary };
}
