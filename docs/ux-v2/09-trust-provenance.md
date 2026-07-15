# 11. Trust & provenance design

Confidence sits **next to the fleet recommendation**, not only in an advanced card below it. A
"Where did this come from?" panel expands the full, structured provenance the engine already produces
(rc-qa-9/10). Everything here maps to an existing engine field — nothing is authored prose about the data.

---

## Confidence ladder (next to the fleet)

A single chip, color-coded, from `capacity.source` (+ `prefillIslScale` for the scaled distinction):

| Level | Chip | Meaning | Engine source |
|---|---|---|---|
| **Measured match** | 🟢 Measured | exact model, GPU, precision, ISL, OSL, whole-box topology, traceable run | `source==="measured"`, no reasons |
| **Measured, scaled** | 🟢→🟡 Measured·scaled | exact serving group, input throughput scaled to your ISL | `source==="extrapolated"` + `prefillIslScale≠1` only |
| **Extrapolated** | 🟡 Extrapolated | sequence / precision / topology differs | `source==="extrapolated"` + reasons |
| **Proxy** | 🟦 Proxy | another model's benchmark used as a stand-in | `source==="proxy"` |
| **Heuristic** | ⬜ Heuristic | no applicable benchmark; rough estimate | `source==="heuristic"` |

The chip is always adjacent to the fleet number and repeated on every alternative card and in the export.

---

## "Where did this come from?" panel

Expands beside the fleet. Renders the structured provenance verbatim:

```
Where did this come from?

Benchmark      SemiAnalysis InferenceX  ·  independent third-party  ·  methodology ↗
Run            run 27434759052 ↗   (GitHub Actions)
Recipe         commit 45126b036e
Measured       2026-06-12
Hardware       B200 · TP8 · 8 GPUs handle prefill and decode (aggregated) · no spec-decode
Precision      fp4   (requested INT4)
Sequence       measured 1024 / 1024   ·   your workload 2,910 / 500
Statistic      TTFT is P99: 99% of requests start within this time under benchmark
               conditions; 1% may be slower. (Not the average.)

Why this is "Extrapolated", not "Measured":
  • input length 2,910 not close to benchmarked ISL 1,024
    → prefill throughput measured at ISL 1,024 and scaled to 2,910
  • output length 500 not close to benchmarked OSL 1,024

Planning capacity, not an availability or tail-latency guarantee.
Validate with your intended serving stack and a production-shaped load test before committing.
```

Every line has a source:
- source / methodology / run / recipe / date / topology → `capacity.benchmarkProvenance.*`
- precision / sequence requested-vs-used → `precisionUsed/Requested`, `seqUsed/seqRequested`
- reasons → `capacity.extrapolationReasons` (verbatim reason strings)
- scaling → `prefillIslScale`, `perGpuPrefillTokS`
- statistic → `ttftPercentile`
- disclaimer → the INF-004 constant

For **heuristic**, the panel instead shows the prefill uncertainty band (`prefillRange`:
ratio, low/base/high capacity, fleet min/base/max replicas) and "no benchmark for this model/GPU."

---

## The specialist's six questions — answered in the panel

| Question | Answered by |
|---|---|
| Where did this number come from? | Benchmark + run + recipe lines |
| How current is it? | Measured date |
| What was actually measured? | Hardware, precision, sequence, statistic |
| What was inferred? | The "why extrapolated/scaled" reasons |
| Could this change API-vs-self-host? | Confidence chip + qualified-verdict banner |
| What must be load-tested? | The disclaimer + risks list ([10-result-hierarchy.md](10-result-hierarchy.md)) |

---

## Rules

- Confidence is **always beside the fleet**, never only in a lower card.
- The panel is **read-only, structured, deterministic** — it serializes engine fields; it never
  authors claims or infers from values.
- A **qualified verdict** (positive recommendation resting on non-measured capacity, an estimated
  prefill bound, or a non-live/overridden price) always shows the amber "treat as qualified — validate
  before committing" banner beside the recommendation, per `verdictQualified`.
- Aggregated topology never reads as double the GPUs (INF-010); disaggregated shows separate pools.

## Design constraints

- All fields already exist in the engine as of rc-qa-11; Phase 0 designs the presentation. No new
  engine fields are required for the trust panel.
