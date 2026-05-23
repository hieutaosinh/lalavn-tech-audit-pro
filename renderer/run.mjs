#!/usr/bin/env node
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const TPL = join(ROOT, "templates");

function parseArgs(argv) {
  const args = { input: null, out: null, template: "consulting-v1", formats: "html" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") args.input = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--template") args.template = argv[++i];
    else if (a === "--formats") args.formats = argv[++i];
    else if (a === "-h" || a === "--help") {
      help();
      process.exit(0);
    }
  }
  if (!args.input) throw new Error("Missing --input report.json");
  args.input = resolve(args.input);
  args.out = resolve(args.out || join(dirname(args.input), "deliverables"));
  args.formats = args.formats.split(",").map((x) => x.trim()).filter(Boolean);
  return args;
}

function help() {
  console.log(`Audit Pro Renderer

Usage:
  node renderer/run.mjs --input report.json [--template consulting-v1] [--formats html,pdf,wp-html] [--out DIR]
`);
}

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreColor(score) {
  if (score >= 85) return "#15803d";
  if (score >= 70) return "#4d7c0f";
  if (score >= 50) return "#ca8a04";
  if (score >= 30) return "#ea580c";
  return "#dc2626";
}

function badge(text, tone = "neutral") {
  const map = {
    critical: "background:#fee2e2;color:#991b1b;border-color:#fecaca",
    warning: "background:#fef3c7;color:#92400e;border-color:#fde68a",
    info: "background:#dbeafe;color:#1e40af;border-color:#bfdbfe",
    neutral: "background:#f1f5f9;color:#334155;border-color:#e2e8f0",
    good: "background:#dcfce7;color:#166534;border-color:#bbf7d0"
  };
  return `<span class="badge" style="${map[tone] || map.neutral}">${esc(text)}</span>`;
}

function priorityTone(p) {
  return p === "P0" ? "critical" : p === "P1" ? "warning" : "info";
}

function css(scoped = false) {
  const root = scoped ? ".audit-pro-render" : ":root";
  return `
${root}{--ink:#0f172a;--muted:#64748b;--line:#dbe3ef;--soft:#f8fafc;--brand:#0f766e;--accent:#2563eb;--danger:#dc2626;--warn:#d97706;--ok:#16a34a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);line-height:1.5}
body{margin:0;background:#e8eef7;color:#0f172a}
.audit-pro-render{background:#e8eef7;color:#0f172a}
.cover{min-height:86vh;background:radial-gradient(circle at 80% 16%,rgba(14,165,233,.34),transparent 28%),linear-gradient(135deg,#111827 0%,#0f766e 54%,#2563eb 100%);color:white;display:flex;align-items:center;padding:64px 48px}
.cover-inner{max-width:1060px;margin:0 auto;width:100%}
.kicker{font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.82;font-weight:800}
.cover h1{font-size:52px;line-height:1.06;margin:18px 0 14px;letter-spacing:0}
.cover .sub{font-size:18px;max-width:820px;opacity:.92}
.cover-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:42px}
.cover-card{border:1px solid rgba(255,255,255,.24);background:rgba(255,255,255,.13);padding:18px;border-radius:8px;backdrop-filter:blur(10px)}
.cover-card .v{font-size:30px;font-weight:850}.cover-card .l{font-size:12px;opacity:.82;text-transform:uppercase;font-weight:800}
.page{max-width:1140px;margin:22px auto;background:white;border:1px solid var(--line);border-radius:8px;padding:30px;box-shadow:0 12px 36px rgba(15,23,42,.08)}
.section-title{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:18px}
h2{margin:0;font-size:24px;letter-spacing:0}h3{margin:24px 0 10px;font-size:17px}p{margin:8px 0}.muted{color:var(--muted)}
.dashboard{display:grid;grid-template-columns:1.2fr 1.2fr repeat(3,.82fr);gap:14px}
.score-card,.card{border:1px solid var(--line);background:var(--soft);border-radius:8px;padding:16px}
.score-card{background:linear-gradient(180deg,#ffffff,#f8fafc)}
.score-num{font-size:44px;font-weight:900}.score-label{color:var(--muted);font-size:13px;font-weight:800}
.metric{font-size:30px;font-weight:900}.metric-label{font-size:12px;color:var(--muted);font-weight:800;text-transform:uppercase}
.risk-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:18px}
.risk-card{border-radius:8px;padding:17px;color:white;min-height:106px;box-shadow:0 10px 24px rgba(15,23,42,.14)}
.risk-card .metric-label{color:rgba(255,255,255,.78)}.risk-card .hint{font-size:12px;opacity:.86;margin-top:8px}
.tone-critical{background:linear-gradient(135deg,#991b1b,#ef4444)}.tone-warning{background:linear-gradient(135deg,#b45309,#f59e0b)}.tone-info{background:linear-gradient(135deg,#1d4ed8,#38bdf8)}.tone-good{background:linear-gradient(135deg,#15803d,#22c55e)}.tone-insight{background:linear-gradient(135deg,#6d28d9,#2563eb)}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.badge{display:inline-flex;align-items:center;border:1px solid transparent;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:800;white-space:nowrap}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:10px;text-align:left;vertical-align:top}th{background:#f8fafc;color:#334155;font-size:12px;text-transform:uppercase}
.url{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}
.action{display:grid;grid-template-columns:70px 1fr 110px 110px;gap:10px;align-items:start;border-bottom:1px solid var(--line);padding:12px 0}.action:last-child{border-bottom:0}
.action-title{font-weight:850}.small{font-size:12px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.bar{height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden}.bar span{display:block;height:100%}
.finding{border-left:4px solid #94a3b8;background:#fff;border-radius:8px;padding:13px 14px;margin:10px 0;box-shadow:0 1px 0 rgba(15,23,42,.06)}
.finding.critical{border-left-color:#dc2626;background:#fff5f5}.finding.warning{border-left-color:#f59e0b;background:#fffbeb}.finding.info{border-left-color:#2563eb;background:#eff6ff}
.finding-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.finding-code{font-weight:850}.finding-msg{margin-top:7px}
.page-row{display:grid;grid-template-columns:72px 1fr 90px 90px;gap:12px;border-bottom:1px solid var(--line);padding:12px 0}.page-row:last-child{border-bottom:0}
@media(max-width:760px){.cover{padding:42px 22px}.cover h1{font-size:34px}.cover-grid,.dashboard,.risk-grid,.grid-2,.grid-3,.cards{grid-template-columns:1fr}.page{margin:12px 8px;padding:18px}.action,.page-row{grid-template-columns:1fr}}
`;
}

function topIssues(report, limit = 10) {
  return (report.summary?.topIssues || []).slice(0, limit);
}

function allActions(report) {
  const bp = report.actionPlan?.byPriority || {};
  return ["P0", "P1", "P2"].flatMap((p) => (bp[p] || []).map((x) => ({ ...x, priority: x.priority || p })));
}

function clampPct(n) {
  return Math.max(0, Math.min(100, Number(n) || 0));
}

function riskLabel(score) {
  if (score >= 85) return "Ổn định";
  if (score >= 70) return "Khá tốt";
  if (score >= 50) return "Cần cải thiện";
  if (score >= 30) return "Rủi ro cao";
  return "Khẩn cấp";
}

function issueGroups(report) {
  const seen = new Map();
  for (const i of report.allIssues || []) {
    const key = `${i.severity || "info"}:${i.area || "general"}:${i.code || "ISSUE"}:${i.message || ""}`;
    const row = seen.get(key) || {
      severity: i.severity || "info",
      area: i.area || "general",
      code: i.code || "ISSUE",
      message: i.message || "",
      googleOfficial: Boolean(i.googleOfficial),
      count: 0,
      urls: [],
    };
    row.count++;
    if (i.url && row.urls.length < 3) row.urls.push(i.url);
    seen.set(key, row);
  }
  const order = { critical: 0, warning: 1, info: 2 };
  return [...seen.values()].sort((a, b) => {
    if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
    return b.count - a.count;
  });
}

function renderBody(report, { scoped = false } = {}) {
  const s = report.summary || {};
  const geo = report.geo || {};
  const site = report.site || {};
  const actions = allActions(report);
  const p0 = actions.filter((a) => a.priority === "P0");
  const quick = actions.filter((a) => a.effort === "low").slice(0, 4);
  const wrapperOpen = scoped ? "" : '<div class="audit-pro-render">';
  const wrapperClose = scoped ? "" : "</div>";
  const pages = (report.pages || []).slice().sort((a, b) => (a.pageScore ?? 100) - (b.pageScore ?? 100)).slice(0, 16);
  const findings = issueGroups(report).slice(0, 28);
  const googleOfficialCount = (report.allIssues || []).filter((i) => i.googleOfficial).length;

  return `${wrapperOpen}
<section class="cover">
  <div class="cover-inner">
    <div class="kicker">Audit Pro Consulting Report</div>
    <h1>SEO + GEO Audit<br>${esc(site.domain || "Website")}</h1>
    <div class="sub">Báo cáo phân tích kỹ thuật, nội dung, khả năng index và mức sẵn sàng cho AI Search. Tập trung vào việc ưu tiên sửa theo tác động.</div>
    <div class="cover-grid">
      <div class="cover-card"><div class="v">${esc(site.pagesAnalyzed ?? (report.pages || []).length)}</div><div class="l">URL analyzed</div></div>
      <div class="cover-card"><div class="v">${esc(s.score ?? "—")}/100</div><div class="l">SEO score</div></div>
      <div class="cover-card"><div class="v">${esc(geo.score ?? "—")}/100</div><div class="l">GEO score</div></div>
      <div class="cover-card"><div class="v">${esc(s.totalIssues ?? 0)}</div><div class="l">Issues found</div></div>
    </div>
  </div>
</section>

<section class="page">
  <div class="section-title"><div><div class="kicker muted">Executive summary</div><h2>Tóm tắt điều hành</h2></div><div class="muted">${esc(report.auditDate || "")}</div></div>
  <div class="dashboard">
    <div class="score-card"><div class="score-num" style="color:${scoreColor(s.score ?? 0)}">${esc(s.score ?? "—")}</div><div class="score-label">SEO Health</div><div class="bar"><span style="width:${Math.max(0, Math.min(100, s.score || 0))}%;background:${scoreColor(s.score || 0)}"></span></div></div>
    <div class="score-card"><div class="score-num" style="color:${scoreColor(geo.score ?? 0)}">${esc(geo.score ?? "—")}</div><div class="score-label">GEO Readiness · ${esc(geo.label || "")}</div><div class="bar"><span style="width:${Math.max(0, Math.min(100, geo.score || 0))}%;background:${scoreColor(geo.score || 0)}"></span></div></div>
    <div class="score-card"><div class="metric" style="color:#dc2626">${esc(s.issueCounts?.critical ?? 0)}</div><div class="metric-label">Critical</div></div>
    <div class="score-card"><div class="metric" style="color:#ca8a04">${esc(s.issueCounts?.warning ?? 0)}</div><div class="metric-label">Warning</div></div>
    <div class="score-card"><div class="metric" style="color:#2563eb">${esc(s.issueCounts?.info ?? 0)}</div><div class="metric-label">Info</div></div>
  </div>
  <div class="risk-grid">
    <div class="risk-card tone-critical"><div class="metric">${esc(riskLabel(s.score ?? 0))}</div><div class="metric-label">Risk level</div><div class="hint">Dựa trên SEO score và số issue critical/warning.</div></div>
    <div class="risk-card tone-warning"><div class="metric">${esc(report.actionPlan?.summary?.P0 ?? 0)}</div><div class="metric-label">P0 tasks</div><div class="hint">Việc cần xử lý trước khi tối ưu sâu.</div></div>
    <div class="risk-card tone-info"><div class="metric">${esc(site.pagesAnalyzed ?? (report.pages || []).length)}</div><div class="metric-label">URLs analyzed</div><div class="hint">Mẫu crawl đang dùng cho report này.</div></div>
    <div class="risk-card tone-insight"><div class="metric">${esc(googleOfficialCount)}</div><div class="metric-label">Google AI flags</div><div class="hint">Issue có gắn nguồn Google official guide.</div></div>
  </div>
  <div class="grid-2" style="margin-top:18px">
    <div class="card"><h3>Vấn đề cần xử lý trước</h3>${p0.length ? p0.map((a) => `<p><b>${badge(a.priority, priorityTone(a.priority))} ${esc(a.title)}</b><br><span class="muted">${esc(a.reason)}</span></p>`).join("") : '<p class="muted">Không có P0.</p>'}</div>
    <div class="card"><h3>Quick wins</h3>${quick.length ? quick.map((a) => `<p><b>${badge(a.priority, priorityTone(a.priority))} ${esc(a.title)}</b><br><span class="muted">${esc(a.action || a.reason)}</span></p>`).join("") : '<p class="muted">Không có quick win rõ.</p>'}</div>
  </div>
</section>

<section class="page">
  <div class="section-title"><div><div class="kicker muted">Priority plan</div><h2>Kế hoạch hành động</h2></div><div>${badge(`P0 ${report.actionPlan?.summary?.P0 ?? 0}`, "critical")} ${badge(`P1 ${report.actionPlan?.summary?.P1 ?? 0}`, "warning")} ${badge(`P2 ${report.actionPlan?.summary?.P2 ?? 0}`, "info")}</div></div>
  ${actions.slice(0, 18).map((a) => `<div class="action avoid-break"><div>${badge(a.priority, priorityTone(a.priority))}</div><div><div class="action-title">${esc(a.title)}</div><div class="muted small">${esc(a.reason)}</div><div class="small" style="margin-top:5px">${esc(a.action)}</div></div><div class="small"><b>Effort</b><br>${esc(a.effort || "—")}</div><div class="small"><b>Impact</b><br>${esc(a.impact || "—")}</div></div>`).join("")}
</section>

<section class="page">
  <div class="section-title"><div><div class="kicker muted">Issue overview</div><h2>Top vấn đề</h2></div></div>
  <table><thead><tr><th>Severity</th><th>Area</th><th>Code</th><th>Count</th><th>Sample</th></tr></thead><tbody>
  ${topIssues(report, 14).map((i) => `<tr><td>${badge(i.severity, i.severity)}</td><td>${esc(i.area)}</td><td><b>${esc(i.code)}</b></td><td>${esc(i.count)}</td><td>${esc(i.sampleMessage)}</td></tr>`).join("")}
  </tbody></table>
</section>

<section class="page">
  <div class="section-title"><div><div class="kicker muted">Detailed findings</div><h2>Chi tiết phát hiện</h2></div><div class="muted">${esc(findings.length)} nhóm issue hiển thị</div></div>
  ${findings.map((i) => `<div class="finding ${esc(i.severity)} avoid-break">
    <div class="finding-head">${badge(i.severity, i.severity)} ${badge(i.area, "neutral")} ${i.googleOfficial ? badge("Google official", "info") : ""}<span class="finding-code">${esc(i.code)}</span><span class="muted small">x${esc(i.count)}</span></div>
    <div class="finding-msg">${esc(i.message)}</div>
    ${i.urls.length ? `<div class="small muted" style="margin-top:6px">${i.urls.map((u) => `<span class="url">${esc(u)}</span>`).join("<br>")}</div>` : ""}
  </div>`).join("")}
</section>

<section class="page">
  <div class="section-title"><div><div class="kicker muted">GEO readiness</div><h2>AI Search readiness</h2></div><div>${badge(`${geo.score ?? "—"}/100`, (geo.score || 0) >= 60 ? "good" : "warning")}</div></div>
  <div class="cards">
    <div class="card"><div class="metric">${geo.llmsTxtExists ? "Yes" : "No"}</div><div class="metric-label">llms.txt</div></div>
    <div class="card"><div class="metric">${geo.aiAccess || "—"}</div><div class="metric-label">AI bots access</div></div>
    <div class="card"><div class="metric">${esc(geo.avgCitability ?? "—")}</div><div class="metric-label">Avg citability</div></div>
    <div class="card"><div class="metric">${esc(geo.faqCoverage ?? "—")}</div><div class="metric-label">FAQ coverage</div></div>
  </div>
  <p class="muted">GEO score phản ánh khả năng nội dung dễ được AI Search hiểu, trích dẫn và dùng làm nguồn trả lời.</p>
</section>

<section class="page">
  <div class="section-title"><div><div class="kicker muted">Page detail</div><h2>URL cần chú ý</h2></div><div class="muted">Sort theo page score thấp nhất</div></div>
  ${pages.map((p) => `<div class="page-row avoid-break">
    <div><b style="color:${scoreColor(p.pageScore ?? 0)}">${esc(p.pageScore ?? "—")}</b><div class="small muted">score</div></div>
    <div><div class="url">${esc(p.finalUrl || p.url)}</div><div class="small muted">${esc(p.signals?.title || "")}</div></div>
    <div><b>${esc(p.status ?? "—")}</b><div class="small muted">status</div></div>
    <div><b>${esc((p.issues || []).length)}</b><div class="small muted">issues</div></div>
  </div>`).join("")}
</section>

<section class="page">
  <div class="section-title"><div><div class="kicker muted">Technical signals</div><h2>Tín hiệu kỹ thuật</h2></div></div>
  <div class="cards">
    <div class="card"><div class="metric">${site.https ? "Yes" : "No"}</div><div class="metric-label">HTTPS</div></div>
    <div class="card"><div class="metric">${site.sitemapFound ? "Yes" : "No"}</div><div class="metric-label">Sitemap</div></div>
    <div class="card"><div class="metric">${esc(report.security?.missing?.length ?? 0)}</div><div class="metric-label">Missing headers</div></div>
    <div class="card"><div class="metric">${esc(report.internalLinks?.linksToBroken ?? 0)}</div><div class="metric-label">Broken internal links</div></div>
  </div>
  <div class="grid-2" style="margin-top:18px">
    <div class="card"><h3>Sitemap quality</h3><p><b>${esc(report.sitemapQuality?.totalUrls ?? 0)}</b> URL trong sitemap, <b>${esc(report.sitemapQuality?.urlsChecked ?? 0)}</b> URL đã cross-check.</p><p class="muted">Broken: ${esc(report.sitemapQuality?.urlsBroken?.length ?? 0)} · Noindex: ${esc(report.sitemapQuality?.urlsNoindex?.length ?? 0)} · Redirected: ${esc(report.sitemapQuality?.urlsRedirected?.length ?? 0)}</p></div>
    <div class="card"><h3>Google AI guide</h3><p>Googlebot blocked: <b>${report.googleAi?.googlebot?.blocked ? "Yes" : "No"}</b></p><p class="muted">Weak topic pillars: ${esc(report.googleAi?.topicClusters?.weakPillars ?? 0)} · Pagination bad canonicals: ${esc(report.googleAi?.pagination?.badCanonicals ?? 0)}</p></div>
  </div>
</section>

<section class="page">
  <div class="section-title"><div><div class="kicker muted">Appendix</div><h2>Dữ liệu đi kèm</h2></div></div>
  <p>Report này được render từ <code>report.json</code>. Các file CSV/JSON gốc nên được giữ lại để agent hoặc tool khác đọc khi tạo queue sửa lỗi.</p>
  <p class="muted">Renderer chỉ trình bày dữ liệu. Upload Drive, sửa WordPress, hoặc tạo queue xử lý là trách nhiệm của tool khác.</p>
</section>
${wrapperClose}`;
}

async function renderHtml(report, templateName, scoped = false) {
  const templateFile = templateName === "wordpress-embed-v1" ? "wordpress-embed-v1.html" : "consulting-v1.html";
  const tpl = await readFile(join(TPL, templateFile), "utf8");
  const printCss = await readFile(join(TPL, "print-v1.css"), "utf8");
  const body = renderBody(report, { scoped });
  return tpl
    .replace("{{TITLE}}", `Audit Pro Report - ${report.site?.domain || "website"}`)
    .replace("{{CSS}}", css(scoped) + "\n" + printCss)
    .replace("{{BODY}}", body);
}

async function renderPdf(htmlPath, pdfPath) {
  const chromium = ["/snap/bin/chromium", "chromium", "google-chrome"].find((cmd) => existsSync(cmd) || spawnSync("which", [cmd]).status === 0);
  if (!chromium) throw new Error("Chromium/Chrome not found for PDF rendering");
  const tmpPdf = join("/tmp", `audit-pro-render-${Date.now()}.pdf`);
  const snapTmp = join("/tmp/snap-private-tmp/snap.chromium/tmp", tmpPdf.split("/").pop());
  const htmlUrl = pathToFileURL(resolve(htmlPath)).href;
  const command = [
    "set -e",
    `rm -f ${JSON.stringify(tmpPdf)} ${JSON.stringify(snapTmp)}`,
    [
      "timeout 45s",
      JSON.stringify(chromium),
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-software-rasterizer",
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-sync",
      "--no-first-run",
      `--user-data-dir=${JSON.stringify(join("/tmp", `audit-pro-chrome-${Date.now()}`))}`,
      `--print-to-pdf=${JSON.stringify(tmpPdf)}`,
      "--print-to-pdf-no-header",
      JSON.stringify(htmlUrl)
    ].join(" "),
    `test -s ${JSON.stringify(tmpPdf)} || test -s ${JSON.stringify(snapTmp)}`
  ].join("; ");
  const r = spawnSync("bash", ["-lc", command], { encoding: "utf8", timeout: 50000 });
  if (r.status !== 0) throw new Error(`PDF render failed: ${r.stderr || r.stdout}`);
  const src = existsSync(tmpPdf) ? tmpPdf : snapTmp;
  const data = await readFile(src);
  await writeFile(pdfPath, data);
  await rm(src, { force: true });
}

async function main() {
  const args = parseArgs(process.argv);
  const report = JSON.parse(await readFile(args.input, "utf8"));
  await mkdir(args.out, { recursive: true });
  const base = `audit-pro-${report.site?.domain || "report"}`.replace(/[^a-z0-9.-]+/gi, "-").toLowerCase();
  const outputs = [];

  if (args.formats.includes("html")) {
    const html = await renderHtml(report, args.template, false);
    const p = join(args.out, `${base}.html`);
    await writeFile(p, html);
    outputs.push(p);
  }
  if (args.formats.includes("wp-html")) {
    const html = await renderHtml(report, "wordpress-embed-v1", true);
    const p = join(args.out, `${base}.wordpress.html`);
    await writeFile(p, html);
    outputs.push(p);
  }
  if (args.formats.includes("pdf")) {
    const htmlPath = join(args.out, `${base}.html`);
    if (!existsSync(htmlPath)) {
      const html = await renderHtml(report, args.template, false);
      await writeFile(htmlPath, html);
      outputs.push(htmlPath);
    }
    const pdfPath = join(args.out, `${base}.pdf`);
    await renderPdf(htmlPath, pdfPath);
    outputs.push(pdfPath);
  }

  console.log(JSON.stringify({ ok: true, out: args.out, outputs }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
