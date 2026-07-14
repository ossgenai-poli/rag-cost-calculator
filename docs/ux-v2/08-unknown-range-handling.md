# 10. Unknown & range handling

A live customer often doesn't know a value. The tool must never **block** on a number it can't
supply, and it must **propagate the uncertainty into the recommendation's confidence** rather than
pretending a guess is a fact.

---

## The "I don't know" control

Every Simple-mode **Fact** field has a secondary affordance:

```
Monthly question volume   [ 500,000 ]        or  ⌄ I'm not sure
                                                  ┌──────────────────────────┐
                                                  │ Low   [ 200,000 ]        │
                                                  │ Base  [ 500,000 ] ← used │
                                                  │ High  [1,200,000 ]       │
                                                  └──────────────────────────┘
```

- **Base** drives the headline result; **Low/High** drive a **range** shown beside it.
- Choosing "I'm not sure" without numbers offers **typical presets** (e.g. traffic: pilot / department
  / org-wide) that fill a plausible low/base/high.

---

## Fields and their unknown-handling

| Field | If unknown | Effect on result |
|---|---|---|
| **Monthly volume** | low/base/high or pilot/dept/org preset | headline at base; cost + break-even shown as a range |
| **Peak-to-average** | steady / spiky / very-spiky preset (1.2 / 2 / 3×) | fleet range; flagged as an assumption |
| **Answer length** | "short / medium / long" (~150 / 500 / 1,200) | decode demand + output-cost range |
| **Sources per question** | recommend 4; range 3–8 | prefill-bound fleet range (biggest swing for long context) |
| **Concurrency** | leave derived from the operating point | none — it's derived, not asked |
| **Operating schedule** | business-hours / 24×7 preset | uptime hours; break-even active-window QPS |

---

## How uncertainty changes confidence

Uncertainty is shown in **two independent channels** so they're never conflated:

1. **Evidence confidence** — how well the *benchmark* matches (measured / scaled / extrapolated /
   proxy / heuristic). Unaffected by input uncertainty.
2. **Input confidence** — how firm the *customer's numbers* are. Driven by how many facts are ranges
   vs firm values.

```
Confidence: Measured·scaled benchmark  ·  Inputs: 3 of 7 are ranges
Fleet: 74–112 instances (base 87 = case R1)   Self-host: $6.1M–$9.3M/mo (base $7.18M = R1)
```
*(Base = reference case R1; the band endpoints here are schematic and will come from the Phase-1 range
recompute described below.)*

- When any material Fact is a range, the fleet and cost are shown as **base + band**, and the headline
  says "roughly" / "about."
- **Largest modeled range effect (P2-5):** the app names the input whose low↔high bounds move the fleet
  the most, e.g. *"Largest modeled range effect: **context chunks sent to the model** (3–8) → fleet
  74–112."* This **is** a deterministic sensitivity analysis — it *does* compare modeled output effects
  by re-running the engine at each input's bounds. It is **not** causation inferred from an observed
  before/after delta; the comparison is a controlled recompute. The result serializes **{selected input,
  its low/high bounds, the computed fleet effect}** into the JSON/report.

---

## Rules

- **Never block.** A missing Fact falls back to a labeled preset, never a hidden default.
- **Base is always explicit.** The headline value's source (customer number, range base, or preset) is
  labeled.
- **Ranges recompute, they don't extrapolate.** Low/high fleet and cost come from **re-running the
  engine at the low/high inputs**, so the band is real, not a percentage guess.
- **Two confidence channels stay separate** — a firmly-known input against a proxy benchmark is still
  low *evidence* confidence; a range input against a measured benchmark is high evidence, wide input band.

## Design constraints

- The range recompute reuses the existing engine (Phase 1 wiring); Phase 0 specifies the interaction
  and the two-channel confidence model.
- The "largest modeled range effect" is a **bounded sensitivity recompute** (engine re-run at each
  input's low/high), serialized as {input, bounds, effect}. It is a legitimate deterministic analysis
  of modeled output effects — distinct from the forbidden pattern of inferring causation from an
  uncontrolled before/after value delta.
