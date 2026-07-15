# 12. Customer-ready result hierarchy

Results are presented in the order a customer conversation actually flows — decision first, evidence
last. This is the order of the recommendation rail, the Stage-F panel, and the exported report.

Every element maps to an engine field; nothing is authored narrative that can drift from the numbers.

---

## The seven levels (top to bottom)

### 1. Recommendation
The one-line verdict: **API · Self-host · Inconclusive**, with the confidence chip beside it.
> "Calling the API is cheaper today." / "Self-hosting is the better economic choice at this volume." /
> "Too close to call — validate before deciding."
Source: `verdict`, `verdictQualified`, `capacity.source`.

### 2. Why
The 1–3 drivers behind the verdict, in plain terms.
> "You're below the break-even volume." · "This workload is prefill-bound, so the fleet is large." ·
> "The API model is priced low relative to GPU hours."
Source: break-even (`breakEvenTokens`, `equivalentQPS`), `bindingDim`, the dominant sensitivity lever
(top row of `computeSensitivity`), cost split. **Deterministic — named fields, not inferred causation.**

### 3. Estimated cost
Monthly · annual · per-query, for the recommended side, with the other side beside it.
> "≈ $X,XXX,XXX/mo · $XX.XM/yr · $0.0123/query (self-host) vs $XXX,XXX/mo (API)."
Source: `selfHostedMonthly$`, `apiMonthly$`, derived per-query.

### 4. Recommended architecture
Model · GPU · fleet, with the reconciled fleet equation available on expand.
> "DeepSeek-V4-Pro · p6-b200 · INT4 · 87 instances (86 for throughput + 1 N+1, 1 box/replica)."
Source: `fleet-explain` equation, topology fields.

### 5. Confidence
The ladder chip + one line, with "Where did this come from?" to expand.
> "Extrapolated — measured at 1,024 tokens, scaled to your 2,910-token input."
Source: `capacity.source` + reasons + `prefillIslScale` (see [09-trust-provenance.md](09-trust-provenance.md)).

### 6. Risks & exclusions
What the estimate does **not** cover, and what to validate. Deterministic checklist assembled from
active engine flags:
- N+1 is serving-replica redundancy only — **not AZ / quota / DR / full HA**.
- Planning capacity, not an availability or tail-latency guarantee (INF-004 disclaimer).
- If `verdictQualified`: the specific reason (non-measured capacity / scaled prefill / overridden price).
- If heuristic: the prefill uncertainty band and "validate input throughput."
- Ops/networking/observability/overhead assumptions used.
- Purchasing discounts are indicative — get an AWS quote.
- Quota/capacity for {n} × {GPU} not verified.
- "Before purchasing, load-test the intended serving stack under production-shaped traffic."

### 7. Advanced evidence *(collapsed)*
For the specialist: the benchmark operating point, the memory/throughput math, the full fleet
equation, the sensitivity table, and the raw provenance. Source: existing capacity/crossover fields
and exports.

---

## Layout note

Levels 1–3 are always visible (the rail + headline). 4–5 are one glance below. 6 is a labeled block.
7 is collapsed by default. A junior SA reads 1–3 aloud; a specialist drills into 6–7.

## Rules

- **Order is fixed** — recommendation before cost before architecture before evidence. Never lead with
  the GPU table.
- **Every level is engine-sourced.** The customer narrative is a deterministic template over named
  fields (the future narrative-generator contract; Phase 0 does not build it).
- **Confidence travels with the recommendation** at every level and into the export.
- The export reproduces this exact order so a reviewer who wasn't in the room reads it the same way.
