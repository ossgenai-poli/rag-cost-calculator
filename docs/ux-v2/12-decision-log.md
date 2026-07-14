# 14. Decision log

Decisions made in Phase 0, alternatives considered, open questions for the owner/reviewers, risks,
and items deliberately deferred to later phases.

---

## Decisions made (Phase 0 design)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Single progressive page + persistent recommendation rail**, not a rigid wizard | Serves new SAs (top-down flow) without slowing experienced SAs (jump anywhere); rail keeps the answer one glance away |
| D2 | **GPU, precision, fleet count become recommendations/derived**, not entered inputs | These are the top guessing points (G1–G3); the engine already sizes them |
| D3 | **Two modes, one engine** — Simple hides inference; Expert exposes every lever via per-section Tune drawers | Matches audit requirement; no divergent math |
| D4 | **Four-type taxonomy** (Fact / Derived / Recommended / Expert) shown as visible chips | Makes "is this a customer fact or an assumption?" answerable at a glance |
| D5 | **Confidence beside the fleet**, with a structured "Where did this come from?" panel | The rc-qa-9/10 provenance exists; the fix is placement, not new data |
| D6 | **Ranked option set** (balanced / lowest-cost / highest-confidence / rejected-with-reasons), captioned "among modeled AWS configs" | Avoids the opaque single "best GPU"; shows the specialist the search space |
| D7 | **Presets preview + conflict + preserve-edits + explicit apply + undo** | No silent overwrites; presets set inputs, never hardcode outputs |
| D8 | **Unknowns via low/base/high**, with **two separate confidence channels** (evidence vs input) | Never block on a number; never conflate a firm input on a proxy benchmark with a range on a measured one |
| D9 | **Fixed result hierarchy** (recommendation → why → cost → arch → confidence → risks → evidence) | Matches a live customer conversation; export reads the same |
| D10 | **All customer narrative is a deterministic template over engine fields/reason codes** | Honors the traceability constraint; causation never inferred from value deltas |
| D11 | **Artifacts isolated on `ux/v2` under `docs/ux-v2/`**; engine/runtime untouched; no deploy | Honors the isolation requirements |

---

## Alternatives considered (and why not, for now)

- **Stepped wizard** — rejected (D1): blocks experienced SAs; a progressive page with anchors gives
  the guidance without the gate.
- **Full replace of the current UI immediately** — deferred: v2 ships behind a flag alongside
  `rc-qa-11` until three-reviewer promotion.
- **LLM-generated narrative** — rejected: must be deterministic and traceable; use a template over
  engine fields (the `fleet-explain`-style contract), not free generation.
- **Curated GPU shortlist only** — open (Q1): may be the pragmatic Phase-1 start vs a full sweep.

---

## Open questions for the owner / reviewers

| # | Question | Options |
|---|---|---|
| Q1 | **Recommendation sweep breadth** | (a) all modeled GPU families × {BF16,FP8,INT4} ranked; (b) curated shortlist per model first |
| Q2 | **Ranking priority order** | Confirm: feasibility → SLA → min-evidence → preference → cost. Or should cost lead once feasible? |
| Q3 | **Replace vs coexist** | Retire the current form after promotion, or keep it selectable long-term? |
| Q4 | **Preset overwrite default** | Confirm preserve-edited-fields-by-default (design assumes yes) |
| Q5 | **Phase-0 deliverable format** | This: markdown docs + one HTML wireframe artifact. Want higher-fidelity interactive wireframes or Figma-style mocks instead? |
| Q6 | **"Model class" vs specific model** | Should Simple mode let the SA pick a *class* (e.g. "large open-weights reasoning") and recommend the specific model, or always pick the exact model? |
| Q7 | **Minimum evidence threshold** | Is "extrapolated" the floor for a recommended option, with heuristic shown only below the line? |

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Recommendation sweep adds latency / cost per interaction | Phase 1 to measure; cache; consider shortlist (Q1) |
| R2 | Over-simplification hides a constraint a specialist needs | Expert mode + trust panel must expose everything; specialist review gates promotion |
| R3 | Determinism drift — a future narrative infers causation from deltas | Enforce the template-over-fields contract; add tests that narrative cites a field/reason code |
| R4 | Confidence chip over-trusted ("measured" ≠ "guaranteed") | Keep the INF-004 disclaimer beside every self-host recommendation |
| R5 | Preset/override interaction complexity confuses users | Usability pass in Phase 2; preview/undo reduce risk |
| R6 | Scope creep from "recommend everything" | Phase boundaries: Phase 0 design only; Phase 1 headless enablers with tests before any UI |

---

## Deliberately deferred to later phases

- **Recommendation-engine code** (GPU/precision sweep + ranking) → Phase 1, headless + unit-tested.
- **Narrative-generator code** (deterministic template over engine fields) → Phase 1.
- **Change-diff tracker** (reason-coded "what changed & why") → Phase 1.
- **Simple/Expert product components** → Phase 2.
- **Presets + unknown/range UI** → Phase 2/4.
- **Any extension of `fleet-explain.ts`** → not in Phase 0 (referenced as a future contract only).
- **Promotion / flag flip / deployment** → after three-reviewer sign-off.

---

## Phase 0 exit

Phase 0 is complete when the wireframe artifact + these docs are reviewed by all three personas.
**Do not begin Phase 1 without explicit approval.** Open questions Q1–Q7 should be resolved (or
consciously deferred) at that review.
