# QA Handoff — RAG Cost Calculator (RC `rc-qa-5`)

This is the single source of truth for the QA engineer. Everything needed to run the test plan is
here. Live-pricing suites run against the Vercel runtime (§3/§5); all other suites run against the
static site.

> **Retest round (rc-qa-5):** second GPU-engineering remediation — prefill/QPS capacity,
> utilization-target sizing, complete serving-group granularity, precision+sequence provenance,
> context feasibility, infeasibility reason codes, the corrected GPU fixture, per-SKU price
> provenance, input-overflow guards, and executive-honesty UX. **See §11** for the focused
> checklist + canonical DeepSeek reproduction. rc-qa-4 capacity fixes (§10) and rc-qa-3 (§8/§9)
> remain intact.

---

## 1. What to test against (pinned RC)

| | Value |
|---|---|
| **Git tag** | `rc-qa-5` |
| **Commit SHA** | run `git rev-parse rc-qa-5` |
| **Static site (live + verified rendering)** | https://ossgenai-poli.github.io/rag-cost-calculator/ |
| **Runtime site (LIVE pricing)** | https://rag-cost-calculator-hazel.vercel.app/ |
| **Issue tracker** | https://github.com/ossgenai-poli/rag-cost-calculator/issues |

Check out the exact tree:
```bash
git clone https://github.com/ossgenai-poli/rag-cost-calculator.git
cd rag-cost-calculator
git fetch --tags --force        # the rc tags are re-pointed between rounds
git checkout rc-qa-5            # detached HEAD at the pinned RC
```

**Pre-verified by the developer on this exact SHA** (so an environment problem is distinguishable
from a product defect):
- `npm run typecheck` → clean
- `npm test` → **126 passed** (incl. GPU capacity + remediation, catalog-drift, topN-clamp, QA regressions)
- `npm run build:static` → emits `./out`
- `npm run test:e2e` → **PASS** (no console errors)

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

**Live-pricing suites — NOW RUNNABLE** against the runtime site
https://rag-cost-calculator-hazel.vercel.app/ (stood up + verified; `npm run verify:live` PASSes):
- `pricing.source == "live"` and live-vs-fallback deltas.
- Direct `/api/prices` checks.
- **What genuinely-live looks like** (so real values aren't misfiled as bugs):
  - GPU: `p6-b200.48xlarge` ≈ **$113.93/hr live** (moved off the $113 estimate); `p5.48xlarge` = **$55.04** (live value equals the estimate — correct, not stale); `p5e.48xlarge` = **$63.29 default** because AWS exposes **no OnDemand SKU** for it in us-east-1 (honest fallback — do **not** file).
  - OpenSearch: OCU **$0.24/hr live**; storage **$0.024/GB-mo** (kept from catalog — the only serverless storage SKU is per-byte-hour, wrong unit to use as GB-mo).
  - `updatedAt` reflects build/revalidation time, cached ~1h (§5.0 #2) — reload won't change it; redeploy to refresh.

On the **static** build, `pricing.source` is `"fallback"` **by design** — that is a PASS, not a defect.

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

## 5. Runtime preview with LIVE AWS pricing — ✅ DONE (steps kept for reproducibility)
> Stood up at https://rag-cost-calculator-hazel.vercel.app/ with the `rag-price-reader`
> IAM user (`PricingReadOnly`) and verified live (`npm run verify:live` → PASS). Root-causing the
> initial `fallback` surfaced two real route bugs (all-or-nothing GPU fetch; wrong OpenSearch
> service code) — both fixed on `main`. The steps below remain valid for re-provisioning.


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
3. Confirm live pricing with the bundled checker (does all three checks incl. the partial-live
   GPU guard, exits non-zero on any failure):
   ```bash
   npm run verify:live https://<your-app>.vercel.app
   # PASS only if source=="live" AND at least one GPU $/hr differs from public/prices.json
   ```
   Or manually: Pricing-sources badge shows **live**; **Export JSON** → `pricing.source == "live"`
   (static shows `"fallback"`); and the exported GPU `pricePerHr` **differs from** `public/prices.json`.
   If `source: "live"` but GPU numbers are unchanged, that's the partial-live case from §5.0 #3 —
   **file it** (likely `p6-b200` / `p5e` missing from the Price List API), don't pass it as green.
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
- [fixtures/README.md](./fixtures/README.md) — L4 legacy-scenario fixture + how to load it.

---

## 8. rc-qa-2 retest checklist (fixes for the rc-qa-1 NO-GO)

| # | Case | Fix | Retest |
|---|---|---|---|
| #24 | A1 — Pages stuck "Loading prices" | `pages.yml` builds with `NEXT_PUBLIC_BASE_PATH`; build-time guard `verify:basepath` | Load the static URL — it renders numbers, no hang. (Verified on deploy.) |
| #25 | I2 — conflicting ≥15 vs ≥6 | grounding is authoritative; flat capacity warning uses it, duplicate banner suppressed | I2 shows a single figure (grounded ≥15); no ≥6 anywhere |
| #26 | C1 — no vector count | "Vectors stored" shown in the token panel | Change chunk size/overlap → the count updates |
| #27 | G2 — RI-1yr == Savings 40% | Savings-1yr → 30%, RI-1yr → 40% | Switch purchasing model → GPU cost differs between the two |
| #28 | L5 — CSV row order | CSV emits canonical EXPORT_SPEC order | CSV breakdown = Ingestion, Vector store, Reranking, Generation, Guardrails, Query overhead, Operations |
| L4 | stale saved scenario | fixture provided (§7) | Load fixture → renders, defaults backfill, no crash |

Local gates all green on `rc-qa-2`: `typecheck`, **75** unit tests (incl. `qa-regressions.test.ts`),
`build:static`, `verify:basepath`, `test:e2e` (root **and** the deployed subpath URL), `verify:live`.

---

## 9. rc-qa-3 retest checklist (end-user AWS-decision findings)

| Area | Fix | Retest |
|---|---|---|
| P1 — under-provisioned savings | The self-hosted fleet **auto-sizes** to serve the load (memory + throughput + grounded + peak/uptime). Comparison, headline, and exports all bill the feasible fleet; a note shows "auto-sized from N". | GLM-5.2, 2×p5, 100M q/mo → cost reflects the required fleet (no −42% illusion that reverses when sized) |
| P1 — grounded capacity | Grounding now scales required decode by **peakFactor** and **uptime**; `effectiveRequiredInstances` = **max(grounded, flat)**. | Halve uptime or 2× peak → required instances rise; grounded never under-reports vs flat |
| P1 — Bedrock rates | GPT-5.5 → **$5.50/$33** per 1M; GPT-5.4 → **$2.75/$16.50** per 1M (us-east-1). | Sources modal / JSON export shows the new rates |
| P1 — ops in scenarios | Ops/overhead applied to **every** scenario (scenario-specific). | Set overhead>0 → the selected scenario total == the headline total |
| P2 — uptime cap | Fleet uptime clamped to **≤730 h/mo** (input + schema + calc). | Enter 2000 → treated as 730 |
| P2 — integer instances | Instances floored to a whole number (input + schema + calc). | Enter 2.5 → billed as 2 (or auto-sized higher) |
| P2 — OpenSearch floor | Min-OCU field discloses the **Classic 2-OCU** assumption + NextGen note. | Hint visible on the Min OCU field |
| P2 — $0 GPU rate | Flagged as **owned/free capacity**; savings marked not like-for-like. | Set GPU $/hr = 0 → owned-capacity notice shows |

Coverage: `lib/qa-regressions.test.ts` adds cases for every item above; **82** unit tests pass.
Gates green on `rc-qa-3`: typecheck · 82 tests · build:static · verify:basepath · test:e2e · verify:live.

### §9a — Auto-size behavior contract (refined per owner requirements)
Auto-size stays the **default**. The entered count is never silently changed; billing uses the
required count and every surface is consistent:
- The entered value **N** stays in the input; the util card shows **"Entered fleet: N · Billed fleet: M"**.
- When M > N: **"Auto-sized from N to M to serve this workload."** M is used in the headline, scenario
  table, crossover, cost breakdown, CSV/JSON/MD exports (JSON gains a `fleet` block; MD names both),
  and reproduces from a shared link (N is stored; M is derived). Enter **M or more** → notice clears.
- **Manual cap:** a "Auto-size fleet to workload" toggle (default ON). When OFF and the entered fleet
  can't serve the load, the **Self-built + GPU** scenario is marked **Infeasible** and its cost/savings
  are **suppressed** (not shown as a valid cheap option). Covered by `qa-regressions.test.ts`.

---

## 10. rc-qa-4 retest checklist — GPU capacity-model remediation (GPU-001…007)

**One authoritative capacity source.** Self-hosted throughput, utilization, break-even, verdict,
scenarios, headline and exports all read `crossover.capacity.perInstanceDecodeTokS` — the measured
benchmark operating point. No generic `sustainedTokPerSec × precision` once a benchmark is selected.
Every self-host result is labeled **measured / proxy / extrapolated / heuristic** (badge in the
grounded card; `capacity source` in the report; `fleet.capacity.source` in JSON).

| # | Area | Retest |
|---|---|---|
| GPU-001 | Benchmark capacity everywhere | Grounded card, headline, scenarios, exports agree; utilization is measured-tight, not the old comfortable value |
| GPU-002 | Concurrency constrains the point | Lowering **Max concurrent seqs** lowers the selected point's throughput and raises instances; chosen concurrency ≤ the cap |
| GPU-003 | KV precision independent of weights | New **KV-cache precision** control; BF16 vs FP8 changes KV memory only; both precisions recorded in exports |
| GPU-004 | TTFT SLA gate | New **Max TTFT** (default 2000 ms); a point exceeding it → "SLA not met — infeasible", no positive verdict |
| GPU-005 | Topology + substitution labels | 64-GPU / 4-GPU / precision / seq mismatches show **extrapolated** (not measured), with reasons |
| GPU-006 | Serving group / replica / HA | Fleet = replicas × boxes/replica; **HA (N+1)** toggle (default on) adds a real replica + cost; counts are whole serving groups |
| GPU-007 | Owned-capacity scenario | $0 GPU + traffic → complete scenario (infra + ops, hardware **$0 owned capacity**), NOT "No generation volume", no like-for-like % |
| Peak/uptime | Telemetry | Utilization card shows **avg** and **peak** demand vs provided capacity, both labeled |

### Exact expected values (baked InferenceX data, default inputs)

**DeepSeek reproduction** — DeepSeek-V4-Pro · p6-b200 · INT4 · 200M q/mo · 500 out · 30 tok/s/user ·
Max concurrent = 16 · TTFT 2000 ms · peak 1 · HA on:
- capacity source **extrapolated** (default input 2910 tok is far from the 1024 bucket)
- chosen concurrency **16**, **214 tok/s/GPU** (measured @ conc 16 — *not* the uncapped 327)
- avg decode demand **38,052 tok/s**, provided **≈41,069 tok/s**, **utilAvg ≈ 92.7%**
- throughput **23** boxes, **+1** N+1 HA replica ⇒ **requiredInstances = 24**, **billed = 24**
- feasible **true**, verdict **self-host efficient**
- Set **Max concurrent = 1** ⇒ conc-1 point ≈ **22.8 tok/s/GPU** ⇒ **≈210 instances** (throughput 209 + HA).
- Set **Max TTFT = 100 ms** ⇒ TTFT 0.23 s > 0.1 s ⇒ **infeasible**, verdict flips to "API wins".

**GLM long-context KV** — GLM-5.2 · p5 · INT4 **weights** · **BF16 KV** · 128K ctx · 16 concurrent:
- weights **≈200 GB**, KV **≈790 GB**, service memory **≈1,139 GB** ⇒ **memory floor 2 × p5**
- Switch **KV precision → FP8** ⇒ KV **≈395 GB** (weights unchanged at 200 GB).

**MiniMax topology** — MiniMax-M3 · p6-b200 · FP8 (64-GPU benchmark):
- gpusInConfig **64** ⇒ **8 boxes/replica**, source **extrapolated** (cross-node), fleet is a multiple of 8.

Coverage: `lib/gpu-capacity.test.ts` (15 cases) pins the above; **101** unit tests pass. Gates green on
`rc-qa-4`: typecheck · 101 tests · build:static · verify:basepath · test:e2e · verify:live.

### Defaults chosen (owner-approved)
Max TTFT **2 s** · KV precision **BF16** (independent) · **HA N+1 on** by default · cross-node benchmark =
one measured replica of `ceil(gpus/8)` boxes with linear replica scaling, labeled **extrapolated** on any
precision / sequence / model / partial-box mismatch.

### §10a — Pre-handoff confirmations (owner requirements)
1. **Non-measured capacity never gives an unconditional positive.** A "self-host efficient"
   verdict built on **proxy / extrapolated / heuristic** capacity sets `crossover.verdictQualified =
   true`; the grounded card, the crossover verdict, the Markdown report, and the JSON `fleet.verdict*`
   all show it **qualified** ("not a direct measurement — validate before committing"). Only
   `source: "measured"` yields an unqualified positive. Tests: *provenance gate* (3 cases).
2. **Exact topology stays measured on a match.** A benchmark whose GPU count is a whole multiple of
   the 8-GPU box (incl. the exact 64-GPU case) with matching model/precision/sequence is labeled
   **measured**; the multi-replica linear-scaling assumption is a **note**, not a downgrade. Any
   partial box, non-whole-multiple, or precision/sequence/model substitution is **extrapolated** with
   the reason displayed. Tests: *64-GPU stays measured* + *sequence mismatch → extrapolated*.
3. **N+1 adds one complete serving group.** For an 8-box replica, HA adds exactly **8 boxes**
   (`requiredInstances(on) − requiredInstances(off) === instancesPerReplica`), never a fractional or
   percentage bump. Dedicated test: *N+1 adds exactly ONE complete serving group — 8 boxes*.
4. **TTFT is never labeled p95.** The baked InferenceX field is an unlabeled `ttft`; the UI/report/JSON
   say plain **"TTFT"** and make no percentile claim. (Confirmed: no `p95`/`p99`/`percentile` string
   anywhere in the app.) Per your call, the dataset is **not** expanded this release — deterministic
   gating and honest provenance take priority.

Suite total after these: **106** unit tests.

---

## 11. rc-qa-5 retest checklist — 2nd GPU-engineering remediation (GPU-008…013, QA-014, INPUT-020, UX, PRICING)

All self-hosted capacity now reads from ONE authoritative source and reconciles across UI, scenario
table, exports and verdict. `crossover.verdictQualified` is set (and the qualification shown in UI /
Markdown / JSON) whenever a positive verdict rests on anything other than **measured capacity +
live pricing** — i.e. proxy/extrapolated/heuristic throughput, an estimated **prefill** bound, a
**fallback/reference** GPU price, or a commitment/Spot discount.

| # | Area | Retest |
|---|---|---|
| GPU-008 | Prefill + QPS | Zero/short-output, high-input workloads are real GPU work; fleet = max(prefill, decode, memory, topology, SLA); prefill-bound sizing is flagged estimated |
| GPU-009 | Utilization target | Fleet sized to `capacity × utilTarget`; util lands ≤ target; util card shows **avg**, **peak**, and **post-one-loss** peak; lowering the target raises the fleet |
| GPU-010 | Precision + sequence | **BF16 ≠ FP8** (extrapolated, not measured); output (OSL) bucket validated with a tight 1.5× tolerance; requested vs benchmarked ISL/OSL shown; reasons in exports |
| GPU-011 | Serving groups | Usable replicas = `floor(boxes/ipr)`; stranded boxes = zero capacity; auto-size rounds to a group multiple; a 9-box/8-box-replica manual cap is infeasible |
| GPU-012 | Context feasibility | input + max output > context (or model max) ⇒ infeasible, no positive verdict; KV uses the servable sequence |
| GPU-013 | Reason codes | Coded infeasibility with targeted guidance; **only** capacity shortage (manual-cap) suggests adding instances — a TTFT failure never does |
| QA-014 | Fixture | The DeepSeek fixture uses the **p6 price ($113)**, not p5 ($55); UI-equivalent construction = direct construction (shared `applyGpuSelection`) |
| INPUT-020 | Overflow | `1e308` queries → finite cost/fleet/util (no Infinity/NaN); extreme inputs are clamped |
| UX-015 | Qualification | A positive **heuristic** result visibly says it is not validated (no benchmark card required) |
| UX-016 | "Modeled cost" | No more "fully priced"; an Included/Excluded disclosure lists excluded categories; zero Ops inputs are labeled assumptions |
| UX-017 | Redundancy | Control renamed **"Serving redundancy (N+1 replicas)"**; HA-off shows a result-level **Non-production estimate** banner; models replica redundancy, not AZ/Spot/quota/DR |
| UX-019 | QPS semantics | Break-even shows **calendar-average** and **active-window** QPS (÷ uptime); report states the uptime basis |
| PRICING-018 | Per-SKU provenance | Sources modal badges each GPU **live / reference / override**; JSON export carries `priceSource`; a positive rec on fallback/estimated pricing is qualified |

### Canonical DeepSeek reproduction (assert the mechanics — dollars are non-normative)
DeepSeek-V4-Pro · p6-b200 · INT4 weights · BF16 KV · 200M q/mo · 2,910 input · 500 output · concurrency
16 · TTFT 2,000 ms · peak 1 · uptime 730 · HA on · auto-size on · on-demand:
- The **selected p6 price ($113/hr)** is used — never the default p5 $55 (QA-014).
- Fleet is whole serving groups (ipr = 1 here) sized to the 70% util target; GPU total reconciles as
  **billed boxes × $113 × 730 h + modeled infra/ops**.
- For the **current workload** the verdict is **API wins** (self-host is not cheaper at this scale);
  the static-fallback figure ~**$2.39M / +139%** is a **non-normative reference**, not a pinned
  assertion (it depends on the session's full infra/retrieval inputs).
- Report **current-workload winner** separately from **theoretical crossover feasibility** (a fleet
  can be feasible yet not the cheaper option at today's volume).

Suite total: **126** unit tests. Gates green on `rc-qa-5`: typecheck · 126 tests · build:static ·
verify:basepath · test:e2e · verify:live.
