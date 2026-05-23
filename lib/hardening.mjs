/**
 * v0.6 hardening helpers.
 *
 * Goals:
 * - Keep site score stable across different crawl sizes.
 * - Separate confirmed external-link failures from blocked/unknown network states.
 * - Make heuristic issues explicit so reports can tell clients what needs manual verification.
 */

const SEVERITY_WEIGHT = {
  critical: 10,
  warning: 4,
  info: 1,
};

const AREA_MULTIPLIER = {
  indexability: 1.35,
  technical: 1.2,
  performance: 1.1,
  security: 1.1,
  schema: 1,
  content: 1,
  "ai-search": 0.95,
  "javascript-seo": 0.95,
  links: 0.9,
  "internal-linking": 0.9,
  accessibility: 0.75,
  "user-experience": 0.75,
};

export function computeIssueCounts(issues = []) {
  return {
    critical: issues.filter((i) => i.severity === "critical").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
  };
}

export function computeSiteScore(issues = [], pageCount = 1) {
  const pages = Math.max(1, Number(pageCount) || 1);
  const uniqueCodes = new Set();
  let rawPenalty = 0;

  for (const issue of issues) {
    const severityWeight = SEVERITY_WEIGHT[issue.severity] ?? SEVERITY_WEIGHT.info;
    const areaMultiplier = AREA_MULTIPLIER[issue.area] ?? 1;
    const confidenceMultiplier = issue.confidence === "low" ? 0.35 : issue.confidence === "medium" ? 0.7 : 1;
    rawPenalty += severityWeight * areaMultiplier * confidenceMultiplier;
    if (issue.code) uniqueCodes.add(issue.code);
  }

  // Crawl-size normalization: repeated template issues should hurt, but not linearly forever.
  const normalizedPenalty = rawPenalty / Math.sqrt(pages);
  const diversityPenalty = Math.min(uniqueCodes.size * 0.35, 8);
  const score = 100 - normalizedPenalty - diversityPenalty;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function classifyExternalLinkResults(results = []) {
  const summary = {
    confirmedBroken: [],
    blocked: [],
    timeoutOrNetwork: [],
    unknown: [],
    ok: [],
  };

  for (const r of results) {
    if (r.ok) {
      summary.ok.push(r);
    } else if (r.status >= 400 && r.status < 500 && r.status !== 403 && r.status !== 429) {
      summary.confirmedBroken.push(r);
    } else if (r.status >= 500 && r.status < 600) {
      summary.confirmedBroken.push(r);
    } else if (r.status === 403 || r.status === 429) {
      summary.blocked.push(r);
    } else if (r.status === 0 || /abort|timeout|network|fetch/i.test(r.error || "")) {
      summary.timeoutOrNetwork.push(r);
    } else {
      summary.unknown.push(r);
    }
  }

  return summary;
}

export function annotateHeuristicIssue(issue, confidence = "medium") {
  return {
    ...issue,
    confidence: issue.confidence || confidence,
    manualVerify: issue.manualVerify ?? true,
  };
}
