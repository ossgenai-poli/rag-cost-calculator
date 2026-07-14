# 3. GPU comprehension matrix

The GPU section is where a junior SA is most likely to guess and a specialist is most likely to
challenge. For each concept: **what the new SA sees** (Simple), **what the expert can inspect**
(Expert/trust), and **what the app recommends automatically** (the derivation).

Every "app recommends" cell is deterministic and traceable to an engine field — no guessing.

| Concept | New SA sees (Simple) | Expert can inspect | App recommends automatically |
|---|---|---|---|
| **GPU selection** | "Recommended: p6-b200 — balanced" with 2–3 ranked alternatives and a confidence chip | Full ranked list incl. rejected options + reason; the benchmark point behind each | Sweep modeled GPU families × precisions through the engine; rank by feasibility → SLA → confidence → preference → cost. *"Recommended among AWS configs currently modeled."* |
| **Weight precision** | Not shown; folded into the GPU recommendation ("INT4 quantized") | Quality/memory/throughput trade-off; which precisions have benchmark data | Default from model + available benchmark curve; INT4/FP8 where measured, else the safest that fits |
| **KV-cache precision** | Hidden | BF16 vs FP8 with a compatibility note; KV memory delta | BF16 (conservative) unless FP8 is safe for the model/runtime |
| **Context length** | Shown as a derived output: "Context window: 4,500 tok (auto)" | The min = query + sources + prompt + output; the headroom % added; the model's own ceiling | **No silent truncation** (P1-UX-003): `needed > model max` → **infeasible**; `needed ≤ max` but `needed + headroom > max` → recommend the **max** with an explicit *reduced-headroom* warning; else → `needed + headroom` |
| **Concurrent sequences** | Hidden (drives the operating point) | The benchmark operating point chosen; how concurrency ↔ interactivity ↔ TTFT move | From the operating point that meets the interactivity + P99 TTFT SLA (default cap 32) |
| **Instance count (fleet)** | A **derived result**: "Fleet: 87 instances" with the reconciled equation | The full `fleet-explain` equation (binding dim ÷ capacity × util → replicas → boxes) | Auto-sized: `max(memory-floor, throughput, redundancy)` in complete serving groups |
| **Auto-size** | "Size the fleet for me" (on) — explains it sizes for memory, peak throughput, SLA and N+1 | Toggle off to set a manual cap (becomes an explicit override) | On by default; fleet is derived. Off → manual entry is an **expert override**, fleet labeled capped |
| **N+1 redundancy** | "Add a spare serving replica (N+1)" — "serving redundancy only, not full HA/DR" | The exact extra replica = one complete serving group of boxes | On for production availability; adds one complete replica |
| **Interactivity** | A **response-experience preset** (conversational / interactive-RAG / analyst / batch) | The tok/s/user number it maps to; achieved vs target at the operating point | Preset → target tok/s/user; picks the concurrency that still meets it |
| **P99 TTFT** | "Longest acceptable wait to first word" (from preset) | Labeled **P99 TTFT** with the benchmark statistic; the tail vs the SLA | Preset → target (2 s default); the operating point must meet the **P99** tail or it's infeasible |
| **Utilization target** | A profile: **conservative 50% / balanced 70% / aggressive 85%** | The headroom vs queueing/SLA-risk trade-off; the exact % used in sizing | Balanced 70% unless the operational profile says otherwise |
| **Fleet uptime** | Derived from the **operating schedule** ("business hours" / "24×7") | Hours/month computed; cap at 730; override | Schedule → hours/month; break-even reported over both calendar and active-window |
| **Purchasing model** | Hidden (On-demand assumed) | On-demand / RI / Savings / Spot; **indicative discount ≠ a customer quote** | On-demand for planning; discounts shown as indicative only, separated from AWS quotes |
| **GPU price / provenance** | The $/hr with a source chip (live / reference / your override) | Live-vs-fallback, the SKU, when an override qualifies the verdict | Live price where available; editing it marks the verdict qualified |
| **Benchmark confidence** | A confidence chip next to the fleet (measured / scaled / extrapolated / proxy / heuristic) | "Where did this come from?" — run, recipe, date, topology, P99 semantics, scaling/extrapolation reasons | From `capacity.source` + reasons; only "measured" when model/GPU/precision/ISL/OSL/topology + a traceable run all match |

---

## Progressive disclosure rule

- **New SA** never has to choose GPU, precision, KV, context, concurrency, utilization, purchasing, or
  fleet count. They pick a **model**, a **response experience**, an **availability level**, and an
  **optimization preference**; everything else is recommended or derived with a visible reason.
- **Expert** opens per-section Tune drawers to override any of the above; every override is explicit,
  reason-tagged, and (where it weakens evidence) qualifies the verdict.
- **Specialist** uses the trust panel to trace every recommendation to the benchmark run and reasons,
  and challenges via the same numbers the SA sees — no hidden math.

## Anti-guessing guarantee

No GPU-section field in Simple mode requires the SA to know a value the customer wouldn't. The three
historically dangerous fields — **GPU choice, precision, and fleet count** — are now recommendations
or derived results, each defensible from an engine field. This is the core of the redesign.
