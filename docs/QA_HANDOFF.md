# QA Handoff — RAG Cost Calculator (RC `rc-qa-1`)

This is the single source of truth for the QA engineer. Everything needed to run the 65-case
test plan is here. Two suites (runtime `/api/prices` + live-pricing) are **deferred** until the
runtime host in §5 is provisioned — they are explicitly called out so they are not failed for
missing infrastructure.

---

## 1. What to test against (pinned RC)

| | Value |
|---|---|
| **Git tag** | `rc-qa-1` |
| **Commit SHA** | `5773d25a8caf3154e566c888211c86ad2ff325af` |
| **Static site (live now)** | https://ossgenai-poli.github.io/rag-cost-calculator/ |
| **Runtime site (live pricing)** | *deferred — stand up per §5* |
| **Issue tracker** | https://github.com/ossgenai-poli/rag-cost-calculator/issues |

Check out the exact tree:
```bash
git clone https://github.com/ossgenai-poli/rag-cost-calculator.git
cd rag-cost-calculator
git checkout rc-qa-1        # detached HEAD at the pinned RC
```

**Pre-verified by the developer on this exact SHA** (so an environment problem is distinguishable
from a product defect):
- `npm run typecheck` → clean
- `npm test` → **67 passed** (incl. catalog-drift + topN-clamp regression tests)
- `npm run build:static` → emits `./out`
- `npm run test:e2e` → **PASS** (static default total **$3,801/mo**, no console errors)

---

## 2. Environment setup

```bash
npm ci                      # installs tsx + puppeteer-core (needed by refresh + e2e)
npm run typecheck
npm test
npm run build:static        # ⚠️ NOT `npm run build` — only build:static emits ./out
npm run serve:static        # serves ./out at http://localhost:3100
# in another shell, optional automated smoke:
npm run test:e2e            # puppeteer-core drives system Chrome at :3100
```
Notes:
- `test:e2e` expects Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` (edit
  `scripts/verify-e2e.mjs` `CHROME` const for another OS/path).
- **Downloads (exports):** the exact CSV/JSON/Markdown acceptance criteria are in
  [EXPORT_SPEC.md](./EXPORT_SPEC.md). Validate downloads in a **real browser** or via Playwright
  `page.on('download')` — some embedded browsers do not surface `blob:` downloads.

---

## 3. Scope — run now vs. deferred

**Run now (static + client-side; use the Pages URL or local `serve:static`):**
- Suites A–H, J–M and all edge cases **C1–C… incl. C3** — calc engine, modes, scenarios,
  crossover, guardrails, benchmark grounding (Suite I), sharing, exports, provenance, UX.
- These do not need a backend; the static bundle must **never** call `/api/prices`
  (the e2e asserts this).

**Deferred until §5 host exists (do not FAIL for missing infra — mark BLOCKED):**
- Any case asserting **live** AWS pricing (`pricing.source == "live"`, live-vs-fallback deltas).
- Any case exercising the `/api/prices` route directly.
On the static build, `pricing.source` is `"fallback"` **by design** — that is a PASS, not a defect.

---

## 4. Two clarifications the plan now pins down

**C3 — topN vs topK guard (confirmed behavior).**
Set Top K = 20 and "Chunks sent to the LLM" (topN) = 30. Expected: the field **keeps the entered
value (30) and shows a warning** that topN exceeds topK, while the **calculation clamps topN to
topK** — generation cost equals the topN=20 cost and raising topN further does not change it.
Rationale: transparent to user intent, correct in the math. Covered by
`calc-engine.test.ts › topN ≤ topK`.

**Exports (L5–L7).** Grade against [EXPORT_SPEC.md](./EXPORT_SPEC.md): `rag-cost-breakdown.csv`,
`rag-assumptions.json`, `rag-cost-report.md`. Accept if the file parses, on-screen numbers match,
and the JSON catalog is current (no `qwen2.5-72b` / `p4d`).

---

## 5. Runtime preview with LIVE AWS pricing — setup steps (owner: infra/you)

The static site cannot report live pricing (no backend). To exercise the `/api/prices` route and
the live-pricing suites, deploy the **runtime** build (Vercel; the repo already has `vercel.json`)
with a least-privilege AWS key. **Credentials go only into Vercel's secret store — never into the
repo, never into chat.**

### 5.0 How live pricing actually works (read first — three non-obvious things)
The `/api/prices` route is declared `export const dynamic = "force-static"` + `revalidate = 3600`.
That has real consequences for this setup:

1. **The live prices are baked at BUILD time, then cached (ISR, 1-hour revalidate) — not fetched
   per request.** So the AWS credentials must be present **during Vercel's build**, not only at
   runtime. Practical rule: **add the env vars first, then deploy** (or redeploy after adding them).
   Adding creds to an already-built deployment does nothing until it redeploys or the hourly
   revalidation fires.
2. **`updatedAt` reflects the build/last-revalidation time, not the moment of the request**, and
   reloading the page repeatedly returns the same cached snapshot. That is correct behavior — Codex
   should **not** file it as a staleness bug. To force a fresh pull, **redeploy**.
3. **`source: "live"` means *at least one* sub-fetch (GPU or OpenSearch) succeeded — not that every
   price is live.** GPU and OpenSearch are fetched independently; if the GPU fetch fails (e.g. a
   brand-new instance type like `p6-b200.48xlarge` isn't in the AWS Price List Query API under that
   exact name), the route silently keeps GPU **defaults** while OpenSearch success still flips the
   label to `live`. → **Verification must check the actual GPU `pricePerHr` differs from the
   committed fallback, not just trust the badge.** (See §5d. This partial-live case is itself a
   legitimate QA finding worth filing if the GPU numbers don't move.)

The AWS Price List Query API endpoint is called from `us-east-1` regardless of `AWS_REGION`;
`AWS_REGION` only selects which region's *prices* are looked up (default `us-east-1`).

### 5a. Create the least-privilege AWS credential
1. AWS Console → **IAM → Policies → Create policy** → JSON tab → paste:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "pricing:GetProducts", "Resource": "*" }
     ]
   }
   ```
   Name it `RagCalcPricingReadOnly`. (The Price List API is global; call it via `us-east-1`.)
2. IAM → **Users → Create user** → e.g. `ragcalc-qa` → **do not** give console access.
3. Attach `RagCalcPricingReadOnly` to the user.
4. Open the user → **Security credentials → Create access key** → use case "Application running
   outside AWS" → copy the **Access key ID** and **Secret access key** *once* (into the Vercel
   secret store in 5c — not anywhere else).

### 5b. Import the repo to Vercel
1. Vercel → **Add New → Project → Import** `ossgenai-poli/rag-cost-calculator`.
2. **Framework:** Next.js (auto). **Build command:** `npm run build` (the **default** — NOT
   `build:static`; the static command strips the API route). **Output:** default (`.next`).
3. **Git → Production branch / commit:** pin the deploy to tag **`rc-qa-1`** (Deploy Hooks or
   "Deploy a specific commit" = `5773d25`). This keeps runtime and static on the same tree.

### 5c. Add the secrets (Vercel, not the repo) — BEFORE the first build
Project → **Settings → Environment Variables** → add for **Production** (and Preview if used).
Do this **before** deploying (per §5.0 #1 — the live fetch runs at build time):
| Name | Value |
|---|---|
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | *(from 5a step 4)* |
| `AWS_SECRET_ACCESS_KEY` | *(from 5a step 4)* |

Do **not** set `STATIC_EXPORT` / `NEXT_PUBLIC_STATIC_EXPORT` here — leaving them unset is what makes
the frontend call `/api/prices` and ships the runtime API route. (`vercel.json` already pins
`buildCommand: npm run build`, which is correct — do not change it to `build:static`.)

### 5d. Deploy & confirm "live" (with the partial-live guard)
1. Trigger the deploy; note the `*.vercel.app` URL — that is the **runtime preview URL**.
2. **Check the Vercel build log** for the `/api/prices` prerender — if AWS calls failed at build,
   you'll see it there and the baked response will be `fallback`.
3. Load the URL and confirm live pricing:
   - the Pricing-sources modal / freshness badge shows a **live** source, **and**
   - **Export JSON** → `pricing.source == "live"` (static export shows `"fallback"`), **and**
   - **the actual GPU `pricePerHr` in the exported JSON differs from the committed fallback**
     (compare against `public/prices.json`). If `source: "live"` but the GPU numbers are unchanged,
     that's the partial-live case from §5.0 #3 — **file it** (likely `p6-b200` / `p5e` missing from
     the Price List API), don't pass it as green.
4. To force a fresh pull (the response is cached hourly), **redeploy** — don't wait on reloads.
5. Send the developer word that it's live and I'll help diff live-vs-fallback numbers.

### 5e. Clean up after QA
Deactivate/delete the `ragcalc-qa` access key in IAM once testing is complete (or rotate on a
schedule). The policy grants only read-only price lookups, but short-lived keys are best practice.

---

## 6. Defect filing

QA is run by **Codex from the owner's workspace**, filing through the owner's own GitHub account —
no separate collaborator invite is required. File in
https://github.com/ossgenai-poli/rag-cost-calculator/issues. Labels available:
`severity:critical` · `severity:major` · `severity:minor` · `severity:trivial` · `qa` ·
`area:pricing` · `area:calc-engine`. Each issue should include: case ID (e.g. `C3`, `L6`), the
URL/build used (static tag `rc-qa-1` or the runtime URL), steps, expected vs. actual, and a
screenshot or the offending export file.

---

## 7. Reference documents
- [TEST_PLAN.md](./TEST_PLAN.md) — the 65 cases (Suites A–M + edge cases).
- [EXPORT_SPEC.md](./EXPORT_SPEC.md) — export acceptance criteria (Suite L5–L7).
