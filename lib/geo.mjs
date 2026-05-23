/**
 * GEO (Generative Engine Optimization) checks.
 *
 * Phân tích site có sẵn sàng cho thời AI Search hay không:
 * Google AI Overview, ChatGPT Search, Perplexity, Claude, Gemini, Bing Copilot.
 *
 * 12 check offline — không cần API, không cần network ngoài fetch /llms.txt.
 *
 * Trả về:
 *   - perPage: signals & issues cho từng trang
 *   - site: signals & issues cấp site
 *   - score: GEO Score 0-100 (song song với SEO Score)
 */

// cheerio chỉ cần khi parse HTML cho từng trang — dynamic import để
// các pure function (rules, scoring) chạy được không cần dependency.
let _cheerio = null;
async function getCheerio() {
  if (!_cheerio) _cheerio = await import("cheerio");
  return _cheerio;
}

const AI_BOTS = [
  "GPTBot",          // OpenAI / ChatGPT
  "OAI-SearchBot",   // ChatGPT Search
  "ChatGPT-User",    // ChatGPT browsing
  "ClaudeBot",       // Anthropic Claude
  "anthropic-ai",
  "PerplexityBot",   // Perplexity
  "Perplexity-User",
  "Google-Extended", // Google Bard / Gemini training
  "Bingbot",         // Bing / Copilot (cũng là search bot)
  "CCBot",           // Common Crawl (training data)
  "Applebot-Extended",
];

const STAT_PATTERNS = [
  /\b\d+([.,]\d+)?\s*%/g,                   // "30%", "12.5%"
  /\b\d{3,}([.,]\d+)?\b/g,                  // ">= 100": "1500", "1.500"
  /\b(20|19)\d{2}\b/g,                      // năm "2024", "1999"
  /\$\s?\d+/g,                              // "$10"
  /\b\d+([.,]\d+)?\s*(triệu|tỷ|nghìn|VND|USD|đồng|k|M|B)\b/gi,
];

const CITATION_PATTERNS = [
  /\btheo\s+\w+/gi,                         // "theo Google", "theo nghiên cứu"
  /\bnguồn\s*:/gi,
  /\baccording to\b/gi,
  /\bresearch (shows|found|by)\b/gi,
  /\bstudy (shows|by|of)\b/gi,
  /\bdữ liệu\s+(từ|của|cho)/gi,
];

const QA_PATTERNS = [
  /\?\s*$/m,                                // câu hỏi
];

// Trust pages: LLM ưu tiên cite site có thông tin tổ chức/tác giả/chính sách rõ ràng
const TRUST_PAGE_PATTERNS = {
  about: /\/(about|gioi-thieu|ve-chung-toi|about-us)\/?(\?|$|#)/i,
  contact: /\/(contact|lien-he|contact-us)\/?(\?|$|#)/i,
  privacy: /\/(privacy|privacy-policy|chinh-sach-bao-mat|chinh-sach-rieng-tu)\/?(\?|$|#)/i,
  terms: /\/(terms|terms-of-service|tos|dieu-khoan|dieu-khoan-su-dung)\/?(\?|$|#)/i,
};

// Trusted "sameAs" platforms — knowledge graph signal cho LLM
const TRUSTED_SAMEAS_DOMAINS = [
  "linkedin.com",
  "twitter.com", "x.com",
  "facebook.com",
  "wikipedia.org", "wikidata.org",
  "crunchbase.com",
  "github.com",
  "youtube.com",
  "instagram.com",
];

const DEFINITION_PATTERNS = [
  /\b(\w[\w\s]{2,30}?)\s+là\s+(gì|một|những)/gi,    // "X là gì", "X là một"
  /\bnghĩa là\b/gi,
  /\bđược định nghĩa\b/gi,
  /\b\w+\s+is\s+(a|an|the)\b/gi,
];

// ─────────────────────────────────────────────────────────────────
// Check 1-2: llms.txt + robots.txt AI bots
// ─────────────────────────────────────────────────────────────────
export async function checkLlmsTxt(origin, fetchFn) {
  // GET /llms.txt
  try {
    const res = await fetchFn(origin + "/llms.txt");
    if (!res.ok) return { exists: false, status: res.status };
    const text = await res.text();
    const isMarkdown = /^#\s+/m.test(text);
    const sections = (text.match(/^##\s+.+$/gm) || []).length;
    const links = (text.match(/^-\s*\[.+\]\(.+\)/gm) || []).length;
    return {
      exists: true,
      status: res.status,
      bytes: text.length,
      isMarkdown,
      sections,
      links,
      raw: text.slice(0, 500),
    };
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

export function analyzeRobotsForAI(robotsTxtContent) {
  if (!robotsTxtContent) return { aiAccess: "unknown", blockedBots: [], allowedBots: [], hasGoogleExtended: false };

  const blockedBots = [];
  const allowedBots = [];
  let activeUA = null;
  let activeIsAi = false;
  const text = robotsTxtContent.raw || robotsTxtContent;

  for (const lineRaw of String(text).split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();

    if (key === "user-agent") {
      activeUA = val;
      activeIsAi = AI_BOTS.some((b) => b.toLowerCase() === val.toLowerCase());
      continue;
    }

    if (activeIsAi) {
      if (key === "disallow" && val === "/") {
        if (!blockedBots.includes(activeUA)) blockedBots.push(activeUA);
      } else if (key === "allow" || (key === "disallow" && val !== "/")) {
        if (!allowedBots.includes(activeUA)) allowedBots.push(activeUA);
      }
    }
  }

  let aiAccess;
  if (blockedBots.length === 0) aiAccess = "open";
  else if (blockedBots.length >= 3) aiAccess = "mostly-blocked";
  else aiAccess = "partially-blocked";

  return {
    aiAccess,
    blockedBots,
    allowedBots,
    hasGoogleExtended: blockedBots.includes("Google-Extended") || allowedBots.includes("Google-Extended"),
  };
}

// ─────────────────────────────────────────────────────────────────
// Check 3-12: per-page signals
// ─────────────────────────────────────────────────────────────────
export async function analyzePageGeo(page) {
  const issues = [];
  const signals = {
    citabilityScore: 0,
    statisticsCount: 0,
    citationsCount: 0,
    definitionCount: 0,
    questionCount: 0,
    hasFAQ: false,
    hasTLDR: false,
    hasLastUpdated: false,
    hasAuthorBio: false,
    chunkability: { score: 0, h2Count: 0, h2WithContent: 0, avgChunkWords: 0 },
    schemasForAI: [],
    multimodal: { hasImages: 0, hasImageAlt: 0, hasVideo: 0, hasVideoTranscript: 0 },
    entityClarity: { hasOrganization: false, hasPerson: false, hasAbout: false },
  };

  if (!page.html) return { issues, signals };

  const cheerio = await getCheerio();
  const $ = cheerio.load(page.html);

  // Strip boilerplate cho text analysis
  const $clone = cheerio.load(page.html);
  $clone("script, style, noscript, nav, footer, header, aside").remove();
  const mainText = $clone("body").text().replace(/\s+/g, " ").trim();
  const wordCount = mainText ? mainText.split(/\s+/).length : 0;

  // ── Check 3: Statistics density
  let statCount = 0;
  for (const pattern of STAT_PATTERNS) {
    const matches = mainText.match(pattern);
    if (matches) statCount += matches.length;
  }
  signals.statisticsCount = statCount;
  const statDensity = wordCount > 0 ? (statCount / wordCount) * 1000 : 0; // per 1000 words
  if (statDensity < 2 && wordCount > 300) {
    issues.push({ severity: "info", code: "GEO_LOW_STATS", message: `Ít số liệu cụ thể (${statCount} trong ${wordCount} từ) — LLM ít cite trang không có data`, area: "ai-search" });
  }

  // ── Check 4: Citations / "according to..."
  let citCount = 0;
  for (const pattern of CITATION_PATTERNS) {
    const matches = mainText.match(pattern);
    if (matches) citCount += matches.length;
  }
  signals.citationsCount = citCount;
  if (citCount === 0 && wordCount > 500) {
    issues.push({ severity: "info", code: "GEO_NO_CITATIONS", message: "Không có 'theo X', 'nguồn:', 'according to' — LLM thích trang có cite nguồn", area: "ai-search" });
  }

  // ── Check 5: Definitions ("X là Y")
  let defCount = 0;
  for (const pattern of DEFINITION_PATTERNS) {
    const matches = mainText.match(pattern);
    if (matches) defCount += matches.length;
  }
  signals.definitionCount = defCount;

  // ── Check 6: Question / Q&A format
  // Regex cũ /[^.!?]*\?/g match cả "?" trong URL/query string nhúng vào text.
  // Nay chỉ đếm câu hỏi thực: kết thúc bằng "?" sau ít nhất 1 ký tự chữ.
  const sentenceEndQuestions = mainText.match(/[A-Za-zÀ-ỹ][^.!?\n]{3,}\?/g) || [];
  signals.questionCount = sentenceEndQuestions.length;

  // ── Check 7: TL;DR / summary at top
  const firstChars = mainText.slice(0, 1000).toLowerCase();
  signals.hasTLDR = /\btl;?dr\b|tóm tắt|tóm lược|key takeaway|in short|nhanh gọn:/.test(firstChars);

  // ── Check 8: FAQ section
  const faqHeadings = $("h2, h3").filter((_, el) => /faq|câu hỏi thường gặp|q&a|frequently asked/i.test($(el).text())).length;
  const faqSchema = page.signals?.schemaTypes?.includes("FAQPage") || pageHasFaqSchema($);
  signals.hasFAQ = faqHeadings > 0 || faqSchema;
  if (!signals.hasFAQ && wordCount > 500) {
    issues.push({ severity: "info", code: "GEO_NO_FAQ", message: "Không có FAQ section — LLM rất ưa cite từ FAQ format", area: "ai-search" });
  }

  // ── Check 9: Last updated date
  const dateText = $("body").text();
  signals.hasLastUpdated = /cập nhật|last updated|updated on|sửa đổi/i.test(dateText) || $('time[datetime]').length > 0 || $('meta[property="article:modified_time"]').length > 0;
  if (!signals.hasLastUpdated && wordCount > 300) {
    issues.push({ severity: "info", code: "GEO_NO_DATE", message: "Không có ngày cập nhật rõ ràng — LLM ưu tiên content mới", area: "ai-search" });
  }

  // ── Check 10: Author bio + E-E-A-T signals
  const hasAuthorMeta = !!$('meta[name="author"]').attr("content");
  const hasAuthorBio = $('[rel~="author"], .author-bio, .post-author, [itemtype*="Person"]').length > 0;
  const hasPersonSchema = pageHasPersonSchema($);
  signals.hasAuthorBio = hasAuthorMeta || hasAuthorBio || hasPersonSchema;
  if (!signals.hasAuthorBio && wordCount > 500) {
    issues.push({ severity: "warning", code: "GEO_NO_AUTHOR", message: "Không có thông tin tác giả/E-E-A-T — LLM cần biết 'ai viết' để tin tưởng cite", area: "ai-search" });
  }

  // ── Check 11: Content chunkability (mỗi H2 có nội dung độc lập?)
  // Đồng thời check direct-answer paragraph: ngay sau H2 có 1 đoạn 40-80 từ
  // trả lời thẳng câu hỏi (format LLM cite nhiều nhất).
  const h2s = $("h2");
  let h2WithContent = 0;
  let totalChunkWords = 0;
  let chunkCount = 0;
  let h2WithDirectAnswer = 0;
  h2s.each((_, h2) => {
    const $h2 = $(h2);
    let chunkText = "";
    let next = $h2.next();
    let depth = 0;
    // Direct-answer: đoạn đầu tiên (P/UL/OL/DL) ngay sau H2
    let firstParaWords = 0;
    let firstParaSeen = false;
    while (next.length && next[0].tagName !== "h2" && depth < 50) {
      if (!["script", "style", "nav", "aside"].includes(next[0].tagName)) {
        const t = next.text();
        chunkText += " " + t;
        if (!firstParaSeen && ["p", "ul", "ol", "dl"].includes(next[0].tagName)) {
          const cleaned = t.replace(/\s+/g, " ").trim();
          firstParaWords = cleaned ? cleaned.split(/\s+/).length : 0;
          firstParaSeen = true;
        }
      }
      next = next.next();
      depth++;
    }
    chunkText = chunkText.replace(/\s+/g, " ").trim();
    const chunkWords = chunkText ? chunkText.split(/\s+/).length : 0;
    if (chunkWords >= 50) h2WithContent++;
    if (firstParaWords >= 30 && firstParaWords <= 100) h2WithDirectAnswer++;
    totalChunkWords += chunkWords;
    chunkCount++;
  });
  signals.chunkability = {
    h2Count: h2s.length,
    h2WithContent,
    h2WithDirectAnswer,
    avgChunkWords: chunkCount > 0 ? Math.round(totalChunkWords / chunkCount) : 0,
    score: h2s.length > 0 ? Math.round((h2WithContent / h2s.length) * 100) : 0,
    directAnswerScore: h2s.length > 0 ? Math.round((h2WithDirectAnswer / h2s.length) * 100) : 0,
  };
  if (h2s.length >= 3 && signals.chunkability.score < 60) {
    issues.push({ severity: "info", code: "GEO_POOR_CHUNK", message: `Chunkability thấp (${signals.chunkability.score}%) — LLM tách bài theo H2, mỗi H2 nên có ≥ 50 từ riêng`, area: "ai-search" });
  }
  if (h2s.length >= 3 && signals.chunkability.directAnswerScore < 40) {
    issues.push({
      severity: "info",
      code: "GEO_NO_DIRECT_ANSWER",
      message: `Chỉ ${signals.chunkability.directAnswerScore}% H2 có direct-answer paragraph (30-100 từ ngay sau heading) — đây là format ChatGPT/Perplexity cite nhiều nhất`,
      area: "ai-search",
    });
  }

  // ── Check 12: Multimodal signals
  const imgs = $("img");
  const imgsWithAlt = imgs.filter((_, el) => {
    const a = $(el).attr("alt");
    return a && a.trim().length > 5;
  }).length;
  const videos = $("video, iframe[src*='youtube'], iframe[src*='vimeo']").length;
  const transcripts = $('[class*="transcript"], [id*="transcript"]').length;
  signals.multimodal = { hasImages: imgs.length, hasImageAlt: imgsWithAlt, hasVideo: videos, hasVideoTranscript: transcripts };

  // ── Schemas for AI (Article, FAQPage, HowTo, Organization, Person)
  const aiPriorityTypes = ["Article", "BlogPosting", "NewsArticle", "FAQPage", "HowTo", "Organization", "Person", "Product", "Recipe"];
  const pageSchemas = page.signals?.schemaTypes || [];
  signals.schemasForAI = pageSchemas.filter((t) => aiPriorityTypes.includes(t));
  signals.entityClarity.hasOrganization = pageSchemas.includes("Organization");
  signals.entityClarity.hasPerson = pageSchemas.includes("Person");

  // ── Citability score (0-100): tổng hợp các signal
  signals.citabilityScore = computeCitabilityScore(signals, wordCount);
  if (signals.citabilityScore < 40 && wordCount > 300) {
    issues.push({ severity: "warning", code: "GEO_LOW_CITABILITY", message: `Citability score thấp (${signals.citabilityScore}/100) — khó được AI trích dẫn`, area: "ai-search" });
  }

  return { issues, signals };
}

function pageHasFaqSchema($) {
  let has = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const i of items) {
        if (i && (i["@type"] === "FAQPage" || (Array.isArray(i["@type"]) && i["@type"].includes("FAQPage")))) has = true;
      }
    } catch {}
  });
  return has;
}

function pageHasPersonSchema($) {
  let has = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const i of items) {
        if (i && (i["@type"] === "Person" || (Array.isArray(i["@type"]) && i["@type"].includes("Person")))) has = true;
      }
    } catch {}
  });
  return has;
}

function computeCitabilityScore(s, wordCount) {
  let score = 0;
  // Stats density (max 25)
  const statDensity = wordCount > 0 ? (s.statisticsCount / wordCount) * 1000 : 0;
  score += Math.min(25, Math.round(statDensity * 5));
  // Citations (max 15)
  score += Math.min(15, s.citationsCount * 5);
  // Definitions (max 10)
  score += Math.min(10, s.definitionCount * 2);
  // FAQ presence (10)
  if (s.hasFAQ) score += 10;
  // TLDR (5)
  if (s.hasTLDR) score += 5;
  // Author bio / E-E-A-T (10)
  if (s.hasAuthorBio) score += 10;
  // Last updated (5)
  if (s.hasLastUpdated) score += 5;
  // Chunkability (max 15)
  score += Math.round((s.chunkability.score || 0) * 0.15);
  // Schemas for AI (max 5)
  if (s.schemasForAI.length >= 1) score += 3;
  if (s.schemasForAI.length >= 2) score += 2;

  return Math.min(100, score);
}

// ─────────────────────────────────────────────────────────────────
// Site-level GEO analysis
// ─────────────────────────────────────────────────────────────────
export function analyzeGeoSite(pages, signalsByUrl, geoSignalsByUrl, llmsTxt, robotsAi) {
  const issues = [];

  // llms.txt
  if (!llmsTxt?.exists) {
    issues.push({ severity: "warning", code: "GEO_LLMS_TXT_MISSING", message: "Thiếu file /llms.txt — chuẩn mới giúp AI hiểu site nhanh hơn", area: "ai-search" });
  } else if (!llmsTxt.isMarkdown || llmsTxt.sections === 0) {
    issues.push({ severity: "info", code: "GEO_LLMS_TXT_POOR", message: "llms.txt tồn tại nhưng không đúng format markdown chuẩn", area: "ai-search" });
  }

  // AI bot blocking
  if (robotsAi?.aiAccess === "mostly-blocked") {
    issues.push({ severity: "critical", code: "GEO_AI_BLOCKED", message: `robots.txt block ${robotsAi.blockedBots.length} AI bot (${robotsAi.blockedBots.slice(0, 3).join(", ")}…) — site sẽ không xuất hiện trong AI Search`, area: "ai-search" });
  } else if (robotsAi?.aiAccess === "partially-blocked") {
    issues.push({ severity: "warning", code: "GEO_AI_PARTIAL_BLOCK", message: `robots.txt block 1 số AI bot: ${robotsAi.blockedBots.join(", ")}`, area: "ai-search" });
  }

  // Entity clarity site-wide + sameAs detection
  let hasOrgSchema = false;
  const sameAsDomains = new Set();
  let orgSameAsCount = 0;
  for (const sig of signalsByUrl.values()) {
    if (sig.schemaTypes?.includes("Organization")) {
      hasOrgSchema = true;
      // Tìm Organization item để extract sameAs
      for (const s of (sig.schemas || [])) {
        if (!s.valid || !s.item) continue;
        const t = Array.isArray(s.type) ? s.type : [s.type];
        if (!t.some((x) => x === "Organization" || x === "Corporation" || x === "LocalBusiness")) continue;
        const sa = s.item.sameAs;
        const list = Array.isArray(sa) ? sa : sa ? [sa] : [];
        for (const u of list) {
          if (typeof u !== "string") continue;
          orgSameAsCount++;
          try {
            const host = new URL(u).hostname.replace(/^www\./, "");
            for (const d of TRUSTED_SAMEAS_DOMAINS) {
              if (host === d || host.endsWith("." + d)) sameAsDomains.add(d);
            }
          } catch {}
        }
      }
    }
  }
  if (!hasOrgSchema) {
    issues.push({ severity: "warning", code: "GEO_NO_ORG_SCHEMA", message: "Không có Organization schema — LLM khó định danh site là ai/làm gì", area: "ai-search" });
  } else if (orgSameAsCount === 0) {
    issues.push({
      severity: "warning",
      code: "GEO_NO_SAMEAS",
      message: "Organization schema không có thuộc tính sameAs — LLM thiếu cross-reference tới LinkedIn/Wikipedia/Crunchbase, khó build knowledge graph",
      area: "ai-search",
    });
  } else if (sameAsDomains.size < 2) {
    issues.push({
      severity: "info",
      code: "GEO_SAMEAS_THIN",
      message: `sameAs chỉ liên kết tới ${sameAsDomains.size} platform tin cậy — thêm LinkedIn, Wikipedia, Crunchbase để mạnh hơn knowledge graph`,
      area: "ai-search",
    });
  }

  // Trust pages presence (about / contact / privacy / terms)
  const allUrls = pages.map((p) => p.finalUrl || p.url);
  const trustPages = { about: false, contact: false, privacy: false, terms: false };
  for (const url of allUrls) {
    for (const [kind, pattern] of Object.entries(TRUST_PAGE_PATTERNS)) {
      if (pattern.test(url)) trustPages[kind] = true;
    }
  }
  const missingTrust = Object.entries(trustPages).filter(([, v]) => !v).map(([k]) => k);
  if (missingTrust.length >= 2) {
    issues.push({
      severity: "warning",
      code: "GEO_MISSING_TRUST_PAGES",
      message: `Thiếu trang trust: ${missingTrust.join(", ")} — LLM dùng các trang này làm signal trước khi cite (đặc biệt About, Contact)`,
      area: "ai-search",
    });
  } else if (missingTrust.length === 1) {
    issues.push({
      severity: "info",
      code: "GEO_MISSING_ONE_TRUST_PAGE",
      message: `Thiếu trang ${missingTrust[0]} — nên bổ sung để tăng trust signal cho LLM`,
      area: "ai-search",
    });
  }

  // Average citability
  let totalCitability = 0;
  let lowCitability = 0;
  let geoCount = 0;
  for (const geo of geoSignalsByUrl.values()) {
    totalCitability += geo.citabilityScore || 0;
    if ((geo.citabilityScore || 0) < 40) lowCitability++;
    geoCount++;
  }
  const avgCitability = geoCount > 0 ? Math.round(totalCitability / geoCount) : 0;

  // FAQ coverage
  let faqCount = 0;
  for (const geo of geoSignalsByUrl.values()) {
    if (geo.hasFAQ) faqCount++;
  }
  const faqCoverage = pages.length > 0 ? Math.round((faqCount / pages.length) * 100) : 0;

  return {
    issues,
    summary: {
      avgCitability,
      lowCitabilityPages: lowCitability,
      faqCoverage,
      llmsTxtExists: llmsTxt?.exists || false,
      aiAccess: robotsAi?.aiAccess || "unknown",
      blockedBots: robotsAi?.blockedBots || [],
      hasGoogleExtended: robotsAi?.hasGoogleExtended || false,
      hasOrganizationSchema: hasOrgSchema,
      sameAsDomains: [...sameAsDomains],
      sameAsCount: orgSameAsCount,
      trustPages,
      missingTrustPages: missingTrust,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// GEO Score (0-100) — tổng hợp toàn site
// ─────────────────────────────────────────────────────────────────
export function computeGeoScore({ siteSummary, pageCount }) {
  let score = 100;

  // Hard blockers
  if (siteSummary.aiAccess === "mostly-blocked") score -= 40;
  else if (siteSummary.aiAccess === "partially-blocked") score -= 15;

  if (!siteSummary.llmsTxtExists) score -= 8;
  if (!siteSummary.hasOrganizationSchema) score -= 10;

  // Avg citability gap (dưới 70 trừ điểm theo gap)
  const citGap = Math.max(0, 70 - (siteSummary.avgCitability || 0));
  score -= Math.round(citGap * 0.4);

  // Low citability pages ratio
  if (pageCount > 0) {
    const lowRatio = (siteSummary.lowCitabilityPages || 0) / pageCount;
    score -= Math.round(lowRatio * 15);
  }

  // FAQ coverage
  if ((siteSummary.faqCoverage || 0) < 30) score -= 8;

  return Math.max(0, Math.min(100, score));
}

export function geoScoreLabel(score) {
  if (score >= 85) return "Sẵn sàng cho AI Search";
  if (score >= 70) return "Tốt";
  if (score >= 50) return "Trung bình";
  if (score >= 30) return "Cần cải thiện";
  return "Yếu — chưa sẵn sàng AI";
}
