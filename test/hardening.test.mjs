import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyExternalLinkResults,
  computeIssueCounts,
  computeSiteScore,
  annotateHeuristicIssue,
} from "../lib/hardening.mjs";

test("computeIssueCounts groups severities", () => {
  const counts = computeIssueCounts([
    { severity: "critical" },
    { severity: "warning" },
    { severity: "warning" },
    { severity: "info" },
  ]);
  assert.deepEqual(counts, { critical: 1, warning: 2, info: 1 });
});

test("computeSiteScore normalizes repeated issues by crawl size", () => {
  const repeated = Array.from({ length: 20 }, () => ({
    severity: "warning",
    code: "META_DESC_MISSING",
    area: "on-page",
  }));
  const smallCrawlScore = computeSiteScore(repeated, 1);
  const largerCrawlScore = computeSiteScore(repeated, 25);

  assert.ok(smallCrawlScore < largerCrawlScore);
  assert.ok(largerCrawlScore > 70);
});

test("computeSiteScore discounts low-confidence/manual-verify issues", () => {
  const highConfidence = computeSiteScore([
    { severity: "warning", code: "SOFT_404", area: "indexability" },
  ], 1);
  const lowConfidence = computeSiteScore([
    { severity: "warning", code: "SOFT_404", area: "indexability", confidence: "low", manualVerify: true },
  ], 1);

  assert.ok(lowConfidence > highConfidence);
});

test("classifyExternalLinkResults separates broken from blocked and unknown", () => {
  const summary = classifyExternalLinkResults([
    { url: "https://ok.example", status: 200, ok: true },
    { url: "https://missing.example", status: 404, ok: false },
    { url: "https://forbidden.example", status: 403, ok: false },
    { url: "https://limited.example", status: 429, ok: false },
    { url: "https://timeout.example", status: 0, ok: false, error: "AbortError" },
    { url: "https://weird.example", status: 302, ok: false },
  ]);

  assert.equal(summary.ok.length, 1);
  assert.equal(summary.confirmedBroken.length, 1);
  assert.equal(summary.blocked.length, 2);
  assert.equal(summary.timeoutOrNetwork.length, 1);
  assert.equal(summary.unknown.length, 1);
});

test("annotateHeuristicIssue marks manual verification metadata", () => {
  const issue = annotateHeuristicIssue({ code: "POSSIBLE_INTERSTITIAL", severity: "info" }, "low");
  assert.equal(issue.confidence, "low");
  assert.equal(issue.manualVerify, true);
});
