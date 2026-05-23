# Audit Pro Workflow V1

Purpose: make `audit-pro-git` the primary website audit system for Lalavn and client work.

The tool must produce:

- a human-readable report for owners/clients;
- machine-readable data for agents/scripts;
- a remediation queue;
- a repeatable re-audit gate;
- a clear green/pass status before delivery is considered complete.

## Core Workflow

```text
intake -> run audit -> normalize findings -> generate reports -> generate remediation plan -> fix -> recrawl -> green gate -> client-ready package
```

## 1. Intake

Input should be explicit, repeatable, and client-safe.

Minimum required fields:

- `client_slug`
- `site_url`
- `audit_mode`: `quick` | `standard` | `deep` | `recrawl`
- `site_type`: `wordpress` | `shop` | `saas` | `local_business` | `publisher` | `unknown`
- `owner`: internal operator or client owner
- `output_root`

Optional fields:

- `brand_name`
- `logo_url`
- `contact_email`
- `competitors`
- `priority_urls`
- `ignore_urls`
- `allowed_false_positives`
- `previous_report`
- `psi_enabled`
- `broken_link_check`
- `max_urls`
- `max_depth`

Suggested intake file:

```json
{
  "client_slug": "lalavn",
  "site_url": "https://lalavn.com",
  "audit_mode": "standard",
  "site_type": "wordpress",
  "owner": "lalaseo",
  "output_root": "/root/.openclaw/workspace/lalaseo/sites/lalavn/04_technical-seo/audits",
  "priority_urls": [
    "https://lalavn.com/",
    "https://lalavn.com/seo-tu-dong/"
  ],
  "allowed_false_positives": []
}
```

## 2. Audit Run

Current entry:

```bash
node run.mjs --url https://site.com --client-slug client-slug --auto-compare
```

Needed wrapper:

```bash
node scripts/audit-workflow.mjs --input clients/lalavn.audit.json
```

Wrapper responsibilities:

- load intake;
- create deterministic output folder;
- run `run.mjs` with correct flags;
- render deliverables;
- run green gate;
- write manifest.

## 3. Output Package

Each run should produce this structure:

```text
audits/YYYY-MM-DD/<run-id>/
├── input.json
├── manifest.json
├── report.json
├── report.html
├── report.md
├── pages.csv
├── issues.csv
├── action-plan.csv
├── remediation-plan.md
├── green-gate.json
├── green-gate.md
└── deliverables/
    ├── client-report.html
    ├── client-report.pdf
    ├── wordpress-embed.html
    └── machine-package.zip
```

`manifest.json` should include:

- tool version;
- command run;
- timestamps;
- input file path;
- output paths;
- previous report path;
- pass/fail status;
- gate summary.

## 4. Report Layers

### Human report

Audience: business owner, marketing lead, client.

Must answer:

- website health score;
- biggest risks;
- what must be fixed first;
- what changed since last audit;
- what Lalavn recommends doing next;
- what is already good enough.

Outputs:

- `client-report.html`
- `client-report.pdf`
- optional `wordpress-embed.html`

### Machine report

Audience: agent, scripts, project management system.

Must include:

- stable issue codes;
- URL;
- severity;
- area;
- priority;
- recommended fix;
- expected owner;
- current status;
- false-positive/accepted-risk fields.

Outputs:

- `report.json`
- `issues.csv`
- `pages.csv`
- `action-plan.csv`
- `green-gate.json`

### Remediation report

Audience: implementation operator.

Must answer:

- what to fix;
- in what order;
- where to verify;
- what can be ignored;
- what needs human decision.

Output:

- `remediation-plan.md`

## 5. Green Gate

Green gate is stricter than score.

Suggested default pass criteria:

- `P0 = 0`
- `critical = 0`
- `internal_broken_links = 0`
- no sitemap URL returns `4xx/5xx`
- no important/indexable URL has unintended `noindex`
- homepage has exactly one H1
- priority pages have title and meta description
- priority pages return 200 or intended 301
- required trust pages exist: About, Contact, Privacy, Terms
- Organization/WebSite schema baseline exists
- security header baseline exists:
  - `Strict-Transport-Security`
  - `X-Content-Type-Options`
  - `X-Frame-Options` or equivalent CSP frame policy
  - `Referrer-Policy`
- unresolved warnings are either assigned, accepted, or marked false positive

Recommended status:

- `green`: pass all blocking criteria
- `yellow`: no P0/critical, but important P1 remains
- `red`: P0/critical remains, or crawl failed
- `manual_review`: tool cannot decide safely

## 6. False Positive And Accepted Risk Policy

The tool must not force wrong fixes.

Examples:

- author archives may intentionally be `noindex`;
- social share URLs returning 403 may be crawler noise;
- static HTML crawler may over-report SPA symptoms on some WordPress/cached pages;
- a category/archive page may not need meta work if intentionally noindex.

Add an override file:

```json
{
  "false_positives": [
    {
      "code": "SPA_EMPTY_ROOT",
      "url_pattern": "https://lalavn.com/*",
      "reason": "Live WordPress HTML includes full content; static heuristic over-reported.",
      "approved_by": "lalaseo",
      "expires": "2026-06-20"
    }
  ],
  "accepted_risks": [
    {
      "code": "META_DESC_MISSING",
      "url_pattern": "https://lalavn.com/author/*",
      "reason": "Author archives intentionally noindex.",
      "approved_by": "lalaseo"
    }
  ]
}
```

Green gate should apply overrides, but preserve raw findings in `report.json`.

## 7. Scripts Needed

### `scripts/audit-workflow.mjs`

Primary orchestrator.

Input:

- `--input client.audit.json`

Responsibilities:

- validate intake;
- call `run.mjs`;
- call renderer;
- call remediation generator;
- call green gate;
- write manifest;
- print final status and output paths.

### `scripts/generate-remediation-plan.mjs`

Turns `report.json` and `action-plan.csv` into an implementation plan.

Input:

- `--report report.json`
- `--out remediation-plan.md`
- optional `--overrides overrides.json`

Responsibilities:

- group issues by P0/P1/P2;
- detect sitewide vs page-level fixes;
- mark likely false positives needing review;
- produce action order and verification commands.

### `scripts/green-gate.mjs`

Checks whether the site passes the delivery gate.

Input:

- `--report report.json`
- optional `--overrides overrides.json`
- `--out green-gate.json`

Responsibilities:

- evaluate blocking criteria;
- return non-zero exit when status is `red`;
- write `green-gate.json` and `green-gate.md`;
- list exact blockers.

### `scripts/build-client-package.mjs`

Creates final deliverables.

Input:

- `--run-dir audits/YYYY-MM-DD/<run-id>`

Responsibilities:

- render HTML/PDF/WP embed;
- copy machine-readable files;
- write package index;
- optionally zip files for client handoff.

### `scripts/compare-runs.mjs`

Compares before/after or week-over-week runs.

Input:

- `--before report.json`
- `--after report.json`

Responsibilities:

- fixed issues;
- new issues;
- persistent issues;
- score/gate change;
- client-friendly progress summary.

## 8. Implementation Order

Phase 1 - Workflow foundation:

1. add intake schema;
2. add workflow runner;
3. add manifest;
4. add green gate;
5. update README with the new workflow.

Phase 2 - Remediation:

1. generate remediation plan from `report.json`;
2. add false-positive/accepted-risk overrides;
3. classify sitewide vs page-level fixes;
4. create machine task queue.

Phase 3 - Client deliverables:

1. automatic PDF render;
2. deliverables folder standard;
3. client summary after recrawl;
4. package/zip output.

Phase 4 - Higher confidence:

1. optional browser-rendered audit mode for SPA/cached JS issues;
2. stable issue severity config per site type;
3. regression tests using saved fixture reports.

## 9. Definition Of Done

The workflow is ready for client use when:

- one intake file can run the full audit;
- all outputs are written to one predictable run folder;
- green gate gives `green/yellow/red/manual_review`;
- false positives can be overridden without deleting raw data;
- remediation plan is generated automatically;
- re-audit can prove fixed vs remaining issues;
- client report and machine package can be handed off without manual assembly.
