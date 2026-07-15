# Phase-1 QA handoff — sweep (APPROVED `7c16584`) + narrative (APPROVED `7c8b97a`) + change-diff (for review)

**Branch:** `ux/v2-phase1` · **Approved sweep baseline:** `7c16584` · **Approved narrative baseline:**
`7c8b97a` · **Parent:** `ux/v2 @ c2d41f4` · **Frozen control/main:** rc-qa-11 `d749309`. Headless only.
**No UI, no merge, no deploy.**

This handoff covers the **deterministic reason-coded change-diff** (`diffRecommendations`) built on the
approved sweep + narrative. UI, merge and deploy remain **HELD** until change-diff QA.

## What to review

1. **`lib/recommendation/change-diff.ts`** — `diffRecommendations(prev, next) → RecommendationDiff`.
   Pure, deterministic, reason-coded diff of two **structured** results (never narrative prose); no input
   mutation; null-safe. **The exported `ChangeCode` union is the ONE binding contract** (DESIGN §6).
   Coverage of every schema field is enforced by compile-time `satisfies Record<keyof …, ChangeCode>`
   maps + generic per-subkey composite diffing, and by guard tests that mutate EVERY leaf path AND the
   structural cases (reorder / optional-presence / duplicates / simultaneous composite changes)
   (DESIGN §10.7–§10.9). Semantics: ONE shared normalization (undefined props omitted, undefined array
   entries + non-finite numbers → null, sorted keys; absent ≡ explicitly-undefined); `evaluations` order
   is NON-SEMANTIC (id-normalized identity); duplicate candidate ids FAIL CLOSED; `identical` = canonical
   equality of the complete normalized results; no emitted change has canonically equal payloads;
   semantically-unequal results always yield ≥1 change (`result-changed` catch-all). Rejections emit
   both the primary `rejection-changed` transition and full `rejection-details-changed`;
   `candidate-added/removed` carry the full deep-copied evaluation snapshot; `best-self-host-changed`
   carries full before/after cards.
2. Previously approved (context): sweep §3–§4 + §10–§10.3, narrative §5 + §10.4–§10.6.

## Run

```
npx vitest run lib/recommendation      # 123 (81 sweep/contracts + 21 narrate/comparator + 21 change-diff)
npx vitest run                         # 347 (frozen 184 + registry 40 + recommendation 123)
npx tsc --noEmit                       # clean
```

**Narrative HOLD-2 fix (see DESIGN §10.6):** a single shared comparator-integrity helper
(`costComparatorValid`) now guards every narrated dollar claim — candidate existence + full
eligibility/qualification, exact amount reconciliation against BOTH the candidate evaluation and
`apiOption.monthlyCost`, deterministic cheapest-qualified ordering (same `byCostThenId` as
`deriveDecision`), finite amounts, and choice/inequality consistency. Any failed invariant → neutral
wording, no dollar winner, no silent repair.

**Narrative HOLD-1 fixes (see DESIGN §10.5):** evidence-gap prose derives the ACTUAL evidence state
tokens at the gate (never hardcoded categories); the lower-cost decision persists its exact
`costComparator` (cheapest qualified self-host, cost→id tie-break) and narrate explains cost from IT —
never from the optimization-selected `bestSelfHost` — failing closed to neutral wording on
absent/inconsistent comparator facts; trusted PriceBook labels (`apiOption.modelLabel`,
`selfHostModelLabel`) drive customer-facing prose (ids stay in audit data) with a cross-model
comparability caveat whenever the compared models differ; adjustment disclosures use customer-readable
labels while raw field paths remain in `inputAdjustments`.

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
