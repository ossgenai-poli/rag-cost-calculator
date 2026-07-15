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

- **Structured vs narrated (rev-2 #5).** `recommend()` returns a `StructuredRecommendationResult` —
  **facts only, no prose.** `narrate(structured)` returns a `NarratedRecommendationResult` that adds the
  `decision.rationale`, card `bindingConstraint`/`tradeoff`, and caption. The change-diff compares the
  **structured** results.
- **Top-level `decision`** — `{ choice: "api" | "self-host" | "undetermined"; basis }` with the
  deterministic precedence basis union `self-host-infeasible | sla | evidence-gap |
  comparison-unavailable | lower-cost` (§4.2). `customer-preference` is **removed** from the top-level
  derivation (Phase 1 has no comparable API latency/confidence metrics). A GPU config is **never** the
  overall recommendation when API wins.
- **`apiOption`** (rev-2 #3) — the API delivery option represented structurally: `{ modelId; monthlyCost:
  number | null; priceState; comparisonQualified }`, not just a rationale string.
- **`bestSelfHost: Card | null`** — the best *evidence-qualified* self-host config, separate from
  `decision`. `null` ⇒ no evidence-qualified self-host exists (honest empty state).
- **`CandidateEvaluation`** carries **distinct** gate fields — `technicallyFeasible` (which **excludes
  price**, rev-2 #2), `slaQualified`, `evidenceQualified`, `priceQualified`, `comparisonQualified`,
  `recommendationEligible` — plus **separate** confidence representations: `engineConfidence` (frozen
  `capacity.source`), `registry?` (experimental provenance, using the registry's **exported** types —
  `SelectionResult` status, `ConfidenceCategory`, `Reason[]`, `Transformation[]`, `ProvenanceView`), and
  `effectiveConfidence` (`EngineConfidence | "unbenchmarked"`). It also carries the structured explanation
  inputs: `fleet` (reconciled equation), `cost` (self-host vs API, both `number | null` — **no $0
  sentinel**), TTFT + percentile, and the reason-coded `rejections`.
- **`RecommendationRequest`** = `{ workload: CalcInputs; optimizeFor; experimentalProvenance? }` — **no
  caller candidates** (rev-4). `recommend()` loads the pinned catalog, **filters it to the workload's
  EXACT model** (rev-2 #3 — no cross-model recommendations; that needs a separate quality-equivalence
  contract), and builds each candidate's `CalcInputs` with the existing pure transforms
  `applyGpuSelection`/`applyModelSelection` (QA-014 ⇒ a test fixture is byte-identical to the app
  selector's output), so the sweep can never diverge from the real engine inputs.

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

**Per-candidate gates** set the DISTINCT fields; the first failing gate sets the primary rejection code
(never conflate "can't run" with "not enough evidence", and **never** treat a missing price as
infeasibility — rev-2 #2):

1. **`technicallyFeasible`** (excludes **price AND SLA** — HOLD-1 P1-1/P1-2) — derived from STRUCTURED
   engine codes, never message regexes. `capacity.contextOverflow` → `context-window-overflow`; a
   `crossover.infeasibility[]` code that is NOT an SLA code (`ttft`/`interactivity`/
   `concurrency-below-min`) maps via a fixed table (`manual-cap`→`fleet-exceeds-practical-limit`, else
   `model-does-not-fit-serving-group`). SLA/TTFT/interactivity failures do **not** touch technical
   feasibility.
2. **`slaQualified`** — `capacity.slaAchievable && ttftMet && interactivityMet && concWithinLimit` (P99
   TTFT + streaming + concurrency + N+1). Fail → `sla-unmet-ttft-or-streaming`.
3. **`evidenceQualified`** — `effectiveConfidence ∈ {measured, measured-scaled}` on a real applicable
   benchmark (§3.1). `proxy` / `heuristic` / substituted-precision `extrapolated` / `unbenchmarked` →
   `evidence-below-threshold` (kept for Expert review, never a primary card). **A heuristic H200 stays
   `technicallyFeasible=true` but `recommendationEligible=false`** — missing evidence is never
   infeasibility.
4. **`recommendationEligible` = `technicallyFeasible && slaQualified && evidenceQualified`.**
5. **`priceQualified`** (self-host price exists) and **`comparisonQualified`** (`priceQualified` AND an
   API price exists) are tracked SEPARATELY — they feed the decision, not eligibility. An
   evidence-qualified but unpriced config is still `recommendationEligible`, but drives the decision to
   `undetermined`.

**`bestSelfHost`** = the top of the deterministic ranking (§4.1) over `recommendationEligible` candidates
(or `null` if none). `lowest-cost` / `highest-confidence` / `lowest-latency` alternatives = the best
eligible candidate optimizing that axis, included **only when its candidate id differs** from a card
already shown. At R1 they legitimately collapse to "none" (one eligible config).

### 4.2 Top-level decision — deterministic precedence (rev-2 #1)

`deriveDecision(evaluations, apiOption)` — **first match wins**, so overlapping conditions can never
produce a nondeterministic basis. `optimizeFor` does **not** enter here (it ranks self-host only):

| # | Condition | `choice` / `basis` |
|---|---|---|
| 0 | **zero candidates**, model IS self-hostable (catalog coverage gap) | `api` / `no-modeled-candidate` |
| 0′ | **zero candidates**, model is NOT self-hostable | `api` / `self-host-infeasible` |
| 1 | candidates exist, none `technicallyFeasible` | `api` / `self-host-infeasible` |
| 2 | feasible exist, but none `slaQualified` | `api` / `sla` |
| 3 | SLA-qualified exist, but none `evidenceQualified` | `api` / `evidence-gap` |
| 4 | evidence-qualified exists, but **either side** lacks `comparisonQualified` (API price missing, or no comparison-qualified self-host) | `undetermined` / `comparison-unavailable` |
| 5 | trustworthy comparison: `apiOption.monthlyCost ≤` cheapest comparison-qualified self-host | `api` / `lower-cost` |
| 5′ | trustworthy comparison: cheapest comparison-qualified self-host is cheaper | `self-host` / `lower-cost` |

So **R1/R5 → `api` / `lower-cost`** with `bestSelfHost = p6-b200`; a **heuristic-only** case (R3/R4,
`bestSelfHost=null`) → **`api` / `evidence-gap`** (never `lower-cost` — the $554k/$522k heuristic numbers
are not a comparison input).

### 4.3 Registry request mapping (rev-2 #4) — honest, never invented

`buildRegistryRequest(candidate, workload, calc)` sets only fields derived from **real** data — modelId,
weight/KV precision (`precisionFromBits`), `gpuSku`, `awsInstance`, `gpuCount`, `isl`
(`perQuery.llmInputTok`), `osl`, `concurrency`, the interactivity SLA, and `framework`/`serving` **only
when** the frozen benchmark provenance actually reports them. Fields we cannot establish — **checkpoint,
parallelism (TP/PP/EP), nodeCount, prefix-cache, speculative-decoding** — are left **UNSET**. The pinned
InferenceX snapshot establishes none of these, so the request is incomplete and the registry returns
`invalid-request` → the candidate stays `unbenchmarked` (approval limitation, preserved). No default is
invented to force a resolution.

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

`diffRecommendations(prev, next)` returns an ordered list of coded changes over the **structured**
results. **The binding contract is the exported `ChangeCode` union in `change-diff.ts`** (mirrored in
§10.7–§10.8 and QA-HANDOFF — one source of truth):

> `mode-changed · decision-changed · comparator-changed · api-model-changed · api-option-changed ·
> model-label-changed · best-self-host-changed · alternatives-changed · rejection-details-changed ·
> control-comparison-changed · effective-workload-changed · adjustments-changed · pricing-changed ·
> candidate-added · candidate-removed · candidate-config-changed · gate-changed · rejection-changed ·
> confidence-changed · provenance-changed · fleet-changed · fleet-equation-changed · latency-changed ·
> serving-facts-changed · cost-changed`

Verdict changes surface as `cost-changed` (`cost.verdict`); gate entry/exit surfaces as `gate-changed` +
`rejection-changed`/`rejection-details-changed` (the earlier draft names `verdict-changed`/`gate-flip`
are superseded). Coverage of **every** schema field is enforced by compile-time
`satisfies Record<keyof …, ChangeCode>` maps plus a coarse per-field fallback (§10.8); `identical` is the
canonical equality of the complete results. Pure function of the two results; no time, no randomness.

---

## 7. Reference-case anchoring (ground truth = [18](../18-reference-cases.md))

The engine tests assert BOTH the overall `decision` AND the best evidence-qualified self-host candidate,
against the already-signed-off numbers. The **candidate set** for each case is stated explicitly (all
share the exact model `dsv4`; the sweep varies only infra/precision):

| Case | Candidate set (dsv4, exact model) | `decision` | `bestSelfHost` | Rejections |
|---|---|---|---|---|
| R1 | {p6-b200·INT4} | **api** / `lower-cost` | p6-b200 · 87 boxes · $7,176,630 · prefill · **Measured·scaled** | — |
| R2 | {p6-b200·**INT4**, p6-b200·**FP8**} — evaluated together | api / `lower-cost` | p6-b200·INT4 (unchanged) | FP8 → `evidence-below-threshold` (fp4 substituted → not distinct/measured) |
| R3 | {p5e·H200·INT4} | **api** / **`evidence-gap`** | **null** | H200 heuristic → `technicallyFeasible=true`, `evidence-below-threshold`; the $554k figure NEVER a comparison input or alternative |
| R4 | {p5·H100·INT4} | **api** / **`evidence-gap`** | **null** | H100 heuristic → `evidence-below-threshold` |
| R5 | {p6-b200·INT4} · 5M vol | **api** / `lower-cost` | p6-b200 · 4 boxes · $329,960 | — |

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
3. **`optimizeFor` default + delivery-model preference** — which axis is the Stage-A default, and whether
   to add an explicit `deploymentPreference` request field (deterministic semantics) to let a customer
   prefer API or self-host independent of cost. `customer-preference` was removed from the top-level
   basis until such a field exists.
4. **`undetermined` triggers** — v1 yields `undetermined`/`comparison-unavailable` only when a required
   price is missing. Any further "untrustworthy comparison" conditions are to be enumerated with UX.
5. **Alternative distinctness** — v1 uses the exact same-id rule (§4.1). Fuzzy percentage thresholds are
   deferred to the UI phase.
6. **Narrative locale/format** — md/plain strings now; HTML rendering is a UI-phase concern.

---

## 10. Sweep review — HOLD-1 (findings, reproductions, fixes)

The first focused sweep QA returned HOLD with six P1 findings + one P2. All are fixed on this branch;
each is captured here with its reproduction and resolution, and covered by tests.

| # | Finding (repro) | Fix |
|---|---|---|
| **P1-1** | `ttftTargetMs=100` on B200: `technicallyFeasible=false`, rejection `fleet-exceeds-practical-limit` (a TTFT SLA failure folded into technical feasibility via `crossover.feasible`, then mislabeled by a `/instances/` message regex). | `technicallyFeasible` now derives from **structured** infeasibility codes and EXCLUDES the SLA codes (`ttft`/`interactivity`/`concurrency-below-min`). No message regexes. SLA maps to `sla-unmet-ttft-or-streaming`. Test: B200 low-TTFT → `technicallyFeasible=true`, `slaQualified=false`, `sla-unmet-ttft-or-streaming`, `decision=api/sla`. |
| **P1-2** | `minimax-m3-oss`/`glm-5.2-oss`/`nemotron-3-ultra-oss` (all `selfHostable`) with no pinned candidate → `api/self-host-infeasible`. | New basis **`no-modeled-candidate`**: self-hostable model + zero candidates → `api/no-modeled-candidate`; `self-host-infeasible` is reserved for genuinely non-self-hostable models or candidates that are all technically infeasible. Tests cover both. |
| **P1-3** | `optimizeFor:"bogus"` accepted; a `p6-b200` candidate with `gpuSku:"H100"` passed validation; `PINNED_CANDIDATES` mutable. | Boundary enum validation (`optimizeFor`, `experimentalProvenance`, workload) fails closed; catalog validation checks `gpuSku` against a reviewed `REVIEWED_INSTANCE_ACCELERATOR` map (a local curated copy — not a registry deep-import); `PINNED_CANDIDATES` and every entry are `Object.freeze`d and `validateCandidateCatalog` returns frozen records. Negative tests for all three. |
| **P1-4** | A synthetic `extrapolated` result with matching precision but partial-topology reasons / no provenance was classified `measured-scaled`. | `engineConfidenceFrom` now requires a **traceable, same-precision, ISL-scaled** measurement (real `benchmarkProvenance`, `prefillEstimated=false`, a defined `prefillIslScale`, `precisionUsed===precisionRequested`) from STRUCTURED fields; anything else stays `extrapolated`. R1's sequence-scaled behavior preserved. Negatives for untraceable provenance, estimated prefill, no ISL scale, precision substitution. |
| **P1-5** | `deriveDecision` returned `lower-cost` even when `comparisonQualified=false`. | A cost decision now requires `comparisonQualified` on **both** the API option and the selected self-host candidate; otherwise `comparison-unavailable`. Contract tests for both sides. |
| **P1-6** | Result lacked effective inputs / clamp notes / price provenance; `recommend()` imported `prices.json` directly. | Added `effectiveWorkload` (GPU-independent normalized inputs), `inputAdjustments` (incl. the 730h uptime cap), and `pricing` (`source`/`asOf`/`region`/reconciled `gpuPriceSource`); reconciled once at result level with a cross-candidate consistency assertion. Introduced the trusted `loadPriceBook()` seam (default = pinned reference book; production wires live/fallback; tests module-mock). |
| **P2-1** | "evaluated exactly once" checked output length; API cost silently took the first non-null. | Added a `calculate()` spy seam asserting exactly one call per candidate; `recommend()` now asserts the API cost is identical across exact-model candidates and fails closed otherwise. |

**After HOLD-1:** recommendation tests 58, full suite 282, tsc clean; engine + registry byte-identical to
`4b2c848`; diff confined to `lib/recommendation/` + `docs/ux-v2/phase1/`; main frozen at `d749309`.

### 10.1 Sweep review — HOLD-2 (findings, reproductions, fixes)

| # | Finding (repro) | Fix |
|---|---|---|
| **P1-1** | An `extrapolated` result with traceable provenance, `prefillEstimated=false`, a finite `prefillIslScale`, matching precision, but a **partial-topology** `extrapolationReasons` entry was still classified `measured-scaled`. | `engineConfidenceFrom` now additionally requires that **every** `extrapolationReasons` entry is a permitted **sequence-length** reason (`/not close to benchmarked ISL\|OSL/`). Any topology / precision / untraceable-provenance reason (or a mix) → `extrapolated`. R1's ISL/OSL scaling preserved. Negatives added for partial-box, non-whole-box, untraceable, and mixed reasons. |
| **P1-2** | Setting `apiComparisonInPricePer1K/OutPricePer1K=999` in the workload flipped the decision to `self-host/lower-cost` (API=$681M) while `pricing.source` stayed `fallback`. `runCandidate` trusted the workload's duplicated price fields. | `recommend()` now resolves `llmModelId`/`apiComparisonModelId` against the trusted price book and **patches their prices** (`resolveTrustedPrices`) before `calculate()`; unknown ids are rejected. The customer's model CHOICE is honored; the PRICES are the trusted book's. Tamper test: hidden price fields cannot change the result or provenance. |
| **P1-3** | `effectiveWorkload` showed entered values, not computed ones — `gpuUptimeHoursPerMonth=1000` stayed 1000; `topN=9,topK=3` stayed `topN=9` with no adjustment. | `buildEffectiveWorkload()` materializes the CALCULATED workload with the engine's internal adjustments — uptime capped at 730h and `topN=min(topN,topK)` — and emits a structured adjustment for each. Test asserts `effectiveWorkload` agrees with every adjustment. |
| **P1-4** | `corpus.refreshCadence`/`vectorStore.indexingAlgo="bogus"` accepted; unknown `llmModelId` returned a fabricated priced API option; `ragMode="B"` produced a contradictory self-host card (calculate() forces API mode for managed KB). | The complete public contract is validated at the boundary BEFORE loading candidates: request enums, nested workload enums (refreshCadence, indexingAlgo, generation.mode, ragMode), and model ids (llm + apiComparison) against the trusted book. **ragMode "B" fails closed as unsupported** by the self-host sweep in Phase 1 (documented). Reproductions added for each. |

**After HOLD-2:** recommendation tests 66, full suite 290, tsc clean; engine + registry byte-identical to
`4b2c848`; diff confined to `lib/recommendation/` + `docs/ux-v2/phase1/`; main frozen at `d749309`.

### 10.2 Sweep review — HOLD-3 (findings, reproductions, fixes)

| # | Finding (repro) | Fix |
|---|---|---|
| **P1-1** | `apiOption.modelId` reported the self-host model (`deepseek-v4-pro-oss`) while `effectiveWorkload.generation.apiComparisonModelId` was `claude-fable-5` — attributing Claude's API price to DeepSeek. An embedding id (`titan-embed-v2`) was accepted and priced as a generation API. | `apiOption.modelId` is now the **compared API model** (the normalized `apiComparisonModelId`); the self-host identity remains in `evaluations[].config` / `effectiveWorkload.generation.llmModelId`. Validation requires `apiComparisonModelId` (when set) to resolve to a `kind==="llm"` model. Tests: `apiOption.modelId === effectiveWorkload…apiComparisonModelId`; an alternate LLM reports that LLM + its trusted price; embedding/rerank ids fail closed. |
| **P1-2** | "Complete validation" was piecemeal: `gpuPricingModel`/`traffic.method="bogus"` accepted; `peakFactor=-1`, `utilTarget=0`, `topK=-1/topN=-2` accepted; `gpuUptimeHoursPerMonth=-5` silently became 730. | Replaced the hand-picked checks with one authoritative boundary validator (`validate.ts`) run BEFORE candidate loading: all decision-relevant enums (`ragMode`, `refreshCadence`, `indexingAlgo`, `generation.mode`, `gpuPricingModel`, `traffic.method`, `managedKb.retrievalMode`), required nested objects, finite numbers, and domain constraints (`utilTarget∈(0,1]`, `peakFactor>0`, `topK≥1`, `topN≥0`, `gpuUptimeHoursPerMonth≥0`, …) following the calculator's own rules. Intentional `topN>topK` and `uptime>730` are still accepted (reconciled); malformed/non-finite/negative values fail closed. Reproductions added as public `recommend()` tests. |
| **P2** | `apiComparisonModelId=""` failed as unknown, while the frozen calculator treats an unset comparison id as "use the selected LLM". | Empty/unset `apiComparisonModelId` is normalized to `llmModelId` in `resolveTrustedPrices` (and allowed by validation) — the documented compatible behavior; test asserts `apiOption.modelId === llmModelId`. |

**After HOLD-3:** recommendation tests 77, full suite 301, tsc clean; engine + registry byte-identical to
`4b2c848`; diff confined to `lib/recommendation/` + `docs/ux-v2/phase1/`; main frozen at `d749309`.

### 10.3 Sweep review — HOLD-4 (findings, reproductions, fixes)

| # | Finding (repro) | Fix |
|---|---|---|
| **P1-1** | `effectiveWorkload` was a full `CalcInputs` carrying the caller's GPU/precision fields, which the sweep overrides per candidate — so `effectiveWorkload` said `p5.48xlarge / weightBits=16` while `bestSelfHost` was `p6-b200 / INT4` (two conflicting sources of truth; caller `gpuPricePerHr=999`/invented fields could be narrated as candidate facts). | `effectiveWorkload` is now a **workload-only** `EffectiveWorkload` type that EXCLUDES the candidate-varying fields (`gpuInstanceType`, `gpuPricePerHr`, `sustainedTokPerSec`, `weightBits`, `kvBits`). The ACTUAL applied serving facts now live on each `CandidateEvaluation.servingFacts` (instance/SKU, weight+KV precision, effective GPU $/hr + source, pricing model, uptime, utilTarget), derived from the exact `calc.effectiveInputs` so they reconcile with what `calculate()` consumed. Tamper test: caller GPU/price fields never appear as candidate facts; `servingFacts` reflect the pinned candidate + trusted price. |
| **P1-2** | `gpuUptimeHoursPerMonth=0` was accepted, `effectiveWorkload` showed 730, `inputAdjustments` was empty — a silent 0→730. | `buildEffectiveWorkload` now **discloses** the default: `entered≤0` emits `{field:"gpuUptimeHoursPerMonth", entered:0, calculated:730}` and `servingFacts.uptimeHours=730`. Negative uptime is still rejected by the validator. |
| **cleanup** | `weightBits`/`kvBits` accepted any non-negative number; `gpuInstanceType` unvalidated; `sustainedTokPerSec` unvalidated. | Validator now requires `weightBits∈{4,8,16}`, `kvBits∈{8,16}` (exact), `gpuInstanceType` present in the trusted price book, and `sustainedTokPerSec` finite ≥ 0. Negatives added (`weightBits=3`, `kvBits=7`, `gpuInstanceType="made-up"` all fail closed). |

**After HOLD-4:** recommendation tests 81, full suite 305, tsc clean; engine + registry byte-identical to
`4b2c848`; diff confined to `lib/recommendation/` + `docs/ux-v2/phase1/`; main frozen at `d749309`.

### 10.4 Narrative slice (implemented — for focused narrative QA)

`narrate(structured) → NarratedRecommendationResult` is a **pure, deterministic** template over the
structured result (no engine/registry call, no Date/random). Binding requirements → coverage:

| Requirement | How it is honored |
|---|---|
| Lead with API-vs-self-host decision | `decision.rationale` always opens with `Recommendation: …` by `decision.basis`. |
| Name both models when they differ | rationale appends `(compared models: <api> via API vs self-hosting <self>)` when `apiOption.modelId !== effectiveWorkload.generation.llmModelId`. |
| bestSelfHost never the overall rec when `api` | rationale leads with the API option; the card is only ever the "best self-host option". Test asserts no `Recommendation: self-host` when `choice==="api"`. |
| Every basis covered deterministically | `lower-cost / evidence-gap / no-modeled-candidate / self-host-infeasible / sla / comparison-unavailable` each have an explicit branch. |
| Candidate facts only from `servingFacts` | card `tradeoff`/`bindingConstraint` read `servingFacts` (instance, precision, GPU price, pricing model); never a stale CalcInputs. |
| Workload facts only from `effectiveWorkload`; disclosures from `inputAdjustments` | self-host model id from `effectiveWorkload.generation.llmModelId`; adjustments rendered from `inputAdjustments`. |
| Exact confidence tokens | the `confidence` token is emitted verbatim (`measured` … `unbenchmarked`). |
| Registry invalid-request = internal limitation | experimental-mode note: "internal evidence-metadata limitation … not a problem with the request". |
| Pricing provenance; never "live" on fallback | pricing disclosure from `pricing.{source,asOf,region,gpuPriceSource}`; "live" only when `source==="live"`. |
| No unsupported percentile | TTFT clause only when `ttftPercentile ∈ {p50,p90,p95,p99}`. |
| Fleet sizing from `fleet.equation` | `bindingConstraint` embeds `fleet.equation` verbatim; no math reconstructed. |
| Pricing wording guard | `servingFacts.gpuPricePerHr` rendered as "on-demand base rate" + purchasing model — never a discounted "effective rate". |

**After the narrative slice:** recommendation tests 92 (incl. 11 narrate), full suite 316, tsc clean;
engine + registry byte-identical to `4b2c848`; diff confined to `lib/recommendation/` + `docs/ux-v2/phase1/`;
main frozen at `d749309`. change-diff / UI / merge / deploy remain HELD pending narrative QA.

### 10.5 Narrative review — HOLD-1 (findings, reproductions, fixes)

| # | Finding (repro) | Fix |
|---|---|---|
| **P1-NARR-1** | Evidence-gap prose hardcoded "(only heuristic/extrapolated estimates)" — experimental R1's actual state is `unbenchmarked`, so the rationale contradicted its own registry note. | The rationale now derives the ACTUAL unique `effectiveConfidence` tokens from the candidates that reached the evidence gate (technically feasible + SLA-qualified), rendered as "Available evidence state(s): …" — exact tokens, deterministic order (rank-desc, then alphabetical), never invented. Tests: experimental R1 says `unbenchmarked` (and never claims heuristic/extrapolated); R3 says `heuristic`; a mixed fixture lists "heuristic, unbenchmarked" deterministically. |
| **P1-NARR-2** | `deriveDecision` compares against the CHEAPEST comparison-qualified self-host, but narrate explained the decision with the optimization-selected `bestSelfHost` — with a $5.0M comparator and a $7.18M bestSelfHost the prose made a mathematically false "lower-cost" claim. | The exact comparator is now persisted structurally on the decision: `Decision.costComparator = {selfHostCandidateId, selfHostMonthly, apiMonthly}` (deterministic cost→config-id tie-break; present only for `lower-cost`). narrate() explains the cost decision from the comparator (its instance + amounts); `bestSelfHost` still describes the optimization-selected config separately. If the comparator is absent/inconsistent (missing eval, amount mismatch, or the claimed inequality fails), narrate **fails closed to neutral wording** with no dollar winner asserted. Tests: self-host-wins and api-wins with bestSelfHost ≠ comparator (inequality always holds); absent/inconsistent → neutral. Comparator is additive — sweep choice/basis behavior unchanged (all 81 sweep tests still pass). |
| **P2-NARR-1** | Prose used internal ids (`claude-fable-5`, `deepseek-v4-pro-oss`) and omitted the cross-model comparability caveat. | Trusted labels from the PriceBook are added to the structured result (`apiOption.modelLabel`, `selfHostModelLabel`) — narrate maintains no id→label mapping; prose uses labels, ids remain in the audit structure. Whenever the compared API model differs from the self-host model, the rationale appends: "This compares the selected models' costs; capability and quality equivalence are not established by this calculator." Adjustment disclosures use customer-readable labels ("Context chunks sent to the model", "GPU fleet uptime hours/month"); raw field paths remain in `inputAdjustments`. Tests for cross-model caveat, same-model (no caveat), alternate-API label, and label-vs-id separation. |

**After narrative HOLD-1:** recommendation tests 99 (81 sweep + 18 narrate), full suite 323, tsc clean;
engine + registry byte-identical to `4b2c848`; approved sweep behavior unchanged; diff confined to
`lib/recommendation/` + `docs/ux-v2/phase1/`; main frozen at `d749309`.

### 10.6 Narrative review — HOLD-2 (comparator integrity)

| # | Finding (repro) | Fix |
|---|---|---|
| **P1-NARR-3** | The inline `amountsConsistent` check missed four invariants: comparator `apiMonthly` vs `apiOption.monthlyCost`, comparator API amount vs the candidate evaluation's API amount, the comparator candidate's eligibility, and cheapest-qualified ordering. Repro 1: tampering `costComparator.apiMonthly` to $1 narrated "API at $1/month". Repro 2: substituting the rejected heuristic H200 evaluation as the comparator narrated a heuristic $554k self-host win. | ONE shared integrity helper, `costComparatorValid(decision, apiOption, evaluations)` in `decision.ts`, used by narration (and reusing the SAME `byCostThenId` ordering `deriveDecision` picks with). Valid requires ALL of: basis `lower-cost` · candidate exists · candidate `recommendationEligible` + `evidenceQualified` + `priceQualified` + `comparisonQualified` · candidate selfHost AND api amounts EXACTLY match the comparator · `apiOption.monthlyCost` EXACTLY matches · the candidate is the deterministic CHEAPEST comparable candidate (cost→config-id) · amounts finite · claimed choice/inequality consistent. Any failed invariant → neutral wording with no asserted dollar winner; narrate never repairs or substitutes a comparator. Tests: tampered API amount → neutral; rejected-heuristic comparator → neutral; valid-but-non-cheapest comparator → neutral; valid api-wins and self-host-wins comparators → exact amounts. |

**After narrative HOLD-2:** recommendation tests 102 (81 sweep + 21 narrate), full suite 326, tsc clean;
engine + registry byte-identical to `4b2c848`; approved sweep behavior unchanged; diff confined to
`lib/recommendation/` + `docs/ux-v2/phase1/`; main frozen at `d749309`.

### 10.7 Change-diff slice (implemented — for focused change-diff QA)

`diffRecommendations(prev, next) → RecommendationDiff` (`change-diff.ts`) — a pure, deterministic,
reason-coded diff of two **structured** results (never narrative prose). Requirements → coverage:

| Requirement | How it is honored |
|---|---|
| Structured-only comparison | consumes `StructuredRecommendationResult` fields exclusively; no prose parsing. |
| Reason-coded change classes | `mode/decision/comparator/api-model/best-self-host/pricing/adjustments-changed`, `candidate-added/removed`, and per-candidate `gate/rejection/confidence/fleet/cost-changed` — each with a `field` path. |
| Before/after + candidate ids preserved | every change carries deep-copied `before`/`after` structured values; per-candidate changes carry the stable canonical `candidateId`. |
| Identical → empty | `identical: true`, `changes: []` (tested on two identical R1 runs). |
| Deterministic ordering/serialization | fixed sort (result-level first → candidate id → code order → field); byte-identical `JSON.stringify` across repeat calls. |
| Null-safe | `undefined` → `null`, non-finite numbers → `null`; serialized diff never contains NaN/undefined; codes + values only, no invented explanations. |
| No input mutation | pure reads + deep-copied values; tested with deep-frozen inputs and before/after JSON snapshots. |

Tests (9): identical-R1 empty · R1→R5 fleet (87→4) + cost ($7,176,630→$329,960) · control→experimental
(mode, effectiveConfidence measured-scaled→unbenchmarked, registry.status null→invalid-request,
evidenceQualified/recommendationEligible flips, decision lower-cost→evidence-gap, bestSelfHost→null,
comparator→null, rejection null→evidence-below-threshold) · API-model change (Fable→Opus + API cost) ·
topN/uptime adjustments · pricing source/asOf per-field · candidate added/removed (both directions) ·
decision+comparator flip with exact before/after amounts · determinism + deep-frozen-input immutability.

**After the change-diff slice:** recommendation tests 111 (81 sweep + 21 narrate + 9 diff), full suite
335, tsc clean; engine + registry byte-identical to `4b2c848`; approved sweep (`7c16584`) and narrative
(`7c8b97a`) behavior unchanged; diff confined to `lib/recommendation/` + `docs/ux-v2/phase1/`; main
frozen at `d749309`. UI / merge / deploy remain HELD pending change-diff QA.

### 10.8 Change-diff review — HOLD-1 (findings, reproductions, fixes)

| # | Finding (repro) | Fix |
|---|---|---|
| **P1-DIFF-1** | The diff observed only selected fields and defined `identical` as `changes.length===0` — TTFT target 2,000→3,000ms (recorded in `effectiveWorkload`) returned `identical:true`, as did independent changes to `effectiveWorkload`, `controlComparison`, `selfHostModelLabel`, `apiOption.priceState/comparisonQualified/modelLabel`, `alternatives`, `rejected`, same-id `bestSelfHost`/`config` fields, `servingFacts`, `ttftS/ttftPercentile`, `fleet.equation`, rejection messages, and `registry.reasons/transformations/provenance/differsFromControl`. | **Complete coverage, doubly guarded.** (1) Compile-time: `satisfies Record<keyof …, ChangeCode>` coverage maps for `StructuredRecommendationResult`, `CandidateEvaluation`, `Decision`, `ApiOption`, `PricingProvenance`, `FleetReconciliation`, `CostComparison`, `RegistryEvidence` — a new schema field without a reason code fails typecheck. (2) Runtime: every field is compared by canonical (sorted-key) equality; when a field differs and its fine-grained handler emits nothing, a coarse change with the field's mapped code and full deep-copied before/after is emitted — a JSON-unequal field can never pass silently. New codes: `api-option-changed`, `model-label-changed`, `effective-workload-changed`, `control-comparison-changed`, `alternatives-changed`, `candidate-config-changed`, `serving-facts-changed`, `latency-changed`, `provenance-changed`, `fleet-equation-changed`, `rejection-details-changed`. **`identical` is now the canonical equality of the COMPLETE results.** Guard test: every primitive leaf path of a real control AND experimental result is mutated individually — each must yield `identical:false` and ≥1 coded change. |
| **P2-DIFF-1** | `candidate-added/removed` carried only the id — not self-contained. | Added/removed events now carry the **full deep-copied `CandidateEvaluation` snapshot** on the populated side (before=null/after=evaluation and vice versa), with `candidateId` retained separately. Test asserts the snapshot (config/confidence/fleet) and that it is a copy, not an alias. |
| **P3-DIFF-1** | DESIGN §6 still documented `verdict-changed`/`gate-flip`, diverging from the implementation. | §6 now points at the exported `ChangeCode` union as the ONE binding contract (mirrored here and in QA-HANDOFF); verdict changes surface as `cost-changed`(`cost.verdict`), gate entry/exit as `gate-changed` + `rejection(-details)-changed`. |

**After change-diff HOLD-1:** recommendation tests 119 (81 sweep + 21 narrate + 17 diff), full suite 343,
tsc clean; engine + registry byte-identical to `4b2c848`; approved sweep (`7c16584`) and narrative
(`7c8b97a`) behavior unchanged; diff confined to `lib/recommendation/` + `docs/ux-v2/phase1/`; main
frozen at `d749309`. UI / merge / deploy remain HELD.

### 10.9 Change-diff review — HOLD-2 (normalization + composite integrity)

| # | Finding (repro) | Fix |
|---|---|---|
| **P1-DIFF-2 (A)** | Reversing `evaluations[]` yielded `identical:false` with `changes:[]` — canonical equality treated the array as ordered while the event generator keyed by candidate id. Duplicate candidate ids were silently collapsed by Map-keying. | **Documented semantic: `evaluations` order is NON-SEMANTIC.** `identical` compares an identity view with evaluations sorted by canonical candidate id (a pure reorder is `identical:true`, no changes). **Duplicate candidate ids FAIL CLOSED** (throw) in either input before any map is built. |
| **P1-DIFF-2 (B)** | An absent optional property vs an explicitly-`undefined` one compared unequal in `canonical()` (which rendered undefined props as null) but equal in the field observers (JSON copy drops them) — `identical:false`, `changes:[]`; nested cases could emit events with visually identical payloads. | **ONE shared normalization policy** for equality AND emitted copies: undefined object properties are OMITTED, undefined array entries → null, non-finite numbers → null, keys sorted. Absent ≡ explicitly-undefined everywhere. `add()` refuses to emit any change whose normalized before/after are canonically equal. **Defensive invariant:** semantically unequal results always produce ≥1 change — a `result-changed` catch-all (full before/after) fires if no finer event was emitted; `identical:false` with `changes:[]` is impossible by construction. |
| **P2-DIFF-2** | Changing a rejection's code AND message together emitted only `rejection-changed` for the code — the fine event suppressed the composite fallback, losing the message change. | Rejections now emit BOTH: `rejection-changed` (primary code transition) and `rejection-details-changed` (complete before/after structures) whenever the arrays differ. Generally, composite fields (`decision`, `apiOption`, `pricing`, `fleet`, `cost`, `registry`) are now diffed by a generic `diffSub` over the UNION of subkeys (known keys → mapped codes; unknown/future keys → the composite's fallback code) — a fine handler can no longer suppress an unrepresented change inside its composite. `bestSelfHost` uses uniform full-card before/after semantics (an id change never hides the rest of the card). |

Structural guard tests added: array reorder → identical; duplicate ids → throw; optional-presence →
equal; simultaneous composite changes (priceState + comparisonQualified + monthlyCost) all represented;
rejection code+message → both events; and the leaf-mutation guard now also asserts every emitted
payload pair is canonically different and no case returns `identical:false` with empty changes.

**After change-diff HOLD-2:** recommendation tests 123 (81 sweep + 21 narrate + 21 diff), full suite 347,
tsc clean; engine + registry byte-identical to `4b2c848`; approved sweep (`7c16584`) and narrative
(`7c8b97a`) behavior unchanged; diff confined to `lib/recommendation/` + `docs/ux-v2/phase1/`; main
frozen at `d749309`. UI / merge / deploy remain HELD.

### 10.10 Narrow headless revision — availability semantics (UI HOLD-2 P1-UI-4, reviewer-authorized)

The UI review exposed a semantic contradiction the presentation layer could not honestly resolve: an
API-only model produced `basis="self-host-infeasible"` and the narrated "technically feasible" wording,
while availability (weights/rights) is a catalog fact, not GPU feasibility.

- **`DecisionBasis` gains `self-host-unavailable`**, decided FIRST in the precedence (before any
  technical candidate feasibility), from the trusted model-catalog `selfHostable` fact; the decision
  carries `availability: { reason: "api-only" | "weights-unavailable" }`.
- **`self-host-infeasible` is now reserved** for genuine capacity/memory/topology feasibility failures
  (self-hostable model, candidates present, none technically feasible).
- **narrate()**: "This model is available through the API only; self-host weights are not available, so
  no self-host cost comparison was performed." — never "technically (in)feasible" for this state.
- **change-diff**: `Decision.availability` added to the compile-time coverage map (decision-changed).
- Tests: contract (availability decided before feasibility, even with contradictory candidates; genuine
  infeasibility unchanged and `availability` absent), sweep (API-only → reason-coded basis), narrative
  (required wording; `technically (in)feasible` never used for availability; infeasible wording intact).

**After this revision:** recommendation tests 127, full suite 351, tsc clean; engine + registry
byte-identical to `4b2c848`; diff confined to `lib/recommendation/` + `docs/ux-v2/phase1/`; main frozen
at `d749309`.

### 10.11 Narrow headless revision — pricing qualification (iteration-3 HOLD P1-UI3-1, reviewer-authorized)

The iteration-3 review found that an indicative commitment discount (e.g. the 30% one-year Savings Plan
planning factor) could produce an UNQUALIFIED executive recommendation: the decision flipped to
self-host / lower-cost with "trustworthy cost comparison" wording, although the result rests on a
planning factor, fallback GPU pricing and an aggressive utilization target. The approved structure did
not preserve enough of the engine's `pricingEstimated` qualification, and the reviewer directed the fix
at the STRUCTURED boundary (never UI-only copy or duplicated constants).

- **`PricingAssumption` on every `CandidateEvaluation`** (schema.ts): `qualification`
  (`reference | indicative-commitment | indicative-spot | override`), `purchasingModel`,
  `onDemandBaseHourly`, `assumedDiscountPct`, `modeledEffectiveHourly`, `pricingEstimated`,
  `assumptionSource`. Every number is PRESERVED from the frozen engine —
  `GPU_COMMITMENT_DISCOUNT` / `effectiveGpuHourly` are imported from `lib/self-host.ts`, never
  duplicated; `pricingEstimated` is composed from the same two engine facts (`crossover.gpuPriceSource`,
  effective `gpuPricingModel`) as the engine's PRICING-018 state. Only the trusted on-demand book rate
  is an unqualified `reference`.
- **`CostComparator.pricingQualification`** persists the comparator candidate's qualification ON the
  decision; `costComparatorValid` gains the invariant that it EXACTLY matches the candidate's
  structured assumption (missing/mismatched → fail closed to neutral wording).
- **narrate()**: a non-reference lower-cost result is a qualified DIRECTIONAL planning result — "Under
  these assumptions, modeled self-host cost is lower: … Self-host pricing assumes a 30% one-year
  Savings Plan discount off the on-demand rate ($113.00/GPU-hour → $79.10/GPU-hour modeled planning
  rate) — an indicative planning factor, not an AWS quote." The base rate and modeled planning rate are
  rendered AS AN ASSUMPTION, never as a quoted effective rate. Reference (on-demand) narration is
  byte-identical to the approved wording. `PURCHASING_MODEL_LABELS` (schema.ts) is the single copy
  source for narrate() and the UI.
- **change-diff**: `pricingAssumption` joins the compile-time candidate coverage map
  (`pricing-changed`, candidate scope); the comparator payload carries the qualification.
- The decision itself is NOT suppressed — an indicative-commitment winner remains
  `self-host / lower-cost`, qualified structurally so no consumer can render it unqualified.

Tests: on-demand reference invariance (byte-identical narration, `reference` comparator), savings-1yr →
`indicative-commitment` with the engine's 30% factor and the honest decision flip, spot →
`indicative-spot` (65%), tampered comparator qualification → validator fails closed, purchasing-model
change → `pricing-changed` + `comparator-changed` diff events. Suite: 359/359 in this worktree.

### 10.12 Pricing-assumption integrity (re-review P1-PRICE-INT-1, reviewer-authorized)

The re-review showed the comparator integrity check verified only the QUALIFICATION while the
assumption's internal fields (discount %, base rate, modeled planning rate, source) could be tampered
and still be narrated as customer-facing fact. Fix: `lib/recommendation/pricing.ts` holds the ONE
canonical derivation `expectedPricingAssumption(servingFacts)` — recommend() now BUILDS the assumption
through it and the new shared `pricingAssumptionValid(evaluation)` CHECKS a presented assumption
against it (deep field-by-field reconciliation: finiteness/nonnegativity, purchasingModel ==
servingFacts.gpuPricingModel, base == servingFacts.gpuPricePerHr, discount == engine
GPU_COMMITMENT_DISCOUNT, modeled rate == engine effectiveGpuHourly, qualification/pricingEstimated/
assumptionSource match the derivation). Build and check share one code path, so they cannot drift; the
engine's factors remain imported, never duplicated. `costComparatorValid()` requires
`pricingAssumptionValid(candidate)` before any dollar winner or discount/rate claim is narrated — any
failed invariant fails closed to the neutral comparison-details-unavailable wording. Tamper tests cover
discount %, base rate, modeled rate, purchasing model, qualification, pricingEstimated,
assumptionSource, NaN and negative values, plus the exact 95%/$1 repro end-to-end through narrate();
the valid on-demand and commitment narrations are asserted unchanged. Suite: 364/364.
