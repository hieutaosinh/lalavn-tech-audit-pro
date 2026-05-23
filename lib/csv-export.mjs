/**
 * CSV exports — for enterprise clients who want to filter/pivot in Excel.
 *
 * Tạo 3 file CSV:
 *   - pages.csv      → 1 row / page (URL + score + key signals + issue counts)
 *   - issues.csv     → 1 row / issue (URL + severity + code + message + area + confidence/manualVerify)
 *   - action-plan.csv → 1 row / task (priority + title + reason + action + effort + impact)
 *
 * Pure ESM, không depend npm package — escape thủ công theo RFC 4180.
 */

const NL = String.fromCharCode(10);

function csvEscape(v) {
  if (v == null) return "";
  let s = String(v);
  // Bỏ control chars có thể phá CSV
  s = s.replace(/[\r\n]+/g, " ").trim();
  if (/[",;\t]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toRow(values) {
  return values.map(csvEscape).join(",");
}

/**
 * Per-page summary CSV.
 * Cột: url, status, depth, durationMs, words, h1, schemaTypes,
 *      pageScore, criticalCount, warningCount, infoCount,
 *      citabilityScore, hasFAQ, hasAuthor, hasTLDR
 */
export function exportPagesCSV(report) {
  const headers = [
    "url",
    "finalUrl",
    "status",
    "depth",
    "durationMs",
    "wordCount",
    "h1Count",
    "schemaTypes",
    "pageScore",
    "critical",
    "warning",
    "info",
    "manualVerifyIssues",
    "lowConfidenceIssues",
    "citability",
    "hasFAQ",
    "hasAuthor",
    "hasTLDR",
    "noindex",
    "canonical",
  ];
  const rows = [toRow(headers)];

  for (const p of report.pages) {
    const sig = p.signals || {};
    const geo = p.geoSignals || {};
    const c = p.issues.filter((i) => i.severity === "critical").length;
    const w = p.issues.filter((i) => i.severity === "warning").length;
    const inf = p.issues.filter((i) => i.severity === "info").length;
    const manualVerify = p.issues.filter((i) => i.manualVerify).length;
    const lowConfidence = p.issues.filter((i) => i.confidence === "low").length;
    rows.push(toRow([
      p.url,
      p.finalUrl,
      p.status,
      p.depth,
      p.durationMs,
      sig.wordCount,
      sig.h1Count,
      (sig.schemaTypes || []).join("|"),
      p.pageScore != null ? p.pageScore : "",
      c,
      w,
      inf,
      manualVerify,
      lowConfidence,
      geo.citabilityScore,
      geo.hasFAQ ? "1" : "0",
      geo.hasAuthorBio ? "1" : "0",
      geo.hasTLDR ? "1" : "0",
      sig.noindex ? "1" : "0",
      sig.canonical || "",
    ]));
  }
  return rows.join(NL) + NL;
}

/**
 * Flat issue list CSV.
 */
export function exportIssuesCSV(report) {
  const headers = ["url", "severity", "code", "area", "confidence", "manualVerify", "googleOfficial", "message"];
  const rows = [toRow(headers)];

  for (const i of report.allIssues || []) {
    rows.push(toRow([
      i.url || "",
      i.severity,
      i.code,
      i.area || "",
      i.confidence || "high",
      i.manualVerify ? "1" : "0",
      i.googleOfficial ? "1" : "0",
      i.message,
    ]));
  }
  return rows.join(NL) + NL;
}

/**
 * Action plan CSV.
 */
export function exportActionPlanCSV(report) {
  const headers = ["priority", "id", "title", "area", "effort", "impact", "reason", "action"];
  const rows = [toRow(headers)];

  const ap = report.actionPlan || { byPriority: {} };
  for (const p of ["P0", "P1", "P2"]) {
    const tasks = ap.byPriority[p] || [];
    for (const t of tasks) {
      rows.push(toRow([
        p,
        t.id,
        t.title,
        t.area,
        t.effort,
        t.impact,
        t.reason,
        t.action,
      ]));
    }
  }
  return rows.join(NL) + NL;
}
