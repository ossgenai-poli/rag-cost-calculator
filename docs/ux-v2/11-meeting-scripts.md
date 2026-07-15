# 13. Before / after meeting scripts

Three scripts showing the experience gap. The "before" reflects the current `rc-qa-11` form; the
"after" reflects the UX-v2 design. Customer answers are limited to what a real buyer would know.

> **Every structural number below comes from one documented input set** in
> [18-reference-cases.md](18-reference-cases.md), computed on the frozen rc-qa-11 engine. Script 1 uses
> the **large-deployment** case **R1** (200M questions/mo → 87 instances); the small-customer note uses
> **R5** (5M → 4 instances). Dollar values are planning figures from the committed price book.

---

## Script 1 — New SA (~1 yr), **current** experience

*Input set: R1 — DeepSeek-V4-Pro · p6-b200 · INT4 · 200M questions/mo · 2,910/500 tokens.*

> **Customer:** "We run about 200 million support questions a month against 10,000 docs. Should we run
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
> **SA:** "Let me get back to you on the GPU sizing." *(guesses, can't explain the result, meeting stalls.)*

**Failure modes:** ~7 guesses; premature technical depth; a result the SA can't defend.

---

## Script 1 — New SA (~1 yr), **UX v2**

> **SA:** *(Stage A)* "What are we deciding? — Compare API vs self-hosting. Production. What matters
> most? — balanced cost and latency."
>
> **SA:** *(Stage B — reads the customer's own words)* "200 million questions a month… busiest hour
> about the same as average… 10,000 documents, a couple of pages each, refreshed monthly… answers a
> few paragraphs… you want it to feel like a chat assistant."
>
> **App:** *(Stage C→D)* recommends **DeepSeek-V4-Pro · p6-b200 · INT4 · 87 instances** (86 for
> throughput + 1 N+1), chip **Measured·scaled**, "Interactive RAG" experience, 24×7 availability. Rail:
> API **$6.49M/mo**, self-host **$7.18M/mo**.
>
> **SA (reads Stage F aloud):** "At 200 million questions a month, calling the API is a bit cheaper
> today — about $6.5M vs $7.2M for your own GPUs. Self-hosting only pays off above roughly **221
> million** questions a month, so you're just under the line. This is a *measured-but-scaled* estimate —
> the benchmark was taken at a 1,024-token prompt and scaled to your ~2,900-token prompt — so before
> committing we'd load-test it."

**Wins:** no GPU internals entered; a defensible sentence; the real break-even; confidence stated.

**Small-customer variant (R5):** at 5M questions/mo the same model/GPU sizes to **4 instances** and
API wins decisively ($162k vs $330k) — the SA sees the fleet shrink and the verdict hold, no re-guessing.

---

## Script 2 — Inference specialist (15–25 yr), challenge & validate, **UX v2**

> **Specialist:** "Why p6-b200 and not p5e or p5?"
> **SA:** *(rejected-options list)* "p5e/H200 and p5/H100 have **no DeepSeek benchmark** in our evidence
> set, so they fall to the heuristic path — we exclude them from the recommendation rather than show a
> number we can't defend. B200 is the only GPU with measured DeepSeek data." *(cites R3/R4.)*
>
> **Specialist:** "Is this prefill- or decode-bound?"
> **SA:** *(fleet equation)* "Prefill-bound — 221,461 input tok/s ÷ (3,715 prefill tok/s/replica × 70%
> = 2,600) → 86 replicas, +1 N+1 = 87."
>
> **Specialist:** "That prefill number — measured or assumed?"
> **SA:** *(trust panel)* "Measured input throughput at ISL 1,024, scaled to your 2,910-token input —
> that's why it's **Measured·scaled**, not Measured."
>
> **Specialist:** "TTFT — average or tail?"
> **SA:** "P99. Ninety-nine percent of requests start within 2 s under benchmark conditions; 1% may be
> slower. A tighter budget flips it infeasible."
>
> **Specialist:** "What if I force FP8?"
> **SA:** "It won't change the fleet — we have no DeepSeek **FP8** benchmark on B200, so FP8 reuses the
> FP4 curve and is flagged *precision substituted → extrapolated*. Same 87 instances, lower confidence."
> *(cites R2.)*
>
> **Specialist:** "Replica failure?"
> **SA:** "N+1 adds one complete serving group; after one loss we show post-loss peak utilization. It's
> serving redundancy only — not multi-AZ, DR, or a compliance architecture."

**Wins:** every answer traces to a benchmark run or engine field, or to an honest "no evidence — excluded."

---

## Script 3 — Generalist SA (5–10 yr), speed + override, **UX v2**

> **SA:** *(applies "Cost-optimized production" preset — preview shows the field changes, keeps the
> utilization they'd set)* "Apply."
> **SA:** *(opens Tune → GPU, forces FP8)* "Huh — fleet stays **87**." *(notice: "Precision FP8 has no
> DeepSeek benchmark on B200; reusing the FP4 curve — confidence dropped Measured·scaled → Extrapolated,
> reason: precision substituted.")* "Right, no FP8 data — I'll leave it INT4." *(cites R2.)*
> **SA:** *(Compare)* puts the INT4 recommendation beside the FP8-forced override, sees identical fleet
> but lower confidence, exports the report.

**Wins:** fast presets, explicit overrides, and an override that **honestly refuses to invent** a
distinct result — the change notice names the real reason.

---

## What the scripts prove against the success measures

- New SA reaches a credible comparison **without GPU internals**, with the **real** break-even (Script 1-after).
- Specialist gets a traceable answer **or an honest "no evidence — excluded"** for every challenge (Script 2).
- Generalist overrides cleanly and the tool **won't fabricate** an FP8 result it can't support (Script 3).
- Auto-size needs **no** manual GPU-count guess; the SA can explain **why** the fleet changed; the
  customer can tell measured from scaled from excluded.
