# Changelog

## v0.6.0 — Hardening release

### Changed

- Bumped CLI/package version from `0.5.1` to `0.6.0`.
- Replaced the old linear site score formula with a normalized scoring helper:
  - repeated template issues no longer punish large crawls linearly forever;
  - low-confidence/manual-verification issues have lower score impact;
  - score metadata is now included in `report.summary.scoring`.
- External link checking now separates:
  - `confirmedBroken` — 4xx except 403/429 and 5xx;
  - `blocked` — 403/429, common bot/rate-limit responses;
  - `timeoutOrNetwork` — aborts/network failures;
  - `unknown` — ambiguous responses that need manual review.
- CLI output now reports confirmed broken links separately from blocked/timeout/network states.

### Added

- `lib/hardening.mjs` with scoring, link classification, and heuristic metadata helpers.
- Node built-in tests for v0.6 hardening helpers.
- `npm test` and `npm run smoke` scripts.
- GitHub Actions workflow for Node 20 test runs.
- v0.6 hardening notes in `docs/v0.6-hardening.md`.

### Notes

- This release intentionally does not add headless browser rendering. SPA/React-heavy sites still need manual verification or a future Puppeteer/Playwright phase.
- Heuristic checks such as soft 404, interstitials, and JS-heavy HTML should be treated as audit signals, not absolute proof.
