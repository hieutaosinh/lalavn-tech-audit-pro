# Content Audit Core Logic

Purpose: define the reusable logic for a content-audit layer that complements `audit-pro-git`.

`audit-pro-git` remains the technical SEO/GEO audit tool. This content-audit layer evaluates the content inventory, topic overlap, quality risk, and recommended editorial actions. Version 1 is report-only. It must not write, delete, redirect, noindex, or update WordPress content automatically.

## Operating Principles

- The server is the source of truth for measurable facts.
- LLMs are used only where semantic judgment is required.
- Every recommendation must be reproducible from stored input, rules, prompt version, and cached LLM output.
- Human approval is required before destructive or externally visible actions.
- Re-audits should reuse cached LLM decisions unless the page, cluster, rubric, or prompt version changed.

## Server Responsibilities

The server handles deterministic work:

- Fetch content from sitemap, WordPress REST API, or crawled HTML.
- Extract URL, title, slug, meta description, H1-H3, canonical, publish date, modified date, author, category, tags, word count, image alt coverage, internal links, external links, indexability, and status code.
- Run rule-based scoring.
- Detect exact duplicates and near duplicates where possible.
- Build topic candidates and risk clusters before LLM review.
- Cache page fingerprints, cluster fingerprints, and LLM results.
- Generate CSV, JSON, Markdown, and HTML reports.
- Keep action output as recommendations only.

## LLM Responsibilities

The LLM handles judgment that cannot be reliably measured by rules:

- Identify search intent.
- Distinguish same keyword from same intent.
- Select pillar content inside a cluster.
- Decide whether similar pages should be kept separate, merged, redirected, updated, or noindexed.
- Evaluate topical depth, originality, E-E-A-T signals, and usefulness.
- Produce a merge plan or rewrite outline when requested.

The LLM must return structured JSON. Free-form prose is allowed only in human-readable reports derived from that JSON.

## Scoring Rubric

Each URL receives a `server_score` from 0 to 100.

| Area | Points | Server checks |
| --- | ---: | --- |
| Metadata | 15 | title length, meta description, H1, canonical, slug readability |
| Structure | 15 | heading order, paragraph length, table of contents, image alt coverage |
| Freshness | 10 | publish age, modified age, topic freshness sensitivity |
| Thin content | 15 | word count, main content ratio, heading count, internal support |
| Duplicate risk | 15 | duplicate title, duplicate meta, similar slug, similar heading set |
| Internal links | 10 | inbound/outbound internal links, orphan risk, pillar links |
| Taxonomy | 10 | category quality, tag count, junk/default taxonomy |
| Technical content risk | 10 | indexability, canonical mismatch, redirect chain, broken links |

Severity bands:

- `80-100`: healthy
- `60-79`: needs review
- `40-59`: weak
- `0-39`: high risk

## Rule-Based Flags

Examples of server flags:

- `missing_title`
- `short_title`
- `long_title`
- `missing_meta`
- `duplicate_title`
- `missing_h1`
- `multiple_h1`
- `thin_content`
- `stale_content`
- `uncategorized`
- `tag_spam`
- `orphan_page`
- `low_internal_links`
- `canonical_mismatch`
- `noindex_detected`
- `broken_internal_link`
- `near_duplicate_slug`

Thresholds should live in configuration, not hardcoded across modules.

## LLM Needed Policy

Set `llm_needed = true` when:

- A cluster has multiple pages targeting similar topics and server rules cannot choose a safe action.
- Two or more URLs appear to share keyword/entity overlap but may have different search intent.
- The server suggests `MERGE`, `REDIRECT`, or `NOINDEX` with less than high confidence.
- A page has business value but weak SEO signals.
- The audit requires topical depth, originality, E-E-A-T, or usefulness review.
- A rewrite outline, merge plan, or pillar/subtopic map is needed.

Set `llm_needed = false` when:

- The issue is purely measurable, such as missing metadata, H1 errors, broken links, or exact duplicate title.
- The page and cluster fingerprints are unchanged and a valid cached LLM result exists.
- The page is healthy by server rules and not part of a risky cluster.

## Fingerprint And Cache Logic

Store these fields for each LLM decision:

- `url`
- `content_hash`
- `title_hash`
- `cluster_hash`
- `rubric_version`
- `prompt_version`
- `llm_model`
- `decision`
- `confidence`
- `reason`
- `created_at`

Reuse cached LLM output only when:

- `content_hash` is unchanged.
- `cluster_hash` is unchanged.
- `rubric_version` is unchanged.
- `prompt_version` is unchanged.

Ask the LLM again when:

- The page body, title, slug, taxonomy, or canonical changed materially.
- The page moved to a different cluster.
- The scoring rubric or LLM prompt changed.
- The previous confidence is `low` and the page is still a priority.

## Action Taxonomy

Every URL should receive one recommended action:

- `KEEP`: content is useful and should remain as-is.
- `UPDATE`: content has value but needs refresh, expansion, structure, or metadata work.
- `MERGE`: combine with a stronger or more complete URL.
- `REDIRECT`: page should be redirected after merge or removal, pending approval.
- `NOINDEX`: keep for users but remove from search index, pending approval.
- `DELETE_DRAFT`: draft, test, or junk content that should not remain in the editorial system, pending approval.

Destructive actions must always include `requires_human_approval = true`.

## Output Schema

Minimum per-URL output:

```json
{
  "url": "https://example.com/post/",
  "server_score": 72,
  "server_flags": ["stale_content", "low_internal_links"],
  "cluster_id": "cluster-service-seo",
  "llm_needed": true,
  "llm_reason": "Similar intent cluster needs pillar/merge decision.",
  "llm_decision": "UPDATE",
  "confidence": "medium",
  "recommended_action": "UPDATE",
  "requires_human_approval": false,
  "notes": "Refresh examples, add internal links, improve metadata."
}
```

Minimum report outputs:

- `inventory.csv`
- `inventory.json`
- `rule_findings.json`
- `clusters.json`
- `llm_decisions.json`
- `content_action_plan.csv`
- `content_audit_report.md`

## Re-Audit Flow

First audit:

1. Crawl or fetch all candidate URLs.
2. Extract inventory fields.
3. Score all URLs with server rules.
4. Build clusters and mark risky groups.
5. Send only required pages/clusters to the LLM.
6. Save baseline fingerprints and decisions.
7. Generate report and action plan.

Later audits:

1. Fetch current data.
2. Compare against stored fingerprints.
3. Reuse cached LLM decisions for unchanged pages and clusters.
4. Ask the LLM only for new, changed, or newly risky clusters.
5. Generate a delta report showing fixed, new, and persistent issues.

## Safety Rules

- V1 must be audit-only.
- No automatic WordPress mutation.
- No automatic redirects.
- No automatic noindex.
- No automatic delete.
- No hidden LLM calls; every LLM call must be recorded with prompt version and input fingerprint.
- Reports must clearly separate server facts from LLM judgments.
