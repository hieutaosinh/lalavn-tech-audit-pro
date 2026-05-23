#!/usr/bin/env node
/**
 * Audit Pro — Lalavn Deep Audit CLI entry point.
 *
 * Usage:
 *   node run.mjs --url https://example.com [options]
 *
 * Options:
 *   --url URL              Target homepage URL (required)
 *   --client-slug SLUG     Client folder name (default: from domain)
 *   --config FILE          Config JSON (default: ./config.json or ./config.example.json)
 *   --max-urls N           Override config.crawl.maxUrls
 *   --max-depth N          Override config.crawl.maxDepth
 *   --no-psi               Disable PageSpeed Insights calls
 *   --no-broken-links      Disable broken link check
 *   --no-csv               Disable CSV exports
 *   --compare-with FILE    Path to previous report.json to compare with
 *   --auto-compare         Auto find previous audit in same client folder
 *   --out DIR              Override output directory
 *
 * Output:
 *   sites/<client-slug>/audits/YYYY-MM-DD/
 *     - report.json
 *     - report.html         (Pro brand, Print to PDF)
 *     - report.md
 *     - pages.csv           (per-page metrics)
 *     - issues.csv          (flat issue list)
 *     - action-plan.csv     (P0/P1/P2 tasks)
 */

// NL_STR is declared FIRST to avoid temporal-dead-zone errors when used in
// progress output below. (v0.3 bug fix)
const NL_STR = String.fromCharCode(10);

import { writeFile, mkdir, readFile, readdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { Crawler } from "./lib/crawler.mjs";
import {
  analyzePage,
  analyzeSite,
  checkBrokenLinks,
  checkHreflangReciprocity,
  checkInternalRedirectLinks,
  computePageScore,
} from "./lib/checks.mjs";
import { runPsiBatch, psiResultsToIssues } from "./lib/psi.mjs";
import { generateActionPlan, impactEstimate } from "./lib/action-plan.mjs";
import { loadPreviousReport, compareReports } from "./lib/compare.mjs";
import { renderHTML, renderMarkdown } from "./lib/render.mjs";
import {
  analyzePageGeo,
  analyzeGeoSite,
  checkLlmsTxt,
  analyzeRobotsForAI,
  computeGeoScore,
  geoScoreLabel,
} from "./lib/geo.mjs";
import { analyzeSecurityHeaders } from "./lib/security-headers.mjs";
import { analyzeSitemapQuality } from "./lib/sitemap-quality.mjs";
import { exportPagesCSV, exportIssuesCSV, exportActionPlanCSV } from "./lib/csv-export.mjs";
import {
  analyzePreviewControls,
  analyzeArticleSchemaForAI,
  analyzeProductSchemaForAI,
  analyzeFreshness,
  analyzeInterstitial,
  analyzeJSRendering,
  analyzeSoft404,
  analyzeCrawlableLinks,
  analyzeSiteForGoogleAI,
} from "./lib/google-ai-guide.mjs";
import {
  annotateHeuristicIssue,
  classifyExternalLinkResults,
  computeIssueCounts,
  computeSiteScore,
} from "./lib/hardening.mjs";

const TOOL_VERSION = "0.6.0";

const HEURISTIC_CONFIDENCE = {
  SPA_EMPTY_ROOT: "low",
  JS_HEAVY_THIN_HTML: "low",
  POSSIBLE_INTERSTITIAL: "low",
  SOFT_404: "medium",
  WEAK_TOPIC_CLUSTERS: "medium",
  CRAWL_BUDGET_WASTE: "medium",
  PAGINATION_CANONICAL_TO_PAGE_1: "medium",
};

function hardenIssues(issues = []) {
  return issues.map((issue) => {
    const confidence = HEURISTIC_CONFIDENCE[issue.code];
    return confidence ? annotateHeuristicIssue(issue, confidence) : issue;
  });
}

// ─────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    url: null, clientSlug: null, config: null,
    maxUrls: null, maxDepth: null,
    noPsi: false, noBrokenLinks: false, noCsv: false,
    compareWith: null, autoCompare: false,
    out: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i];
    else if (a === "--client-slug") args.clientSlug = argv[++i];
    else if (a === "--config") args.config = argv[++i];
    else if (a === "--max-urls") args.maxUrls = parseInt(argv[++i], 10);
    else if (a === "--max-depth") args.maxDepth = parseInt(argv[++i], 10);
    else if (a === "--no-psi") args.noPsi = true;
    else if (a === "--no-broken-links") args.noBrokenLinks = true;
    else if (a === "--no-csv") args.noCsv = true;
    else if (a === "--compare-with") args.compareWith = argv[++i];
    else if (a === "--auto-compare") args.autoCompare = true;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "-h" || a === "--help") { printHelp(); process.exit(0); }
  }
  if (!args.url) { console.error("ERROR: --url bắt buộc"); printHelp(); process.exit(1); }
  if (!/^https?:\/\//i.test(args.url)) args.url = "https://" + args.url;
  return args;
}

function printHelp() {
  console.log(`Audit Pro v${TOOL_VERSION} — Lalavn Deep Audit (SEO + GEO)

Usage:
  node run.mjs --url URL [options]

Options:
  --url URL              Target URL (required)
  --client-slug SLUG     Client folder (default: derived from domain)
  --config FILE          Config JSON file
  --max-urls N           Override max URLs to crawl
  --max-depth N          Override crawl depth
  --no-psi               Skip PageSpeed Insights
  --no-broken-links      Skip broken link check
  --no-csv               Skip CSV exports
  --compare-with FILE    Previous report.json to diff with
  --auto-compare         Find latest previous audit automatically
  --out DIR              Override output dir
  -h, --help             Show help

Env:
  PSI_API_KEY            (optional) PageSpeed Insights API key for higher quota

Output: sites/<client-slug>/audits/YYYY-MM-DD/
`);
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));

function todayISO() { return new Date().toISOString().slice(0, 10); }

function slugifyDomain(host) {
  return host.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function loadConfig(configPath) {
  const candidates = [
    configPath,
    join(__dirname, "config.json"),
    join(__dirname, "config.example.json"),
  ].filter(Boolean);
  for (const p of candidates) {
    if (await fileExists(p)) {
      const text = await readFile(p, "utf8");
      return JSON.parse(text);
    }
  }
  throw new Error("Không tìm thấy config.json hoặc config.example.json");
}

async function findPreviousAudit(auditsDir, currentDate) {
  if (!(await fileExists(auditsDir))) return null;
  try {
    const dirs = await readdir(auditsDir);
    const dates = dirs.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < currentDate).sort().reverse();
    for (const d of dates) {
      const candidate = join(auditsDir, d, "report.json");
      if (await fileExists(candidate)) return candidate;
    }
  } catch {}
  return null;
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  const t0 = performance.now();

  const config = await loadConfig(args.config);
  if (args.maxUrls) config.crawl.maxUrls = args.maxUrls;
  if (args.maxDepth) config.crawl.maxDepth = args.maxDepth;
  if (args.noPsi) config.checks.psiEnabled = false;
  if (args.noBrokenLinks) config.checks.brokenLinkCheck = false;

  const startObj = new URL(args.url);
  const domain = startObj.hostname;
  const clientSlug = args.clientSlug || slugifyDomain(domain);

  console.log(`${NL_STR}[${config.brand.name} v${TOOL_VERSION}]  ${domain}${NL_STR}`);
  console.log(`  Crawl: max ${config.crawl.maxUrls} URLs, depth ${config.crawl.maxDepth}, concurrency ${config.crawl.concurrency}`);
  console.log(`  PSI: ${config.checks.psiEnabled ? "enabled" : "disabled"}${process.env.PSI_API_KEY ? " (with key)" : " (no key)"}`);
  console.log(`  Broken link check: ${config.checks.brokenLinkCheck ? "enabled" : "disabled"}`);
  console.log(`  CSV export: ${args.noCsv ? "disabled" : "enabled"}${NL_STR}`);

  // ── 1. Crawl ────────────────────────────────────────────────────
  const crawler = new Crawler(config.crawl);
  console.log(`  · Đang crawl...`);
  const signalsByUrl = new Map();
  const issuesByUrl = new Map();
  const geoSignalsByUrl = new Map();
  const geoIssuesByUrl = new Map();
  const externalLinkSet = new Set();

  const crawlResult = await crawler.crawl(args.url, async (page) => {
    const { issues, signals } = analyzePage(page, config.checks);
    signalsByUrl.set(page.finalUrl, signals);
    issuesByUrl.set(page.finalUrl, issues);
    if (signals.linksRaw) {
      for (const l of signals.linksRaw) if (!l.internal) externalLinkSet.add(l.href);
    }
    // GEO per-page (đính kèm signals SEO để check schema types)
    const geoResult = await analyzePageGeo({ ...page, signals });
    geoSignalsByUrl.set(page.finalUrl, geoResult.signals);
    geoIssuesByUrl.set(page.finalUrl, hardenIssues(geoResult.issues));

    // Google AI guidance per-page checks (preview controls, schema completeness,
    // freshness, interstitial, JS rendering, soft 404, crawlable links).
    const previewResult = await analyzePreviewControls(page);
    const articleResult = analyzeArticleSchemaForAI(signals.schemas);
    const productResult = analyzeProductSchemaForAI(signals.schemas);
    const freshnessResult = analyzeFreshness(signals.schemas);
    const interstitialResult = await analyzeInterstitial(page);
    const jsResult = await analyzeJSRendering(page);
    const soft404Result = await analyzeSoft404(page);
    const crawlableResult = await analyzeCrawlableLinks(page);

    const gaIssues = hardenIssues([
      ...previewResult.issues,
      ...articleResult.issues,
      ...productResult.issues,
      ...freshnessResult.issues,
      ...interstitialResult.issues,
      ...jsResult.issues,
      ...soft404Result.issues,
      ...crawlableResult.issues,
    ]);
    if (gaIssues.length) {
      const existing = issuesByUrl.get(page.finalUrl) || [];
      issuesByUrl.set(page.finalUrl, [...existing, ...gaIssues]);
    }
    // Lưu signal phụ vào signals (để CSV/HTML report dùng)
    signals.preview = previewResult.signals;
    signals.freshness = freshnessResult.signals;
    signals.interstitial = interstitialResult.signals;
    signals.jsRendering = jsResult.signals;
    signals.soft404 = soft404Result.signals.isSoft404;
    signals.linksHealth = crawlableResult.signals;
  }, ({ done, total }) => {
    if (done % 5 === 0 || done === total) {
      process.stdout.write(`\r    [${done}/${total}] crawled`);
    }
  });
  process.stdout.write(NL_STR);
  console.log(`  ✓ Crawl xong: ${crawlResult.pages.length} URL (skipped ${crawlResult.skipped.length})`);
  if (crawlResult.sitemapErrors?.length) {
    console.log(`  ⚠ Sitemap fetch errors: ${crawlResult.sitemapErrors.length}`);
  }

  // ── 1b. GEO site-level: llms.txt + robots AI bots ────────────
  console.log(`  · Đang kiểm tra GEO signals (llms.txt, AI bots access)...`);
  const origin = new URL(args.url).origin;
  const llmsTxt = await checkLlmsTxt(origin, (u) => crawler.fetchWithTimeout(u));
  const robotsAi = analyzeRobotsForAI(crawlResult.robots);
  const geoSiteAnalysis = analyzeGeoSite(crawlResult.pages, signalsByUrl, geoSignalsByUrl, llmsTxt, robotsAi);
  geoSiteAnalysis.issues = hardenIssues(geoSiteAnalysis.issues);
  console.log(`  ✓ GEO check xong: llms.txt ${llmsTxt.exists ? "✓" : "✗"} · AI bots access: ${robotsAi.aiAccess}`);

  // ── 2. Site-level analysis ─────────────────────────────────────
  const siteAnalysis = analyzeSite(crawlResult.pages, crawlResult.allInternalLinks, signalsByUrl);

  // ── 2b. Hreflang reciprocity (cross-page validation) ────────────
  const hreflangAnalysis = checkHreflangReciprocity(crawlResult.pages, signalsByUrl);

  // ── 2c. Internal link → redirect / broken detection ─────────────
  const internalRedirectAnalysis = checkInternalRedirectLinks(crawlResult.pages, signalsByUrl);

  // ── 2d. Sitemap quality cross-validation ────────────────────────
  const sitemapQuality = analyzeSitemapQuality(
    crawlResult.sitemapsUsed,
    crawlResult.sitemapUrls || [],
    crawlResult.pages,
    signalsByUrl
  );

  // ── 2e. Security headers (homepage as representative) ───────────
  const homepage = crawlResult.pages.find((p) => p.depth === 0) || crawlResult.pages[0];
  const securityAnalysis = homepage
    ? analyzeSecurityHeaders(homepage.headers || {}, homepage.finalUrl || homepage.url)
    : { issues: [], signals: { present: {}, missing: [], compression: "unknown" } };

  // ── 2f. Google AI guidance site-level checks ─────────────────────
  // Googlebot access, crawl budget waste, topic cluster coverage cho query fan-out.
  const googleAiAnalysis = analyzeSiteForGoogleAI({
    robotsTxt: crawlResult.robots,
    pages: crawlResult.pages,
    signalsByUrl,
  });
  googleAiAnalysis.issues = hardenIssues(googleAiAnalysis.issues);

  // ── 3. PSI (optional) ──────────────────────────────────────────
  let psiResults = [];
  if (config.checks.psiEnabled && crawlResult.pages.length > 0) {
    const sample = crawlResult.pages.slice(0, config.checks.psiSampleSize).map((p) => p.finalUrl || p.url);
    console.log(`  · Đang gọi PageSpeed Insights (${sample.length} URL × ${config.checks.psiStrategies.length} strategies)...`);
    psiResults = await runPsiBatch(sample, config.checks.psiStrategies, ({ done, total, ok }) => {
      process.stdout.write(`\r    [${done}/${total}] PSI ${ok ? "✓" : "✗"}    `);
    });
    process.stdout.write(NL_STR);
    console.log(`  ✓ PSI xong`);
  }
  const psiIssues = psiResultsToIssues(psiResults);

  // ── 4. Broken link check (optional, sample) ────────────────────
  let brokenLinkResult = null;
  if (config.checks.brokenLinkCheck && externalLinkSet.size > 0) {
    console.log(`  · Đang check ${Math.min(externalLinkSet.size, config.checks.brokenLinkSampleLimit)} external link...`);
    brokenLinkResult = await checkBrokenLinks(externalLinkSet, config.crawl, ({ done, total }) => {
      if (done % 10 === 0 || done === total) process.stdout.write(`\r    [${done}/${total}]    `);
    });
    brokenLinkResult.classification = classifyExternalLinkResults(brokenLinkResult.results);
    process.stdout.write(NL_STR);
    console.log(
      `  ✓ External link check: ${brokenLinkResult.classification.confirmedBroken.length} confirmed broken · ` +
      `${brokenLinkResult.classification.blocked.length} blocked · ${brokenLinkResult.classification.timeoutOrNetwork.length} timeout/network / ${brokenLinkResult.sample} checked`
    );
  }

  // ── 5. Aggregate issues ────────────────────────────────────────
  const allIssues = [];
  for (const [url, issues] of issuesByUrl) {
    for (const i of hardenIssues(issues)) allIssues.push({ ...i, url });
  }
  for (const [url, issues] of geoIssuesByUrl) {
    for (const i of hardenIssues(issues)) allIssues.push({ ...i, url });
  }
  for (const i of hardenIssues(siteAnalysis.issues)) allIssues.push(i);
  for (const i of hardenIssues(geoSiteAnalysis.issues)) allIssues.push(i);
  for (const i of hardenIssues(hreflangAnalysis.issues)) allIssues.push(i);
  for (const i of hardenIssues(internalRedirectAnalysis.issues)) allIssues.push(i);
  for (const i of hardenIssues(sitemapQuality.issues)) allIssues.push(i);
  for (const i of hardenIssues(securityAnalysis.issues)) allIssues.push(i);
  for (const i of hardenIssues(googleAiAnalysis.issues)) allIssues.push(i);
  for (const i of hardenIssues(psiIssues)) allIssues.push(i);

  if (!crawlResult.robots.exists) allIssues.push({ severity: "warning", code: "ROBOTS_MISSING", message: "Không tìm thấy robots.txt", area: "technical" });
  if (!crawlResult.sitemapFound) allIssues.push({ severity: "warning", code: "SITEMAP_MISSING", message: "Không tìm thấy sitemap.xml", area: "technical" });
  if (crawlResult.sitemapErrors?.length) {
    allIssues.push({
      severity: "info",
      code: "SITEMAP_FETCH_ERROR",
      message: `${crawlResult.sitemapErrors.length} sitemap không fetch được — kiểm tra CDN/origin có block bot không`,
      area: "technical",
    });
  }

  if (brokenLinkResult) {
    const c = brokenLinkResult.classification || classifyExternalLinkResults(brokenLinkResult.results);
    if (c.confirmedBroken.length > 0) {
      allIssues.push({
        severity: "warning",
        code: "BROKEN_EXTERNAL_LINK",
        message: `${c.confirmedBroken.length} external link xác nhận broken trong sample`,
        area: "links",
        sample: c.confirmedBroken.slice(0, 5),
      });
    }
    if (c.blocked.length + c.timeoutOrNetwork.length + c.unknown.length > 0) {
      allIssues.push({
        severity: "info",
        code: "EXTERNAL_LINK_UNVERIFIED",
        message: `${c.blocked.length + c.timeoutOrNetwork.length + c.unknown.length} external link chưa xác minh được do block/timeout/network — cần manual verify trước khi gọi là broken`,
        area: "links",
        confidence: "low",
        manualVerify: true,
      });
    }
  }

  // ── 6. Score ───────────────────────────────────────────────────
  const issueCounts = computeIssueCounts(allIssues);
  const score = computeSiteScore(allIssues, crawlResult.pages.length);

  // Top issues by code
  const byCode = new Map();
  for (const i of allIssues) {
    if (!byCode.has(i.code)) byCode.set(i.code, { code: i.code, severity: i.severity, area: i.area, count: 0, sampleMessage: i.message, confidence: i.confidence || "high", manualVerify: !!i.manualVerify });
    byCode.get(i.code).count++;
    if (i.manualVerify) byCode.get(i.code).manualVerify = true;
  }
  const topIssues = [...byCode.values()].sort((a, b) => {
    const sevOrder = { critical: 0, warning: 1, info: 2 };
    if (sevOrder[a.severity] !== sevOrder[b.severity]) return sevOrder[a.severity] - sevOrder[b.severity];
    return b.count - a.count;
  }).slice(0, 10);

  // ── 7. Build per-page output (with embedded signals + issues + per-page score)
  const pages = crawlResult.pages.map((p) => {
    const pageIssues = hardenIssues([
      ...(issuesByUrl.get(p.finalUrl) || []),
      ...(geoIssuesByUrl.get(p.finalUrl) || []),
    ]);
    return {
      url: p.url,
      finalUrl: p.finalUrl,
      status: p.status,
      durationMs: p.durationMs,
      depth: p.depth,
      redirected: p.redirected,
      redirectHops: p.redirectHops || 0,
      redirectChain: p.redirectChain || [],
      pageScore: computePageScore(pageIssues),
      signals: signalsByUrl.get(p.finalUrl) || {},
      geoSignals: geoSignalsByUrl.get(p.finalUrl) || {},
      issues: pageIssues,
    };
  });

  // ── 8. Action plan
  const siteSignals = {
    https: !allIssues.find((i) => i.code === "MIXED_HTTP" || i.code === "NO_HTTPS"),
    robotsTxt: crawlResult.robots,
    sitemapFound: crawlResult.sitemapFound,
  };
  const actionPlan = config.actionPlan?.enabled !== false
    ? generateActionPlan({ allIssues, pages, signalsByUrl, siteSignals })
    : { byPriority: { P0: [], P1: [], P2: [] }, summary: { P0: 0, P1: 0, P2: 0 }, total: 0 };

  const impact = config.actionPlan?.estimateImpact !== false ? impactEstimate(allIssues) : null;

  // ── 9. Comparison
  const dateStr = todayISO();
  const projectRoot = __dirname;
  const auditsBase = args.out
    ? args.out
    : join(projectRoot, "sites", clientSlug, "audits");
  const outDir = args.out ? args.out : join(auditsBase, dateStr);

  let previousReportPath = args.compareWith;
  if (args.autoCompare && !previousReportPath) {
    previousReportPath = await findPreviousAudit(auditsBase, dateStr);
    if (previousReportPath) console.log(`  · Tự động compare với: ${previousReportPath}`);
  }
  let previousReport = null;
  if (previousReportPath) previousReport = await loadPreviousReport(previousReportPath);

  const comparison = previousReport ? compareReports(
    { allIssues, summary: { score } },
    previousReport
  ) : null;

  // ── 10. Final report object
  const auditDuration = Math.round(performance.now() - t0);
  const geoScore = computeGeoScore({ siteSummary: geoSiteAnalysis.summary, pageCount: pages.length });
  const report = {
    tool: { name: config.brand.name, version: TOOL_VERSION },
    auditDate: dateStr,
    audit: { durationMs: auditDuration },
    brand: config.brand,
    site: {
      domain,
      startUrl: args.url,
      pagesAnalyzed: pages.length,
      https: siteSignals.https,
      robotsTxt: crawlResult.robots,
      sitemapFound: crawlResult.sitemapFound,
      sitemapsUsed: crawlResult.sitemapsUsed,
      sitemapErrors: crawlResult.sitemapErrors || [],
      duplicateTitles: siteAnalysis.duplicateTitles,
      duplicateDescs: siteAnalysis.duplicateDescs,
      orphans: siteAnalysis.orphans,
      skipped: crawlResult.skipped,
    },
    summary: {
      score,
      scoring: {
        version: "v0.6-normalized-by-page-count-and-confidence",
        note: "Score được normalize theo số URL crawl và giảm trọng số cho issue confidence thấp/manual verify.",
      },
      totalIssues: allIssues.length,
      issueCounts,
      topIssues,
    },
    geo: {
      score: geoScore,
      label: geoScoreLabel(geoScore),
      llmsTxt,
      robotsAi,
      ...geoSiteAnalysis.summary,
    },
    security: securityAnalysis.signals,
    sitemapQuality: sitemapQuality.summary,
    hreflang: hreflangAnalysis.summary,
    internalLinks: internalRedirectAnalysis.summary,
    googleAi: googleAiAnalysis.summary,
    pages,
    psi: psiResults,
    brokenLinks: brokenLinkResult,
    actionPlan,
    impact,
    comparison,
    allIssues,
  };

  // ── 11. Write outputs
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "report.json");
  const htmlPath = join(outDir, "report.html");
  const mdPath = join(outDir, "report.md");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(htmlPath, renderHTML(report), "utf8");
  await writeFile(mdPath, renderMarkdown(report), "utf8");

  let csvPaths = null;
  if (!args.noCsv) {
    const pagesCsvPath = join(outDir, "pages.csv");
    const issuesCsvPath = join(outDir, "issues.csv");
    const planCsvPath = join(outDir, "action-plan.csv");
    await writeFile(pagesCsvPath, exportPagesCSV(report), "utf8");
    await writeFile(issuesCsvPath, exportIssuesCSV(report), "utf8");
    await writeFile(planCsvPath, exportActionPlanCSV(report), "utf8");
    csvPaths = { pagesCsvPath, issuesCsvPath, planCsvPath };
  }

  console.log(`${NL_STR}  Score: ${score}/100  ·  GEO Score: ${geoScore}/100 (${geoScoreLabel(geoScore)})`);
  console.log(`  Issues: ${issueCounts.critical} critical · ${issueCounts.warning} warning · ${issueCounts.info} info`);
  console.log(`  Action plan: P0=${actionPlan.summary.P0}, P1=${actionPlan.summary.P1}, P2=${actionPlan.summary.P2}`);
  if (comparison) console.log(`  vs previous: Δ${comparison.scoreDelta >= 0 ? "+" : ""}${comparison.scoreDelta} · new ${comparison.counts.new} · fixed ${comparison.counts.fixed}`);
  console.log(`  Duration: ${(auditDuration / 1000).toFixed(1)}s`);
  console.log(`${NL_STR}  Reports:`);
  console.log(`    JSON: ${jsonPath}`);
  console.log(`    HTML: ${htmlPath}`);
  console.log(`    MD:   ${mdPath}`);
  if (csvPaths) {
    console.log(`    CSV:  ${csvPaths.pagesCsvPath}`);
    console.log(`          ${csvPaths.issuesCsvPath}`);
    console.log(`          ${csvPaths.planCsvPath}`);
  }
  console.log(`${NL_STR}  Mở report.html → Print → Save as PDF để gửi khách.${NL_STR}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
