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

## Q1–Q7 — RESOLVED (owner positions, this review) → design updated accordingly

| # | Question | Owner position (adopted) | Where reflected |
|---|---|---|---|
| Q1 | Recommendation breadth | **Curated, model-specific, evidence-qualified shortlist.** Maintain an internal research registry; do **not** expose unsupported breadth. | [13](13-catalog-architecture.md), [14](14-hardware-registry.md), [15](15-model-catalog.md), [06](06-recommendation-presentation.md) |
| Q2 | Ranking order | **Feasibility → SLA → evidence threshold → customer preference → cost.** | [06](06-recommendation-presentation.md) ranking contract |
| Q3 | Replace vs coexist | **Experimental flag** until parity + usability review + three-reviewer sign-off; retire the old experience only after promotion approval. | this log D14; README status |
| Q4 | Preset overwrite | **Preserve edited fields by default;** explicit **Apply All** + **Undo**. | [07](07-presets.md) |
| Q5 | Phase-0 format | **Markdown + a self-contained HTML artifact** — sufficient **once the preview is independently accessible** (addressed this round). | README, wireframe hosting |
| Q6 | Model class vs exact | **Allow optional model-class discovery, but resolve to an exact supported model before calculating** capacity/cost. | [15](15-model-catalog.md), [01](01-journey-map.md) |
| Q7 | Minimum evidence | **Measured-exact or a defensible measured-scaled/extrapolated path** may support a **qualified primary** recommendation. **Proxy & heuristic never primary** — below the line or omitted from Simple. | [16](16-evidence-pricing-contracts.md), [06](06-recommendation-presentation.md), [17](17-quality-gate.md) |

## New decisions this round (HOLD → revision)

| # | Decision | Rationale |
|---|---|---|
| D12 | **Five separate concerns** (research registry · supported catalog · compatibility/feasibility · evidence · recommendation), never a hardcoded GPU list or per-model conditionals | [13](13-catalog-architecture.md) |
| D13 | **AVAILABLE ≠ COMPATIBLE ≠ BENCHMARKED ≠ PRICED ≠ RECOMMENDED** surfaced as distinct states | [13](13-catalog-architecture.md) |
| D14 | **Curated coverage is honestly tiny on frozen evidence:** B200 only; 2 primary models (DeepSeek-V4-Pro, MiniMax-M3) + GLM-5.2 proxy (Expert). Nemotron/Kimi/H200/H100/B300/GB200 excluded — no invented coverage | [15](15-model-catalog.md), [18](18-reference-cases.md) |
| D15 | **Availability + pricing + evidence + source contracts** with explicit states; assumptions never presented as AWS/market fact | [14](14-hardware-registry.md), [16](16-evidence-pricing-contracts.md) |
| D16 | **Every structural number is a reference case** computed on rc-qa-11; scripts/wireframe/cards cite them | [18](18-reference-cases.md) |
| D17 | **No silent context truncation** — 3-branch rule (infeasible / reduced-headroom / needed+headroom) | [03](03-gpu-comprehension-matrix.md) |
| D18 | **Taxonomy formalized to four classes** + orthogonal *Scope* and *External (provenanced)* concepts; per-field chips | [02](02-field-inventory.md) |

## P1 / P2 resolutions (this review)

- **P1-UX-001** — scripts use one documented input set (R1/R5); numbers reconcile → [11](11-meeting-scripts.md), [18](18-reference-cases.md).
- **P1-UX-002** — invented "measured/proxy" alternatives removed; DeepSeek is evidence-qualified on **B200 FP4 only**; FP8 = substituted (extrapolated), H200/H100 = heuristic (excluded) → [06](06-recommendation-presentation.md), [18](18-reference-cases.md).
- **P1-UX-003** — 3-branch context rule, no silent truncation → [03](03-gpu-comprehension-matrix.md).
- **P2-1** P99 language; **P2-2** taxonomy normalized + per-field chips; **P2-3** "Context chunks sent to the model" + citations-vs-chunks helper; **P2-4** GPU price as External/provenanced (not a Fact); **P2-5** "Largest modeled range effect" (serialized, sensitivity not delta-causation); **P2-6** "24×7 regulated" → "24×7 high-availability posture" + review-still-required banner.

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

- **Catalog/registry data layer** (hardware, models, evidence, price/availability states) → Phase 1, headless + tested.
- **Compatibility & practical-feasibility filter** (with reason codes) → Phase 1.
- **Recommendation sweep + ranking** → Phase 1, unit-tested per eligibility/rejection/confidence transition.
- **Deterministic structured narrative** (template over engine fields) + **reason-coded change tracker** → Phase 1.
- **Simple/Expert product components** → Phase 2.
- **Presets + unknown/range UI** → Phase 2/4.
- **Any extension of `fleet-explain.ts`** → not in Phase 0 (referenced as a future contract only).
- **Promotion / flag flip / deployment** → after three-reviewer sign-off; no merge to main / Vercel until later.

Phase 1 lives on a **separate `ux/v2-phase1` branch** cut from the approved UX commit (owner directive).

---

## Phase 0 exit

Phase 0 is complete when these docs + the (independently accessible) wireframe are approved by all three
personas. Q1–Q7 are **resolved** (owner positions above) and the P1/P2 findings addressed. **Do not begin
Phase 1 (or create `ux/v2-phase1`) without an explicit verdict change from HOLD.**
