# Production runbook — operational facts & release acceptance

Permanent operational reference recorded at the UX-v2 release closeout (2026-07-15), so future QA does
not repeat the same discovery. Documentation only — it changes no behavior.

## Production surfaces & canonical URLs

| Surface | Canonical URL | Pricing consumed |
|---|---|---|
| Vercel production (public) | **https://rag-cost-calculator-hazel.vercel.app** | `/` runtime/live via `/api/prices` |
| Vercel `/advisor` | https://rag-cost-calculator-hazel.vercel.app/advisor | pinned reference price book (by design) |
| GitHub Pages | https://ossgenai-poli.github.io/rag-cost-calculator/ | pinned reference book (static export) |
| GitHub Pages `/advisor` | **https://ossgenai-poli.github.io/rag-cost-calculator/advisor** — **NO trailing slash** (`/advisor/` 404s; the export emits `advisor.html`) | pinned reference book |

- **The team-scoped generated deployment URL**
  (`rag-cost-calculator-…-ossgenai-2521s-projects.vercel.app`) **is intentionally protected by Vercel
  Standard Protection and is NOT the public production URL.** A 302 to `vercel.com/sso-api` from that
  URL is correct behavior, not an outage. PR/preview deployments are protected the same way.
- `/advisor` is intentionally **unlisted** from the calculator at `/`. If it is ever linked, use the
  verified static URL WITHOUT a trailing slash (above) — a separately reviewed integration change.

## Pricing architecture (two intentionally different consumers)

- **`/` (calculator)**: consumes runtime/live pricing from `/api/prices`. Price provenance is PER-SKU
  (PRICING-018): each GPU carries its own `live` / `reference` (fallback) / `override` chip in the
  "Pricing sources" modal — a top-level "live" state never implies every SKU is live.
- **`/advisor` (UX v2)**: intentionally consumes the **pinned reference price book**
  (`public/prices.json`, static import; owner decision D5) and discloses it everywhere — the
  "(fallback)" rationale suffix, the pinned-book risk line with as-of + region, and the base
  on-demand rate. The advisor never claims live pricing. Do NOT file this as a defect.
- **`/api/prices` is `force-static` with `revalidate = 3600`**: the response (including `updatedAt`)
  is cached and byte-stable across reloads, but it can regenerate **at most hourly** on Vercel in
  addition to redeploys — it is NOT strictly redeploy-only.

## Automated triggers (external to the two obvious workflows)

- **`refresh-prices.yml`** — a third, SCHEDULED workflow: it commits a price refresh to `main`
  nightly as `github-actions[bot]` (and thereby moves `main` and redeploys). A timestamp-only bump
  means the live fetch fell back; see follow-ups.
- **Vercel GitHub integration** — an external deployment trigger: every PR gets a protected preview
  deployment automatically; every `main` push deploys production automatically.
- GitHub Pages deploys on every `main` push (`pages.yml`); CI runs on `pull_request` and `push` to
  `main` (`ci.yml`).

## Final production acceptance (2026-07-15)

- Landed via merge commit `186577c` (parents `05ef745` + `5677633`; tree `ce63eab…` = the approved
  merge result). CI, Pages and Vercel production all succeeded. No frozen tags/pins moved.
- **Pages smoke QA: PASS** — calculator unchanged; `/advisor` loads directly and is unlisted;
  canonical R1 values (hero "Lowest modeled cost: API", $6,492,000 vs $7,176,630, 87 boxes);
  Simple/Expert, export preview + download; 375 px no horizontal overflow; zero console errors;
  fallback pricing correctly disclosed.
- **Vercel live-runtime QA: PASS** — `/api/prices` public: `source: live · us-east-1`, `updatedAt`
  byte-stable across spaced reloads; GPU rates p5 $55.04 (live; equals fallback), p5e $63.29
  (**fallback, honestly chipped "reference"**), **p6-b200 $113.9328 live vs $113 fallback — the
  genuine difference that satisfies the live-pricing acceptance condition**; selecting B200 on the
  live calculator feeds $113.9328 into the modeled GPU $/hr ("Catalog live price"); zero console/page
  errors on `/` and `/advisor`. **No pricing-provenance defect; no P1 filed.**

## Retained non-blocking operational follow-ups

1. Prevent timestamp-only fallback refresh commits, or separate `refreshAttemptedAt` from
   `livePriceVerifiedAt` in the price book so a bump proves verified live pricing rather than a
   refresh attempt.
2. This runbook records `refresh-prices.yml` and the Vercel GitHub integration as the operational
   inventory entries that were previously undocumented.

## Approved-baseline audit references

The UX-v2 approval chain (verdict pins, landing ancestry, rebased equivalents, deferrals) is recorded
in [docs/ux-v2/MERGE-READINESS.md](ux-v2/MERGE-READINESS.md); per-iteration review history lives in
[docs/ux-v2/ui/REVIEW.md](ux-v2/ui/REVIEW.md).
