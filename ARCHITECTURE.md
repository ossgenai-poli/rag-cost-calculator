# AWS RAG Price Calculator — Architecture & Deployment

Living reference for the `rag-cost-calculator` project. **If you change how the app is
built, deployed, or configured, update this file in the same commit.** Anyone (human or
agent) should be able to read this and deploy safely.

Last updated: 2026-07-19.

---

## What this is

An engineer-mode **cost estimator for Retrieval-Augmented-Generation (RAG) pipelines on
AWS** — model the full pipeline (ingestion → retrieval → generation) and see the monthly
bill update live. Client-side calculator driven by AWS pricing data.

## Stack

- **Framework:** **Next.js** (App Router, `app/`), React 19, TypeScript.
- **UI/logic:** Tailwind CSS, Recharts (charts), Zod (validation).
- **Pricing data:** `@aws-sdk/client-pricing` — pricing is refreshed into the repo via
  `npm run refresh-prices` (`scripts/refresh-prices.ts`), so the deployed app is
  self-contained and needs no AWS credentials at runtime.
- **Tests:** Vitest (unit + coverage); e2e/live/basepath verifiers under `scripts/`.

## Project layout

- `app/` — Next.js routes/pages (+ a guarded, runtime-only `/api` route)
- `components/`, `lib/` — UI components and calculation logic
- `public/`, `docs/` — assets and documentation (screenshot, notes)
- `out/` — static export output (generated; GitHub Pages)
- `cloud-migration/`, `lightspeedcs-site/`, `outputs/` — auxiliary/experimental content

## Build modes (one source, two targets)

| Command | Target | Notes |
| --- | --- | --- |
| `npm run build` | **Vercel** (dynamic Next.js) | Primary hosting. Includes the runtime `/api` route. |
| `npm run build:static` | **Static export** → `out/` | `STATIC_EXPORT=true`; for GitHub Pages. The `/api` route is guarded so the static build never depends on it. |

`next.config.mjs` toggles static mode via `STATIC_EXPORT=true` and reads
`NEXT_PUBLIC_BASE_PATH` so the site can be hosted under a project subpath (GitHub Pages).

## Deployment

- **Primary — Vercel:** `vercel.json` sets `framework: nextjs`,
  `buildCommand: npm run build`, `installCommand: npm install`. Connect the repo to
  Vercel; pushes deploy automatically.
- **Alternative — GitHub Pages (static):**
  ```bash
  STATIC_EXPORT=true NEXT_PUBLIC_BASE_PATH=/rag-cost-calculator npm run build:static
  # publish ./out to the gh-pages branch / Pages
  ```

Not on Cloudflare — this project does **not** use Workers/D1/wrangler.

## Local development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # vitest
npm run refresh-prices   # pull latest AWS prices into the repo
```

## Verification scripts

- `npm run verify:live` — checks a live deployment
- `npm run verify:basepath` — checks base-path/static hosting
- `npm run test:e2e` — end-to-end (puppeteer-core)

## Change log

- 2026-07-19: Created this document.
