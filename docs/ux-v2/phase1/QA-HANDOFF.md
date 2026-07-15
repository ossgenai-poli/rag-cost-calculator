# Phase-1 QA handoff — recommendation sweep (APPROVED) + narrative generator (for review)

**Branch:** `ux/v2-phase1` · **Approved sweep baseline:** `7c16584` (frozen) · **Parent:** `ux/v2 @ c2d41f4`
· **Frozen control/main:** rc-qa-11 `d749309`. Headless only. **No UI, no merge, no deploy.**

This handoff covers the **deterministic narrative generator** (`narrate`) built on the approved sweep.
change-diff, UI, merge and deploy remain **HELD** until narrative QA.

## What to review

1. **`lib/recommendation/narrate.ts`** — `narrate(structured) → NarratedRecommendationResult`. Pure,
   deterministic, template over structured fields only (no engine/registry call, no Date/random).
2. Contracts + design: [DESIGN.md](DESIGN.md) §5 (narrative design) and §10.4 (binding-requirement →
   coverage table). The sweep itself (approved) is §3–§4 and the HOLD-1..4 records in §10.

## Run

```
npx vitest run lib/recommendation      # 92 (81 sweep/contracts + 11 narrate)
npx vitest run                         # 316 (frozen 184 + registry 40 + recommendation 92)
npx tsc --noEmit                       # clean
```

## Isolation invariants (all hold)

```
git rev-parse main                                   # d749309 (frozen)
git diff --name-only 4b2c848 ux/v2-phase1            # only lib/recommendation/ + docs/ux-v2/phase1/
git diff --stat 4b2c848 -- lib/calc-engine.ts lib/capacity.ts lib/crossover.ts lib/benchmarks.ts \
   lib/fleet-explain.ts lib/types.ts lib/ui-logic.ts lib/benchmark-registry components .github   # empty
```
The recommendation layer imports the frozen engine and the approved benchmark registry **read-only**
(registry only via its safe `index`; a boundary guard enforces no deep-import).

## Narrative — what it guarantees (binding requirements)

Lead with the API-vs-self-host **decision**; name **both** models when the compared API model differs from
the self-host model; **never** present `bestSelfHost` as the overall recommendation when
`decision.choice==="api"`; cover **every** basis (`lower-cost`, `evidence-gap`, `no-modeled-candidate`,
`self-host-infeasible`, `sla`, `comparison-unavailable`). Candidate GPU/precision/pricing facts come
**only** from `CandidateEvaluation.servingFacts`; workload facts **only** from `effectiveWorkload`;
entered-vs-calculated disclosures **only** from `inputAdjustments`. Confidence tokens
(`measured`/`measured-scaled`/`extrapolated`/`proxy`/`heuristic`/`unbenchmarked`) are preserved exactly. A
registry `invalid-request` is described as an **internal evidence-metadata limitation**, never a
customer-input error. Pricing `source`/`asOf`/`region`/`gpuPriceSource` are disclosed; it never says
"live" when the book is `fallback`; P95/P99 is claimed only when the structured percentile supports it;
fleet sizing is rendered from `fleet.equation` (no reconstructed math); nothing is invented.

**Pricing wording guard:** `servingFacts.gpuPricePerHr` is the **on-demand base rate**; for
Reserved/Savings/Spot it is rendered as "base rate + purchasing model", never as a discounted "effective
rate".

## Narrative tests (`narrate.test.ts`, 11)

R1 (API wins; Claude-Fable API vs DeepSeek/B200 self-host, fleet.equation verbatim) · R3/R4 (evidence-gap;
no heuristic-$ comparison) · experimental R1 (unbenchmarked; internal registry limitation, not customer
error) · low-TTFT (API by SLA, not infeasibility) · no-modeled-candidate (coverage gap, not "cannot
self-host") · alternate API model identity · input adjustments (topN clamp, uptime cap, 0→730) ·
fallback pricing disclosure (never "live") · comparison-unavailable (no cost winner asserted) ·
determinism (byte-identical narration) · prose hygiene (no NaN/undefined, no unsupported Measured/
percentile, no contradictory recommendation).

## Guardrails

Do **not** merge to `main` or deploy · do **not** modify the approved sweep behavior or the frozen
engine/registry · change-diff and UI remain out of scope until the narrative passes QA.
