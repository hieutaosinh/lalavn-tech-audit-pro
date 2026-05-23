/**
 * PageSpeed Insights API wrapper.
 * Free for personal use without key, optional PSI_API_KEY env var for higher quota.
 */

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export async function fetchPSI(url, strategy = "mobile", timeoutMs = 60000) {
  const params = new URLSearchParams({ url, strategy });
  // Categories
  for (const c of ["performance", "accessibility", "best-practices", "seo"]) {
    params.append("category", c);
  }
  if (process.env.PSI_API_KEY) params.set("key", process.env.PSI_API_KEY);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${PSI_ENDPOINT}?${params}`, { signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`PSI HTTP ${res.status}${text ? ": " + text.slice(0, 200) : ""}`);
    }
    const data = await res.json();
    return parsePsiResponse(data, strategy);
  } finally {
    clearTimeout(t);
  }
}

function parsePsiResponse(data, strategy) {
  const lh = data.lighthouseResult || {};
  const audits = lh.audits || {};
  const categories = lh.categories || {};

  const score = (name) => categories[name]?.score != null ? Math.round(categories[name].score * 100) : null;

  // Lab metrics (synthetic)
  const lab = {
    lcp: numericValue(audits["largest-contentful-paint"]),
    fcp: numericValue(audits["first-contentful-paint"]),
    cls: numericValue(audits["cumulative-layout-shift"]),
    tbt: numericValue(audits["total-blocking-time"]),
    si: numericValue(audits["speed-index"]),
    tti: numericValue(audits["interactive"]),
  };

  // Field metrics (real user data) — chỉ có nếu URL đủ traffic
  const field = {};
  const lex = data.loadingExperience?.metrics || {};
  for (const [key, target] of Object.entries({
    LARGEST_CONTENTFUL_PAINT_MS: "lcp_field",
    INTERACTION_TO_NEXT_PAINT: "inp_field",
    CUMULATIVE_LAYOUT_SHIFT_SCORE: "cls_field",
    FIRST_CONTENTFUL_PAINT_MS: "fcp_field",
  })) {
    if (lex[key]) {
      field[target] = {
        percentile: lex[key].percentile,
        category: lex[key].category, // FAST | AVERAGE | SLOW
      };
    }
  }

  // Top opportunities (cái sửa được sẽ giúp nhiều nhất)
  const opportunities = [];
  for (const [id, audit] of Object.entries(audits)) {
    if (audit?.details?.type === "opportunity" && audit.numericValue > 100) {
      opportunities.push({
        id,
        title: audit.title,
        description: audit.description?.replace(/\[Learn.+?\]\(.+?\)/g, "").trim(),
        savingsMs: Math.round(audit.numericValue),
        score: audit.score,
      });
    }
  }
  opportunities.sort((a, b) => b.savingsMs - a.savingsMs);

  return {
    strategy,
    scores: {
      performance: score("performance"),
      accessibility: score("accessibility"),
      bestPractices: score("best-practices"),
      seo: score("seo"),
    },
    lab,
    field,
    fieldDataAvailable: Object.keys(field).length > 0,
    opportunities: opportunities.slice(0, 10),
  };
}

function numericValue(audit) {
  if (!audit) return null;
  return audit.numericValue != null ? Math.round(audit.numericValue * 100) / 100 : null;
}

/**
 * Run PSI on multiple URLs across multiple strategies, with concurrency = 2.
 */
export async function runPsiBatch(urls, strategies, onProgress) {
  const results = [];
  const queue = [];
  for (const u of urls) for (const s of strategies) queue.push({ url: u, strategy: s });

  let idx = 0;
  async function worker() {
    while (idx < queue.length) {
      const { url, strategy } = queue[idx++];
      let data = null, err = null;
      try { data = await fetchPSI(url, strategy); }
      catch (e) { err = e.message; }
      results.push({ url, strategy, data, error: err });
      if (onProgress) onProgress({ done: results.length, total: queue.length, url, strategy, ok: !err });
    }
  }
  await Promise.all([worker(), worker()]); // concurrency 2 — Google PSI rate limit thân thiện hơn
  return results;
}

/**
 * Convert PSI thresholds into issues.
 */
export function psiResultsToIssues(psiResults) {
  const issues = [];
  for (const r of psiResults) {
    if (r.error) {
      issues.push({ severity: "info", code: "PSI_ERROR", message: `PSI ${r.strategy} ${r.url}: ${r.error}`, area: "performance" });
      continue;
    }
    const d = r.data;
    const tag = `[${r.strategy}]`;
    // Lab thresholds
    if (d.lab.lcp != null && d.lab.lcp > 2500) {
      issues.push({ severity: d.lab.lcp > 4000 ? "critical" : "warning", code: "LCP_SLOW", message: `${tag} LCP ${(d.lab.lcp / 1000).toFixed(2)}s (mục tiêu < 2.5s)`, area: "performance", url: r.url });
    }
    if (d.lab.cls != null && d.lab.cls > 0.1) {
      issues.push({ severity: d.lab.cls > 0.25 ? "critical" : "warning", code: "CLS_HIGH", message: `${tag} CLS ${d.lab.cls.toFixed(3)} (mục tiêu < 0.1)`, area: "performance", url: r.url });
    }
    if (d.lab.tbt != null && d.lab.tbt > 200) {
      issues.push({ severity: d.lab.tbt > 600 ? "warning" : "info", code: "TBT_HIGH", message: `${tag} TBT ${Math.round(d.lab.tbt)}ms (mục tiêu < 200ms)`, area: "performance", url: r.url });
    }
    // Field INP
    if (d.field.inp_field?.percentile != null && d.field.inp_field.percentile > 200) {
      issues.push({ severity: d.field.inp_field.percentile > 500 ? "critical" : "warning", code: "INP_SLOW", message: `${tag} INP ${d.field.inp_field.percentile}ms (field data, mục tiêu < 200ms)`, area: "performance", url: r.url });
    }
    // Performance score
    if (d.scores.performance != null && d.scores.performance < 50) {
      issues.push({ severity: "warning", code: "PSI_PERF_LOW", message: `${tag} Performance score ${d.scores.performance}/100`, area: "performance", url: r.url });
    }
  }
  return issues;
}
