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

### 5c. Add the secrets (Vercel, not the repo)
Project → **Settings → Environment Variables** → add for **Production** (and Preview if used):
| Name | Value |
|---|---|
| `AWS_REGION` | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | *(from 5a step 4)* |
| `AWS_SECRET_ACCESS_KEY` | *(from 5a step 4)* |

### 5d. Deploy & confirm "live"
1. Trigger the deploy; note the `*.vercel.app` URL — that is the **runtime preview URL**.
2. Load it. Confirm live pricing is active by any one of:
   - the Pricing-sources modal / freshness badge shows a **live** source, **or**
   - **Export JSON** → `pricing.source == "live"` (static export shows `"fallback"`), **or**
   - browser Network tab shows a successful `GET /api/prices` returning `source: "live"`.
3. Hand the QA engineer this URL for the deferred suites. Send the developer word that it's live
   and I'll help diff live-vs-fallback numbers.

### 5e. Clean up after QA
Deactivate/delete the `ragcalc-qa` access key in IAM once testing is complete (or rotate on a
schedule). The policy grants only read-only price lookups, but short-lived keys are best practice.

---

## 6. Defect filing

File in https://github.com/ossgenai-poli/rag-cost-calculator/issues. Labels available:
`severity:critical` · `severity:major` · `severity:minor` · `severity:trivial` · `qa` ·
`area:pricing` · `area:calc-engine`. Please include: case ID (e.g. `C3`, `L6`), the URL/build
used (static tag `rc-qa-1` or the runtime URL), steps, expected vs. actual, and a screenshot.
*(If the QA engineer's GitHub account isn't yet a collaborator, send the developer the handle for
issue-write access.)*

---

## 7. Reference documents
- [TEST_PLAN.md](./TEST_PLAN.md) — the 65 cases (Suites A–M + edge cases).
- [EXPORT_SPEC.md](./EXPORT_SPEC.md) — export acceptance criteria (Suite L5–L7).
