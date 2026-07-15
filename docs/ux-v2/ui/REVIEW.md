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
