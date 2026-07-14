# 13. Before / after meeting scripts

Three scripts showing the experience gap. The "before" reflects the current `rc-qa-11` form; the
"after" reflects the UX-v2 design. Customer answers are limited to what a real buyer would know.

---

## Script 1 — New SA (~1 yr), **current** experience

> **Customer:** "We've got about 500k support questions a month against 10,000 docs. Should we run
> our own GPUs or just use an API?"
>
> **SA:** *(opens the calculator, faces the full form)* "Okay… let me switch to self-hosted GPU."
> *(sees GPU instance, weight precision BF16/FP8/INT4, KV-cache precision, max context length, max
> concurrent sequences, number of instances, interactivity target, max TTFT…)*
>
> **SA (thinking):** *Which GPU? What's INT4 vs FP8? Is KV precision the same as weight precision?
> What do I put for concurrent sequences — is that QPS? Number of instances… but there's an auto-size
> toggle, so why is it asking? Interactivity target in tok/s/user — I have no idea what the customer
> needs.*
>
> **SA:** "Let me get back to you on the GPU sizing." *(guesses INT4, leaves concurrency at default,
> gets an infeasible/qualified result, can't explain why.)*

**Failure modes:** ~7 guesses; premature technical depth; result the SA can't defend; meeting stalls.

---

## Script 1 — New SA (~1 yr), **UX v2**

> **SA:** *(Stage A)* "What are we deciding? — Compare API vs self-hosting. Production. What matters
> most? — let's say balanced cost and latency."
>
> **SA:** *(Stage B — reads the customer's own words)* "500,000 questions a month… busiest hour maybe
> twice average… 10,000 documents, a couple of pages each, refreshed monthly… answers a few
> paragraphs… you want it to feel like a chat assistant."
>
> **App:** *(Stage C→D)* recommends **DeepSeek-V4-Pro · p6-b200 · INT4 · 87 instances**, chip
> **Extrapolated**, with "Interactive RAG" experience and 24×7 availability. Rail shows API ≈ $X and
> self-host ≈ $Y.
>
> **SA (reads Stage F aloud):** "For 500k questions a month, calling the API is cheaper today — about
> $X. Running your own GPUs would be about $Y and only pays off above roughly Z questions a month.
> This is an *extrapolated* estimate because the benchmark was measured at a shorter prompt than
> yours; before committing we'd load-test it."

**Wins:** no GPU internals entered; a defensible sentence; confidence stated; next step clear.

---

## Script 2 — Inference specialist (15–25 yr), challenge & validate, **UX v2**

> **Specialist:** "Why p6-b200 and not p5e?"
> **SA:** *(alternatives card)* "p5e-FP8 is 6% cheaper but relies on a proxy benchmark; p6-b200-INT4 is
> the cheapest *measured-derived* option that meets your SLA."
>
> **Specialist:** "Is this prefill- or decode-bound?"
> **SA:** *(fleet equation)* "Prefill-bound — 221,461 input tok/s ÷ (3,715 prefill tok/s/replica × 70%)
> → 86 replicas, +1 N+1."
>
> **Specialist:** "That prefill number — measured or assumed?"
> **SA:** *(trust panel)* "Measured input throughput at ISL 1,024, scaled to your 2,910-token input —
> that's why it's flagged extrapolated, not measured."
>
> **Specialist:** "TTFT — average or tail?"
> **SA:** "P99. The 2 s SLA is checked against the P99 tail; a tighter budget flips it infeasible."
>
> **Specialist:** "What happens on a replica failure?"
> **SA:** "N+1 adds one complete serving group; after one loss, peak utilization is shown — and it's
> serving redundancy only, not AZ/DR."
>
> **Specialist:** "What if the real prefill throughput is off?"
> **SA:** "On the heuristic path we'd show a fleet band; here it's measured-scaled, so the risk is the
> scaling factor — flagged, and load-test is in the exclusions."

**Wins:** every answer traces to a benchmark run or engine field; the specialist can accept or
demand a load-test, not re-derive arithmetic.

---

## Script 3 — Generalist SA (5–10 yr), speed + override, **UX v2**

> **SA:** *(applies "Cost-optimized production" preset — preview shows 4 field changes, keeps the
> utilization they'd set)* "Apply."
> **SA:** *(opens Tune → GPU)* "Force FP8 for quality margin." *(field flips to expert override; fleet
> re-derives; a notice: 'Fleet changed 87 → 92 because precision changed INT4 → FP8.')*
> **SA:** *(Compare)* puts recommended vs the FP8 override side by side, exports the report.

**Wins:** fast presets, explicit overrides, visible change reasons, side-by-side, one-click defensible
export.

---

## What the scripts prove against the success measures

- New SA reaches a credible comparison **without GPU internals** (Script 1-after).
- Specialist traces **every** number to evidence (Script 2).
- Generalist completes fast and overrides cleanly (Script 3).
- Auto-size needs **no** manual GPU-count guess (all).
- The SA can explain **why the fleet changed** (Script 3 change notice).
- The customer can tell calculated facts from estimates (confidence chip, all).
