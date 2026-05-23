/**
 * HTML report renderer for Lalavn Deep Audit.
 * Single self-contained HTML file with cover, exec summary, full report, action plan, appendix.
 * Optimized for Chrome "Print → Save as PDF".
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
  return `<span class="badge" style="${colors[sev] || colors.info}">${sev}</span>`;
}

function priorityBadge(p) {
  const colors = { P0: "#dc2626", P1: "#ea580c", P2: "#65a30d" };
  return `<span class="prio" style="background:${colors[p]};color:white">${p}</span>`;
}

// ─── Sections ────────────────────────────────────────────────────
function renderCover(report) {
  const b = report.brand;
  const d = report.auditDate;
  return `<section class="cover">
  <div class="cover-content">
    <div class="cover-logo">
      ${b.logoUrl ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.logoText)}">` : `<div class="logo-text">${escapeHtml(b.logoText)}</div>`}
    </div>
    <h1 class="cover-title">${escapeHtml(b.name)}</h1>
    <div class="cover-tagline">${escapeHtml(b.tagline)}</div>

    <div class="cover-target">
      <div class="cover-domain">${escapeHtml(report.site.domain)}</div>
      <div class="cover-url">${escapeHtml(report.site.startUrl)}</div>
    </div>

    <div class="cover-meta">
      <div><span>Ngày báo cáo</span><b>${escapeHtml(d)}</b></div>
      <div><span>URL được phân tích</span><b>${report.site.pagesAnalyzed}</b></div>
      <div><span>Vấn đề phát hiện</span><b>${report.summary.totalIssues}</b></div>
      <div><span>SEO Score</span><b style="color:${scoreColor(report.summary.score)}">${report.summary.score}/100</b></div>
      ${report.geo ? `<div><span>GEO Score</span><b style="color:${scoreColor(report.geo.score)}">${report.geo.score}/100</b></div>` : ""}
    </div>

    <div class="cover-footer">
      <div>${escapeHtml(b.footer)}</div>
      <div class="cover-contact">
        ${b.website ? `<span>${escapeHtml(b.website)}</span>` : ""}
        ${b.email ? `<span>${escapeHtml(b.email)}</span>` : ""}
      </div>
    </div>
  </div>
</section>`;
}

function renderExecSummary(report) {
  const s = report.summary;
  const cmp = report.comparison;
  const impact = report.impact;

  const trendHtml = cmp ? `
    <div class="trend">
      <div class="trend-row">
        <span>So với lần audit ${cmp.previousDate}:</span>
        <b style="color:${cmp.scoreDelta >= 0 ? "#16a34a" : "#dc2626"}">${cmp.scoreDelta >= 0 ? "+" : ""}${cmp.scoreDelta} điểm</b>
      </div>
      <div class="trend-row">
        <span>Vấn đề mới phát sinh:</span>
        <b>${cmp.counts.new}</b>
      </div>
      <div class="trend-row">
        <span>Vấn đề đã sửa:</span>
        <b style="color:#16a34a">${cmp.counts.fixed}</b>
      </div>
    </div>` : "";

  const top3 = (report.actionPlan.byPriority.P0 || []).slice(0, 3);
  const quickWins = (report.actionPlan.byPriority.P1 || []).filter((t) => t.effort === "low").slice(0, 3);

  // Google AI Optimization Guide compliance summary (issues with googleOfficial:true)
  const googleOfficialIssues = (report.allIssues || []).filter((i) => i.googleOfficial);
  const googleOfficialCount = googleOfficialIssues.length;
  const googleOfficialCritical = googleOfficialIssues.filter((i) => i.severity === "critical").length;

  return `<section class="page exec-summary">
  <header class="page-header">
    <h2>Tóm tắt cho điều hành</h2>
    <div class="page-meta">${escapeHtml(report.site.domain)} · ${escapeHtml(report.auditDate)}</div>
  </header>

  <div class="hero-score">
    <div style="display:flex;justify-content:center;gap:48px;flex-wrap:wrap;align-items:center">
      <div>
        <div class="hero-score-num" style="color:${scoreColor(s.score)};font-size:64px">${s.score}<span style="font-size:24px">/100</span></div>
        <div class="hero-score-label" style="color:${scoreColor(s.score)}">SEO · ${scoreLabel(s.score)}</div>
      </div>
      ${report.geo ? `<div>
        <div class="hero-score-num" style="color:${scoreColor(report.geo.score)};font-size:64px">${report.geo.score}<span style="font-size:24px">/100</span></div>
        <div class="hero-score-label" style="color:${scoreColor(report.geo.score)}">GEO · ${escapeHtml(report.geo.label)}</div>
      </div>` : ""}
    </div>
  </div>

  <div class="exec-cards">
    <div class="exec-card crit"><div class="v">${s.issueCounts.critical}</div><div class="l">Critical</div></div>
    <div class="exec-card warn"><div class="v">${s.issueCounts.warning}</div><div class="l">Warning</div></div>
    <div class="exec-card info"><div class="v">${s.issueCounts.info}</div><div class="l">Info</div></div>
    <div class="exec-card"><div class="v">${report.actionPlan.summary.P0}</div><div class="l">P0 — Tuần này</div></div>
    <div class="exec-card"><div class="v">${report.actionPlan.summary.P1}</div><div class="l">P1 — Tháng này</div></div>
    <div class="exec-card"><div class="v">${report.actionPlan.summary.P2}</div><div class="l">P2 — Quý này</div></div>
  </div>

  ${impact ? `
  <div class="impact-callout">
    <h3>Ước lượng ảnh hưởng</h3>
    <p>Nếu không xử lý các vấn đề Critical, ước tính site có thể đang <b>mất ~${impact.estimatedTrafficLossPct}% organic traffic tiềm năng</b>. Mức độ nghiêm trọng: <b>${impact.severity.toUpperCase()}</b>.</p>
    <p class="caveat">Đây là ước lượng dựa trên rule, không phải đo thực tế. Để có số chính xác cần GSC data.</p>
  </div>
  ` : ""}

  ${googleOfficialCount > 0 ? `
  <div class="impact-callout" style="background:${googleOfficialCritical > 0 ? "#fee2e2" : "#dbeafe"};border-left-color:${googleOfficialCritical > 0 ? "#dc2626" : "#2563eb"}">
    <h3>Google AI Optimization Guide compliance</h3>
    <p><b>${googleOfficialCount}</b> vấn đề được flag theo <a href="https://developers.google.com/search/docs/fundamentals/ai-optimization-guide" target="_blank">Google AI Optimization Guide chính thức</a> (${googleOfficialCritical} critical, ${googleOfficialIssues.filter((i)=>i.severity==="warning").length} warning, ${googleOfficialIssues.filter((i)=>i.severity==="info").length} info).</p>
    <p class="caveat">Đây là check trực tiếp theo guide do Google publish — ưu tiên fix cao hơn các check generic GEO/AEO.</p>
  </div>
  ` : ""}

  ${trendHtml}

  <h3>Top 3 vấn đề lớn nhất</h3>
  ${top3.length ? `<ol class="action-list">${top3.map((t) => `
    <li>
      <div class="action-title">${priorityBadge(t.priority)} ${escapeHtml(t.title)}</div>
      <div class="action-reason">${escapeHtml(t.reason)}</div>
    </li>`).join("")}</ol>` : `<p class="muted">Không có vấn đề Critical lớn — tốt!</p>`}

  ${quickWins.length ? `
  <h3>Quick wins (low effort, high return)</h3>
  <ol class="action-list">${quickWins.map((t) => `
    <li>
      <div class="action-title">${priorityBadge(t.priority)} ${escapeHtml(t.title)}</div>
      <div class="action-reason">${escapeHtml(t.reason)}</div>
    </li>`).join("")}</ol>` : ""}

</section>`;
}

function renderTechnicalSection(report) {
  const ss = report.site;
  const psi = report.psi || [];
  const sec = report.security || {};
  const sq = report.sitemapQuality || {};
  const il = report.internalLinks || {};
  const hl = report.hreflang || {};

  let psiHtml = "";
  if (psi.length > 0) {
    psiHtml = `
      <h3>Core Web Vitals (PageSpeed Insights)</h3>
      <table class="data">
        <thead><tr><th>URL</th><th>Strategy</th><th>Perf</th><th>SEO</th><th>LCP</th><th>CLS</th><th>INP (field)</th></tr></thead>
        <tbody>${psi.map((r) => {
          if (r.error) return `<tr><td class="url">${escapeHtml(r.url)}</td><td>${r.strategy}</td><td colspan="5" class="muted">${escapeHtml(r.error)}</td></tr>`;
          const d = r.data;
          return `<tr>
            <td class="url">${escapeHtml(r.url)}</td>
            <td>${r.strategy}</td>
            <td style="color:${scoreColor(d.scores.performance ?? 0)}"><b>${d.scores.performance ?? "—"}</b></td>
            <td style="color:${scoreColor(d.scores.seo ?? 0)}"><b>${d.scores.seo ?? "—"}</b></td>
            <td>${d.lab.lcp != null ? (d.lab.lcp / 1000).toFixed(2) + "s" : "—"}</td>
            <td>${d.lab.cls != null ? d.lab.cls.toFixed(3) : "—"}</td>
            <td>${d.field.inp_field?.percentile ? d.field.inp_field.percentile + "ms" : "—"}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;
  }

  // ── HTTP security headers (homepage representative)
  const SEC_HEADERS = [
    ["strict-transport-security", "HSTS"],
    ["content-security-policy", "CSP"],
    ["x-content-type-options", "X-Content-Type-Options"],
    ["x-frame-options", "X-Frame-Options"],
    ["referrer-policy", "Referrer-Policy"],
    ["permissions-policy", "Permissions-Policy"],
  ];
  const secHtml = `
    <h3>HTTP Security Headers (homepage)</h3>
    <table class="data">
      <thead><tr><th>Header</th><th>Trạng thái</th><th>Giá trị</th></tr></thead>
      <tbody>${SEC_HEADERS.map(([key, label]) => {
        const v = sec.present?.[key];
        return `<tr>
          <td><code>${escapeHtml(label)}</code></td>
          <td>${v ? `<b style="color:#16a34a">✓ Có</b>` : `<b style="color:#dc2626">✗ Thiếu</b>`}</td>
          <td class="url">${v ? escapeHtml(String(v).slice(0, 120)) : "—"}</td>
        </tr>`;
      }).join("")}
      <tr>
        <td><code>Compression</code></td>
        <td>${sec.compression && sec.compression !== "none" ? `<b style="color:#16a34a">✓</b>` : `<b style="color:#dc2626">✗</b>`}</td>
        <td><code>${escapeHtml(sec.compression || "none")}</code></td>
      </tr>
      </tbody>
    </table>`;

  // ── Sitemap quality details
  let sitemapHtml = "";
  if (sq.totalUrls > 0) {
    sitemapHtml = `
      <h3>Sitemap quality</h3>
      <div class="kv">
        <div><span>Tổng sitemap</span><b>${sq.sitemaps || 0}</b></div>
        <div><span>Tổng URL khai báo</span><b>${sq.totalUrls || 0}</b></div>
        <div><span>URL đã cross-check</span><b>${sq.urlsChecked || 0}</b></div>
        <div><span>URL bị 4xx/5xx</span><b style="color:${(sq.urlsBroken?.length || 0) > 0 ? "#dc2626" : "inherit"}">${sq.urlsBroken?.length || 0}</b></div>
        <div><span>URL có meta noindex</span><b style="color:${(sq.urlsNoindex?.length || 0) > 0 ? "#ca8a04" : "inherit"}">${sq.urlsNoindex?.length || 0}</b></div>
        <div><span>URL bị 3xx redirect</span><b>${sq.urlsRedirected?.length || 0}</b></div>
        <div><span>URL canonical khác</span><b>${sq.urlsCanonicalElsewhere?.length || 0}</b></div>
        <div><span>Sitemap quá lớn (>50k)</span><b>${sq.overSizedSitemaps || 0}</b></div>
      </div>`;
  }

  // ── Internal link health
  let internalHtml = "";
  if (il.linksToRedirect != null) {
    internalHtml = `
      <h3>Internal link health</h3>
      <div class="kv">
        <div><span>Link tới URL bị redirect</span><b style="color:${il.linksToRedirect > 0 ? "#ca8a04" : "inherit"}">${il.linksToRedirect}</b></div>
        <div><span>Link tới URL 4xx/5xx</span><b style="color:${il.linksToBroken > 0 ? "#dc2626" : "inherit"}">${il.linksToBroken}</b></div>
      </div>`;
  }

  // ── Hreflang summary
  let hreflangHtml = "";
  if (hl.totalDeclaring > 0) {
    hreflangHtml = `
      <h3>Hreflang i18n</h3>
      <div class="kv">
        <div><span>Trang khai báo hreflang</span><b>${hl.totalDeclaring}</b></div>
        <div><span>Thiếu reciprocal</span><b style="color:${hl.missingReciprocal > 0 ? "#ca8a04" : "inherit"}">${hl.missingReciprocal}</b></div>
        <div><span>Mã không hợp lệ</span><b>${hl.invalidCodes}</b></div>
        <div><span>Thiếu x-default site-wide</span><b>${hl.missingXDefault > 0 ? "✗" : "✓"}</b></div>
      </div>`;
  }

  // ── Google AI guide signals
  let googleAiHtml = "";
  const ga = report.googleAi;
  if (ga) {
    const gb = ga.googlebot || {};
    const cb = ga.crawlBudget || {};
    const tc = ga.topicClusters || {};
    const pg = ga.pagination || {};
    const gbStatus = gb.blocked
      ? `<b style="color:#dc2626">✗ Block toàn bộ</b>`
      : gb.partiallyBlocked
        ? `<b style="color:#ca8a04">⚠ Block 1 phần</b>`
        : `<b style="color:#16a34a">✓ Mở</b>`;
    googleAiHtml = `
      <h3>Google AI Search compliance <span style="font-size:11px;color:var(--muted);font-weight:400">(theo Google AI Optimization Guide chính thức)</span></h3>
      <div class="kv">
        <div><span>Googlebot access</span>${gbStatus}</div>
        <div><span>URL lãng phí crawl budget</span><b style="color:${(cb.wasteUrls || 0) >= 5 ? "#ca8a04" : "inherit"}">${cb.wasteUrls || 0}</b></div>
        <div><span>Pillar pages tìm thấy</span><b>${tc.pillarsFound || 0}</b></div>
        <div><span>Pillar yếu (< 5 subtopic)</span><b style="color:${(tc.weakPillars || 0) > 0 ? "#ca8a04" : "inherit"}">${tc.weakPillars || 0}</b></div>
        <div><span>Paginated URL</span><b>${pg.paginatedUrls || 0}</b></div>
        <div><span>Pagination canonical sai</span><b style="color:${(pg.badCanonicals || 0) > 0 ? "#ca8a04" : "inherit"}">${pg.badCanonicals || 0}</b></div>
      </div>`;
  }

  return `<section class="page">
  <header class="page-header"><h2>Sức khoẻ kỹ thuật</h2></header>

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

  ${googleAiHtml}
  ${secHtml}
  ${sitemapHtml}
  ${internalHtml}
  ${hreflangHtml}
  ${psiHtml}
</section>`;
}

function renderGeoSection(report) {
  const g = report.geo;
  if (!g) return "";
  const geoColor = scoreColor(g.score);
  const access = g.aiAccess || "unknown";
  const accessLabels = {
    "open": { text: "Mở (tốt)", color: "#16a34a" },
    "partially-blocked": { text: "Block 1 phần", color: "#ca8a04" },
    "mostly-blocked": { text: "Block phần lớn (xấu)", color: "#dc2626" },
    "unknown": { text: "Không xác định", color: "#64748b" },
  };
  const accessInfo = accessLabels[access] || accessLabels.unknown;

  // Top GEO issues
  const geoIssues = report.allIssues.filter((i) => i.area === "ai-search");
  const geoIssueByCode = new Map();
  for (const i of geoIssues) {
    if (!geoIssueByCode.has(i.code)) geoIssueByCode.set(i.code, { code: i.code, severity: i.severity, count: 0, sampleMessage: i.message });
    geoIssueByCode.get(i.code).count++;
  }
  const topGeoIssues = [...geoIssueByCode.values()].sort((a, b) => {
    const sev = { critical: 0, warning: 1, info: 2 };
    if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity];
    return b.count - a.count;
  }).slice(0, 8);

  // Top citability pages
  const pagesByCit = [...report.pages]
    .filter((p) => p.geoSignals?.citabilityScore != null)
    .sort((a, b) => (a.geoSignals.citabilityScore || 0) - (b.geoSignals.citabilityScore || 0))
    .slice(0, 5);

  return `<section class="page geo-section">
  <header class="page-header">
    <h2>GEO Readiness — sẵn sàng cho AI Search?</h2>
    <div class="page-meta">Generative Engine Optimization · ChatGPT · Perplexity · Google AI Overview</div>
  </header>

  <div class="hero-score" style="background:#f0f9ff;border:1px solid #bae6fd">
    <div class="hero-score-num" style="color:${geoColor}">${g.score}<span>/100</span></div>
    <div class="hero-score-label" style="color:${geoColor}">${escapeHtml(g.label)}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px">GEO Score (song song với SEO Score ${report.summary.score})</div>
  </div>

  <div class="exec-cards">
    <div class="exec-card"><div class="v" style="color:${accessInfo.color}">${escapeHtml(accessInfo.text)}</div><div class="l">AI Bots Access</div></div>
    <div class="exec-card"><div class="v">${g.llmsTxtExists ? "✓" : "✗"}</div><div class="l">llms.txt</div></div>
    <div class="exec-card"><div class="v">${g.hasOrganizationSchema ? "✓" : "✗"}</div><div class="l">Organization Schema</div></div>
    <div class="exec-card"><div class="v">${g.sameAsCount || 0}</div><div class="l">sameAs links</div></div>
    <div class="exec-card"><div class="v">${g.avgCitability ?? "—"}</div><div class="l">Avg Citability</div></div>
    <div class="exec-card"><div class="v">${g.faqCoverage ?? 0}%</div><div class="l">FAQ Coverage</div></div>
    <div class="exec-card"><div class="v">${g.lowCitabilityPages || 0}</div><div class="l">Trang khó cite</div></div>
  </div>

  ${g.trustPages ? `
  <h3>Trust pages</h3>
  <div class="kv">
    <div><span>About</span><b style="color:${g.trustPages.about ? "#16a34a" : "#dc2626"}">${g.trustPages.about ? "✓" : "✗"}</b></div>
    <div><span>Contact</span><b style="color:${g.trustPages.contact ? "#16a34a" : "#dc2626"}">${g.trustPages.contact ? "✓" : "✗"}</b></div>
    <div><span>Privacy</span><b style="color:${g.trustPages.privacy ? "#16a34a" : "#dc2626"}">${g.trustPages.privacy ? "✓" : "✗"}</b></div>
    <div><span>Terms</span><b style="color:${g.trustPages.terms ? "#16a34a" : "#dc2626"}">${g.trustPages.terms ? "✓" : "✗"}</b></div>
  </div>` : ""}

  ${g.sameAsDomains?.length ? `
  <h3>sameAs platforms (knowledge graph signal)</h3>
  <p style="font-size:13px">${g.sameAsDomains.map((d) => `<code>${escapeHtml(d)}</code>`).join(" · ")}</p>
  ` : ""}

  ${g.blockedBots?.length ? `
  <div class="impact-callout" style="background:#fee2e2;border-left-color:#dc2626">
    <h3>AI Bots đang bị chặn</h3>
    <p>robots.txt đang block các bot: <b>${g.blockedBots.map(escapeHtml).join(", ")}</b></p>
    <p class="caveat">Có nghĩa là content của site sẽ KHÔNG xuất hiện trong câu trả lời của các AI engine này.</p>
  </div>` : ""}

  ${topGeoIssues.length ? `
  <h3>Top vấn đề GEO</h3>
  <table class="data">
    <thead><tr><th>Severity</th><th>Code</th><th>Số lần</th><th>Mô tả</th></tr></thead>
    <tbody>${topGeoIssues.map((i) => `
      <tr>
        <td>${severityBadge(i.severity)}</td>
        <td><code>${escapeHtml(i.code)}</code></td>
        <td><b>${i.count}</b></td>
        <td>${escapeHtml((i.sampleMessage || "").slice(0, 120))}</td>
      </tr>`).join("")}</tbody>
  </table>` : `<p class="muted">Không phát hiện vấn đề GEO đáng kể.</p>`}

  ${pagesByCit.length ? `
  <h3>5 trang có Citability thấp nhất (cần ưu tiên cải thiện)</h3>
  <table class="data">
    <thead><tr><th>URL</th><th>Citability</th><th>Stats</th><th>FAQ</th><th>Author</th><th>TL;DR</th></tr></thead>
    <tbody>${pagesByCit.map((p) => {
      const g = p.geoSignals || {};
      return `<tr>
        <td class="url"><a href="${escapeHtml(p.finalUrl || p.url)}">${escapeHtml(p.finalUrl || p.url)}</a></td>
        <td><b style="color:${scoreColor(g.citabilityScore || 0)}">${g.citabilityScore || 0}</b></td>
        <td>${g.statisticsCount ?? 0}</td>
        <td>${g.hasFAQ ? "✓" : "✗"}</td>
        <td>${g.hasAuthorBio ? "✓" : "✗"}</td>
        <td>${g.hasTLDR ? "✓" : "✗"}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>` : ""}

  <div class="impact-callout" style="background:#eff6ff;border-left-color:#2563eb">
    <h3>GEO là gì?</h3>
    <p>Generative Engine Optimization — tối ưu để được AI search engine (ChatGPT, Perplexity, Google AI Overview, Claude, Gemini) <b>trích dẫn</b> trong câu trả lời.</p>
    <p class="caveat">Khác SEO truyền thống (rank để có click), GEO đo bằng citation rate. Đây là channel tăng trưởng nhanh nhất 2025-2026.</p>
  </div>
</section>`;
}

function renderTopIssues(report) {
  const top = report.summary.topIssues;
  if (!top.length) return "";
  return `<section class="page">
  <header class="page-header"><h2>Top 10 issues phổ biến</h2></header>
  <table class="data">
    <thead><tr><th>Severity</th><th>Code</th><th>Số lần</th><th>Khu vực</th><th>Ví dụ</th></tr></thead>
    <tbody>${top.map((t) => `
      <tr>
        <td>${severityBadge(t.severity)}</td>
        <td><code>${escapeHtml(t.code)}</code></td>
        <td><b>${t.count}</b></td>
        <td><span class="area">${escapeHtml(t.area || "general")}</span></td>
        <td>${escapeHtml((t.sampleMessage || "").slice(0, 100))}</td>
      </tr>`).join("")}</tbody>
  </table>
</section>`;
}

function renderPerPage(report) {
  // Sort: trang điểm thấp nhất trước (highlight nhanh chỗ cần ưu tiên)
  const sortedPages = [...report.pages].sort((a, b) => {
    const aScore = a.pageScore != null ? a.pageScore : 100;
    const bScore = b.pageScore != null ? b.pageScore : 100;
    return aScore - bScore;
  });
  return `<section class="page">
  <header class="page-header"><h2>Phân tích từng trang</h2><div class="page-meta">Sắp xếp theo score thấp → cao</div></header>
  <table class="data per-page">
    <thead><tr>
      <th>URL</th><th>Score</th><th>Status</th><th>Time</th><th>Words</th><th>H1</th><th>Schema</th><th>C/W/I</th><th>Chi tiết</th>
    </tr></thead>
    <tbody>${sortedPages.map((p) => {
      const sig = p.signals || {};
      const c = p.issues.filter((i) => i.severity === "critical").length;
      const w = p.issues.filter((i) => i.severity === "warning").length;
      const inf = p.issues.filter((i) => i.severity === "info").length;
      const ps = p.pageScore != null ? p.pageScore : 100;
      const issuesMini = p.issues.length === 0 ? "<li>—</li>" : p.issues.map((i) =>
        `<li class="sev-${i.severity}"><b>${escapeHtml(i.code)}</b>: ${escapeHtml(i.message)}</li>`
      ).join("");
      return `<tr>
        <td class="url"><a href="${escapeHtml(p.finalUrl || p.url)}">${escapeHtml(p.finalUrl || p.url)}</a></td>
        <td><b style="color:${scoreColor(ps)}">${ps}</b></td>
        <td>${p.status || "—"}</td>
        <td>${p.durationMs || "—"}ms</td>
        <td>${sig.wordCount || "—"}</td>
        <td>${sig.h1Count ?? "—"}</td>
        <td>${(sig.schemaTypes || []).slice(0, 2).join(", ") || "—"}</td>
        <td>
          <span class="pill" style="background:#fee2e2;color:#991b1b">${c}</span>
          <span class="pill" style="background:#fef3c7;color:#92400e">${w}</span>
          <span class="pill" style="background:#dbeafe;color:#1e40af">${inf}</span>
        </td>
        <td><details><summary>${p.issues.length} issue</summary><ul class="issues">${issuesMini}</ul></details></td>
      </tr>`;
    }).join("")}</tbody>
  </table>
</section>`;
}

function renderActionPlan(report) {
  const ap = report.actionPlan;
  const renderTask = (t) => `
    <div class="task">
      <div class="task-head">
        ${priorityBadge(t.priority)}
        <span class="task-title">${escapeHtml(t.title)}</span>
        <span class="task-meta">effort: <b>${t.effort}</b> · impact: <b>${t.impact}</b> · ${escapeHtml(t.area || "")}</span>
      </div>
      <div class="task-reason"><b>Lý do:</b> ${escapeHtml(t.reason)}</div>
      <div class="task-action"><b>Hành động:</b> ${escapeHtml(t.action)}</div>
    </div>`;

  return `<section class="page">
  <header class="page-header"><h2>Action plan</h2></header>

  ${ap.byPriority.P0?.length ? `
  <div class="ap-group">
    <h3>P0 — Cần làm tuần này (${ap.byPriority.P0.length})</h3>
    ${ap.byPriority.P0.map(renderTask).join("")}
  </div>` : ""}

  ${ap.byPriority.P1?.length ? `
  <div class="ap-group">
    <h3>P1 — Tháng này (${ap.byPriority.P1.length})</h3>
    ${ap.byPriority.P1.map(renderTask).join("")}
  </div>` : ""}

  ${ap.byPriority.P2?.length ? `
  <div class="ap-group">
    <h3>P2 — Quý này (${ap.byPriority.P2.length})</h3>
    ${ap.byPriority.P2.map(renderTask).join("")}
  </div>` : ""}

  ${ap.total === 0 ? `<p class="muted">Không phát hiện vấn đề cần action — site khá sạch. Tiếp tục duy trì content cadence.</p>` : ""}
</section>`;
}

function renderComparison(report) {
  const cmp = report.comparison;
  if (!cmp) return "";
  return `<section class="page">
  <header class="page-header"><h2>So sánh với lần audit trước (${escapeHtml(cmp.previousDate)})</h2></header>

  <div class="kv">
    <div><span>Score trước</span><b>${cmp.previousScore}/100</b></div>
    <div><span>Score hiện tại</span><b>${cmp.currentScore}/100</b></div>
    <div><span>Δ Score</span><b style="color:${cmp.scoreDelta >= 0 ? "#16a34a" : "#dc2626"}">${cmp.scoreDelta >= 0 ? "+" : ""}${cmp.scoreDelta}</b></div>
    <div><span>Vấn đề mới</span><b style="color:#dc2626">${cmp.counts.new}</b></div>
    <div><span>Đã sửa</span><b style="color:#16a34a">${cmp.counts.fixed}</b></div>
    <div><span>Vẫn còn</span><b>${cmp.counts.persistent}</b></div>
  </div>

  ${cmp.newIssues.length ? `<h3>Mới phát sinh</h3><ul class="diff-list">${cmp.newIssues.slice(0, 20).map((i) => `<li>${severityBadge(i.severity)} <code>${escapeHtml(i.code)}</code> ${escapeHtml(i.message)}</li>`).join("")}</ul>` : ""}
  ${cmp.fixedIssues.length ? `<h3>Đã sửa từ lần trước</h3><ul class="diff-list ok">${cmp.fixedIssues.slice(0, 20).map((i) => `<li>✓ <code>${escapeHtml(i.code)}</code> ${escapeHtml(i.message)}</li>`).join("")}</ul>` : ""}
</section>`;
}

// ─── CSS ─────────────────────────────────────────────────────────
function getStyles(brand) {
  return `
:root{--primary:${brand.primaryColor};--accent:${brand.accentColor};--muted:#64748b;--border:#e2e8f0;--bg:#fafafa}
*{box-sizing:border-box}
body{margin:0;font:14px/1.55 -apple-system,"Segoe UI",Roboto,sans-serif;color:var(--primary);background:var(--bg)}
.wrap{max-width:1100px;margin:0 auto}
.muted{color:var(--muted)}

/* Cover */
.cover{min-height:100vh;background:linear-gradient(135deg,var(--primary),${brand.accentColor || "#2563eb"});color:white;padding:60px 40px;display:flex;align-items:center;justify-content:center;page-break-after:always}
.cover-content{max-width:700px;width:100%}
.cover-logo{margin-bottom:60px}
.cover-logo img{max-width:160px;max-height:60px;background:white;padding:12px;border-radius:6px}
.logo-text{font-size:32px;font-weight:800;letter-spacing:-0.02em}
.cover-title{font-size:42px;font-weight:800;margin:0 0 8px;letter-spacing:-0.02em}
.cover-tagline{font-size:18px;opacity:0.85;margin-bottom:60px}
.cover-target{padding:24px 0;border-top:1px solid rgba(255,255,255,0.2);border-bottom:1px solid rgba(255,255,255,0.2);margin-bottom:40px}
.cover-domain{font-size:28px;font-weight:700;margin-bottom:4px}
.cover-url{opacity:0.7;font-size:13px;word-break:break-all}
.cover-meta{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:60px}
.cover-meta>div{display:flex;flex-direction:column;gap:4px}
.cover-meta span{font-size:11px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.6}
.cover-meta b{font-size:18px;font-weight:600}
.cover-footer{font-size:12px;opacity:0.7}
.cover-contact{margin-top:8px;display:flex;gap:16px}

/* Pages */
.page{background:white;padding:40px;margin:0;border-bottom:1px solid var(--border);page-break-after:always}
.page:last-child{page-break-after:auto}
.page-header{border-bottom:2px solid var(--primary);padding-bottom:8px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:12px}
.page-header h2{margin:0;font-size:22px;font-weight:700;letter-spacing:-0.01em}
.page-meta{color:var(--muted);font-size:12px}

/* Exec summary */
.hero-score{text-align:center;margin:16px 0 32px;padding:24px;background:#f8fafc;border-radius:12px}
.hero-score-num{font-size:80px;font-weight:800;line-height:1}
.hero-score-num span{font-size:32px;opacity:0.5}
.hero-score-label{font-size:16px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;margin-top:4px}

.exec-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}
.exec-card{background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center}
.exec-card .v{font-size:28px;font-weight:700;line-height:1.1}
.exec-card .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-top:4px}
.exec-card.crit .v{color:#dc2626}
.exec-card.warn .v{color:#ca8a04}
.exec-card.info .v{color:#2563eb}

.impact-callout{background:#fef3c7;border-left:4px solid #ca8a04;padding:16px;margin-bottom:24px;border-radius:4px}
.impact-callout h3{margin:0 0 8px;font-size:14px}
.impact-callout p{margin:0 0 4px}
.impact-callout .caveat{font-size:11px;color:var(--muted);font-style:italic}

.trend{background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:24px}
.trend-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border)}
.trend-row:last-child{border:none}

.action-list{padding-left:20px}
.action-list li{margin-bottom:12px}
.action-title{font-weight:600;margin-bottom:4px}
.action-reason{color:var(--muted);font-size:13px}

/* Tables */
.kv{display:grid;grid-template-columns:repeat(2,1fr);gap:6px 24px;margin-bottom:24px}
.kv>div{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--border)}
.kv span{color:var(--muted)}
.kv b{font-weight:600}

table.data{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}
table.data th,table.data td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
table.data th{background:#f8fafc;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.04em}
table.data td.url{max-width:280px;word-break:break-all}
table.data td.url a{color:var(--primary);text-decoration:none}
table.data td.url a:hover{text-decoration:underline}
table.data code{background:#f1f5f9;padding:1px 5px;border-radius:3px;font-size:11px}
table.data .area{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em}

/* Per-page details */
table.per-page details{font-size:11px}
table.per-page summary{cursor:pointer;color:var(--accent)}
ul.issues{margin:6px 0 0;padding-left:16px;font-size:11px}
ul.issues li{margin-bottom:2px}
ul.issues .sev-critical{color:#991b1b}
ul.issues .sev-warning{color:#92400e}
ul.issues .sev-info{color:#1e40af}

/* Badges & pills */
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;text-transform:uppercase;font-weight:700;letter-spacing:0.04em}
.pill{display:inline-block;min-width:22px;padding:1px 6px;border-radius:4px;font-size:11px;text-align:center;margin-right:2px}
.prio{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;margin-right:6px;letter-spacing:0.04em}

/* Action plan */
.ap-group{margin-bottom:32px}
.ap-group h3{font-size:15px;margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.task{background:#f8fafc;border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:12px}
.task-head{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.task-title{font-weight:600;font-size:14px;flex:1}
.task-meta{font-size:11px;color:var(--muted)}
.task-reason,.task-action{font-size:13px;margin-bottom:4px;line-height:1.5}
.task-reason b,.task-action b{color:var(--primary)}

/* Diff lists */
.diff-list{font-size:12px;padding-left:18px}
.diff-list li{margin-bottom:4px}
.diff-list.ok li{color:#166534}

/* Print */
@media print{
  body{background:white}
  .page{box-shadow:none;border:none}
  .cover{min-height:auto}
}
`;
}

// ─── Main render ────────────────────────────────────────────────
export function renderHTML(report) {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(report.brand.name)} — ${escapeHtml(report.site.domain)}</title>
<style>${getStyles(report.brand)}</style>
</head>
<body>
${renderCover(report)}
<div class="wrap">
${renderExecSummary(report)}
${renderGeoSection(report)}
${renderTechnicalSection(report)}
${renderTopIssues(report)}
${renderPerPage(report)}
${renderActionPlan(report)}
${renderComparison(report)}
<footer class="page" style="text-align:center;color:var(--muted);font-size:12px;border-top:1px solid var(--border)">
  <p>Generated by ${escapeHtml(report.brand.name)} v${report.tool?.version || "0.5"} · ${escapeHtml(report.auditDate)}</p>
  <p>${escapeHtml(report.brand.footer)}</p>
</footer>
</div>
</body>
</html>`;
}

export function renderMarkdown(report) {
  const s = report.summary;
  const ap = report.actionPlan;
  const L = [];
  L.push(`# ${report.brand.name} — ${report.site.domain}`);
  L.push("");
  L.push(`- Ngày: ${report.auditDate}`);
  L.push(`- URL crawl: ${report.site.pagesAnalyzed}`);
  L.push(`- Score: **${s.score}/100** (${scoreLabel(s.score)})`);
  L.push(`- Issues: ${s.issueCounts.critical} critical · ${s.issueCounts.warning} warning · ${s.issueCounts.info} info`);
  L.push("");

  if (report.geo) {
    L.push(`## GEO Readiness`);
    L.push(`- GEO Score: **${report.geo.score}/100** (${report.geo.label})`);
    L.push(`- AI Bots Access: ${report.geo.aiAccess}`);
    L.push(`- llms.txt: ${report.geo.llmsTxtExists ? "✓" : "✗"}`);
    L.push(`- Organization schema: ${report.geo.hasOrganizationSchema ? "✓" : "✗"}`);
    L.push(`- Avg Citability: ${report.geo.avgCitability}`);
    L.push(`- FAQ Coverage: ${report.geo.faqCoverage}%`);
    if (report.geo.blockedBots?.length) L.push(`- Blocked AI bots: ${report.geo.blockedBots.join(", ")}`);
    L.push("");
  }

  if (report.comparison) {
    const cmp = report.comparison;
    L.push(`## So sánh với ${cmp.previousDate}`);
    L.push(`- Δ Score: ${cmp.scoreDelta >= 0 ? "+" : ""}${cmp.scoreDelta}`);
    L.push(`- Mới: ${cmp.counts.new} · Đã sửa: ${cmp.counts.fixed} · Còn: ${cmp.counts.persistent}`);
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
