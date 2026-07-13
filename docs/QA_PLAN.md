# QA Plan — RAG Cost Calculator

Run this before merging any **major change** (engine math, a new input that feeds
cost, a new scenario/mode, or a pricing-model change). It exists because a
subtle regression here doesn't crash — it silently shows a wrong number, and a
wrong number in a cost tool drives a wrong decision.

## 0. Definition of "major change"
Anything that touches: `lib/calc-engine.ts`, `lib/crossover.ts`, `lib/derived.ts`,
`lib/scenarios.ts`, `lib/sensitivity.ts`, `lib/self-host.ts`, `lib/model-prices.ts`,
`public/prices.json`, or any input control that flows into a cost. UI-only tweaks
(colors, copy, layout) need only the smoke test (§5).

## 1. Core invariants (must ALWAYS hold)
These are the properties a reviewer/automated test should assert. Several map to
existing unit tests; the rest are the bar for new work.

1. **Active mode drives every primary number.** Header, monthly card, cost/1k,
   annualized, breakdown, largest-cost-driver, sensitivity, and charts all derive
   from the *same* `generation.mode`. Switching mode must change all of them.
   - self-hosted → generation cost = `boxes × gpuPricePerHr × 730`, not tokens.
   - api → generation cost = token price × volume.
2. **No silent substitution.** The engine never swaps the selected model,
   deployment mode, GPU, or pricing source without showing it. Comparison
   scenarios are labeled "comparison", never presented as the selected result.
3. **Fleet ≥ memory floor.** Billed `boxes ≥ instancesToLoad(model, gpu)`. The
   cost curve and break-even never use fewer instances than can load the model.
4. **Decode throughput applies to output tokens only.** Never divide total
   (input+output) tokens by `sustainedTokPerSec`. Capacity, realized utilization,
   and break-even utilization use output tokens.
5. **Utilization is bounded.** Realized utilization ∈ [0, ~1]. A break-even that
   needs > 100% of fleet capacity is `breakEvenFeasible = false` and must read
   "not achievable / API wins", never "self-host efficient".
6. **Unknown price ⇒ incomplete, never a fabricated total.** Missing pricing shows
   an incomplete estimate with known/unknown split; it never reuses an unrelated
   scenario's number as a stand-in.
7. **Every displayed cost traces to a formula + a price** (see the Formulas and
   Pricing-sources modals).

## 2. Scenario test matrix
Exercise at least these combinations after an engine change. Expected values are
for the committed reference prices; recompute if prices change.

| Mode | Model | Instances | Queries/mo | Expected headline driver |
|------|-------|-----------|------------|--------------------------|
| API | Claude Opus 4.8 | — | 100k | LLM generation |
| API | Claude Fable 5 | — | 100k | LLM generation |
| Self-hosted | GLM-5.2 (400B) | 2 (min) | 100k | GPU infrastructure ~100% |
| Self-hosted | Kimi K2.6 (1T) | 4 (min) | 100k | GPU infrastructure |
| Self-hosted | GLM-5.2 | 6 (raised) | 100k | GPU cost = 3× the 2-box cost |
| Self-hosted | GLM-5.2 | 2 | 1k | GPU cost unchanged; realized util → ~0% |
| Self-hosted | GLM-5.2 | 2 | 500M | under-provisioned warning fires |
| Either | any | — | 0 | per-query/per-1k show "—" (fixed floor still applies) |

## 3. The regression that motivated this plan
Self-hosted GLM-5.2, 2 × p5.48xlarge, 100k queries **must** produce a headline of
**~$80.7k/month** (GPU-dominated), **not ~$792** (API tokens). This is asserted by
`lib/calc-engine.test.ts › generation mode affects the total`. If that test is
ever weakened, this whole class of bug can return.

## 4. Automated coverage (run `npm test`)
- `calc-engine.test.ts` — golden totals; **mode-aware total/breakdown/driver**;
  ingestion overlap; OCU sizing; refresh cadence; Mode B overrides.
- `crossover.test.ts` — fleet-scaled break-even; **decode-correct utilization**;
  **feasibility (>1 ⇒ infeasible)**; flat fixed-fleet curve; provisioning scaling.
- `self-host.test.ts` — memory sizing; memory-floor on box count.
- `ui-logic.test.ts` — derived metrics; scenarios; share round-trip + validation;
  sensitivity ranking.

Also gate: `npm run typecheck`, `npm run build`, and (for UI-affecting changes)
`scripts/verify-e2e.mjs` against the static bundle.

## 5. Manual smoke test (10 min, from the tester's cases)
1. **Mode switch** — API → self-hosted flips headline, driver, breakdown, charts.
2. **Instances** — 2 → 3 changes monthly, annualized, cost/1k, breakdown, curve.
3. **Below memory floor** — setting instances < min is prevented (field `min`).
4. **Utilization > 100%** — never labeled "efficient"; shows "not achievable".
5. **Reranking toggle** — off zeroes its cost; total drops.
6. **API vs self-hosted model** — the two are different models ⇒ comparison must
   disclose it (see backlog P1).
7. **Precision** — (backlog) BF16/FP8 changes memory + instance count.
8. **Very low traffic** — GPU cost fixed; realized util → ~0%; per-1k spikes.
9. **Capacity-step crossing** — raising traffic past capacity flags under-provision.
10. **Missing price** — removing a price yields an incomplete estimate, not a total.

## 6. Remediation backlog (from external QA feedback)
### Done (this pass — P0)
- ✅ Active mode drives all primary outputs (the $792→$80.7k fix).
- ✅ Correct self-hosted GPU monthly cost (fleet × 730).
- ✅ Enforce minimum model-loading instance count in cost/curve.
- ✅ Utilization > 100% is "not achievable", not "efficient".
- ✅ Decode throughput applied to output tokens only; realized-utilization metric.
- ✅ Scenario-aware sensitivity (GPU fixed vs API linear).
- ✅ Selected-scenario label; dynamic instance count (no hard-coded "one box").

### P1 — high priority
- ✅ Fixed scenarios regression (comparison is mode-independent; "Self-built + API"
  always shows the API cost, not the mode-dependent total).
- ✅ **Reranking** as its own line item, priced per search request (not per token,
  not hidden in "query overhead").
- ✅ **Precision/quantization** input (BF16/FP16=2B, FP8/INT8=1B, INT4=0.5B) → memory
  and instance count (throughput impact not yet modeled — see below).
- ✅ **Throughput vs precision** — quantization now raises decode capacity via a
  precision speedup factor (FP16 1.0 / FP8 1.6 / INT4 1.8), so realized util,
  throughput-instances, and break-even reflect it.
- ✅ **Price provenance** — Sources modal shows source badges (live / reference /
  typed config / estimate) with a legend and per-section provenance.
- Still open:
  - Model comparison **currently uses the same model's hosted price** (apples-to-apples
    for OSS models). Add an explicit **API comparison-model selector** + proxy
    disclosure for cross-model comparisons.
  - Fuller **model-memory model** (active vs total params, explicit KV-cache from
    context length × concurrency, TP/PP overhead, safety margin) + "does not fit".
    The current model uses a documented 1.2× overhead over precision-aware weights.
  - **Managed KB** built from its own component tree (today it honestly reuses the
    self-built infra estimate and discloses it, but should be independent).

### P2 — product quality
- Feature-level **guardrail** pricing (input/output separate; char-based units).
- Crossover **X-axis selector** (queries / QPS / input-tok / output-tok) and a
  "no feasible crossover" state; per-point tooltip with instances + utilization.
- **Reserved / Spot / Savings Plan** GPU pricing + uptime schedule.
- Networking / logging / monitoring / production-overhead line items.
- Peak-vs-average workload modeling; exportable assumptions + calc report.

## 7. Sign-off checklist (paste into the PR)
- [ ] `npm test` green (and new invariants covered by a test)
- [ ] `npm run typecheck` clean
- [ ] `npm run build` succeeds
- [ ] Scenario matrix (§2) spot-checked in the browser
- [ ] No primary number shows a non-selected scenario
- [ ] No "efficient/recommended" label on an infeasible config
- [ ] Unknown prices render as incomplete, not a total
