# Test fixtures

## `legacy-saved-scenario.json` — for TEST_PLAN **L4** (stale saved scenario)

A saved-scenario array shaped like one persisted **before** newer schema fields
existed. Its `inputs` omits 8 fields added later (`managedKb`, `ops`,
`generation.interactivityTarget`, `generation.gpuPricingModel`,
`generation.gpuUptimeHoursPerMonth`, `generation.weightBits`,
`guardrails.charsPerTextUnit`, `guardrails.charsPerToken`). Loading it must
**not crash** — `coerceInputs` backfills those from schema defaults.

Regenerate with: `npx tsx scripts/gen-l4-fixture.ts`
Covered by: `lib/qa-regressions.test.ts › L4 legacy saved scenario`.

### How to run L4
1. Open the app (static Pages or the runtime URL).
2. Open DevTools → Console.
3. Paste the file's contents as the value:
   ```js
   localStorage.setItem("rag-calc-saved-v1", JSON.stringify(/* paste the JSON array here */));
   ```
   (or copy the array literal directly into `JSON.stringify(...)`).
4. Reload the page.
5. **Expected:** the saved scenario **"Legacy scenario (pre-schema)"** appears in
   the saved-scenarios list. Loading it renders results with **no crash/blank** —
   the missing newer fields default in (e.g. Managed KB and Ops panels show their
   default values; guardrail char fields show defaults). This is a PASS.
