# Content Audit Build Checklist

Purpose: implementation checklist for adding a content-audit layer next to `audit-pro-git`.

Read `docs/CONTENT_AUDIT_CORE_LOGIC.md` first. This checklist controls scope. Do not add WordPress write actions in V1.

## MVP Scope

- [ ] Accept input from sitemap URL, WordPress REST API, or a URL list.
- [ ] Crawl/fetch posts and pages.
- [ ] Extract normalized inventory fields.
- [ ] Score each URL with the rule-based rubric.
- [ ] Generate duplicate and near-duplicate candidates.
- [ ] Build basic topic clusters.
- [ ] Decide `llm_needed` using policy rules.
- [ ] Cache page, cluster, rubric, prompt, and LLM fingerprints.
- [ ] Generate CSV, JSON, and Markdown reports.
- [ ] Keep all actions report-only.

## Suggested Repository Structure

```text
content-audit-pro/
  config/
    scoring-rubric.json
    llm-policy.json
  cache/
  reports/
  src/
    fetchers/
    extractors/
    scoring/
    clustering/
    llm/
    reports/
  docs/
```

If implemented inside `audit-pro-git`, keep modules separate from existing technical audit modules so technical audit and content audit can run independently.

## Modules

### 1. Fetcher

- [ ] Fetch URLs from sitemap XML.
- [ ] Fetch WordPress posts/pages through REST API.
- [ ] Optionally fetch raw HTML for public-page extraction.
- [ ] Respect `max_urls`, timeout, retry, and rate limits.
- [ ] Save fetch errors in the report.

Output: `raw_pages.json`

### 2. Extractor

- [ ] Normalize URL, slug, status code, canonical, indexability.
- [ ] Extract title, meta description, H1-H3, publish date, modified date.
- [ ] Extract category, tags, author when available.
- [ ] Count words from main content.
- [ ] Count images and missing alt text.
- [ ] Extract internal and external links.

Output: `inventory.json`, `inventory.csv`

### 3. Rule Scorer

- [ ] Load thresholds from `config/scoring-rubric.json`.
- [ ] Score metadata, structure, freshness, thin content, duplicate risk, internal links, taxonomy, and technical content risk.
- [ ] Attach `server_flags`.
- [ ] Produce severity bands.

Output: `rule_findings.json`

### 4. Duplicate And Cluster Builder

- [ ] Detect exact duplicate title/meta.
- [ ] Detect similar slugs and repeated heading patterns.
- [ ] Group by category, tags, keyword/entity candidates, and URL path patterns.
- [ ] Assign stable `cluster_id`.
- [ ] Compute `cluster_hash`.

Output: `clusters.json`

### 5. LLM Gate

- [ ] Implement `llm_needed` policy from core logic.
- [ ] Skip LLM when cached decision is valid.
- [ ] Send only risky pages/clusters to LLM.
- [ ] Require structured JSON output.
- [ ] Store prompt version, model, input hash, and output.

Output: `llm_decisions.json`

### 6. Action Planner

- [ ] Assign one action per URL: `KEEP`, `UPDATE`, `MERGE`, `REDIRECT`, `NOINDEX`, or `DELETE_DRAFT`.
- [ ] Mark destructive actions with `requires_human_approval = true`.
- [ ] Separate server-derived actions from LLM-derived actions.
- [ ] Add confidence and reason fields.

Output: `content_action_plan.csv`

### 7. Report Generator

- [ ] Create executive summary.
- [ ] List top weak pages.
- [ ] List duplicate/cannibalization clusters.
- [ ] List LLM-reviewed decisions.
- [ ] List actions requiring human approval.
- [ ] Include machine-readable output paths.

Output: `content_audit_report.md`

## LLM Prompt Contract

The implementation should keep a versioned prompt file. Required LLM output shape:

```json
{
  "cluster_id": "cluster-example",
  "primary_intent": "commercial investigation",
  "pillar_url": "https://example.com/main/",
  "decisions": [
    {
      "url": "https://example.com/post/",
      "decision": "MERGE",
      "target_url": "https://example.com/main/",
      "confidence": "medium",
      "reason": "Same intent as pillar but weaker depth and lower unique value."
    }
  ],
  "merge_plan": [
    "Move unique examples into the pillar page.",
    "Redirect weaker URL after human approval."
  ]
}
```

## V1 Non-Goals

- [ ] No automatic WordPress updates.
- [ ] No automatic redirect creation.
- [ ] No automatic noindex changes.
- [ ] No automatic post deletion.
- [ ] No traffic or Search Console integration unless explicitly added later.
- [ ] No heavy AI review for every URL by default.

## Test Cases

- [ ] Small site with fewer than 20 URLs.
- [ ] WordPress site with posts and pages.
- [ ] Site with duplicate titles.
- [ ] Site with thin posts.
- [ ] Site with old posts.
- [ ] Cluster with same keyword but different intent.
- [ ] Cluster with same intent requiring merge decision.
- [ ] Re-audit where content hashes are unchanged and LLM cache is reused.
- [ ] Re-audit where one page changes and only that page/cluster is reviewed again.

## Acceptance Criteria

- [ ] A full audit can run without LLM.
- [ ] LLM calls are limited to pages/clusters marked by policy.
- [ ] All outputs are saved under a dated report folder.
- [ ] Every URL has `server_score`, `server_flags`, `llm_needed`, `recommended_action`, `confidence`, and `requires_human_approval`.
- [ ] Cached LLM decisions are reused when fingerprints match.
- [ ] Reports distinguish measurable facts from LLM judgments.
- [ ] No code path mutates WordPress or live site state in V1.

## Claude Build Prompt

```text
Read docs/CONTENT_AUDIT_CORE_LOGIC.md and docs/CONTENT_AUDIT_BUILD_CHECKLIST.md.
Build the MVP exactly from those specs.
Do not add auto-write, delete, redirect, noindex, or WordPress mutation actions.
Keep all destructive actions as report-only recommendations with human approval required.
Implement modules incrementally and update docs/CONTENT_AUDIT_BUILD_CHECKLIST.md as items are completed.
```
