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
- **Pinned candidate catalog (rev-4 trust boundary).** `recommend()` loads a **pinned, internally
  curated** candidate set (`loadCandidateCatalog()`) — the request carries only workload + preference,
  never caller-supplied evidence-bearing candidates (that would repeat the catalog-injection problem the
  benchmark layer closed). Every pinned candidate is validated at load against the frozen engine's own
  data — **supported exact model** (`priceBook.models` + curated model allowlist [15]), **reviewed AWS
  instance** (`priceBook.gpus`), **allowed weight/KV precision combination**, a **stable canonical id**,
  **no duplicates**, **non-empty set**, and well-typed fields — failing closed on any violation.
  Synthetic candidates are injected only through the internal/test path (module-mocking
  `loadCandidateCatalog`, mirroring `resolver-catalog.test.ts`), never through the public API.

---

## 3. Contracts (`lib/recommendation/schema.ts`)

The authoritative types live in `schema.ts`; the shape (revised per the foundation review) is:

- **Top-level `decision`** — `{ choice: "api" | "self-host" | "undetermined"; basis: "lower-cost" |
  "evidence-gap" | "self-host-infeasible" | "sla" | "customer-preference"; rationale }`. This is the
  overall answer. A GPU config is **never** presented as the overall recommendation when API wins.
- **`bestSelfHost: Card | null`** — the best *evidence-qualified* self-host config, separate from
  `decision`. `null` ⇒ no evidence-qualified self-host exists (honest empty state).
- **`CandidateEvaluation`** carries **distinct** gate fields (rev-2) — `technicallyFeasible`,
  `slaQualified`, `evidenceQualified`, `recommendationEligible` — plus **separate** confidence
  representations (rev-3): `engineConfidence` (frozen `capacity.source`), `registry?` (experimental
  provenance: status/confidence/reasons/transformations), and `effectiveConfidence`
  (`EngineConfidence | "unbenchmarked"`). It also carries the structured explanation inputs (rev-6):
  `fleet` (reconciled equation), `cost` (self-host vs API + verdict), TTFT + percentile, and the
  reason-coded `rejections`.
- **`RecommendationRequest`** = `{ workload: CalcInputs; optimizeFor; experimentalProvenance? }` — **no
  caller candidates** (rev-4). `recommend()` builds each candidate's `CalcInputs` with the existing pure
  transforms `applyGpuSelection`/`applyModelSelection` (QA-014 ⇒ a test fixture is byte-identical to what
  the app selector produces), so the sweep can never diverge from the real engine inputs.

### 3.1 Evidence reconciliation (rev-3) — deterministic, demote-only

Confidence rank (higher = stronger): `measured 5 · measured-scaled 4 · extrapolated 3 · proxy 2 ·
heuristic 1 · unbenchmarked 0`.

- **Control mode** (`experimentalProvenance=false`): `effectiveConfidence = engineConfidence`. The
  registry is not consulted. This is the rollback state.
- **Experimental mode**: `effectiveConfidence = rank⁻¹( min( rank(engineConfidence), registryCeiling ) )`
  — the registry can only **lower** confidence, never raise it. Registry ceiling:

| registry `status` | registry `confidence` | ceiling rank |
|---|---|---|
| `selected` | independent-reviewed / open-reproducible / vendor-measured / research-measured | 5 (measured) |
| `selected` | extrapolated | 3 |
| `selected` | proxy | 2 |
| `selected` | heuristic | 1 |
| `unbenchmarked` | (n/a) | **0 (unbenchmarked)** |
| `invalid-request` | (n/a) | 0 (fail closed) |

`evidenceQualified = effectiveConfidence ∈ {measured, measured-scaled}` **and** the engine used a real
applicable benchmark (`benchmarkAvailable`, not a precision/model substitution).

**Consequence for the pinned catalog today (approval limitation, made binding):** in experimental mode
the pinned registry returns `unbenchmarked` for every candidate ⇒ ceiling 0 ⇒ `effectiveConfidence =
unbenchmarked` ⇒ `evidenceQualified = false`. So R1 in experimental mode does **not** keep a
"Measured·scaled" primary with a small warning — it drops to `unbenchmarked` and `bestSelfHost` becomes
`null` (with the registry reasons/transformations preserved for the narrative). Every row of this table
is unit-tested.

---

## 4. Gate pipeline + decision derivation (deterministic — [06](../06-recommendation-presentation.md) order)

**Per-candidate gates** set the four DISTINCT fields (rev-2); the first failing gate sets the primary
rejection code (never conflate "can't run" with "not enough evidence"):

1. **`technicallyFeasible`** — `crossover.feasible`; `capacity.contextOverflow` →
   `context-window-overflow`; `crossover.infeasibility[]` → `model-does-not-fit-serving-group` /
   `node-count-exceeds-topology` / `fleet-exceeds-practical-limit`; missing price → `no-usable-price`.
2. **`slaQualified`** — `capacity.slaAchievable && ttftMet && interactivityMet` (P99 TTFT + streaming +
   N+1). Fail → `sla-unmet-ttft-or-streaming`.
3. **`evidenceQualified`** — `effectiveConfidence ∈ {measured, measured-scaled}` on a real applicable
   benchmark (§3.1). `proxy` / `heuristic` / substituted-precision `extrapolated` / `unbenchmarked` →
   `evidence-below-threshold` (kept for Expert review, never a primary card). **A heuristic H200 stays
   `technicallyFeasible=true` but `recommendationEligible=false`** — missing evidence is never
   infeasibility.
4. **`recommendationEligible` = `technicallyFeasible && slaQualified && evidenceQualified`.**

**`bestSelfHost`** = the top of the deterministic ranking (§5) over `recommendationEligible` candidates
(or `null` if none). `lowest-cost` / `highest-confidence` / `lowest-latency` alternatives = the best
eligible candidate optimizing that axis, included **only when its candidate id differs** from a card
already shown (rev-5). At R1 they legitimately collapse to "none" (one eligible config).

**Top-level `decision`** (rev-1) is derived AFTER the sweep, comparing the best evidence-qualified
self-host config against the API option for the same workload:

| Condition | `decision.choice` | `decision.basis` |
|---|---|---|
| an evidence-qualified self-host exists AND API is cheaper (trustworthy comparison) | `api` | `lower-cost` |
| an evidence-qualified self-host exists AND it is cheaper | `self-host` | `lower-cost` |
| evidence-qualified self-host cheaper on cost but preference axis flips it | per preference | `customer-preference` |
| **no** self-host option is evidence-qualified (e.g. every candidate `unbenchmarked` in experimental mode) | `api` | `evidence-gap` |
| no self-host option is even technically feasible | `api` | `self-host-infeasible` |
| the only self-host options miss the SLA | `api` | `sla` |
| an evidence-qualified self-host exists but the API comparison is untrustworthy/unavailable | `undetermined` | (nearest applicable) |

So **R1/R5 → `decision=api` (`lower-cost`)** with `bestSelfHost = p6-b200` — the GPU config is the best
self-host option, **not** the overall recommendation.

### 4.1 Ranking — complete deterministic total order (rev-5)

A single stable comparator, applied in strict order (later keys only break earlier ties). No result ever
depends on catalog iteration order:

1. **Recommendation eligibility** — `recommendationEligible` before not (eligible candidates always rank
   above ineligible for `bestSelfHost`).
2. **Requested optimization axis** (`optimizeFor`):
   - `cost` → lower `cost.selfHostMonthly` first;
   - `latency` → lower `ttftS` first, with **`ttftS === null` ranked LAST** (a config with no measured
     TTFT can never win a latency race);
   - `confidence` → higher `CONFIDENCE_RANK[effectiveConfidence]` first;
   - `predictability` → self-host (fixed fleet cost) preferred, then lower `cost.selfHostMonthly`.
3. **Effective confidence** — higher `CONFIDENCE_RANK` first.
4. **Relevant secondary metric** — the axis not used in (2): cost then latency (null TTFT last).
5. **Stable canonical `config.id`** — lexicographic final tie-break (guarantees total order).

**Alternative distinctness (Phase 1):** an alternative card is emitted only when its winning candidate
`id` is **not already** the id of a shown card — an exact, deterministic rule. Fuzzy percentage
thresholds ("≥5% cheaper") are deferred to the UI phase.

---

## 5. Narrative generator (`lib/recommendation/narrative.ts`) — template over fields

Follows the `lib/fleet-explain.ts` precedent: **strings are assembled from STRUCTURED fields only — no
free prose, no invented numbers, no prose reverse-engineered from a summary** (rev-6). It consumes the
structured evaluation record — `decision.choice/basis`, the four gate booleans + `rejections` codes,
`engineConfidence`, `registry.reasons/transformations`, `fleet.equation`, `cost` — and renders: the
caption, the `decision.rationale`, each card's `bindingConstraint` ("prefill-bound: 221,461 input tok/s ÷
2,600 per replica → 86 replicas + 1 N+1"), the `tradeoff`, and the effective-confidence chip label. Hard
rule (P1-UX-002): a model/precision/hardware/topology mismatch — or an `unbenchmarked` effective state —
is **never** labelled "Measured"; each renders its own qualified chip. Every produced string is
unit-tested against the R1–R5 reference numbers.

## 6. Change-diff (`lib/recommendation/change-diff.ts`) — deterministic, reason-coded

`diffRecommendations(prev, next)` returns an ordered list of coded changes: **`decision-changed`**
(top-level `api ↔ self-host ↔ undetermined`, with the new `basis`), `best-self-host-changed` (config id),
`fleet-changed` (Δ boxes), `cost-changed` (Δ $), `confidence-changed` (on `effectiveConfidence`, e.g.
`measured-scaled → unbenchmarked`), `verdict-changed` (api-wins ↔ self-host-efficient), `gate-flip` (a
candidate that entered or left `rejected`, with the reason code). Pure function of the two results; no
time, no randomness.

---

## 7. Reference-case anchoring (ground truth = [18](../18-reference-cases.md))

The engine tests assert BOTH the overall `decision` AND the best evidence-qualified self-host candidate
(rev-7), against the already-signed-off numbers:

| Case | Candidate(s) | `decision` | `bestSelfHost` | Rejections |
|---|---|---|---|---|
| R1 | dsv4 · p6-b200 · INT4 | **api** / `lower-cost` | p6-b200 · 87 boxes · $7,176,630 · prefill · **Measured·scaled** | — |
| R2 | dsv4 · p6-b200 · FP8 | api / `lower-cost` | (unchanged) | fp8 → `evidence-below-threshold` (fp4 substituted → not distinct/measured) |
| R3 | dsv4 · p5e (H200) · INT4 | api / `lower-cost` | — | H200 heuristic → `technicallyFeasible=true`, `evidence-below-threshold`; the $554k figure NEVER shown as an alternative |
| R4 | dsv4 · p5 (H100) · INT4 | api / `lower-cost` | — | H100 heuristic → `evidence-below-threshold` |
| R5 | dsv4 · p6-b200 · INT4 · 5M vol | **api** / `lower-cost` | p6-b200 · 4 boxes · $329,960 | — |

**Experimental-provenance mode (approval limitation, explicitly tested):** with the pinned registry,
every candidate resolves to `unbenchmarked` ⇒ `effectiveConfidence=unbenchmarked` ⇒
`evidenceQualified=false` ⇒ `bestSelfHost=null` and `decision=api` / `evidence-gap`. The result **visibly
preserves `unbenchmarked`** (with the registry reasons/transformations retained) and does **not** silently
reuse the control's `Measured·scaled`. R1's structural numbers are additionally cross-checked against
`lib/rc-qa10.test.ts` so a drift in either the engine or this layer fails a test.

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

1. **Candidate catalog growth** — v1 pins a small curated catalog loaded internally (no auto-expansion,
   no coverage growth this pass). How/when the supported catalog is regenerated from the registry +
   priceBook (and re-reviewed) is deferred.
2. **Evidence PROMOTION rule (future)** — v1 is demote-only (§3.1) and is settled. If/when a registry
   record becomes measured-exact with a reviewed AWS-host mapping, the promotion rule and the 3-reviewer
   sign-off gate (owner Q3) must be specified before the registry may raise confidence.
3. **`optimizeFor` default** — which axis is the Stage-A default — pending UX.
4. **`undetermined` triggers** — the precise set of "untrustworthy comparison" conditions (beyond a
   missing API price) that yield `decision=undetermined` — to be enumerated with UX.
5. **Alternative distinctness** — v1 uses the exact same-id rule (§4.1). Fuzzy percentage thresholds are
   deferred to the UI phase.
6. **Narrative locale/format** — md/plain strings now; HTML rendering is a UI-phase concern.
