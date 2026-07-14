# 5. Copy deck

Proposed copy for v2. Every **advanced** field answers four questions: **What is this? · Why is it
needed? · What does the app recommend? · How does changing it affect the result?** Short answer =
inline; technical depth = hover/popover. Essential meaning is never hidden only in a tooltip.

Confidence and provenance language is deterministic — it names the engine field/reason, never infers.

---

## Stage A — Decision framing

- **What are you deciding today?**
  - *Estimate API cost* — "Just the pay-per-token cost of calling a hosted model."
  - *Compare API vs self-hosting* — "Should we call an API or run GPUs ourselves?"
  - *Size an existing self-hosted deployment* — "We've decided to self-host; how many GPUs?"
  - *Optimize an existing GPU fleet* — "We already run GPUs; can we do better?"
- **Where are you in the journey?** Prototype · Production · Growth forecast.
- **What matters most?** Lowest cost · Lowest latency · Data control · Predictable capacity ·
  Operational simplicity. — helper: *"This sets how we rank the recommended options; you can change it."*

---

## Stage B — Workload facts

| Field | Label | Helper (inline) |
|---|---|---|
| queriesPerMonth | **Monthly question volume** | "How many questions users ask the system per month. Not sure? Enter a low/base/high range." |
| queryTokens | **Typical question length** | "About how long is a user's question. ~50 tokens ≈ a sentence or two." |
| outTokens | **Typical answer length** | "About how long the model's answer is. ~500 tokens ≈ 2–3 paragraphs." |
| peakFactor | **Busiest hour vs average** | "Peak traffic ÷ average. Steady ≈ 1.2×, spiky ≈ 2×. Only affects self-hosted fleet size." |
| numDocs | **How many documents** | "Documents in the knowledge base being searched." |
| avgTokensPerDoc | **Average document size** | "~1,000 tokens ≈ 2 pages." |
| refresh | **How often the corpus changes** | "Drives how often we re-embed and the monthly ingest cost." |

---

## Stage C — Experience → SLA

- **Response experience** (preset): *Conversational · Interactive RAG · Analyst / research · Batch.*
  Helper: *"Sets the streaming speed each user feels. We translate it to a tokens-per-second target
  you can inspect."*
- **Longest acceptable wait to first word** (preset or ms): helper: *"How long a user waits before the
  answer starts appearing. We check this against the benchmark's **P99** (worst-case tail), not the
  average."*
- **Availability expectation**: *Business hours · 24×7 · 24×7 regulated.* Helper: *"Sets operating
  hours and whether we add a spare serving replica."*

---

## Advanced fields — the four-question blocks

> **GPU** — *What:* the EC2 GPU instance the model runs on. *Why:* it sets price, memory and measured
> throughput. *Recommended:* the balanced option among modeled AWS configs for your model, SLA and
> preference. *Change it:* a bigger GPU fits more/longer context and may raise throughput but costs
> more per hour; a smaller one may become infeasible.

> **Model precision** — *What:* how compactly the model weights are stored (BF16 → FP8 → INT4).
> *Why:* lower precision uses less GPU memory (fewer instances) and usually raises decode throughput,
> with some quality trade-off. *Recommended:* the precision the benchmark measured for this model.
> *Change it:* INT4 cuts memory/cost but isn't measured for every model; we mark the confidence.

> **KV-cache precision** — *What:* precision of the per-token attention cache, independent of the
> weights. *Why:* it drives KV memory, which grows with context and concurrency. *Recommended:* BF16
> (conservative). *Change it:* FP8 roughly halves KV memory where the runtime supports it.

> **Context window** — *What:* the longest sequence the fleet is configured to hold. *Why:* it sets KV
> memory and therefore the memory-floor instance count. *Recommended:* the minimum your workload needs
> (question + sources + prompt + answer) plus headroom. *Change it:* larger windows cost memory; too
> small is infeasible for your inputs.

> **Max concurrent sequences** — *What:* how many requests the server batches at once. *Why:* it picks
> the benchmark operating point (throughput vs per-user speed). *Recommended:* the point that still
> meets your streaming-speed and P99 TTFT targets. *Change it:* higher concurrency raises throughput
> but lowers per-user speed and raises TTFT. (Not QPS, not simultaneous users.)

> **Streaming speed per user** — *What:* tokens per second each user sees. *Why:* your interactivity
> SLA; it selects how many requests share a GPU. *Recommended:* from your response-experience preset.
> *Change it:* snappier = fewer requests per GPU = more GPUs.

> **Longest wait to first word (P99 TTFT)** — *What:* the worst-case (99th-percentile) time before the
> answer starts. *Why:* the tail is what a customer's SLA cares about. *Recommended:* 2 s. *Change it:*
> a tighter budget can make the measured configuration infeasible.

> **Target GPU utilization** — *What:* how hard we load the fleet at peak. *Why:* headroom vs cost.
> *Recommended:* balanced 70%. *Change it:* 50% conservative (more GPUs, safer) · 85% aggressive
> (cheaper, more queueing/SLA risk).

> **Fleet size** — *What:* GPU instances billed. *Why:* the dominant self-host cost. *Recommended:*
> auto-sized for memory, peak throughput, SLA and N+1. *Change it:* turn auto-size off to cap it
> manually — an explicit override; we then show whether the cap is feasible.

> **Spare serving replica (N+1)** — *What:* one extra complete serving group. *Why:* keeps serving
> capacity if one replica fails. *Recommended:* on for production. *Change it:* off saves a replica's
> cost but a failure drops you below peak. **This is serving redundancy only — not AZ/quota/DR/full HA.**

> **Operating hours** — *What:* hours/month the fleet runs. *Why:* drives GPU cost and the break-even
> volume. *Recommended:* derived from your operating schedule (capped at 730). *Change it:* fewer hours
> lowers cost but raises the break-even QPS during active hours.

> **Purchasing assumption** — *What:* on-demand vs commitment pricing. *Why:* changes effective $/hr.
> *Recommended:* on-demand for planning. *Change it:* RI/Savings/Spot are **indicative** — get a
> customer-specific AWS quote before committing.

---

## Warnings

- **Infeasible (SLA):** "At your P99 TTFT of {x}s and concurrency cap {n}, no measured point meets the
  target. Raise the wait budget, lower streaming speed, raise concurrency, or pick a faster GPU."
- **Context overflow:** "Your inputs need {needed} tokens of context but the window is {configured}.
  Increase the context window or reduce sources/answer length."
- **Owned capacity ($0 GPU):** "GPU price is $0 (owned hardware) — the self-host total excludes hardware
  cost, so the saving vs API isn't like-for-like."
- **Stranded boxes:** "{n} instance(s) don't complete a {ipr}-box serving group — they add cost but no
  serving capacity."

## Confidence language (deterministic — maps to `capacity.source`)

- **Measured match** — "Measured on this exact model, GPU, precision and sequence length."
- **Measured, scaled** — "Measured at ISL {x}; scaled to your {y}-token input — treat as extrapolated."
- **Extrapolated** — "Closest benchmark differs in {reasons}; directional, not a direct measurement."
- **Proxy model** — "Uses {proxy}'s benchmark as a stand-in for {model}."
- **Heuristic** — "No applicable benchmark; sizing is a rough estimate — validate before committing."

## Auto-size explanation

> **Size the fleet for me** — "We size for four things at once: enough memory to hold the model, enough
> throughput for your peak traffic, your streaming-speed and wait-time SLAs, and one spare replica if
> N+1 is on. Turn this off to set the instance count yourself."

## Change notices (never silent — reason-code driven)

- "Fleet changed **8 → 16** because **busiest-hour traffic** rose from 12 to 24 QPS."
- "GPU recommendation changed to **p6-b200** because **INT4** wasn't measured on the previous GPU."
- "Context window grew to **9,200 tok** because **sources per question** increased from 4 to 8."

*(These render from the input that changed and the engine field that moved — never inferred from cost
deltas alone.)*

## Customer-ready recommendation language (Stage F headline)

> "For **{volume} questions/month** of **{model}**, **calling the API is cheaper today** at about
> **{api $}/month**. Self-hosting {n} GPUs would cost about **{self $}/month** and only pays off above
> roughly **{breakeven} questions/month**. This is a **{confidence}** estimate; before committing,
> validate {top risk}."
