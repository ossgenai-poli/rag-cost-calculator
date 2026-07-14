# UX v2 — Phase 0 (Design)

**Status:** EXPERIMENTAL · design-only · not wired to the engine, not deployed.
**Branch:** `ux/v2` (from `rc-qa-11` = `d749309`). **Baseline engine is frozen for Phase 0.**
**Promotion gate:** requires sign-off from all three reviewer personas (new SA, generalist SA,
inference specialist) before any Phase 1 code.

## Why this exists

Today the calculator is a **technical configuration form that computes**. UX v2 reframes it as a
**customer-discovery and decision-explanation tool** an AWS Solution Architect can drive in a live
customer conversation.

> **Guiding principle:** Ask for business and workload truth → recommend infrastructure → expose
> engineering assumptions progressively → explain every recommendation in customer-ready language.

The engine built through `rc-qa-11` already computes almost everything we need to *explain*
(capacity source, provenance, prefill/decode, P99 TTFT, binding dimension, break-even, verdict,
`fleet-explain.ts` equation, reason codes). Phase 0 designs the experience on top of it; it does
**not** change the engine.

## The three people in the room

| Persona | Knows | Needs from the tool |
|---|---|---|
| **New SA (~1 yr)** | AWS + RAG basics | Guidance without external research; not to guess GPU internals |
| **Generalist SA (5–10 yr)** | Architecture + trade-offs | Fast defaults, easy overrides, side-by-side, a defensible explanation |
| **Inference specialist (15–25 yr)** | Serving internals | To trace every number to evidence and challenge it |

Simple mode serves the first two; Expert mode + the trust panel serve the third. **Both use the
same engine** — the only difference is who supplies the inputs.

## Deliverables (this folder)

| # | File | Deliverable |
|---|---|---|
| 1 | [01-journey-map.md](01-journey-map.md) | Customer journey map (decision → facts → experience → recommend → review → explain → compare → export) |
| 2 | [02-field-inventory.md](02-field-inventory.md) | Complete field inventory + taxonomy (fact / derived / recommended / expert) |
| 3 | [03-gpu-comprehension-matrix.md](03-gpu-comprehension-matrix.md) | GPU section: new-SA view / expert view / what the app recommends |
| 4 | [04-guessing-points.md](04-guessing-points.md) | Every place a customer/junior SA guesses or a default masquerades as fact |
| 5 | [05-copy-deck.md](05-copy-deck.md) | Labels, helper text, tooltips, warnings, confidence + auto-size + recommendation copy |
| 6–7 | [wireframes.html](wireframes.html) | Simple-mode + Expert-mode wireframes (visual artifact) |
| 8 | [06-recommendation-presentation.md](06-recommendation-presentation.md) | Ranked options (balanced / lowest-cost / highest-confidence / rejected) |
| 9 | [07-presets.md](07-presets.md) | Experience + operational presets, preview/conflict/undo, no silent overwrite |
| 10 | [08-unknown-range-handling.md](08-unknown-range-handling.md) | "I don't know" / low-base-high ranges → confidence effect |
| 11 | [09-trust-provenance.md](09-trust-provenance.md) | Confidence ladder + "Where did this come from?" panel |
| 12 | [10-result-hierarchy.md](10-result-hierarchy.md) | Customer-ready result order (recommendation → why → cost → arch → confidence → risks → evidence) |
| 13 | [11-meeting-scripts.md](11-meeting-scripts.md) | Before/after scripts for junior SA + specialist challenge |
| 14 | [12-decision-log.md](12-decision-log.md) | Decisions, alternatives, Q1–Q7 (resolved), risks, deferred items |

### Revision round (design review HOLD → these additions)

| File | Deliverable |
|---|---|
| [13-catalog-architecture.md](13-catalog-architecture.md) | Five separate concerns (registry · catalog · feasibility · evidence · recommendation); AVAILABLE≠COMPATIBLE≠BENCHMARKED≠PRICED≠RECOMMENDED |
| [14-hardware-registry.md](14-hardware-registry.md) | Initial hardware research table (H100→B300/GB200/GB300, real AWS sources) + availability contract + inclusion criteria |
| [15-model-catalog.md](15-model-catalog.md) | Curated model table + selection criteria + record schema |
| [16-evidence-pricing-contracts.md](16-evidence-pricing-contracts.md) | Evidence states + pricing states + source/provenance policy |
| [17-quality-gate.md](17-quality-gate.md) | Practical-feasibility filter + rejection reasons + customer-facing quality gate |
| [18-reference-cases.md](18-reference-cases.md) | Every structural number, computed on the frozen rc-qa-11 engine (anchors P1-UX-001/002) |

**Product intent (this round):** *Production-quality decision support with intentionally curated model
and hardware coverage.* **Curated breadth · production-grade depth · no invented coverage.** On the
frozen evidence that resolves honestly to **B200 only** and **2 primary models** — see
[18-reference-cases.md](18-reference-cases.md). P1-UX-001/002/003 and P2-1…6 resolutions are logged in
[12-decision-log.md](12-decision-log.md).

## Hard constraints honored in this design

- **Determinism & traceability:** every customer-facing explanation must map to a **structured
  engine field or reason code** — never inferred from before/after values. (Causation is never read
  from a delta.)
- **Auto-sized fleet is a *derived* result; manual fleet is an *explicit expert override*.**
- **Simple and Expert modes share one engine.**
- **No automatic change is silent** — every derived change shows what changed and which input drove it.
- Phase 0 adds **no** recommendation-engine code, **no** narrative-generator code, **no** product
  components, **no** deployment. `fleet-explain.ts` is referenced as a *future* structured-explanation
  contract but is **not** extended here.

## How to review

1. Open [wireframes.html](wireframes.html) (or the published Artifact link in the handoff) — this is
   the visual spine. Toggle Simple ↔ Expert.
2. Read [12-decision-log.md](12-decision-log.md) for the open decisions that need owner input.
3. Each persona reviews against their row in the table above and the [11-meeting-scripts.md](11-meeting-scripts.md).

**Test engineer:** follow [REVIEW-INSTRUCTIONS.md](REVIEW-INSTRUCTIONS.md) — this is a **design-artifact
review**, not a functional test. It has the isolation/safety invariants, the engine-fidelity
cross-check, the completeness checklist, and the persona-review protocol + scoring.
