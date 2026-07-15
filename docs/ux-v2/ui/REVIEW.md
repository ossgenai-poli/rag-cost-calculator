# UI slice review — /advisor (first reviewable vertical slice)

**Branch:** `ux/v2-ui` (from the approved complete headless baseline `ux/v2-phase1 @ e938c5d`).
**Scope:** customer input journey · Simple/Expert mode · decision summary · best-self-host + rejection
states · trust/provenance panel · structured adjustments · deterministic narrative rendering.
**Not in scope:** merge, deploy, replacing the calculator at `/`, alternatives cards, presets, exports.

## Local review

```
cd <worktree>          # ux/v2-ui
npm run dev            # then open http://localhost:3000/advisor  (the calculator at "/" is untouched)
npx vitest run         # 364 = 347 approved baseline + 13 advisor component/a11y + 4 crypto-shim parity
npx tsc --noEmit       # clean
```

Walkthrough (default state = the R1 canonical reference workload; every number is approved output):
1. **Simple mode** — decision-first: "Use the API · basis: lower-cost", narrated rationale (verbatim
   `narrate()` output), $6,492,000/mo API vs $7,176,630/mo best self-host, caption. The GPU config
   appears ONLY in the secondary "Best self-host option" card (Measured·scaled chip, serving facts,
   fleet equation on expand).
2. **Expert mode** — adds SLA/workload-shape inputs, "Rejected options (3)" (FP8 → Extrapolated,
   H200/H100 → Heuristic, all `evidence-below-threshold` with the feasible/SLA/evidence booleans),
   and the "Where did this come from?" panel (pricing provenance, per-config evidence chips, P99 TTFT
   tail-statistic wording, planning-capacity disclaimer).
3. **Experimental toggle** (Expert) — decision flips to `basis: evidence-gap`; every config demotes to
   the **Unbenchmarked** chip; the self-host panel shows the honest empty state ("no qualifying
   benchmark evidence"); the rationale carries the internal-evidence-metadata-limitation wording. No
   GPU is ever promoted.
4. **Model = MiniMax M3** — `no-modeled-candidate`: "catalog-coverage gap, not a technical limitation".
   **Model = an "API only" entry** — `self-host-infeasible`. **TTFT 100ms** — B200 rejected
   `sla-unmet-ttft-or-streaming` (evidence-gap overall with the pinned catalog).
5. **Top N 9 / Top K 3, uptime 1000 (or 0)** — the amber "Inputs adjusted for calculation" table shows
   entered→calculated (9→3, 1000→730, 0→730) with raw field paths preserved.
6. Malformed input (e.g. volume 0) — a red banner with the boundary validator's message, verbatim;
   never a crash or a silently repaired value.
7. Responsive: single column at 375px; no horizontal scroll. Dev server compiles with no errors.

## Every displayed value → its structured source field

| UI element | Source (structured result) |
|---|---|
| Decision headline + basis chip | `decision.choice` / `decision.basis` |
| Rationale paragraph | `decision.rationale` (narrate(); verbatim) |
| API cost + label | `apiOption.monthlyCost` / `apiOption.modelLabel` |
| Best self-host cost + label | `bestSelfHost.costMonthly` / `selfHostModelLabel` |
| Caption | `RECOMMENDATION_CAPTION` (narrated `caption`) |
| Card config + chip | `bestSelfHost.config.label` / `bestSelfHost.confidence` (exact token) |
| Instance / precision / GPU rate / pricing model / uptime / utilization | `evaluations[].servingFacts.*` (never workload GPU fields) |
| Fleet count + binding dim | `evaluations[].fleet.boxes` / `.bindingDim` |
| Fleet equation | `bestSelfHost.bindingConstraint` (narrate(); embeds `fleet.equation` verbatim) |
| Trade-off line | `bestSelfHost.tradeoff` (narrate()) |
| Empty self-host explanations | `decision.basis` branch (4 coded states; no invented text) |
| Rejected rows: label / chip / code / message / gate booleans | `rejected[].config.label`, `evaluations[].effectiveConfidence`, `rejected[].code`, `rejected[].message`, `evaluations[].{technicallyFeasible,slaQualified,evidenceQualified}` |
| Price book / as-of / region / GPU price source | `pricing.{source,asOf,region,gpuPriceSource}` ("live" only when `source==="live"`) |
| Evidence chips per config + demotion note | `evaluations[].{engineConfidence,effectiveConfidence}` |
| TTFT line | `evaluations[].ttftS` + `.ttftPercentile` (rendered only when a real percentile) |
| Registry note | `evaluations[].registry.status` (internal limitation wording; never a customer-input error) |
| Adjustments rows | `inputAdjustments[].{field,entered,calculated}` (labels are copy; raw path shown) |
| Error banner | the thrown boundary-validation message, verbatim |

Components never call the engine or registry directly; the ONLY consumption path is
`lib/recommendation/index.ts` (`recommend` → `narrate`). No number, evidence state, explanation or
recommendation is authored in a component.

## Build-integration note (reviewed change outside `components/app`)

The frozen registry's `hash.ts` imports `node:crypto`, which webpack cannot bundle for the browser.
`next.config.mjs` now replaces it — **client bundles only** — with `lib/browser-shims/node-crypto.ts`,
a pure-TS sha256 whose output is proven byte-identical to node:crypto in
`lib/browser-shims/node-crypto.test.ts` (edge cases + the REAL pinned snapshot checksums, including the
manifest's recorded InferenceX checksum) — so the registry's fail-closed checksum verification behaves
identically in-browser. Server/SSR/tests keep real node:crypto. The frozen registry is untouched.
`vitest.config.ts` gained JSX transform + the `@/` alias for the new `.tsx` component tests (no effect
on the approved `.ts` suites — full baseline remains green).

## Open UX decisions for owner review

- **UI-D1** Simple mode hides Rejected + Trust panels (specialist material per wireframe); confidence
  still travels with the card via the chip. Confirm or always-show-collapsed.
- **UI-D2** `Unbenchmarked` chip (dark neutral) extends the Phase-0 5-level ladder for the Phase-1
  registry demotion state. Confirm color/wording.
- **UI-D3** Adjustment/copy labels exist in narrate() AND the UI panel (two copies of presentation
  copy). Consolidate into one copy-deck module in a later slice?
- **UI-D4** Model dropdown lists API-only models (honest `self-host-infeasible` outcome) — keep or
  hide them from a self-host advisor?
- **UI-D5** The slice pins the committed reference price book (deterministic, provenance-labelled
  "fallback"). Wire the calculator's live-price loadPrices() path in a later slice?
- **UI-D6** Numeric fields validate through the fail-closed boundary (a 0/blank momentarily shows the
  red banner while typing). Debounce/soft-validate in a later slice?
- **UI-D7** The advisor pins a light color scheme inside the dark-themed app shell. Confirm, or theme
  to match the calculator.
