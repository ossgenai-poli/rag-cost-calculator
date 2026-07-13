# RAG Cost Calculator — End-to-End Test Plan

**Audience:** an independent (third-party) tester with no prior knowledge of the codebase.
**Goal:** verify the application is correct, complete, and robust for release.
**Scope:** the full web application — cost model, self-hosted GPU sizing, managed-KB pricing,
benchmark grounding, charts, exports, sharing, and UX. Assumes all currently open PRs are merged.

> **How to use this document.** Work top to bottom. Each test case has an ID, exact steps, and an
> expected result. Record **Pass / Fail / Blocked** and notes in the Result columns (or your test
> tool). Attach a screenshot for any Fail. File defects with the test ID, severity, browser, and
> repro steps. Do **not** skip the "Reference values" section — several cases depend on it.

---

## 0. Feature availability & prerequisites (READ FIRST)

This plan covers the full intended feature set. Some features land in **pending pull requests** and
are **not** on `main` yet. **Confirm which build you are testing** and run only the suites its
features support — testing a pending feature against a build that lacks it will (correctly) fail.

Ask the developer which of these are merged into your build, and tick the column:

| Feature area | Suites | Required PR | On current `main`? | In your build? |
|---|---|---|---|---|
| Core cost model, mode switching, retrieval, vector store | A (partial), B, C | — (base) | ✅ Yes | |
| **Guardrails — char-based input/output split** | **D2–D4** | **#16** | ❌ **No** (main uses a single unit price + units/query — see D-note) | |
| Reranking as its own line | D1 | — | ✅ Yes | |
| Managed Bedrock KB pricing | E | #13 | ✅ Yes | |
| Self-hosted GPU sizing (memory/precision/instances) | F | base | ✅ engine; ⚠️ see prices-note | |
| GPU commitment pricing + uptime | G | #17 | ✅ Yes | |
| Crossover chart axis selector / tooltip / no-crossover | H | #15 | ✅ Yes | |
| **Benchmark-grounded sizing + interactivity SLA** | **Suite I** | **#20** | ❌ **No** (absent) | |
| Ops overhead + peak-vs-average | J | #18 | ✅ Yes | |
| Sharing, saved scenarios, exports (CSV/JSON/report) | K, L | #19 (report) | ✅ Yes | |
| Sources / formulas / provenance | M | — | ✅ Yes | |

> **⚠️ Model & GPU catalog (prices-note).** The committed `public/prices.json` — the *only* price
> source the static build uses — is **stale on current `main`** (shows obsolete models like
> "Claude Opus 4.8 / Qwen2.5-72B" and GPUs "p4d / g5", **without** the 5 open-weight models or
> **B200**). The regeneration ships with **PR #20**. Until #20 is merged, **A2, all of Suite F/I,
> and the model-dependent Reference values (§3) do not apply to a `build:static` build.** On
> `npm run dev` the live `/api/prices` returns the current catalog, so those suites can be run there.

**Recommended:** run this plan against a build with **#13, #15, #16, #17, #18, #19, #20 all merged**
(and `public/prices.json` regenerated). Against partial builds, restrict to the supported suites.

---

## 1. Test environment & prerequisites

| Item | Requirement |
|---|---|
| App under test | The deployed URL provided to you (a static web app), or a local run (below). |
| Browsers | Latest **Chrome**, **Firefox**, **Safari** (macOS), **Edge**. Run the smoke suite (§5) on all four; full suite on Chrome + one other. |
| Devices | Desktop (≥1280px) and mobile (iPhone/Android, ~375–414px width). |
| Network | Normal broadband. Also test one case with the browser **offline** after first load (the app must still work — prices are bundled). |
| Tools | Browser DevTools (Console + Network tabs) open throughout — **any red console error is a defect**. |

**Local run (if no hosted URL is given):**
```bash
# Node 20+ and npm required
npm install
npm run build:static && npm run serve:static   # emits ./out and serves it at :3100
#   (plain `npm run build` does NOT emit ./out — use build:static for the static app)
# or, for a dev server with live prices:
npm run dev                                     # http://localhost:3000
```

> **Which build the tester uses matters.** `build:static` (STATIC_EXPORT=true) is the *shipped*
> artifact — it reads bundled prices from `public/prices.json`. `npm run dev` fetches live prices
> from `/api/prices`. If the two show different model/GPU lists, the committed `public/prices.json`
> is stale (a known issue fixed alongside the benchmark-grounding work — see the matrix below).
Also confirm the automated suite is green before manual testing (developer-run, but verify):
`npm run typecheck`, `npm test`, `npm run build`.

---

## 2. Conventions

- **"Reset"** = click the **Reset** button in the toolbar to restore default inputs. Several cases
  say "From defaults…" — always click Reset first so numbers are reproducible.
- **Severity:** *Critical* (wrong cost number, crash, data loss), *Major* (feature broken/missing),
  *Minor* (cosmetic, copy), *Trivial*.
- **"≈"** means the tester should allow small rounding differences (±1 in the last displayed digit).
- Dollar figures are **USD/month** unless stated. Prices are the app's committed reference prices;
  **if the app's "Pricing updated" date differs materially from this plan's, treat exact-dollar
  expectations as guidance and rely on the relational checks** (e.g. "X increases Y").

---

## 3. Reference values (default configuration)

After **Reset**, the default inputs are approximately: 10,000 docs × 800 tokens; chunk 512, overlap
0.10; topK 20 / topN 5; query 50 tokens; output 500 tokens; prompt overhead 300; **100,000
queries/month**; API mode. Derived input tokens/query = 5×512 + 300 + 50 = **2,910**.

> The default *model* (hence the exact anchors below) depends on the catalog: with the current
> catalog the default LLM is **Claude Fable 5**. On a stale-`prices.json` static build the default
> model and these dollar anchors will differ (§0 prices-note) — rely on the relational checks there.

Anchor outputs to verify (at committed reference prices):

| Anchor | Expected |
|---|---|
| Default monthly total (API, default model) | ≈ **$3,801** |
| Default cost per 1,000 queries | ≈ **$38.01** |
| Largest cost driver | **LLM generation**, ~**85%** (~$3,246/mo) |
| Vector store (OpenSearch) at default | ≈ **$352.80/mo** (near its ~$350 min-OCU floor) |
| Managed KB (Standard) total at default | ≈ **$3,351** |

**AWS-verifiable cross-checks** (these match AWS's own published examples — highest-confidence):
- Managed KB **Standard**, indexed data **50 GB**, **100,000** queries → **managed subtotal = $350**
  (50×$5 storage + 100×$1 retrieval).
- Managed KB **Agentic**, 50 GB, 100k queries, 2 underlying retrievals/call → **subtotal = $850**
  (250 + 100k/1k×$4 + 200k/1k×$1).

---

## 4. Test suites

### Suite A — Smoke / availability
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| A1 | App loads | Open the app URL. | Page renders within a few seconds; no red console errors; a monthly cost is shown; "Pricing updated …" date visible. | | |
| A2 | Models & GPUs present | Open the model dropdown; open the GPU dropdown. | Model list includes the 5 open-weight models: **GLM-5.2, NVIDIA Nemotron 3 Ultra, MiniMax M3, DeepSeek-V4-Pro, Kimi K2.6** and Bedrock API models. GPU list = **p5 (H100), p5e (H200), p6-b200 (B200)** — no obsolete SKUs (no p4d/A100/g5). **Requires the current catalog** — on a `build:static` build this needs PR #20's `prices.json` regen (§0 prices-note); on `npm run dev` it is always current. | | |
| A3 | Offline resilience | Load app, then set DevTools → Network → **Offline**, then Reset and change inputs. | App keeps working; prices still shown; no crash. (Prices are bundled.) | | |

### Suite B — Core cost model & mode switching
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| B1 | Default anchor | Reset. | Total ≈ $3,801; cost/1k ≈ $38.01; driver = LLM generation ~85%. (Ref §3.) | | |
| B2 | Mode switch changes everything | Reset → switch Generation to **Self-hosted GPU**. | Headline total, cost/1k, largest driver, breakdown, and charts **all change**. Selected-scenario badge flips to "Self-hosted GPU". | | |
| B3 | Self-hosted is GPU-priced | In self-hosted mode, note the total. | Generation cost = GPU fleet cost (boxes × $/hr × hours), **not** token price. Largest driver = "GPU infrastructure". | | |
| B4 | Regression guard | Self-hosted, **GLM-5.2**, GPU **p5 (H100)**… set instances to the minimum shown; 100k queries. | Total is GPU-dominated (tens of thousands $/mo), **never** a small (~$800) token figure. | | |
| B5 | Queries scale generation | Reset → change queries/month 100k → 1,000k. | Monthly total and annualized rise; per-1K stays ~constant in API mode; breakdown share of generation stays dominant. | | |
| B6 | Zero traffic | Reset → set queries/month = 0. | Per-query and per-1K show **"—"** (not $0 or NaN); fixed monthly floor (vector store) still shown; no crash. | | |

### Suite C — Retrieval, chunking, vector store
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| C1 | Chunk/overlap affect vectors | Reset → change chunk size and overlap. | Number of vectors and ingestion cost update; overlap increases embedded-token count. | | |
| C2 | topN drives prompt size | Reset → increase topN (chunks sent to LLM). | Input tokens/query and generation cost rise; token breakdown reflects it. | | |
| C3 | topN ≤ topK guard | Try setting topN greater than topK. | topN is capped at topK (cannot exceed retrieved set). | | |
| C4 | OpenSearch min-OCU floor | Reset → shrink corpus toward 0. | Vector-store cost does **not** fall below the min-OCU floor (~$350/mo); an info note explains the floor. | | |
| C5 | Refresh cadence amortization | Reset → change corpus refresh cadence (one-time / weekly / monthly). | Ingestion (embedding) monthly cost changes accordingly (one-time amortized over 12 mo; weekly ×4.345). | | |

### Suite D — Reranking & guardrails
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| D1 | Rerank toggle | Reset → toggle reranking off then on. | Off: reranking line = $0 and total drops. On: reranking is its **own** breakdown line (priced per search request, not per token). | | |
| D2 | Guardrail toggles (base) | Reset → enable **Input guardrail** only, then **Output guardrail** only, then both. | Each toggle adds guardrail cost; total rises and the Guardrails breakdown line reflects it. On current `main` both sides use **one shared unit price × units/query**, so input-only ≈ output-only. | | |
| D3 | ⏳ Char-based input/output split — **PR #16 only** | *Run only if #16 is in your build (§0).* Enable both guardrails; double **topN** (bigger prompt), then separately double output length. | Input guardrail cost scales with **prompt** length; output with **response** length; input-only ≫ output-only at defaults. **N/A — skip if #16 not merged** (base build has no split). | | |
| D4 | Guardrail Advanced fields | Switch to Advanced view; open Guardrails. | **Base (`main`):** "Unit price ($/1K units)" + "Units per query" fields. **With #16:** input/output policy prices + chars-per-text-unit (~400) + chars-per-token (~4). Editing any field changes the cost. | | |

### Suite E — Managed Bedrock Knowledge Bases
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| E1 | Standard AWS example | Reset → in Managed retrieval set mode **Standard**, indexed data **50 GB**; queries **100,000**. | Managed **subtotal = $350** (storage $250 + retrieval $100). (Ref §3.) | | |
| E2 | Agentic AWS example | Set mode **Agentic**, 50 GB, 100k queries, underlying retrievals/call = **2**. | Managed **subtotal = $850** (250 + $400 planning + $200 underlying). | | |
| E3 | Included services | Read the managed card. | Parsing / embeddings / reranking shown as **"included"** (no separate charge). LLM generation added on top; **Total** shown. | | |
| E4 | Scenario row complete | Look at the scenario comparison table. | "Bedrock KB + API" row shows a real monthly figure and a % vs baseline — **never** "Pricing unavailable". | | |
| E5 | Provenance | Open **Pricing sources** modal. | Bedrock Managed KB section present with an **"AWS published"** provenance badge and the verified date. | | |

### Suite F — Self-hosted GPU sizing (memory, precision, instances)
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| F1 | Memory floor | Self-hosted, **Kimi K2.6 (1T)**, GPU p5 (H100). | "Number of instances" minimum is > 1 (a 1T model can't fit in one 8×H100 box); you cannot set fewer. | | |
| F2 | Precision → memory | Self-hosted, a large model → change precision BF16 → FP8 → INT4. | Lower precision lowers memory need → the minimum instance count can drop. | | |
| F3 | Instances scale cost | Self-hosted → raise instances from min to 2× min. | GPU monthly cost roughly doubles; annualized, cost/1k, breakdown, and crossover curve all update. | | |
| F4 | Over-provision hint | Self-hosted, high instances, very low queries (e.g. 1,000/mo). | Realized utilization → ~0%; UI notes the fleet is heavily underutilized (API usually cheaper). | | |
| F5 | Capacity exceeded | Self-hosted, min instances, very high queries (e.g. 500M/mo). | UI flags under-provisioning ("needs ≥ N instances"); utilization is not labeled "efficient". | | |

### Suite G — GPU commitment pricing & uptime
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| G1 | Purchasing model discount | Self-hosted, note On-demand total → switch purchasing model to **RI 3yr**. | Effective $/hr drops ~**60%** (e.g. $55.04 → ~$22.02); the GPU-dominated total drops ~proportionally. Panel shows "−60% vs on-demand". | | |
| G2 | Spot / Savings / RI 1yr | Cycle through Spot, Savings, RI 1yr. | Each applies a distinct discount; Spot largest (~65%). A note says these are planning estimates / Spot is interruptible. | | |
| G3 | Uptime scales cost | On-demand → set **Fleet uptime** 730 → 365 hrs/mo. | GPU cost halves; note that capacity also scales (part-time fleet). 730 (default) = always-on. | | |
| G4 | Identity at defaults | Reset. | On-demand + 730h leaves the baseline GPU cost unchanged (no hidden discount by default). | | |

### Suite H — Crossover chart (API vs self-hosted)
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| H1 | Chart renders | Reset → scroll to "API vs. self-hosted GPU crossover". | Two lines: API (rising) and self-hosted (flat fleet). Break-even and Workload reference lines shown. | | |
| H2 | Axis selector | Click each X-axis option: LLM tokens / Queries / QPS / Input tok / Output tok. | X-axis relabels and rescales; QPS axis shows small decimals; reference lines move with the axis. | | |
| H3 | Tooltip | Hover a point on the chart. | Tooltip shows the axis value, API $/mo, Self-hosted $/mo, and the fleet size + decode utilization at that point. | | |
| H4 | No-feasible-crossover | Self-hosted; raise instances very high (or pick a costly config) until break-even exceeds fleet capacity. | A "No feasible crossover" banner appears instead of an unreachable break-even line. | | |

### Suite I — Benchmark-grounded GPU sizing (interactivity SLA) — ⏳ requires PR #20
> **Skip this entire suite unless PR #20 is merged in your build (§0).** It is absent from current
> `main` (no `Interactivity target` input, no grounding banner) and also depends on the regenerated
> `public/prices.json` (B200 + the 5 open-weight models). Grounds fleet sizing in real InferenceX
> benchmarks; data covers **GLM-5.2, DeepSeek-V4-Pro, MiniMax M3 on B200**; other models/GPUs fall
> back to a heuristic (by design).

| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| I1 | Interactivity input | Self-hosted → find **"Interactivity target (tok/s/user)"** input (default 30). | Present and editable in self-hosted mode; disabled/greyed in API mode. | | |
| I2 | Measured grounding + under-provision | Self-hosted, **DeepSeek-V4-Pro**, GPU **p6-b200**, precision **INT4**, interactivity **30**, queries **200,000,000/mo**, instances = 1. | Banner "Benchmark-grounded GPU sizing" with **InferenceX · measured** badge; states ~**327 tok/s/GPU**, needs **≥ 15 instances**, flags **under-provisioned** (you have 1). | | |
| I3 | SLA sensitivity | From I2, change interactivity 30 → **90**. | Per-GPU throughput falls (~**59 tok/s/GPU**) and required instances rise sharply (~**81**). Higher SLA ⇒ more GPUs. | | |
| I4 | Proxy provenance | Self-hosted, **GLM-5.2**, p6-b200, INT4. | Banner shows **InferenceX · proxy** and a note that GLM-5 is used as a conservative stand-in for GLM-5.2. | | |
| I5 | Graceful fallback | Self-hosted, **NVIDIA Nemotron 3 Ultra**, p6-b200. | Banner (slate) states the model "isn't in the InferenceX benchmark set — GPU sizing uses the heuristic estimate." No crash. | | |
| I6 | GPU with no data | Self-hosted, DeepSeek-V4-Pro, GPU **p5 (H100)**. | Grounding unavailable message (H100 not benchmarked for these models) — heuristic fallback. | | |

### Suite J — Ops overhead & peak-vs-average
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| J1 | Overhead % markup | Reset → set **Production overhead** = 20%. | Total rises ~20%; an "Operations & overhead" line appears in the breakdown (0 when overhead=0). | | |
| J2 | Fixed ops line items | Set Networking = $100/mo and Logging & monitoring = $50/mo. | Total rises by $150; ops line reflects it. | | |
| J3 | Peak-to-average | Self-hosted → set **Peak-to-average ratio** = 3. | The "instances the throughput needs" (under-provisioning signal) scales up ~3×; API cost unaffected; provisioned fleet/cost unchanged. | | |

### Suite K — Traffic input methods
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| K1 | QPS mode | Switch traffic method to **From QPS**; set QPS, hours/day, days/mo. | Derived monthly queries computed and shown read-only; the derivation formula displayed. | | |
| K2 | Round-trip persistence | Set QPS mode, copy the share link, open it in a new tab. | QPS method + values restored (not just the monthly number). | | |

### Suite L — Sharing, saved scenarios, exports
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| L1 | Copy link round-trips | Change several inputs → **Copy link** → open the URL in a fresh tab. | All inputs restored exactly; same monthly total. | | |
| L2 | Malformed link is safe | Manually corrupt the `?s=` param in the URL and load it. | App falls back to defaults; no crash, no wrong number. | | |
| L3 | Save / load / rename / duplicate / delete scenarios | Save a scenario; change inputs; save another; rename, duplicate, delete; reload the page. | Saved scenarios persist across reload (localStorage), show correct monthly + per-1k, and all actions work. | | |
| L4 | Stale saved scenario | (If possible) load an older saved scenario. | Loads without crash — missing newer fields default in. | | |
| L5 | Export CSV | Click **Export CSV**. | A CSV downloads with headline metrics + the cost breakdown; opens cleanly in a spreadsheet. | | |
| L6 | Export JSON | Click **Export JSON**. | A JSON of all assumptions + a pricing provenance record downloads and is valid JSON. | | |
| L7 | Export report | Click **Export report**. | A Markdown `rag-cost-report.md` downloads with headline, breakdown, scenario comparison, crossover verdict, and key assumptions. In self-hosted mode the GPU line records the purchasing model + uptime. | | |

### Suite M — Sources, formulas, provenance
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| M1 | Formulas modal | Open **Formulas**. | Every displayed cost maps to a formula; readable; closes with ✕ or Esc. | | |
| M2 | Sources modal + badges | Open **Pricing sources**. | Provenance legend (live / AWS published / reference / typed config / estimate); OpenSearch, Managed KB, Models, GPU sections each carry a badge and verified date. | | |
| M3 | Reference-prices honesty | On the static deployment, check the header badge. | Shows **"reference prices (not live)"** (not falsely "live") with a tooltip explaining why. | | |

### Suite N — Edge cases & input validation
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| N1 | Non-numeric / negative input | Type letters, a negative number, and a huge number into numeric fields. | Field coerces to a safe value (min/0); never NaN; total never shows NaN/Infinity/`$-`. | | |
| N2 | Empty field | Clear a numeric field entirely. | Falls back to min/0, not blank-crash. | | |
| N3 | $0-priced model | Pick a self-hosted OSS model whose API price is ~0 in a comparison. | Scenarios handle it without divide-by-zero; no "Infinity"/"NaN". | | |
| N4 | Rapid edits | Rapidly change several inputs in a row. | UI stays responsive; numbers settle to the correct final value (debounced URL sync is fine). | | |

### Suite O — Responsive, accessibility, cross-browser
| ID | Test | Steps | Expected | Result | Notes |
|---|---|---|---|---|---|
| O1 | Mobile layout | Load on a phone / 375px width. | No horizontal scroll of the page body; inputs and results usable; sticky summary/footer don't overlap content. | | |
| O2 | Keyboard nav | Tab through inputs and toolbar; open a modal; press **Esc**. | Focus is visible and logical; modal closes on Esc; buttons reachable and operable by keyboard. | | |
| O3 | Action feedback | Copy link / Save / Export. | A visible toast/confirmation appears for each. | | |
| O4 | Cross-browser smoke | Run Suite A + B1–B3 + E1 + I2 on Chrome, Firefox, Safari, Edge. | Identical numbers and behavior on all four; no browser-specific console errors. | | |

---

## 5. 10-minute smoke test (run first on every browser)
1. App loads, no console errors (A1). 2. Model/GPU lists correct (A2). 3. Default total ≈ $3,801
(B1). 4. Mode switch changes everything (B2). 5. Managed KB Standard 50 GB/100k = $350 (E1).
6. **(only if PR #20)** Self-hosted DeepSeek-V4-Pro / B200 / 200M queries flags under-provisioning ≥15 instances (I2).
7. Copy link round-trips (L1). 8. Export report downloads (L7). 9. Sources modal badges (M2).
10. No NaN anywhere under bad input (N1).

---

## 6. Core invariants (must ALWAYS hold — treat any violation as *Critical*)
1. The active **mode** drives every primary number (header, cost/1k, annualized, breakdown, driver,
   sensitivity, charts). Switching mode changes all of them.
2. **No silent substitution** — a comparison model/scenario is always labeled as a comparison, never
   presented as the selected result.
3. **Billed instances ≥ memory floor** — you can never provision fewer GPUs than can load the model.
4. **Utilization is bounded** — a break-even needing >100% of fleet capacity reads "not achievable /
   API wins", never "self-host efficient".
5. **Unknown price ⇒ incomplete**, never a fabricated or borrowed total.
6. **Every displayed cost traces to a formula + a price** (Formulas + Sources modals).
7. **No NaN / Infinity / negative** costs ever reach the screen.

---

## 7. Defect reporting template
```
Title:        [Suite/ID] short summary
Severity:     Critical | Major | Minor | Trivial
Environment:  <URL or build>, <browser+version>, <OS>, <viewport>
Steps:        1) … 2) … 3) …
Expected:     …
Actual:       …
Evidence:     screenshot / console log / HAR
```

## 8. Exit criteria (release readiness)
- 100% of **Critical**/**Major** cases **Pass**; zero open Critical/Major defects.
- All §6 invariants hold across the tested browsers.
- Smoke suite (§5) passes on Chrome, Firefox, Safari, Edge.
- The AWS cross-checks (E1, E2) and the grounding anchors (I2, I3) match this plan.
- No red console errors during any Pass run.

## 9. Sign-off
| Role | Name | Date | Result (Pass/Fail) | Signature |
|---|---|---|---|---|
| Third-party tester | | | | |
| Product owner (audit) | | | | |
