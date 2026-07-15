# Phase 1 — headless recommendation layer (design & contracts)

**Status:** EXPERIMENTAL, additive, headless. Built on the **approved** benchmark-layer baseline
`ux/v2-benchmarks @ 4b2c848` (child branch `ux/v2-phase1`). **The frozen rc-qa-11 engine is unchanged
and remains the deterministic control.** No UI, no merge, no deploy in this pass.

> Scope of this pass (owner-authorized): the three **headless** deliverables — recommendation engine,
> deterministic narrative generator, deterministic reason-coded change-diff — with unit tests and a QA
> handoff, **before** any UI work. No GPU/model/source coverage expansion.

---

## 1. Where this sits (concern E of [13-catalog-architecture.md](../13-catalog-architecture.md))

```
A. research registry ─▶ B. supported catalog ─▶  ┌─────────────────────────────┐
                              ▲      ▲            │  E. recommendation engine   │
                  C. feasibility   D. evidence    │  (this layer — headless)    │
                              (frozen rc-qa-11)    └─────────────────────────────┘
```

The engine **composes existing, tested layers** — it does not re-implement any of them:

| Concern | Source of truth (read-only) | This layer's use |
|---|---|---|
| B. Supported catalog | `priceBook.gpus` / `priceBook.models` + curated allowlist | enumerate candidates |
| C. Feasibility / sizing / cost | **frozen `calculate(inputs, priceBook)`** (rc-qa-11) | run per candidate; read `crossover.*` / `capacity.*` |
| D. Evidence state | **frozen `capacity.source`** (measured/proxy/extrapolated/heuristic) | authoritative evidence gate |
| D′. Cross-source provenance | **approved benchmark registry** `resolveOperatingPoint()` (experimental) | additive annotation + control/experimental diff — **never overrides D** |

### Why `capacity.source`, not the new registry, drives the evidence gate (v1)

The approval note is explicit: *the pinned catalog currently yields zero measured-exact selections, and
Phase 1 must preserve `unbenchmarked` rather than infer host/prefix-cache facts.* The **frozen engine's**
`capacity.source` is the evidence state that is already reconciled and asserted by the R1–R5 reference
cases ([18-reference-cases.md](../18-reference-cases.md)) and `lib/rc-qa10.test.ts`. So:

- **Evidence gate v1 = `capacity.source`** (the control truth). `measured`/`measured-scaled`(extrapolated
  w/ real islScale) qualify; `proxy`/`heuristic`/substituted-precision `extrapolated` **never** become a
  primary recommendation.
- The **experimental registry** is consulted only to attach cross-source provenance and a
  `differsFromControl` flag. When it says `unbenchmarked` (as the pinned catalog does today) that is
  surfaced verbatim — it can **demote** confidence or add a caveat, never **promote** it.

This keeps rc-qa-11 the control and guarantees no Phase-1 regression of the signed-off numbers.

---

## 2. Control / experimental boundary & rollback

- `RecommendationRequest.experimentalProvenance?: boolean` (**default `false`**).
  - `false` → pure frozen-engine composition (feasibility + `capacity.source` + cost). Deterministic,
    no registry call. **This is the rollback state** — behaviourally equivalent to "control only."
  - `true` → additionally calls `resolveOperatingPoint(mode:'experimental')` per selected candidate and
    attaches `provenance` + `controlComparison`; still cannot override the frozen evidence gate.
- The layer imports the benchmark registry **only** through its safe `index` API
  (`resolveOperatingPoint`, `loadCatalog`, types). A boundary-guard test forbids app/components/
  non-registry `lib` code from deep-importing `eligibility`/`select`/`equivalence` internals.
- The frozen engine is imported read-only; this layer writes nothing back and changes no engine file.

---

## 3. Contracts (`lib/recommendation/schema.ts`)

```ts
type OptimizeFor = "cost" | "latency" | "confidence" | "predictability";

interface CandidateConfig {          // one point in the sweep (a supported-catalog record)
  id: string;                        // stable, deterministic (llmModelId · instanceType · wBits/kvBits)
  llmModelId: string;                // resolves to an EXACT model (never a model-class) — owner Q6
  instanceType: string;              // AWS instance (e.g. "p6-b200.48xlarge")
  weightBits: number;                // 4 | 8 | 16
  kvBits: number;                    // 8 | 16
  label: string;                     // human label ("p6-b200 · INT4")
}

// Evidence confidence, mapped 1:1 from the frozen capacity.source (+ substitution reasons).
type Confidence = "measured" | "measured-scaled" | "extrapolated" | "proxy" | "heuristic";

// Reason codes — the union from 17-quality-gate.md plus the evidence-gate codes. Every rejection
// carries exactly one primary code (testable).
type ReasonCode =
  | "model-does-not-fit-serving-group"
  | "node-count-exceeds-topology"
  | "no-compatible-runtime-or-precision"
  | "sla-unmet-ttft-or-streaming"
  | "context-window-overflow"
  | "evidence-topology-mismatch"
  | "fleet-exceeds-practical-limit"
  | "no-usable-price"
  | "research-only-or-unavailable"
  | "evidence-below-threshold";        // proxy/heuristic/substituted → never primary

interface CandidateEvaluation {
  config: CandidateConfig;
  feasible: boolean;                   // crossover.feasible AND all hard gates pass
  confidence: Confidence;
  evidenceQualified: boolean;          // confidence ∈ {measured, measured-scaled} AND real applicable benchmark
  fleetBoxes: number;                  // crossover.boxes (incl. N+1)
  bindingDim: "prefill" | "decode";    // crossover.bindingDim
  selfHostMonthly: number;             // crossover.selfHostedMonthly$
  apiMonthly: number;                  // API generation $/mo (same workload)
  verdict: "api-wins" | "self-host-efficient" | "infeasible";
  ttftS: number | null;                // capacity.ttftS (percentile-labelled)
  ttftPercentile: string | null;       // capacity.ttftPercentile
  rejections: Array<{ code: ReasonCode; message: string }>;  // empty ⇒ passed every gate
  provenance?: ExperimentalProvenance; // present only when experimentalProvenance=true
}

interface Card {                       // a presented option (06-recommendation-presentation.md)
  kind: "recommended-balanced" | "lowest-cost" | "highest-confidence" | "lowest-latency";
  config: CandidateConfig;
  costMonthly: number;
  costDeltaVsRecommended: number;      // 0 for the primary
  confidence: Confidence;
  bindingConstraint: string;           // plain-terms (from narrative generator)
  tradeoff: string;                    // one line (from narrative generator)
}

interface Rejection { config: CandidateConfig; code: ReasonCode; message: string; }

interface RecommendationResult {
  caption: string;                     // "Recommended among currently modeled and evidence-qualified AWS configurations."
  recommended: Card | null;            // null ⇒ NO evidence-qualified option (honest empty state)
  alternatives: Card[];                // lowest-cost / highest-confidence / lowest-latency, when DISTINCT
  rejected: Rejection[];               // every excluded candidate, reason-coded
  evaluations: CandidateEvaluation[];  // full sweep (audit)
  controlComparison?: ControlComparison; // experimentalProvenance only
}
```

`RecommendationRequest` = a base `CalcInputs` workload (the customer's inputs) + `optimizeFor` +
`candidates: CandidateConfig[]` (from the supported catalog) + `experimentalProvenance?`. Each candidate's
`CalcInputs` is built with the **existing pure transforms** `applyGpuSelection`/`applyModelSelection`
(QA-014 guarantees a test fixture is byte-identical to what the app selector produces), so the sweep can
never diverge from the real engine inputs.

---

## 4. Gate pipeline (deterministic, layered — [06](../06-recommendation-presentation.md) order)

Per candidate, in strict order; the first failing gate sets the primary rejection code:

1. **Hard feasibility** — `calculate()` → `crossover.feasible`; `capacity.contextOverflow` →
   `context-window-overflow`; `crossover.infeasibility[]` mapped to `model-does-not-fit-serving-group` /
   `node-count-exceeds-topology` / `fleet-exceeds-practical-limit`; missing price → `no-usable-price`.
2. **SLA & ops** — `capacity.slaAchievable && ttftMet && interactivityMet` (P99 TTFT + streaming +
   N+1). Fail → `sla-unmet-ttft-or-streaming`.
3. **Minimum evidence** — `confidence ∈ {measured, measured-scaled}` on a *real applicable* benchmark.
   `proxy` / `heuristic` / substituted-precision `extrapolated` → `evidence-below-threshold` (kept for
   Expert review, never a primary card).
4. **Optimization preference** — `optimizeFor` orders the survivors.
5. **Cost** — tie-break: cheapest `selfHostMonthly` (or the API-vs-self-host verdict) wins.

`recommended-balanced` = top of the ranking. `lowest-cost` / `highest-confidence` / `lowest-latency` =
the best survivor that **differs on that one axis** (omitted when not distinct — exactly the R1 case where
they legitimately collapse to "none").

---

## 5. Narrative generator (`lib/recommendation/narrative.ts`) — template over fields

Follows the `lib/fleet-explain.ts` precedent: **strings are assembled from engine/registry fields only —
no free prose, no invented numbers.** It renders: the caption, each card's `bindingConstraint`
("prefill-bound: 221,461 input tok/s ÷ 2,600 per replica → 86 replicas + 1 N+1"), the `tradeoff`, and
the confidence chip label. Hard rule (P1-UX-002): a model/precision/hardware/topology mismatch is **never**
labelled "Measured" — `extrapolated`/`proxy`/`heuristic` render their own qualified chip. Every produced
string is unit-tested against the R1–R5 reference numbers.

## 6. Change-diff (`lib/recommendation/change-diff.ts`) — deterministic, reason-coded

`diffRecommendations(prev, next)` returns an ordered list of coded changes: `config-changed`,
`fleet-changed` (Δ boxes), `cost-changed` (Δ $), `confidence-changed` (e.g. `measured-scaled →
heuristic`), `verdict-changed` (api-wins ↔ self-host-efficient), `gate-flip` (a candidate that entered
or left `rejected`, with the reason code). Pure function of the two results; no time, no randomness.

---

## 7. Reference-case anchoring (ground truth = [18](../18-reference-cases.md))

The engine tests assert the composed output against the already-signed-off numbers:

| Case | Candidate | Expect |
|---|---|---|
| R1 | dsv4 · p6-b200 · INT4 | recommended-balanced · 87 boxes · $7,176,630 · prefill · **Measured·scaled** · api-wins |
| R2 | dsv4 · p6-b200 · FP8 | **rejected** `evidence-below-threshold` (fp4 substituted → not distinct/measured) |
| R3 | dsv4 · p5e (H200) · INT4 | **rejected** `evidence-below-threshold` (heuristic) — the $554k figure never shown as an alternative |
| R4 | dsv4 · p5 (H100) · INT4 | **rejected** `evidence-below-threshold` (heuristic) |
| R5 | dsv4 · p6-b200 · INT4 · 5M vol | recommended-balanced · 4 boxes · $329,960 · api-wins |

R1's structural numbers are additionally cross-checked against `lib/rc-qa10.test.ts` so a drift in either
the engine or this layer fails a test.

---

## 8. Isolation invariants (must all hold every commit)

```
git rev-parse main                                   # d749309 (frozen)
git diff --name-only ux/v2-benchmarks ux/v2-phase1   # only lib/recommendation/ + docs/ux-v2/phase1/
git diff --stat 4b2c848 -- lib/capacity.ts lib/benchmarks.ts lib/crossover.ts lib/calc-engine.ts \
   lib/fleet-explain.ts lib/benchmark-registry components .github   # empty (frozen)
```
The registry stays byte-identical to its approved `4b2c848` state; this layer only imports its `index`.

---

## 9. Open decisions (for the Phase-1 QA handoff)

1. **Candidate space source** — Phase-1 v1 sweeps an explicit curated `candidates[]` (no auto-expansion).
   How/when the supported catalog is generated from the registry+priceBook is deferred (no coverage
   expansion this pass).
2. **Registry vs engine evidence reconciliation** — v1 lets the registry only demote/annotate. If/when a
   registry record becomes measured-exact with a reviewed AWS-host mapping, the promotion rule and the
   3-reviewer sign-off gate (owner Q3) must be specified before it can raise confidence.
3. **`optimizeFor` default** — Stage-A preference mapping (which axis is default) — pending UX.
4. **Alternative-distinctness threshold** — how different a cost/latency/confidence alternative must be to
   earn its own card vs. collapse to "none."
5. **Narrative locale/format** — md/plain strings now; HTML rendering is a UI-phase concern.
