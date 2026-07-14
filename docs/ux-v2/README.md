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
| 14 | [12-decision-log.md](12-decision-log.md) | Decisions, alternatives, open questions, risks, deferred items |

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
