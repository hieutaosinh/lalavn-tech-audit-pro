/**
 * HTML + Markdown report renderer for Lalavn Deep Audit.
 * Single self-contained HTML file optimized for Chrome "Print → Save as PDF".
 */

const NL = String.fromCharCode(10);

const ENT_AMP  = String.fromCharCode(38) + "amp;";
const ENT_LT   = String.fromCharCode(38) + "lt;";
const ENT_GT   = String.fromCharCode(38) + "gt;";
const ENT_QUOT = String.fromCharCode(38) + "quot;";
const ENT_APOS = String.fromCharCode(38) + "#39;";

export function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, ENT_AMP)
    .replace(/</g, ENT_LT)
    .replace(/>/g, ENT_GT)
    .replace(/"/g, ENT_QUOT)
    .replace(/'/g, ENT_APOS);
}

function scoreColor(score) {
  if (score >= 90) return "#16a34a";
  if (score >= 75) return "#65a30d";
  if (score >= 60) return "#ca8a04";
  if (score >= 40) return "#ea580c";
  return "#dc2626";
}

function scoreLabel(score) {
  if (score >= 90) return "Rất tốt";
  if (score >= 75) return "Tốt";
  if (score >= 60) return "Trung bình";
  if (score >= 40) return "Cần cải thiện";
  return "Yếu";
}

function severityBadge(sev) {
  const colors = {
    critical: "background:#fee2e2;color:#991b1b",
    warning: "background:#fef3c7;color:#92400e",
    info: "background:#dbeafe;color:#1e40af",
  };
  return `<span class="badge" style="${colors[sev] || colors.info}">${escapeHtml(sev || "info")}</span>`;
}

function confidenceBadge(confidence = "high", manualVerify = false) {
  const colors = {
    high: "background:#dcfce7;color:#166534",
    medium: "background:#fef3c7;color:#92400e",
    low: "background:#fee2e2;color:#991b1b",
  };
  const label = `${confidence}${manualVerify ? " · verify" : ""}`;
  return `<span class="badge" style="${colors[confidence] || colors.high}">${escapeHtml(label)}</span>`;
}

function priorityBadge(p) {
  const colors = { P0: "#dc2626", P1: "#ea580c", P2: "#65a30d" };
  return `<span class="prio" style="background:${colors[p]};color:white">${escapeHtml(p)}</span>`;
}

function issueConfidence(issue) {
  return issue.confidence || "high";
}

function renderCover(report) {
  const b = report.brand;
  return `<section class="cover">
  <div class="cover-content">
    <div class="cover-logo">${b.logoUrl ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.logoText)}">` : `<div class="logo-text">${escapeHtml(b.logoText)}</div>`}</div>
    <h1 class="cover-title">${escapeHtml(b.name)}</h1>
    <div class="cover-tagline">${escapeHtml(b.tagline)}</div>
    <div class="cover-target">
      <div class="cover-domain">${escapeHtml(report.site.domain)}</div>
      <div class="cover-url">${escapeHtml(report.site.startUrl)}</div>
    </div>
    <div class="cover-meta">
      <div><span>Ngày báo cáo</span><b>${escapeHtml(report.auditDate)}</b></div>
      <div><span>URL được phân tích</span><b>${report.site.pagesAnalyzed}</b></div>
      <div><span>Vấn đề phát hiện</span><b>${report.summary.totalIssues}</b></div>
      <div><span>SEO Score</span><b style="color:${scoreColor(report.summary.score)}">${report.summary.score}/100</b></div>
      ${report.geo ? `<div><span>GEO Score</span><b style="color:${scoreColor(report.geo.score)}">${report.geo.score}/100</b></div>` : ""}
    </div>
    <div class="cover-footer">
      <div>${escapeHtml(b.footer)}</div>
      <div class="cover-contact">${b.website ? `<span>${escapeHtml(b.website)}</span>` : ""}${b.email ? `<span>${escapeHtml(b.email)}</span>` : ""}</div>
    </div>
  </div>
</section>`;
}

function renderExecSummary(report) {
  const s = report.summary;
  const lowConfidence = (report.allIssues || []).filter((i) => issueConfidence(i) === "low").length;
  const manualVerify = (report.allIssues || []).filter((i) => i.manualVerify).length;
  const googleOfficialIssues = (report.allIssues || []).filter((i) => i.googleOfficial);
  const googleOfficialCritical = googleOfficialIssues.filter((i) => i.severity === "critical").length;
  const top3 = (report.actionPlan.byPriority.P0 || []).slice(0, 3);
  const quickWins = (report.actionPlan.byPriority.P1 || []).filter((t) => t.effort === "low").slice(0, 3);

  return `<section class="page exec-summary">
  <header class="page-header"><h2>Tóm tắt cho điều hành</h2><div class="page-meta">${escapeHtml(report.site.domain)} · ${escapeHtml(report.auditDate)}</div></header>
  <div class="hero-score">
    <div class="hero-score-num" style="color:${scoreColor(s.score)}">${s.score}<span>/100</span></div>
    <div class="hero-score-label" style="color:${scoreColor(s.score)}">SEO · ${scoreLabel(s.score)}</div>
    ${report.summary.scoring?.note ? `<p class="caveat">${escapeHtml(report.summary.scoring.note)}</p>` : ""}
  </div>
  <div class="exec-cards">
    <div class="exec-card crit"><div class="v">${s.issueCounts.critical}</div><div class="l">Critical</div></div>
    <div class="exec-card warn"><div class="v">${s.issueCounts.warning}</div><div class="l">Warning</div></div>
    <div class="exec-card info"><div class="v">${s.issueCounts.info}</div><div class="l">Info</div></div>
    <div class="exec-card"><div class="v">${manualVerify}</div><div class="l">Cần manual verify</div></div>
    <div class="exec-card"><div class="v">${lowConfidence}</div><div class="l">Low confidence</div></div>
    <div class="exec-card"><div class="v">${report.geo?.score ?? "—"}</div><div class="l">GEO Score</div></div>
  </div>
  ${manualVerify > 0 ? `<div class="impact-callout verify"><h3>Lưu ý về heuristic</h3><p>Có <b>${manualVerify}</b> issue được đánh dấu <b>manual verify</b>. Đây là tín hiệu audit cần kiểm tra lại bằng trình duyệt/GSC/log server, không nên xem là lỗi chắc chắn khi gửi khách.</p></div>` : ""}
  ${googleOfficialIssues.length > 0 ? `<div class="impact-callout"><h3>Google Search / AI features guidance</h3><p><b>${googleOfficialIssues.length}</b> issue liên quan Google guidance (${googleOfficialCritical} critical). Ưu tiên các lỗi crawl/index/preview controls trước các heuristic GEO generic.</p></div>` : ""}
  ${top3.length ? `<h3>Top 3 vấn đề lớn nhất</h3><ol class="action-list">${top3.map((t) => `<li><div class="action-title">${priorityBadge(t.priority)} ${escapeHtml(t.title)}</div><div class="action-reason">${escapeHtml(t.reason)}</div></li>`).join("")}</ol>` : `<p class="muted">Không có vấn đề Critical lớn.</p>`}
  ${quickWins.length ? `<h3>Quick wins</h3><ol class="action-list">${quickWins.map((t) => `<li><div class="action-title">${priorityBadge(t.priority)} ${escapeHtml(t.title)}</div><div class="action-reason">${escapeHtml(t.reason)}</div></li>`).join("")}</ol>` : ""}
</section>`;
}

function renderTechnicalSection(report) {
  const ss = report.site;
  const sec = report.security || {};
  const sq = report.sitemapQuality || {};
  const il = report.internalLinks || {};
  const hl = report.hreflang || {};
  const ga = report.googleAi || {};
  const br = report.brokenLinks?.classification;

  return `<section class="page"><header class="page-header"><h2>Sức khoẻ kỹ thuật</h2></header>
  <div class="kv">
    <div><span>HTTPS</span><b>${ss.https ? "✓ Có" : "✗ Không"}</b></div>
    <div><span>robots.txt</span><b>${ss.robotsTxt?.exists ? "✓ Tồn tại" : "✗ Không tìm thấy"}</b></div>
    <div><span>sitemap.xml</span><b>${ss.sitemapFound ? `✓ ${ss.sitemapsUsed.length} sitemap` : "✗ Không tìm thấy"}</b></div>
    <div><span>Tổng URL crawl</span><b>${ss.pagesAnalyzed}</b></div>
    <div><span>Title trùng</span><b>${ss.duplicateTitles?.length || 0} nhóm</b></div>
    <div><span>Meta description trùng</span><b>${ss.duplicateDescs?.length || 0} nhóm</b></div>
    <div><span>Orphan pages</span><b>${ss.orphans?.length || 0}</b></div>
    <div><span>Audit duration</span><b>${(report.audit?.durationMs / 1000 || 0).toFixed(1)}s</b></div>
  </div>
  <h3>Googlebot / crawl signals</h3>
  <div class="kv">
    <div><span>Googlebot access</span><b>${ga.googlebot?.blocked ? "✗ Blocked" : ga.googlebot?.partiallyBlocked ? "⚠ Partial" : "✓ Open"}</b></div>
    <div><span>Crawl budget waste URLs</span><b>${ga.crawlBudget?.wasteUrls || 0}</b></div>
    <div><span>Pillar pages</span><b>${ga.topicClusters?.pillarsFound || 0}</b></div>
    <div><span>Weak pillars</span><b>${ga.topicClusters?.weakPillars || 0}</b></div>
  </div>
  <h3>External links</h3>
  <div class="kv">
    <div><span>Confirmed broken</span><b>${br?.confirmedBroken?.length || 0}</b></div>
    <div><span>Blocked / rate-limited</span><b>${br?.blocked?.length || 0}</b></div>
    <div><span>Timeout / network</span><b>${br?.timeoutOrNetwork?.length || 0}</b></div>
    <div><span>Unknown</span><b>${br?.unknown?.length || 0}</b></div>
  </div>
  <h3>Security / sitemap / hreflang</h3>
  <div class="kv">
    <div><span>Compression</span><b>${escapeHtml(sec.compression || "unknown")}</b></div>
    <div><span>Sitemap URLs</span><b>${sq.totalUrls || 0}</b></div>
    <div><span>Internal links to redirect</span><b>${il.linksToRedirect || 0}</b></div>
    <div><span>Hreflang missing reciprocal</span><b>${hl.missingReciprocal || 0}</b></div>
  </div>
</section>`;
}

function renderGeoSection(report) {
  const g = report.geo;
  if (!g) return "";
  return `<section class="page geo-section">
  <header class="page-header"><h2>GEO Readiness</h2><div class="page-meta">AI search citation readiness</div></header>
  <div class="hero-score" style="background:#f0f9ff;border:1px solid #bae6fd">
    <div class="hero-score-num" style="color:${scoreColor(g.score)}">${g.score}<span>/100</span></div>
    <div class="hero-score-label" style="color:${scoreColor(g.score)}">${escapeHtml(g.label)}</div>
  </div>
  <div class="exec-cards">
    <div class="exec-card"><div class="v">${escapeHtml(g.aiAccess || "unknown")}</div><div class="l">AI bots access</div></div>
    <div class="exec-card"><div class="v">${g.llmsTxtExists ? "✓" : "✗"}</div><div class="l">llms.txt</div></div>
    <div class="exec-card"><div class="v">${g.hasOrganizationSchema ? "✓" : "✗"}</div><div class="l">Organization schema</div></div>
    <div class="exec-card"><div class="v">${g.avgCitability ?? "—"}</div><div class="l">Avg citability</div></div>
    <div class="exec-card"><div class="v">${g.faqCoverage ?? 0}%</div><div class="l">FAQ coverage</div></div>
    <div class="exec-card"><div class="v">${g.lowCitabilityPages || 0}</div><div class="l">Low citability pages</div></div>
  </div>
</section>`;
}

function renderTopIssues(report) {
  const top = report.summary.topIssues || [];
  if (!top.length) return "";
  return `<section class="page"><header class="page-header"><h2>Top 10 issues phổ biến</h2></header>
  <table class="data"><thead><tr><th>Severity</th><th>Code</th><th>Số lần</th><th>Khu vực</th><th>Confidence</th><th>Ví dụ</th></tr></thead>
  <tbody>${top.map((t) => `<tr>
    <td>${severityBadge(t.severity)}</td>
    <td><code>${escapeHtml(t.code)}</code></td>
    <td><b>${t.count}</b></td>
    <td><span class="area">${escapeHtml(t.area || "general")}</span></td>
    <td>${confidenceBadge(t.confidence || "high", t.manualVerify)}</td>
    <td>${escapeHtml((t.sampleMessage || "").slice(0, 120))}</td>
  </tr>`).join("")}</tbody></table></section>`;
}

function renderPerPage(report) {
  const sortedPages = [...report.pages].sort((a, b) => (a.pageScore ?? 100) - (b.pageScore ?? 100));
  return `<section class="page"><header class="page-header"><h2>Phân tích từng trang</h2><div class="page-meta">Sắp xếp theo score thấp → cao</div></header>
  <table class="data per-page"><thead><tr><th>URL</th><th>Score</th><th>Status</th><th>Words</th><th>Schema</th><th>C/W/I</th><th>Verify</th><th>Chi tiết</th></tr></thead>
  <tbody>${sortedPages.map((p) => {
    const sig = p.signals || {};
    const c = p.issues.filter((i) => i.severity === "critical").length;
    const w = p.issues.filter((i) => i.severity === "warning").length;
    const inf = p.issues.filter((i) => i.severity === "info").length;
    const verify = p.issues.filter((i) => i.manualVerify).length;
    const issuesMini = p.issues.length === 0 ? "<li>—</li>" : p.issues.map((i) => `<li class="sev-${i.severity}"><b>${escapeHtml(i.code)}</b> ${confidenceBadge(issueConfidence(i), i.manualVerify)}: ${escapeHtml(i.message)}</li>`).join("");
    return `<tr>
      <td class="url"><a href="${escapeHtml(p.finalUrl || p.url)}">${escapeHtml(p.finalUrl || p.url)}</a></td>
      <td><b style="color:${scoreColor(p.pageScore ?? 100)}">${p.pageScore ?? 100}</b></td>
      <td>${p.status || "—"}</td>
      <td>${sig.wordCount || "—"}</td>
      <td>${(sig.schemaTypes || []).slice(0, 2).join(", ") || "—"}</td>
      <td><span class="pill crit">${c}</span><span class="pill warn">${w}</span><span class="pill info">${inf}</span></td>
      <td>${verify ? `<b style="color:#92400e">${verify}</b>` : "0"}</td>
      <td><details><summary>${p.issues.length} issue</summary><ul class="issues">${issuesMini}</ul></details></td>
    </tr>`;
  }).join("")}</tbody></table></section>`;
}

function renderActionPlan(report) {
  const ap = report.actionPlan;
  const renderTask = (t) => `<div class="task"><div class="task-head">${priorityBadge(t.priority)}<span class="task-title">${escapeHtml(t.title)}</span><span class="task-meta">effort: <b>${escapeHtml(t.effort)}</b> · impact: <b>${escapeHtml(t.impact)}</b> · ${escapeHtml(t.area || "")}</span></div><div class="task-reason"><b>Lý do:</b> ${escapeHtml(t.reason)}</div><div class="task-action"><b>Hành động:</b> ${escapeHtml(t.action)}</div></div>`;
  return `<section class="page"><header class="page-header"><h2>Action plan</h2></header>
  ${["P0", "P1", "P2"].map((p) => ap.byPriority[p]?.length ? `<div class="ap-group"><h3>${p} (${ap.byPriority[p].length})</h3>${ap.byPriority[p].map(renderTask).join("")}</div>` : "").join("")}
  ${ap.total === 0 ? `<p class="muted">Không phát hiện vấn đề cần action.</p>` : ""}
</section>`;
}

function renderComparison(report) {
  const cmp = report.comparison;
  if (!cmp) return "";
  return `<section class="page"><header class="page-header"><h2>So sánh với lần audit trước (${escapeHtml(cmp.previousDate)})</h2></header>
  <div class="kv"><div><span>Score trước</span><b>${cmp.previousScore}/100</b></div><div><span>Score hiện tại</span><b>${cmp.currentScore}/100</b></div><div><span>Δ Score</span><b>${cmp.scoreDelta >= 0 ? "+" : ""}${cmp.scoreDelta}</b></div><div><span>Vấn đề mới</span><b>${cmp.counts.new}</b></div><div><span>Đã sửa</span><b>${cmp.counts.fixed}</b></div><div><span>Vẫn còn</span><b>${cmp.counts.persistent}</b></div></div>
</section>`;
}

function getStyles(brand) {
  return `
:root{--primary:${brand.primaryColor};--accent:${brand.accentColor};--muted:#64748b;--border:#e2e8f0;--bg:#fafafa}
*{box-sizing:border-box}body{margin:0;font:14px/1.55 -apple-system,"Segoe UI",Roboto,sans-serif;color:var(--primary);background:var(--bg)}.wrap{max-width:1100px;margin:0 auto}.muted,.caveat{color:var(--muted);font-size:12px}.cover{min-height:100vh;background:linear-gradient(135deg,var(--primary),${brand.accentColor || "#2563eb"});color:white;padding:60px 40px;display:flex;align-items:center;justify-content:center;page-break-after:always}.cover-content{max-width:700px;width:100%}.cover-logo{margin-bottom:60px}.cover-logo img{max-width:160px;max-height:60px;background:white;padding:12px;border-radius:6px}.logo-text{font-size:32px;font-weight:800}.cover-title{font-size:42px;font-weight:800;margin:0 0 8px}.cover-tagline{font-size:18px;opacity:.85;margin-bottom:60px}.cover-target{padding:24px 0;border-top:1px solid rgba(255,255,255,.2);border-bottom:1px solid rgba(255,255,255,.2);margin-bottom:40px}.cover-domain{font-size:28px;font-weight:700}.cover-url{opacity:.7;font-size:13px;word-break:break-all}.cover-meta{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:60px}.cover-meta>div{display:flex;flex-direction:column;gap:4px}.cover-meta span{font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.6}.cover-meta b{font-size:18px}.cover-footer{font-size:12px;opacity:.7}.cover-contact{margin-top:8px;display:flex;gap:16px}.page{background:white;padding:40px;margin:0;border-bottom:1px solid var(--border);page-break-after:always}.page:last-child{page-break-after:auto}.page-header{border-bottom:2px solid var(--primary);padding-bottom:8px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:12px}.page-header h2{margin:0;font-size:22px}.page-meta{color:var(--muted);font-size:12px}.hero-score{text-align:center;margin:16px 0 32px;padding:24px;background:#f8fafc;border-radius:12px}.hero-score-num{font-size:72px;font-weight:800;line-height:1}.hero-score-num span{font-size:28px;opacity:.5}.hero-score-label{font-size:16px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-top:4px}.exec-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}.exec-card{background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center}.exec-card .v{font-size:28px;font-weight:700}.exec-card .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}.crit .v{color:#dc2626}.warn .v{color:#ca8a04}.info .v{color:#2563eb}.impact-callout{background:#fef3c7;border-left:4px solid #ca8a04;padding:16px;margin-bottom:24px;border-radius:4px}.impact-callout.verify{background:#fff7ed;border-left-color:#ea580c}.kv{display:grid;grid-template-columns:repeat(2,1fr);gap:6px 24px;margin-bottom:24px}.kv>div{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border)}.kv span{color:var(--muted)}table.data{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}table.data th,table.data td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}table.data th{background:#f8fafc;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}td.url{max-width:280px;word-break:break-all}td.url a{color:var(--primary);text-decoration:none}table.data code{background:#f1f5f9;padding:1px 5px;border-radius:3px}.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;text-transform:uppercase;font-weight:700;letter-spacing:.04em}.pill{display:inline-block;min-width:22px;padding:1px 6px;border-radius:4px;font-size:11px;text-align:center;margin-right:2px}.pill.crit{background:#fee2e2;color:#991b1b}.pill.warn{background:#fef3c7;color:#92400e}.pill.info{background:#dbeafe;color:#1e40af}.prio{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-right:6px}.issues{margin:6px 0 0;padding-left:16px;font-size:11px}.issues li{margin-bottom:4px}.sev-critical{color:#991b1b}.sev-warning{color:#92400e}.sev-info{color:#1e40af}.task{background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px}.task-head{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px}.task-title{font-weight:600;font-size:14px;flex:1}.task-meta{font-size:11px;color:var(--muted)}@media print{body{background:white}.page{box-shadow:none;border:none}.cover{min-height:auto}}`;
}

export function renderHTML(report) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(report.brand.name)} — ${escapeHtml(report.site.domain)}</title><style>${getStyles(report.brand)}</style></head><body>${renderCover(report)}<div class="wrap">${renderExecSummary(report)}${renderGeoSection(report)}${renderTechnicalSection(report)}${renderTopIssues(report)}${renderPerPage(report)}${renderActionPlan(report)}${renderComparison(report)}<footer class="page" style="text-align:center;color:var(--muted);font-size:12px;border-top:1px solid var(--border)"><p>Generated by ${escapeHtml(report.brand.name)} v${report.tool?.version || "0.6"} · ${escapeHtml(report.auditDate)}</p><p>${escapeHtml(report.brand.footer)}</p></footer></div></body></html>`;
}

export function renderMarkdown(report) {
  const s = report.summary;
  const ap = report.actionPlan;
  const manualVerify = (report.allIssues || []).filter((i) => i.manualVerify).length;
  const lowConfidence = (report.allIssues || []).filter((i) => i.confidence === "low").length;
  const L = [];
  L.push(`# ${report.brand.name} — ${report.site.domain}`);
  L.push("");
  L.push(`- Ngày: ${report.auditDate}`);
  L.push(`- URL crawl: ${report.site.pagesAnalyzed}`);
  L.push(`- Score: **${s.score}/100** (${scoreLabel(s.score)})`);
  L.push(`- Issues: ${s.issueCounts.critical} critical · ${s.issueCounts.warning} warning · ${s.issueCounts.info} info`);
  L.push(`- Manual verify: ${manualVerify} · Low confidence: ${lowConfidence}`);
  L.push("");
  if (report.geo) {
    L.push(`## GEO Readiness`);
    L.push(`- GEO Score: **${report.geo.score}/100** (${report.geo.label})`);
    L.push(`- AI Bots Access: ${report.geo.aiAccess}`);
    L.push(`- llms.txt: ${report.geo.llmsTxtExists ? "✓" : "✗"}`);
    L.push(`- Avg Citability: ${report.geo.avgCitability}`);
    L.push("");
  }
  L.push(`## Action plan`);
  for (const p of ["P0", "P1", "P2"]) {
    if (ap.byPriority[p]?.length) {
      L.push(`### ${p} (${ap.byPriority[p].length})`);
      for (const t of ap.byPriority[p]) {
        L.push(`- **${t.title}** — ${t.reason}`);
        L.push(`  - Action: ${t.action}`);
        L.push(`  - Effort: ${t.effort} · Impact: ${t.impact}`);
      }
      L.push("");
    }
  }
  L.push(`---`);
  L.push(`Generated by ${report.brand.name}`);
  return L.join(NL);
}
