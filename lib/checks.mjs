/**
 * Per-page deep checks. Returns issues + extracted signals.
 * Issue severity: critical | warning | info
 *
 * v0.4 additions:
 *   - Redirect chain detection (3xx hops, 302 vs 301, length warning)
 *   - Mixed content scan (HTTPS page loading http:// resources)
 *   - A11y baseline (html lang, viewport, form labels, empty buttons/links)
 *   - Hreflang reciprocity validation (site-level)
 *   - Internal-link-to-redirect detection (site-level)
 *   - Per-page score
 */

import * as cheerio from "cheerio";

const BOILERPLATE_SELECTORS = "script, style, noscript, nav, footer, header, aside, [role=navigation], [role=banner], [role=contentinfo]";

export function analyzePage(page, config, ctx = {}) {
  const issues = [];
  const signals = {
    titleLength: 0, descriptionLength: 0,
    h1Count: 0, h2Count: 0, h3Count: 0,
    wordCount: 0, readingTimeMin: 0,
    contentRatio: 0,
    internalLinks: 0, externalLinks: 0,
    images: { total: 0, missingAlt: 0, missingDimensions: 0, oldFormat: 0, lazy: 0, missingLazy: 0 },
    schemas: [],
    schemaTypes: [],
    schemaInvalid: 0,
    openGraph: {},
    twitterCard: {},
    canonical: null,
    robotsMeta: null,
    noindex: false, nofollow: false,
    hreflang: [],
    htmlLang: null,
    hasViewport: false,
    ssl: page.finalUrl.startsWith("https://"),
    headingHierarchy: { ok: true, problems: [] },
    duplicateAnchors: [],
    nofollowExternalRatio: 0,
    a11y: { formInputs: 0, formInputsWithLabel: 0, emptyLinks: 0, emptyButtons: 0 },
    mixedContent: { count: 0, samples: [] },
    redirectChain: page.redirectChain || [],
    redirectHops: page.redirectHops || 0,
  };

  // ── Redirect chain analysis (independent of html availability)
  if (page.redirectChain && page.redirectChain.length > 0) {
    // 302 dùng để redirect "permanent" là lỗi rất phổ biến
    const has302 = page.redirectChain.some((c) => c.status === 302);
    if (has302) {
      issues.push({
        severity: "info",
        code: "REDIRECT_302_USED",
        message: `Redirect dùng 302 (Found) thay vì 301 (Permanent) — Google không dồn link equity hiệu quả`,
        area: "technical",
      });
    }
    if (page.redirectChain.length >= 3) {
      issues.push({
        severity: "warning",
        code: "REDIRECT_CHAIN_LONG",
        message: `Redirect chain dài ${page.redirectChain.length} hops — mỗi hop tốn ~100-300ms, nên redirect 1 lần thẳng tới đích`,
        area: "technical",
      });
    } else if (page.redirectChain.length >= 2) {
      issues.push({
        severity: "info",
        code: "REDIRECT_CHAIN_MEDIUM",
        message: `Redirect chain ${page.redirectChain.length} hops — gộp lại thành 1 redirect trực tiếp`,
        area: "technical",
      });
    }
  }

  if (!page.html) {
    if (page.status >= 400) issues.push({ severity: "critical", code: `HTTP_${page.status}`, message: `URL trả về HTTP ${page.status}`, area: "technical" });
    if (page.error) issues.push({ severity: "critical", code: "FETCH_ERROR", message: `Không fetch được: ${page.error}`, area: "technical" });
    return { issues, signals };
  }

  const $ = cheerio.load(page.html);

  // ── HTML lang attribute (a11y + i18n signal)
  const htmlLang = ($("html").attr("lang") || "").trim();
  signals.htmlLang = htmlLang || null;
  if (!htmlLang) {
    issues.push({
      severity: "warning",
      code: "HTML_LANG_MISSING",
      message: "Thiếu thuộc tính lang trên thẻ <html> — search engine khó xác định ngôn ngữ, screen reader đọc sai",
      area: "accessibility",
    });
  }

  // ── Viewport meta (mobile-friendly + a11y)
  const viewport = ($('meta[name="viewport"]').attr("content") || "").trim();
  signals.hasViewport = !!viewport;
  if (!viewport) {
    issues.push({
      severity: "warning",
      code: "VIEWPORT_MISSING",
      message: "Thiếu meta viewport — trang không responsive trên mobile, Google đánh giá thấp",
      area: "accessibility",
    });
  }

  // ── Title
  const title = ($("head > title").first().text() || "").trim();
  signals.title = title;
  signals.titleLength = title.length;
  if (!title) issues.push({ severity: "critical", code: "TITLE_MISSING", message: "Thiếu thẻ <title>", area: "on-page" });
  else if (title.length < config.titleMinLength) issues.push({ severity: "info", code: "TITLE_SHORT", message: `Title ngắn (${title.length} ký tự)`, area: "on-page" });
  else if (title.length > config.titleMaxLength) issues.push({ severity: "info", code: "TITLE_LONG", message: `Title dài (${title.length} ký tự)`, area: "on-page" });

  // ── Meta description
  const desc = ($('meta[name="description"]').attr("content") || "").trim();
  signals.description = desc;
  signals.descriptionLength = desc.length;
  if (!desc) issues.push({ severity: "warning", code: "META_DESC_MISSING", message: "Thiếu meta description", area: "on-page" });
  else if (desc.length < config.metaMinLength) issues.push({ severity: "info", code: "META_DESC_SHORT", message: `Meta description ngắn (${desc.length} ký tự)`, area: "on-page" });
  else if (desc.length > config.metaMaxLength) issues.push({ severity: "info", code: "META_DESC_LONG", message: `Meta description dài (${desc.length} ký tự)`, area: "on-page" });

  // ── Headings
  signals.h1Count = $("h1").length;
  signals.h2Count = $("h2").length;
  signals.h3Count = $("h3").length;
  if (signals.h1Count === 0) issues.push({ severity: "warning", code: "H1_MISSING", message: "Không có thẻ H1", area: "on-page" });
  else if (signals.h1Count > 1) issues.push({ severity: "warning", code: "H1_MULTIPLE", message: `Có ${signals.h1Count} thẻ H1 (nên chỉ 1)`, area: "on-page" });

  // Heading hierarchy check (vd: H3 trước khi có H2)
  const headings = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    headings.push(parseInt(el.tagName.replace(/^h/i, ""), 10));
  });
  let hierarchyProblems = [];
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] > headings[i - 1] + 1) {
      hierarchyProblems.push(`H${headings[i - 1]} → H${headings[i]} (skip)`);
    }
  }
  if (hierarchyProblems.length > 0) {
    signals.headingHierarchy = { ok: false, problems: hierarchyProblems };
    issues.push({ severity: "warning", code: "HEADING_HIERARCHY", message: `Heading skip cấp: ${hierarchyProblems.slice(0, 3).join(", ")}${hierarchyProblems.length > 3 ? "..." : ""}`, area: "content" });
  }

  // ── Canonical
  const canonical = ($('link[rel="canonical"]').attr("href") || "").trim();
  signals.canonical = canonical || null;
  if (canonical) {
    try {
      const abs = new URL(canonical, page.finalUrl).toString();
      const sameOrigin = new URL(abs).origin === new URL(page.finalUrl).origin;
      if (!sameOrigin) issues.push({ severity: "critical", code: "CANONICAL_CROSS_DOMAIN", message: `Canonical sang domain khác: ${abs}`, area: "technical" });
      else if (abs !== page.finalUrl && !abs.startsWith(page.finalUrl.split("?")[0])) {
        // soft warning — canonical khác URL hiện tại
        issues.push({ severity: "info", code: "CANONICAL_DIFFERENT", message: `Canonical khác URL: ${abs}`, area: "technical" });
      }
    } catch {
      issues.push({ severity: "critical", code: "CANONICAL_INVALID", message: `Canonical không hợp lệ: ${canonical}`, area: "technical" });
    }
  }

  // ── Robots meta
  const robotsMeta = ($('meta[name="robots"]').attr("content") || "").toLowerCase();
  signals.robotsMeta = robotsMeta || null;
  signals.noindex = /noindex/.test(robotsMeta);
  signals.nofollow = /nofollow/.test(robotsMeta);
  if (signals.noindex) issues.push({ severity: "critical", code: "META_NOINDEX", message: "Trang có meta robots noindex", area: "indexability" });
  if (signals.nofollow) issues.push({ severity: "warning", code: "META_NOFOLLOW", message: "Trang có meta robots nofollow", area: "indexability" });

  // ── Hreflang
  const hreflangs = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    hreflangs.push({ hreflang: $(el).attr("hreflang"), href: $(el).attr("href") });
  });
  signals.hreflang = hreflangs;

  // ── Mixed content scan (HTTPS page loading http:// resource)
  if (signals.ssl) {
    const mixedSamples = [];
    let mixedCount = 0;
    const checkAttr = (sel, attr) => {
      $(sel).each((_, el) => {
        const v = ($(el).attr(attr) || "").trim();
        if (/^http:\/\//i.test(v)) {
          mixedCount++;
          if (mixedSamples.length < 5) mixedSamples.push({ tag: el.tagName, attr, url: v });
        }
      });
    };
    checkAttr("img[src]", "src");
    checkAttr("script[src]", "src");
    checkAttr("link[rel=stylesheet][href]", "href");
    checkAttr("iframe[src]", "src");
    checkAttr("video[src]", "src");
    checkAttr("audio[src]", "src");
    checkAttr("source[src]", "src");

    signals.mixedContent = { count: mixedCount, samples: mixedSamples };
    if (mixedCount > 0) {
      issues.push({
        severity: mixedCount >= 5 ? "critical" : "warning",
        code: "MIXED_CONTENT",
        message: `Trang HTTPS load ${mixedCount} resource HTTP — browser sẽ block hoặc cảnh báo (${mixedSamples.slice(0, 2).map((s) => s.tag + ":" + s.url).join(", ")}${mixedCount > 2 ? "..." : ""})`,
        area: "security",
      });
    }
  }

  // ── Word count (loại boilerplate)
  const $clone = cheerio.load(page.html);
  $clone(BOILERPLATE_SELECTORS).remove();
  const mainText = $clone("body").text().replace(/\s+/g, " ").trim();
  signals.wordCount = mainText ? mainText.split(/\s+/).length : 0;
  signals.readingTimeMin = Math.max(1, Math.round(signals.wordCount / 220));
  const totalHtmlBytes = Buffer.byteLength(page.html, "utf8");
  const textBytes = Buffer.byteLength(mainText, "utf8");
  signals.contentRatio = totalHtmlBytes > 0 ? Math.round((textBytes / totalHtmlBytes) * 1000) / 10 : 0;

  if (signals.wordCount < config.thinContentMinWords && !signals.noindex) {
    issues.push({ severity: "warning", code: "THIN_CONTENT", message: `Trang ngắn (${signals.wordCount} từ, nên ≥ ${config.thinContentMinWords})`, area: "content" });
  }
  if (signals.contentRatio < 10) {
    issues.push({ severity: "info", code: "LOW_CONTENT_RATIO", message: `Tỉ lệ text/HTML thấp (${signals.contentRatio}%) — boilerplate quá nhiều`, area: "content" });
  }

  // ── Images deep
  const imgs = $("img");
  signals.images.total = imgs.length;
  let oldFormat = 0, missingAlt = 0, missingDim = 0, lazy = 0, missingLazy = 0;
  imgs.each((_, el) => {
    const alt = $(el).attr("alt");
    if (alt === undefined || alt.trim() === "") missingAlt++;
    const w = $(el).attr("width"), h = $(el).attr("height");
    if (!w || !h) missingDim++;
    const src = ($(el).attr("src") || $(el).attr("data-src") || "").toLowerCase();
    if (/\.(jpg|jpeg|png|gif)(\?|$)/.test(src)) oldFormat++;
    const loading = ($(el).attr("loading") || "").toLowerCase();
    if (loading === "lazy") lazy++;
    else missingLazy++;
  });
  signals.images = { total: imgs.length, missingAlt, missingDimensions: missingDim, oldFormat, lazy, missingLazy };

  if (missingAlt >= 5) issues.push({ severity: "warning", code: "IMG_ALT_MISSING", message: `${missingAlt}/${imgs.length} ảnh thiếu alt`, area: "accessibility" });
  else if (missingAlt > 0) issues.push({ severity: "info", code: "IMG_ALT_FEW_MISSING", message: `${missingAlt}/${imgs.length} ảnh thiếu alt`, area: "accessibility" });

  if (missingDim >= 5) issues.push({ severity: "warning", code: "IMG_NO_DIMENSIONS", message: `${missingDim}/${imgs.length} ảnh thiếu width/height (gây CLS)`, area: "performance" });
  if (oldFormat >= 5) issues.push({ severity: "info", code: "IMG_OLD_FORMAT", message: `${oldFormat}/${imgs.length} ảnh format cũ (JPG/PNG) — nên dùng WebP/AVIF`, area: "performance" });
  if (missingLazy >= 10) issues.push({ severity: "info", code: "IMG_NO_LAZY", message: `${missingLazy}/${imgs.length} ảnh không có loading="lazy"`, area: "performance" });

  // ── A11y baseline: form labels, empty links/buttons
  const formInputs = $("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), textarea, select");
  let labeledInputs = 0;
  formInputs.each((_, el) => {
    const $el = $(el);
    const id = $el.attr("id");
    const ariaLabel = $el.attr("aria-label");
    const ariaLabelledBy = $el.attr("aria-labelledby");
    const wrappedInLabel = $el.parents("label").length > 0;
    const labelFor = id ? $(`label[for="${id}"]`).length > 0 : false;
    const placeholder = $el.attr("placeholder");
    const title = $el.attr("title");
    if (ariaLabel || ariaLabelledBy || wrappedInLabel || labelFor || placeholder || title) {
      labeledInputs++;
    }
  });
  signals.a11y.formInputs = formInputs.length;
  signals.a11y.formInputsWithLabel = labeledInputs;
  const unlabeled = formInputs.length - labeledInputs;
  if (unlabeled >= 2) {
    issues.push({
      severity: "warning",
      code: "FORM_INPUT_NO_LABEL",
      message: `${unlabeled}/${formInputs.length} input không có label / aria-label / placeholder — screen reader không đọc được`,
      area: "accessibility",
    });
  }

  // Empty links / buttons
  let emptyLinks = 0;
  $("a[href]").each((_, el) => {
    const $a = $(el);
    const text = ($a.text() || "").trim();
    const aria = $a.attr("aria-label");
    const title = $a.attr("title");
    const hasImg = $a.find("img[alt]").filter((_, img) => ($(img).attr("alt") || "").trim().length > 0).length > 0;
    if (!text && !aria && !title && !hasImg) emptyLinks++;
  });
  let emptyButtons = 0;
  $("button").each((_, el) => {
    const $b = $(el);
    const text = ($b.text() || "").trim();
    const aria = $b.attr("aria-label");
    const title = $b.attr("title");
    if (!text && !aria && !title) emptyButtons++;
  });
  signals.a11y.emptyLinks = emptyLinks;
  signals.a11y.emptyButtons = emptyButtons;
  if (emptyLinks >= 3) {
    issues.push({
      severity: "info",
      code: "EMPTY_LINKS",
      message: `${emptyLinks} thẻ <a> không có text/aria-label/img alt — screen reader không đọc được`,
      area: "accessibility",
    });
  }
  if (emptyButtons >= 1) {
    issues.push({
      severity: "info",
      code: "EMPTY_BUTTONS",
      message: `${emptyButtons} thẻ <button> không có text/aria-label`,
      area: "accessibility",
    });
  }

  // ── Links analysis
  const linkHrefs = [];
  const anchorMap = new Map(); // anchor → count
  let internal = 0, external = 0, externalNofollow = 0;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;
    let abs;
    try { abs = new URL(href, page.finalUrl).toString(); } catch { return; }
    const isInternal = new URL(abs).origin === new URL(page.finalUrl).origin;
    if (isInternal) internal++;
    else {
      external++;
      const rel = ($(el).attr("rel") || "").toLowerCase();
      if (rel.includes("nofollow") || rel.includes("ugc") || rel.includes("sponsored")) externalNofollow++;
    }
    const anchor = ($(el).text() || "").trim().slice(0, 80);
    if (anchor) {
      anchorMap.set(anchor, (anchorMap.get(anchor) || 0) + 1);
    }
    linkHrefs.push({ href: abs, anchor, internal: isInternal });
  });
  signals.internalLinks = internal;
  signals.externalLinks = external;
  signals.nofollowExternalRatio = external > 0 ? Math.round((externalNofollow / external) * 100) : 0;
  signals.linksRaw = linkHrefs;

  // Generic anchor texts that hurt SEO
  const genericAnchors = ["click here", "click", "tại đây", "đọc thêm", "read more", "ở đây", "here"];
  let genericCount = 0;
  for (const [anchor, count] of anchorMap) {
    if (genericAnchors.includes(anchor.toLowerCase())) genericCount += count;
    if (count >= 5 && anchor.length > 0) {
      signals.duplicateAnchors.push({ anchor, count });
    }
  }
  if (genericCount >= 3) issues.push({ severity: "info", code: "GENERIC_ANCHOR", message: `${genericCount} link có anchor chung chung ("click here", "đọc thêm"…)`, area: "on-page" });

  // ── JSON-LD schema deep validation
  const schemas = [];
  let invalid = 0;
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item) continue;
        const t = item["@type"] || (item["@graph"] && "graph");
        schemas.push({ type: t, valid: true, item });
      }
    } catch (e) {
      invalid++;
      schemas.push({ type: null, valid: false, error: e.message });
    }
  });
  signals.schemas = schemas;
  signals.schemaInvalid = invalid;
  signals.schemaTypes = [...new Set(schemas.filter((s) => s.valid && s.type).flatMap((s) => Array.isArray(s.type) ? s.type : [s.type]))];

  if (invalid > 0) issues.push({ severity: "warning", code: "SCHEMA_INVALID", message: `${invalid} JSON-LD parse lỗi`, area: "schema" });

  // Schema deep — validate required fields cho top types
  for (const s of schemas.filter((x) => x.valid)) {
    const t = Array.isArray(s.type) ? s.type[0] : s.type;
    const validation = validateSchemaItem(t, s.item);
    if (validation.errors.length > 0) {
      issues.push({ severity: "warning", code: "SCHEMA_REQUIRED_MISSING", message: `${t}: thiếu ${validation.errors.join(", ")}`, area: "schema" });
    }
  }

  // ── OpenGraph & Twitter
  const og = {};
  $('meta[property^="og:"]').each((_, el) => { og[$(el).attr("property")] = $(el).attr("content"); });
  signals.openGraph = og;
  const tw = {};
  $('meta[name^="twitter:"]').each((_, el) => { tw[$(el).attr("name")] = $(el).attr("content"); });
  signals.twitterCard = tw;
  if (!og["og:title"] && !og["og:description"] && !og["og:image"]) {
    issues.push({ severity: "info", code: "OG_MISSING", message: "Thiếu OpenGraph tags", area: "on-page" });
  }

  // ── Slow response
  if (page.durationMs > config.slowResponseMs) {
    issues.push({ severity: "info", code: "SLOW_RESPONSE", message: `Phản hồi chậm: ${page.durationMs}ms`, area: "performance" });
  }

  return { issues, signals };
}

// ─────────────────────────────────────────────────────────────────
// Per-page score
// Mục đích: cho khách enterprise filter "trang nào yếu nhất".
// Công thức: 100 - (critical*15 + warning*5 + info*1), floor 0.
// ─────────────────────────────────────────────────────────────────
export function computePageScore(issues) {
  let score = 100;
  for (const i of issues) {
    if (i.severity === "critical") score -= 15;
    else if (i.severity === "warning") score -= 5;
    else if (i.severity === "info") score -= 1;
  }
  return Math.max(0, score);
}

// ─────────────────────────────────────────────────────────────────
// Schema deep validation (rule-based)
// ─────────────────────────────────────────────────────────────────
const SCHEMA_REQUIRED = {
  Article: ["headline", "datePublished", "author"],
  BlogPosting: ["headline", "datePublished", "author"],
  NewsArticle: ["headline", "datePublished", "author"],
  Product: ["name"],
  Review: ["author", "reviewRating"],
  Recipe: ["name", "recipeIngredient", "recipeInstructions"],
  Event: ["name", "startDate", "location"],
  Organization: ["name", "url"],
  WebSite: ["name", "url"],
  BreadcrumbList: ["itemListElement"],
  FAQPage: ["mainEntity"],
  HowTo: ["name", "step"],
  VideoObject: ["name", "thumbnailUrl", "uploadDate"],
};

export function validateSchemaItem(type, item) {
  const errors = [];
  const warnings = [];
  const required = SCHEMA_REQUIRED[type] || [];
  for (const f of required) {
    if (item[f] == null || (Array.isArray(item[f]) && !item[f].length)) {
      errors.push(f);
    }
  }
  return { errors, warnings };
}

// ─────────────────────────────────────────────────────────────────
// Hreflang reciprocity check
// Quy tắc: nếu A khai báo "B là phiên bản X", thì B phải khai báo "A là phiên bản tương ứng".
// Cũng kiểm tra: có x-default không, format hợp lệ không.
// ─────────────────────────────────────────────────────────────────
const VALID_HREFLANG_PATTERN = /^([a-z]{2,3}(-[A-Za-z]{2,4})?|x-default)$/i;

export function checkHreflangReciprocity(pages, signalsByUrl) {
  const issues = [];
  // Map URL → list of {hreflang, href} declared on that page
  const declarations = new Map();
  for (const p of pages) {
    const sig = signalsByUrl.get(p.finalUrl);
    if (!sig?.hreflang || sig.hreflang.length === 0) continue;
    declarations.set(p.finalUrl, sig.hreflang);
  }

  if (declarations.size === 0) return { issues, summary: { totalDeclaring: 0, missingReciprocal: 0, invalidCodes: 0, missingXDefault: 0 } };

  let invalidCodes = 0;
  let missingReciprocal = 0;
  let missingXDefaultGroups = 0;
  const checkedGroups = new Set();

  for (const [pageUrl, hrefs] of declarations) {
    let hasXDefault = false;
    for (const { hreflang, href } of hrefs) {
      if (!hreflang || !VALID_HREFLANG_PATTERN.test(hreflang)) {
        invalidCodes++;
        issues.push({
          severity: "info",
          code: "HREFLANG_INVALID_CODE",
          message: `Mã hreflang không hợp lệ: "${hreflang}" trên ${pageUrl}`,
          area: "i18n",
          url: pageUrl,
        });
        continue;
      }
      if (hreflang.toLowerCase() === "x-default") { hasXDefault = true; continue; }
      // Reciprocity: trang đích phải có hreflang trỏ ngược lại pageUrl
      let absHref;
      try { absHref = new URL(href, pageUrl).toString().split("#")[0]; } catch { continue; }
      const targetDecl = declarations.get(absHref);
      if (!targetDecl) {
        // Trang đích không khai báo hreflang nào hết — có thể là external hoặc chưa crawl
        // Chỉ flag nếu trang đích nằm trong pages đã crawl
        const inCrawl = pages.some((p) => p.finalUrl === absHref || p.url === absHref);
        if (inCrawl) {
          missingReciprocal++;
          if (missingReciprocal <= 5) {
            issues.push({
              severity: "warning",
              code: "HREFLANG_NO_RECIPROCAL",
              message: `${pageUrl} khai báo hreflang "${hreflang}" → ${absHref}, nhưng trang đích không có hreflang ngược lại`,
              area: "i18n",
              url: pageUrl,
            });
          }
        }
      } else {
        // Trang đích phải có hreflang trỏ về pageUrl
        const hasReverse = targetDecl.some(({ href: h }) => {
          try { return new URL(h, absHref).toString().split("#")[0] === pageUrl; }
          catch { return false; }
        });
        if (!hasReverse) {
          missingReciprocal++;
          if (missingReciprocal <= 5) {
            issues.push({
              severity: "warning",
              code: "HREFLANG_NO_RECIPROCAL",
              message: `${pageUrl} ↔ ${absHref} không có hreflang qua lại đầy đủ`,
              area: "i18n",
              url: pageUrl,
            });
          }
        }
      }
    }
    // x-default chỉ cần 1 group có là OK; flag ở mức site nếu CẢ site không có x-default nào
    if (hasXDefault) checkedGroups.add(pageUrl);
  }

  // Site-level: nếu có hreflang declarations nhưng không trang nào có x-default
  if (declarations.size > 0 && checkedGroups.size === 0) {
    missingXDefaultGroups = declarations.size;
    issues.push({
      severity: "info",
      code: "HREFLANG_NO_X_DEFAULT",
      message: `${declarations.size} trang khai báo hreflang nhưng không có x-default — Google không biết fallback cho ngôn ngữ chưa được khai báo`,
      area: "i18n",
    });
  }

  return {
    issues,
    summary: {
      totalDeclaring: declarations.size,
      missingReciprocal,
      invalidCodes,
      missingXDefault: missingXDefaultGroups,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Internal links pointing to redirects / 4xx
// Phát hiện trang nào chứa internal link tới URL bị redirect → lãng phí
// crawl budget, mất link equity.
// ─────────────────────────────────────────────────────────────────
export function checkInternalRedirectLinks(pages, signalsByUrl) {
  const issues = [];
  // Build status map: cleanUrl (no fragment) → {status, redirected, finalUrl}
  const statusMap = new Map();
  for (const p of pages) {
    statusMap.set(p.url.split("#")[0], { status: p.status, redirected: p.redirected, finalUrl: p.finalUrl, hops: p.redirectHops || 0 });
    if (p.finalUrl && p.finalUrl !== p.url) {
      statusMap.set(p.finalUrl.split("#")[0], { status: p.status, redirected: false, finalUrl: p.finalUrl, hops: 0 });
    }
  }

  let linksToRedirect = 0;
  let linksToBroken = 0;
  const redirectExamples = [];
  const brokenExamples = [];

  for (const [sourceUrl, sig] of signalsByUrl) {
    const links = sig.linksRaw || [];
    for (const l of links) {
      if (!l.internal) continue;
      const target = l.href.split("#")[0];
      const meta = statusMap.get(target);
      if (!meta) continue;
      if (meta.redirected && target !== meta.finalUrl) {
        linksToRedirect++;
        if (redirectExamples.length < 5) redirectExamples.push({ source: sourceUrl, target, finalUrl: meta.finalUrl });
      } else if (meta.status >= 400) {
        linksToBroken++;
        if (brokenExamples.length < 5) brokenExamples.push({ source: sourceUrl, target, status: meta.status });
      }
    }
  }

  if (linksToRedirect >= 3) {
    issues.push({
      severity: "warning",
      code: "INTERNAL_LINK_TO_REDIRECT",
      message: `${linksToRedirect} internal link trỏ tới URL bị redirect — nên cập nhật link trỏ thẳng tới URL đích để tiết kiệm crawl budget`,
      area: "internal-linking",
    });
  }
  if (linksToBroken > 0) {
    issues.push({
      severity: "warning",
      code: "INTERNAL_LINK_TO_BROKEN",
      message: `${linksToBroken} internal link trỏ tới URL trả 4xx/5xx`,
      area: "internal-linking",
    });
  }

  return {
    issues,
    summary: {
      linksToRedirect,
      linksToBroken,
      redirectExamples,
      brokenExamples,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Site-level analysis
// ─────────────────────────────────────────────────────────────────
export function analyzeSite(pages, allInternalLinks, signalsByUrl) {
  const issues = [];

  // Duplicate title / meta
  const titleMap = new Map();
  const descMap = new Map();
  for (const [url, sig] of signalsByUrl) {
    if (sig.title) {
      if (!titleMap.has(sig.title)) titleMap.set(sig.title, []);
      titleMap.get(sig.title).push(url);
    }
    if (sig.description) {
      if (!descMap.has(sig.description)) descMap.set(sig.description, []);
      descMap.get(sig.description).push(url);
    }
  }
  const duplicateTitles = [...titleMap.entries()].filter(([, urls]) => urls.length > 1).map(([value, urls]) => ({ value, urls }));
  const duplicateDescs = [...descMap.entries()].filter(([, urls]) => urls.length > 1).map(([value, urls]) => ({ value, urls }));
  if (duplicateTitles.length) issues.push({ severity: "warning", code: "DUPLICATE_TITLE", message: `${duplicateTitles.length} nhóm title trùng`, area: "on-page" });
  if (duplicateDescs.length) issues.push({ severity: "warning", code: "DUPLICATE_META", message: `${duplicateDescs.length} nhóm meta description trùng`, area: "on-page" });

  // Orphan pages: trong page list nhưng không URL nào link tới
  const linkedTo = new Set();
  for (const targets of allInternalLinks.values()) {
    for (const t of targets) linkedTo.add(t);
  }
  const orphans = [];
  for (const p of pages) {
    if (p.depth === 0) continue; // homepage không tính
    if (!linkedTo.has(p.finalUrl) && !linkedTo.has(p.url)) orphans.push(p.finalUrl || p.url);
  }
  if (orphans.length > 0) {
    issues.push({ severity: "warning", code: "ORPHAN_PAGES", message: `${orphans.length} trang không có internal link tới (orphan)`, area: "internal-linking" });
  }

  // SSL site-wide
  const httpsCount = pages.filter((p) => (p.finalUrl || p.url).startsWith("https://")).length;
  if (httpsCount < pages.length) {
    issues.push({ severity: "critical", code: "MIXED_HTTP", message: `${pages.length - httpsCount} trang chưa dùng HTTPS`, area: "technical" });
  }

  return { issues, duplicateTitles, duplicateDescs, orphans };
}

// ─────────────────────────────────────────────────────────────────
// Broken link checker (HEAD requests on sample)
// ─────────────────────────────────────────────────────────────────
export async function checkBrokenLinks(linkSet, config, onProgress) {
  const sample = [...linkSet].slice(0, config.brokenLinkSampleLimit);
  const results = [];
  const concurrency = 10;
  let idx = 0;

  async function worker() {
    while (idx < sample.length) {
      const url = sample[idx++];
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        let res;
        try {
          res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal, headers: { "user-agent": config.userAgent } });
          // Một số server không support HEAD → fallback GET
          if (res.status === 405 || res.status === 501) {
            res = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { "user-agent": config.userAgent } });
          }
        } finally { clearTimeout(t); }
        results.push({ url, status: res.status, ok: res.status < 400 });
      } catch (e) {
        results.push({ url, status: 0, ok: false, error: e.message });
      }
      if (onProgress) onProgress({ done: results.length, total: sample.length });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { sample: sample.length, total: linkSet.size, results, broken: results.filter((r) => !r.ok) };
}
