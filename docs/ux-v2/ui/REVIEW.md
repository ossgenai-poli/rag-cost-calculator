# UI slice review — /advisor (vertical slice, revision 3 after UI HOLD-2)

## UI HOLD-2 fixes in this revision

| Finding | Fix |
|---|---|
| **P1-UI-4** API-only page internally contradictory (availability note vs "technically feasible" narrative) | Resolved at the ROOT via the reviewer-authorized **narrow headless revision** (`ux/v2-phase1 @ 39a8a1a`, DESIGN §10.10): `DecisionBasis` gains **`self-host-unavailable`** with `availability: { reason: "api-only" \| "weights-unavailable" }`, derived from the trusted model-catalog `selfHostable` fact BEFORE any technical candidate feasibility; `self-host-infeasible` is reserved for genuine capacity/memory/topology failures; `narrate()` produces "This model is available through the API only; self-host weights are not available, so no self-host cost comparison was performed." and never uses "technically (in)feasible" for this state. `ux/v2-ui` is REBASED onto that revision; the UI now simply maps the structured basis (the earlier cosmetic clarification is removed — nothing is suppressed or rewritten). Contract, sweep, narrative and UI acceptance tests prove the states cannot be conflated (including a page-wide `not.toMatch(/technically\s+(in)?feasible/i)` for the API-only state, and the reverse for genuine infeasibility). |
| **P3-A11Y** banner sentences concatenated | The generic error and "Showing the last valid result below." render as separate `<p>` blocks — accessible text no longer concatenates. |

**Branch:** `ux/v2-ui` (from the approved complete headless baseline `ux/v2-phase1 @ e938c5d`).
**Scope:** customer input journey · Simple/Expert mode · bounded decision summary · best-self-host +
availability/rejection states · trust/provenance panel · structured adjustments · deterministic
narrative rendering. **Not in scope:** merge, deploy, replacing the calculator at `/`, alternatives
cards, presets, exports.

## UI HOLD-1 fixes in this revision

| Finding | Fix |
|---|---|
| **P1-UI-1** hero more authoritative than visible assumptions | Hero is now a BOUNDED conclusion per `decision.basis` ("Lowest modeled cost: API", "Directional cost result: undetermined", "API — no evidence-qualified self-host option", …). A prominent amber disclosure — "Different models are being compared; capability and quality are not normalized." — sits adjacent whenever `apiOption.modelId ≠ workload model`. Workload scale, the input-token formula (query + prompt + TopN×chunk), output tokens, both monthly costs, the **modeled difference** (absolute + % — labeled presentation arithmetic over the two structured amounts) and the evidence chip are all immediately visible in BOTH modes. Simple mode keeps the collapsed "Evidence & assumptions" disclosure (owner D1); rejected candidates stay Expert-only. |
| **P1-UI-2** API-only misclassified as technical infeasibility | Availability (weights/rights) is a DISTINCT state: hero, cost row, empty card, dropdown grouping (owner D4) and disabled self-host controls. **Superseded by UI HOLD-2 / P1-UI-4:** availability is now a first-class reason-coded headless basis (`self-host-unavailable`) — see the HOLD-2 table above. |
| **P1-UI-3** mobile overflow (multi-adjustment state) | The adjustments table was replaced with WRAP-SAFE stacked rows (no `<table>`, `break-words`/`break-all`, wrapping value line). New acceptance test `scripts/verify-advisor-mobile.mjs`: at 375×812 it drives Top N=30/Top K=20/uptime=1000 (multiple adjustment rows) and asserts `document.documentElement.scrollWidth ≤ window.innerWidth` and zero console errors — **PASS** (scrollWidth 375 ≤ 375). The earlier review claim of "no horizontal scroll" was false for this state and is corrected by this fix + test. |
| **P2-UI-1** raw contract errors customer-visible | Boundary-validator messages map through `components/advisor/copy.ts` to field-level customer wording ("Enter a number greater than 0.") with `aria-invalid` + `aria-describedby`; internal property paths never render. Numeric fields keep a local draft and COMMIT ON BLUR/Enter; the **last valid result stays on screen** while editing, with a "showing the last valid result" note (owner D6). |
| **P2-UI-2** concatenated accessible heading names | Basis chip and the "secondary…" annotation are SIBLINGS of their headings; `<h2>` accessible names are now exactly "Lowest modeled cost: API" / "Best self-host option" (asserted in tests). |
| **P2-UI-3** expert inputs lack decision support | Every expert field shows units, recommended default, one-line "why it matters" (shared copy contract `copy.ts` — owner D3), and an entered-vs-default provenance tag ("assumed (default)" / "customer-entered"). |
| **P2-ARCH-1** | Recorded: the browser sha256 shim (test-verified parity) passes for this isolated slice, but Phase-2 should move pinned-artifact verification to build-time/server-side so the browser shim never becomes the permanent trust boundary. |

Owner decisions D1–D7 are implemented as directed (D2: the Unbenchmarked chip is titled "no qualified
evidence — not a confidence level"; D5: pinned reference pricing retained and provenance-labelled; D7:
light scheme pinned for isolated review, shared theme tokens deferred to production).

## Local review

```
cd <worktree>                                # ux/v2-ui
npm run dev                                  # open http://localhost:3000/advisor ("/" untouched)
npx vitest run                               # 374 = 351 headless (incl. HOLD-2 revision) + 19 advisor + 4 crypto-shim
npx tsc --noEmit                             # clean
node scripts/verify-advisor-mobile.mjs       # 375px multi-adjustment overflow acceptance (APP_URL env to point elsewhere)
```

Walkthrough (defaults = the R1 canonical reference workload; all numbers are approved output):
1. **Simple** — bounded hero "Lowest modeled cost: API" + basis chip; cross-model disclosure; API
   $6,492,000/mo vs self-host $7,176,630/mo; modeled difference +$684,630/mo (11% vs API); assumptions
   row (200,000,000 questions/mo · 50+300+5×512 = 2,910 input tok · 500 output tok · Measured·scaled);
   secondary best-self-host card; collapsed "Evidence & assumptions".
2. **Expert** — SLA/workload inputs with units/defaults/why/provenance tags; "Rejected options (3)";
   the trust panel expanded shows pricing provenance, per-config evidence chips, P99 tail-statistic
   wording, planning disclaimer.
3. **Experimental toggle** — basis `evidence-gap`, all chips Unbenchmarked, honest empty self-host
   state, internal-limitation wording. No GPU promoted.
4. **Model = Claude Opus 4.8 (API-only group)** — availability state everywhere; uptime/experimental
   disabled. **Model = MiniMax M3** — coverage-gap wording. **TTFT 100ms** — B200 rejected
   `sla-unmet-ttft-or-streaming`.
5. **Top N 30 / Top K 20, uptime 1000 (or 0)** — stacked amber adjustment rows (9→…, 1000→730, 0→730)
   with raw field paths; wrap-safe at 375px (see acceptance script).
6. Invalid input (volume −1) — friendly field error + red banner "Please correct: Questions per
   month." while the **last valid result remains rendered**.

## Every displayed value → its structured source field

| UI element | Source (structured result) |
|---|---|
| Bounded hero | mapping table over `decision.choice`/`decision.basis` (+ price-book `selfHostable` for the API-only state) |
| Basis chip | `decision.basis` |
| Cross-model disclosure | rendered iff `apiOption.modelId !== effectiveWorkload.generation.llmModelId` |
| Availability note/state | price-book `ModelPrice.selfHostable` (a catalog fact, not an inference) |
| Rationale paragraph | `decision.rationale` (narrate(); verbatim) |
| API cost + label | `apiOption.monthlyCost` / `apiOption.modelLabel` |
| Best self-host cost + label | `bestSelfHost.costMonthly` / `selfHostModelLabel` |
| Modeled difference | labeled presentation arithmetic: `bestSelfHost.costMonthly − apiOption.monthlyCost` (+% vs API); "n/a" when either side is absent |
| Assumptions row | `effectiveWorkload.traffic.queriesPerMonth`, `queryTokens`, `generation.promptOverhead`, `retrieval.topN`, `chunking.chunkSize`, `generation.outTokens` (input-token sum = the documented deterministic formula) |
| Evidence chip | `bestSelfHost.confidence` (exact token) / "no qualified self-host evidence" when null |
| Card facts / fleet / equation / trade-off | `evaluations[].servingFacts.*`, `.fleet.*`, `bestSelfHost.bindingConstraint` / `.tradeoff` (narrate(), verbatim) |
| Empty self-host explanations | `decision.basis` branch + availability (coded states; no invented text) |
| Rejected rows | `rejected[].{config.label,code,message}` + `evaluations[].{effectiveConfidence,technicallyFeasible,slaQualified,evidenceQualified}` |
| Trust panel | `pricing.{source,asOf,region,gpuPriceSource}`, `evaluations[].{engineConfidence,effectiveConfidence,ttftS,ttftPercentile,registry.status}` |
| Adjustment rows | `inputAdjustments[].{field,entered,calculated}` (labels from the shared copy contract; raw path shown) |
| Field errors / banner | boundary-validator message → `copy.ts` customer wording (internal paths never rendered) |

Components consume ONLY `lib/recommendation/index.ts` (`recommend` → `narrate`); no number, evidence
state, explanation or recommendation is authored in a component.

## Build-integration note (reviewed change outside `components/app`)

The frozen registry's `hash.ts` imports `node:crypto`; `next.config.mjs` replaces it — client bundles
only — with `lib/browser-shims/node-crypto.ts`, proven byte-identical to node:crypto in tests
(edge cases + the REAL pinned snapshot + manifest checksums). Server/SSR/tests keep real node:crypto;
the frozen registry is untouched. **P2-ARCH-1 (Phase-2):** prefer build-time/server-side verification of
pinned benchmark artifacts; the browser shim must not become the permanent trust boundary.
`vitest.config.ts` gained the oxc JSX transform + `@/` alias for the `.tsx` component tests (approved
`.ts` suites unaffected — full baseline green).

## Remaining open items for owner/UX

- ~~Availability-aware decision basis~~ — DONE in the HOLD-2 narrow headless revision (`39a8a1a`).
- Phase-2: consolidate narrate()'s internal label map with the UI copy contract when the headless layer
  next opens for approved changes (owner D3 is implemented UI-side).
- Production theming via shared tokens (owner D7).
- Live pricing wiring with explicit source/state (owner D5).
- P2-ARCH-1: build-time/server-side pinned-artifact verification (browser shim must not become the
  permanent trust boundary).

---

# Iteration 2 — presets · change tracking · alternatives (`ux/v2-ui-2`)

**Branch:** `ux/v2-ui-2` (child of the immutable approved `ux/v2-ui @ f02b51f`; headless baseline
`ux/v2-phase1 @ 39a8a1a` unchanged). New files only: `presets.ts`, `PresetBar.tsx`, `ChangesPanel.tsx`,
`AlternativeCards.tsx`, `advisor2.test.tsx` (+ page wiring). Frozen surfaces byte-identical; the
calculator at `/`, main and workflows untouched; no merge/deploy.

## What this iteration adds (Phase-0 journey pieces)

1. **Response-experience presets (07-presets.md, family A / Stage C).** Four declarative INPUT bundles
   (Conversational · Interactive RAG · Analyst/research · Batch) seeding `ttftTargetMs` +
   `interactivityTarget` only — a preset never hardcodes an output. Full documented contract: preview of
   exactly which fields change (old → new, "no change" greyed), conflicts with SA-edited fields default
   to KEEP, explicit "Apply all", single Undo restoring the exact pre-apply state (+ "Reverted …" toast),
   active chip "Preset (n fields kept)". Family B (operational profiles) is deferred — it needs
   utilization/N+1/purchasing in the journey state (**UI2-D2**).
2. **"What changed" panel.** On every committed input change, the APPROVED structured
   `diffRecommendations(previousResult, nextResult)` renders reason-coded rows verbatim
   (`code · field · before → after`); object values defer to the structured audit rather than being
   summarized in invented language. StrictMode-safe (refs committed in effects). Live example: applying
   Conversational (1 s TTFT) honestly flips the decision to `api (evidence-gap)` — B200 misses the SLA —
   and the panel reports `decision-changed api (lower-cost) → api (evidence-gap)` plus the
   gate/fleet/cost rows.
3. **Alternatives cards (06 cards 2–3).** Renders `alternatives[]` (lowest-cost / highest-confidence /
   lowest-latency) with config, chip, cost + Δ-vs-best, trade-off — only when the headless layer produced
   a DISTINCT candidate. With today's pinned catalog this is an HONEST "none — single distinct
   configuration" note (the R1 worked example); populated rendering is covered by structured-fixture
   tests.

## Value → source (new elements)

| UI element | Source |
|---|---|
| Preset preview rows | pure input comparison `computePreview(current, defaults, bundle)` — never an engine re-run |
| Active chip / kept count | `applyPreset` result (fields kept = conflicts resolved to the SA's value) |
| What-changed rows | `diffRecommendations(prev, next).changes[]` verbatim (`code`, `field`, `candidateId`, `before → after`) |
| Alternative cards | `alternatives[].{kind, config.label, confidence, costMonthly, costDeltaVsBest, tradeoff}` |

## Tests & verification

- `advisor2.test.tsx` (11): preview/no-change/conflict semantics; conflicts KEPT by default; explicit
  opt-in uses the preset value; undo snapshot exactness; presets-set-inputs-not-outputs (engine still
  derives the fleet); ChangesPanel renders R1→R5 `fleet 87 → 4` + cost rows and control→experimental
  decision/evidence rows verbatim, empty for identical/no diff; alternatives honest-empty at R1,
  structured-fixture card rendering, hidden without a primary.
- Totals: **385/385** (374 approved baselines + 11), `tsc --noEmit` clean, **375px mobile acceptance
  PASS** (multi-adjustment state re-verified).
- Live clean-browser probe (headless Chrome, fresh profile): preview → apply → active chip →
  what-changed (23 reason-coded rows) → undo toast, **zero console errors**.
- Dev-server hygiene note: two occurrences of a corrupted `.next` dev cache (core chunks 404 → no
  hydration) were fixed with `rm -rf .next` + restart; not a code defect (clean-profile probes pass).

## Open items for owner/UX review

- **UI2-D1** Preset bundle VALUES (1000/50 · 2000/30 · 5000/15 · 30000/5) are proposed planning inputs
  mapped from the doc's qualitative rows — confirm or adjust.
- **UI2-D2** Family B operational profiles (utilization/N+1/uptime/purchasing) need those fields in the
  journey state — next iteration candidate.
- **UI2-D3** What-changed verbosity: the full reason-coded list can be long (23 rows on an SLA flip);
  consider grouping by candidate or a "top changes" summary in a later pass.

## Iteration-2 HOLD remediation (revision 2 of this iteration)

| Finding | Fix |
|---|---|
| **P1-UI2-1** preset provenance inferred from values | EXPLICIT per-field origin (`default \| manual \| preset:<id>`) is stored with state (`presets.ts` pure transitions; page owns `PresetProvenance`). Conflicts arise ONLY from `manual` origin — fields written by a previous preset switch normally (repro A: Strict-conversational → Analyst previews ZERO conflicts and applies without opt-ins, live-verified). A manual edit after apply flips the chip to "Modified from <preset>" and INVALIDATES Undo (repro B: live-verified — Undo control removed); safe Undo restores the exact pre-apply state AND origins. Acceptance tests: preset→preset switching, manual-conflict-only, preset→manual chip/undo invalidation, safe-undo exactness. |
| **P1-UI2-2** Batch not representable by the interactive SLA contract | **Batch removed** from the bundle set (owner position) — to return only with a structured non-interactive/throughput objective, never by loosening interactive SLA values. Conversational retained as **"Strict conversational target"**, described as an aggressive CUSTOMER TARGET, not a universal recommendation. Interactive RAG + Analyst retained per owner. Test pins the exact bundle set + wording. |
| **P2-UI2-1** inaccurate preview/action wording | Dynamic header: "«Preset» proposes N difference(s): X selected to change, Y kept." (live: "proposes 2 differences: 2 selected to change, 0 kept"). Actions: **"Apply selected changes"** (honors per-field choices) + a distinct **"Use all preset values"** override shown only when conflicts exist. `previewCounts` unit-tested for kept/selected splits. |
| **P2-UI2-2** 23-row change list needs a customer summary | `change-summary.ts`: a compact (≤6 item) impact summary derived DETERMINISTICALLY from decision/gate/rejection/confidence/fleet/cost change codes, with the complete reason-coded audit under a collapsed "View all N technical changes". Canonical strict-conversational case (live + test): decision `api (lower-cost) → api (evidence-gap) — no SLA-compatible configuration has qualifying evidence`; both measured B200 configs `now fail the selected SLA (rejection: sla-unmet-ttft-or-streaming)`; `Best self-host option removed`; material fleet/cost rows (best-self-host candidate prioritized so the cap never truncates the decision-relevant facts). |

Live clean-browser probe after remediation: apply → accurate header → chip+Undo → summary+audit →
preset→preset (0 conflicts) → manual edit → "Modified from …" + Undo removed. Zero console errors.
Totals: **385/385**, tsc clean, 375px mobile acceptance PASS. (Dev note: `.next` cache corruption
recurred once more under HMR churn; `rm -rf .next` + restart resolves it — clean-profile probes green.)

## Iteration-2 HOLD-2 remediation (summary presentation only)

| Finding | Fix |
|---|---|
| **P2-UI2-3** canonical summary truncated the cost impact | `summarizeChanges` now RESERVES slots by category (decision · aggregated SLA/evidence consequence · best-self-host · relevant-candidate fleet · relevant-candidate cost · evidence/other) — never "append all and slice". Identical multi-candidate SLA failures aggregate into ONE slot ("Both modeled p6-b200.48xlarge configurations now fail the selected SLA…"); only the most decision-relevant candidate's fleet and cost rows take slots (others stay in the audit). Canonical live/test output: decision → evidence-gap with meaning · aggregated SLA line · best-self-host removed · Fleet 87 → 131 · **Self-host cost $7,176,630 → $10,806,190/mo** · evidence state measured-scaled → extrapolated — ≤6 items, "View all 23 technical changes" audit intact. |
| **P2-UI2-4** valid diffs could render an empty summary | A non-identical diff can never yield an empty list: a workload-assumptions-only diff (e.g. TTFT 5000→4500 with no modeled outcome change) renders the deterministic sentence "Workload assumptions changed; the modeled decision, qualification, fleet, and cost did not change." (derived from effective-workload-changed present + no outcome codes); any other outcome-less diff renders "No material modeled outcome changed." Test proves the fallback invents no decision/fleet/cost text and the raw change stays under "View all 1 technical changes". |

---

# Iteration 3 — journey-state contract + family-B operational profiles (`ux/v2-ui-3`)

**Branch:** `ux/v2-ui-3` (child of the immutable approved `ux/v2-ui-2 @ 7fdee3d`). Frozen baselines,
the calculator at `/`, main and workflows untouched; no merge/deploy.

## 1. Structured journey-state contract FIRST (owner directive)

Utilization, redundancy and purchasing are REAL engine inputs, never presentation-only preset state:

| Journey field | Engine input | Engine effect (verified via real outcomes) |
|---|---|---|
| `utilTargetPct` (%) | `generation.utilTarget` (fraction) | fleet sizing headroom — 85% shrinks the R1 fleet below 87 boxes |
| `haEnabled` | `generation.haEnabled` | N+1 spare replica — off: 87 → 86 boxes (engine-derived) |
| `purchasingModel` | `generation.gpuPricingModel` | indicative commitment discount — savings-1yr: $7,176,630 → $5,023,641/mo and the decision honestly flips to `self-host / lower-cost` |

Expert "Operations & purchasing" controls carry decision support (units/defaults/why + provenance
tags), the N+1 help states it is NOT AZ/DR/compliance, the purchasing select is labeled INDICATIVE, and
all three are disabled for API-only models. Boundary validation maps `utilTarget`/`gpuPricingModel`
failures to friendly field errors. Defaults (70% · N+1 on · on-demand) preserve the approved R1 output
exactly. Serving facts stay honest: the base on-demand rate + purchasing model (never a fake
"effective rate").

## 2. Family-B operational profiles (07-presets §B) over the APPROVED provenance machinery

Six profiles (Prototype · Production—balanced · Latency-sensitive · Cost-optimized · Business-hours ·
24×7 high-availability posture) as declarative INPUT bundles over the new journey fields. The approved
iteration-2 semantics are unchanged, generalized to mixed-type fields (booleans render on/off) and TWO
families: per-family active chips (A and B coexist), manual edits mark only the owning family
"Modified from …" and invalidate the single Undo, B→B switching produces zero conflicts. The HA-posture
profile shows its persistent banner while active (including after later manual edits): "Architecture,
security, quota and compliance review are still required — this preset does not deliver them." (renamed
from "regulated" per Phase-0 P2-6). Operational profiles are disabled for API-only models.

## Verification

- `advisor3.test.tsx` (13): contract mapping + engine outcomes (R1 invariance, 87→86 N+1, 85% shrink,
  savings-1yr economics + honest decision flip, fail-closed invalid ops inputs), profile set/values,
  mixed-type preview, family independence, B→B zero conflicts, persistent banner, API-only disabling,
  a11y/decision support. Totals: **399/399**, tsc clean, **375px mobile acceptance PASS**.
- Live clean-browser probe (zero console errors): Cost-optimized → hero flips to "Lowest modeled cost:
  Self-host" at $4,157,496/mo (85% util + indicative savings, engine-derived); A+B chips coexist;
  HA-posture banner verbatim.

## Open items for owner/UX review

- **UI3-D1** "Business hours" = 220 h/mo (10 h × 22 days) — a proposed planning input; confirm or adjust.
- **UI3-D2** Cost-optimized uses `savings-1yr` as the indicative committed-pricing stand-in (07 says
  "indicative RI/Savings"); confirm or prefer `reserved-1yr`.
- **UI3-D3** The savings-driven decision flip is honest engine output; consider whether the hero should
  carry an "indicative pricing" qualifier when `purchasingModel ≠ on-demand` (crossover already marks
  `pricingEstimated`).

## Iteration-3 HOLD remediation (structured pricing qualification + suspension semantics)

### P1-UI3-1 — an indicative discount can never render an unqualified recommendation
Fixed at the STRUCTURED boundary via the narrowly authorized headless revision (`ux/v2-phase1`,
DESIGN §10.11): every `CandidateEvaluation` carries a `PricingAssumption`
(`qualification: reference | indicative-commitment | indicative-spot | override`, `purchasingModel`,
`onDemandBaseHourly`, `assumedDiscountPct`, `modeledEffectiveHourly`, `pricingEstimated`,
`assumptionSource`) PRESERVED from the engine's own factors (`GPU_COMMITMENT_DISCOUNT` /
`effectiveGpuHourly` imported from `lib/self-host.ts` — never duplicated in a component);
`CostComparator.pricingQualification` persists the comparator candidate's qualification on the decision,
with a new fail-closed `costComparatorValid` invariant. Presentation, when the qualification is
non-reference:
- **Hero**: "Indicative modeled cost: Self-host" (UI3-D3 — mandatory whenever purchasing ≠ on-demand
  influenced the comparison).
- **Prominent adjacent disclosure**: "This result assumes a 30% one-year Savings Plan discount and 85%
  fleet utilization. It is a planning scenario, not an AWS quote." — discount/utilization rendered from
  the structured `PricingAssumption` + `servingFacts` of the comparator candidate.
- **Rate as an assumption**: "$113.00/GPU-hour on-demand base rate × (1 − 30%) = $79.10/GPU-hour modeled
  planning rate — an assumption, not a quoted effective rate."
- **Narrative** (headless): "Recommendation: self-host (directional planning result). Under these
  assumptions, modeled self-host cost is lower: … Self-host pricing assumes a 30% one-year Savings Plan
  discount off the on-demand rate … — an indicative planning factor, not an AWS quote."
- **Change summary**: "a modeled cost comparison decided it" — "trustworthy" is reserved for the
  `reference` qualification and unreadable qualifications fail closed to "modeled".
The decision itself remains `self-host / lower-cost` (qualified directional result, not suppressed).
On-demand behavior is byte-identical (hero, narration, summary, comparator `reference`).

### P1-UI3-2 — profile suspension for API-only models
Applicability is now explicit: for a self-hostable model the profile is ACTIVE (chip, banner, Undo);
for an API-only model it is SUSPENDED — the chip reads "… — inactive for API-only model", the HA
banner is suppressed, the family-B Undo is hidden (family-A Undo unaffected; `UndoSnapshot.family`),
and the operations row is hidden so nothing implies those settings shape the API recommendation. The
customer's settings and provenance are PRESERVED; switching back to a self-hostable model restores the
active state (live-verified: active → suspended → restored, banner and Undo returning intact).

### P2-UI3-1 — operational assumptions visible at the result (Simple mode included)
`DecisionSummary` renders an operations row from the workload-only effective inputs (structured
output): utilization target %, spare serving replica (N+1) on/off, operating h/mo, purchasing model
("(indicative planning assumption)" when ≠ on-demand). The N+1 scope caveat ("N+1 covers one
serving-replica loss only; it does not establish multi-AZ resilience, disaster recovery, security,
quota readiness, or compliance.") renders for EVERY N+1-enabled state in both modes — never restricted
to the HA-posture profile or Expert mode.

### P2-UI3-2 — reduced operating hours clarified (UI3-D1 approved: 220 h/mo retained)
Whenever operating hours < 730 a persistent disclosure renders: "Monthly traffic is assumed to be
served within the selected active hours, so the required active fleet may increase." plus the
not-established list (startup/drain/checkpoint time, accelerator availability, capacity reservations,
quotas, operational automation). Engine behavior preserved: 220 h concentrates demand (87 → 284 boxes
for the canonical case; asserted `> 87` in tests).

### P2-UI3-3 — preset descriptions rendered; stage language removed
The selected preset's description renders inside the preview panel (`preview-description`), not only in
a title attribute. Family headings are customer-facing: "Response experience" / "Operational profile"
(no Stage identifiers). Cost-optimized is renamed "Cost-optimized — illustrative 1-year commitment"
with an explicit planning-scenario description (UI3-D2 owner position).

### Verification (this revision)
- Headless (`ux/v2-phase1 @ 98c1fe0`): 359/359, tsc clean — pricing-assumption structure, comparator
  qualification + tamper fail-closed, qualified narration, reference byte-invariance, diff coverage.
- UI worktree: **423/423** (16 new in `advisor3-hold.test.tsx`), `tsc --noEmit` clean, `build:static`
  clean, **375px mobile acceptance PASS**.
- Live (fresh Chrome profile, ZERO console errors): cost-optimized apply → "Indicative modeled cost:
  Self-host" + both disclosure lines + "$4,157,496/mo"; change summary "a modeled cost comparison
  decided it"; ha-posture → Claude Fable 5 → chip "— inactive for API-only model", banner/Undo/ops row
  suppressed → switch back → all restored; preview description rendered.
