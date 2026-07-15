# 4. Guessing-points inventory

Every place in the **current** app where (a) the customer probably doesn't know the answer, (b) a
junior SA is likely to guess, (c) a default looks authoritative but is an assumption, (d) an
automatic change could surprise the user, or (e) a recommendation needs confidence/provenance beside
it. Each has a severity and the v2 remedy.

**Severity:** P1 = can materially distort the customer decision · P2 = significant confusion / needs
expert help · P3 = polish.

| # | Guessing point | Type | Sev | v2 remedy |
|---|---|---|---|---|
| G1 | **GPU instance** — customer/junior has no basis to pick H100 vs H200 vs B200 | b,c | **P1** | Recommend a ranked set; "Recommended among modeled AWS configs"; confidence chip |
| G2 | **Weight precision (BF16/FP8/INT4)** — junior can't explain the trade-off | a,b | **P1** | Fold into the GPU recommendation; Expert shows quality/memory/throughput |
| G3 | **Fleet count with auto-size ON** — the field still accepts a number that the engine may override | c,d | **P1** | When auto-size on, make it a **derived output**; manual entry only when off (explicit override) |
| G4 | **Interactivity target (tok/s/user)** — unfamiliar unit; junior guesses | a,b | **P1** | Replace with a response-experience preset; show the number in Expert |
| G5 | **Max TTFT statistic** — is 2 s a mean, median, P99? Comparing the wrong statistic to a tail SLA | e | **P1** | Labeled **P99 TTFT** (fixed in rc-qa-9); v2 keeps the label + customer-language wrapper |
| G6 | **Utilization target 70%** — an unexplained magic number | c | **P1** | Conservative/balanced/aggressive profile with headroom vs queueing explanation |
| G7 | **Max concurrent sequences** — confused with QPS or simultaneous users | a,b | **P2** | Derive from the operating point; Expert-only override with a clear definition |
| G8 | **Max context length** — customer doesn't know the configured window they need | a | **P2** | Derive min from query + sources + prompt + output; recommend headroom |
| G9 | **N+1 "HA"** — reads as AZ/quota/DR coverage; it's serving-replica redundancy only | c | **P2** | Rename "spare serving replica (N+1)"; state explicitly it's not full HA/DR |
| G10 | **GPU price live/reference/override** — provenance not obvious at the value | e | **P2** | Source chip beside the $/hr; explain when an override qualifies the verdict |
| G11 | **Purchasing discounts** — indicative discount mistaken for a guaranteed rate | c | **P2** | Separate indicative discount from "get a customer-specific AWS quote" |
| G12 | **Benchmark confidence** — measured vs extrapolated vs proxy vs heuristic not beside the fleet | e | **P1** | Confidence chip next to the fleet + "Where did this come from?" (partly done rc-qa-9/10) |
| G13 | **Auto-size dimensions** — what is being sized (memory? throughput? SLA? HA?) is unstated | d | **P2** | "Automatically size for memory, peak throughput, SLA and redundancy" |
| G14 | **Silent derived changes** — fleet jumps 8→16 with no explanation when peak QPS changes | d | **P1** | Show "changed from 8→16 because peak QPS 12→24" (reason-code driven, not value-inferred) |
| G15 | **Peak-to-average ratio** — customer often doesn't know it | a | **P2** | Offer steady/spiky/very-spiky presets + "I don't know" → range |
| G16 | **Fleet uptime hours** — asked as a number; derivable from schedule | a | **P2** | Ask operating schedule; compute hours/month; allow override |
| G17 | **Answer/query token lengths** — approximate; junior enters false precision | a | **P3** | "Typical" hints + ranges; accept approximate |
| G18 | **Prefill vs decode binding** — which constraint sets the fleet is invisible to a junior | e | **P2** | Surface the binding dimension in the fleet equation (done rc-qa-10); v2 explains it in plain terms |
| G19 | **"Measured" that is actually scaled/extrapolated** — over-trust | e | **P1** | Confidence ladder distinguishes measured / measured-scaled / extrapolated (done rc-qa-10); v2 keeps it beside the fleet |
| G20 | **Embedding/rerank model choice** — cost impact unclear to junior | c | **P3** | Recommend defaults; show the price line inline |

---

## Highest-risk cluster (fix first in later phases)

The P1 cluster **G1–G6 + G12 + G14 + G19** is the heart of the redesign: the GPU stack currently
demands expert knowledge to *enter*, and the confidence/provenance of the answer isn't beside the
answer. v2 turns those inputs into **recommendations/derived results with confidence in place**, and
makes every automatic change **explained, not silent**.

## Design guarantee against new guessing

- No Simple-mode field asks for a value the customer wouldn't plausibly know.
- Every recommended default shows **why** and **what changes if you change it**.
- Every derived value that moves shows **which input drove it** (reason code), never inferred from the
  before/after numbers.
- Confidence and provenance sit **next to the fleet**, not only in an advanced card below it.
