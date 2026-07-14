# 1. Customer journey map

The tool is used **live, in a customer meeting**. The SA is the driver; the customer supplies
answers a normal buyer would know. The map below is the top-to-bottom spine of the Simple-mode page
(one progressive page with a persistent recommendation rail — see wireframes), and it is also the
order the exported report reads in.

Legend for "who supplies it": **C** = customer answers · **SA** = SA judgment · **APP** = app derives/recommends.

---

## Stage A — Establish the decision  *(who: SA + C)*

**Goal:** frame the session so only the fields that matter to *this* decision are shown.

- **What are you deciding?** Estimate API cost · Compare API vs self-hosting · Size an existing
  self-hosted deployment · Optimize an existing GPU fleet.
- **Stage of work?** Prototype · Production · Growth forecast.
- **What matters most?** Lowest cost · Lowest latency · Data control · Predictable capacity ·
  Operational simplicity. → sets the **optimization preference** used to rank recommendations.

**App behavior:** the decision + "what matters most" pick a starting **operational profile** and
**optimization preference**, and hide fields irrelevant to the decision (e.g. "Estimate API cost"
hides the whole GPU section). Nothing about infrastructure is asked yet.

**Exit criterion:** the SA knows which stages follow and the customer has committed a goal.

---

## Stage B — Capture business & workload facts  *(who: C)*

**Goal:** collect only what a buyer actually knows. Customer-language labels; technical name secondary.

- **Customer facts** (the SA enters what the buyer knows): Traffic — **queries/month** or **QPS**;
  **peak-to-average ratio**; **hours of operation**. Corpus — **number of documents**, **average document
  size**, **refresh frequency**. Response — **expected answer length**.
- **Recommended, customer-adjustable** (the app proposes a default the customer can confirm or change,
  *not* a pure fact): **how many sources retrieved** ("Context chunks sent to the model" — classified
  **Recommended** in [02-field-inventory.md](02-field-inventory.md) and rendered with the Recommended chip
  in the wireframe).

Most Stage-B fields are **Customer facts**; the retrieved-sources count is a **Recommended** value the
customer accepts or adjusts — the taxonomy chip is shown per field so the SA can tell them apart. If the
customer doesn't know a fact, they use the range/"I don't know" control (Stage B never blocks on a number
— see [08-unknown-range-handling.md](08-unknown-range-handling.md)).

**Exit criterion:** business truth captured, with uncertainty recorded where it exists.

---

## Stage C — Translate customer-experience requirements  *(who: C via SA, translated by APP)*

**Goal:** turn "what the user should feel" into SLA numbers without asking the customer for tok/s.

- **Response experience** preset → conversational / interactive-RAG / analyst / batch → sets the
  **streaming speed (interactivity)** target.
- **Acceptable wait before the answer starts** → sets the **P99 TTFT** target.
- **Availability expectation** (business hours / 24×7 / 24×7 high-availability posture) → sets **N+1 redundancy** and
  **uptime hours**.

**App behavior:** presets map plain choices to engine SLA inputs; the SA can reveal the exact number.

**Exit criterion:** SLA + availability expressed as engine inputs, each traceable to a customer choice.

---

## Stage D — Recommend infrastructure  *(who: APP)*

**Goal:** the app proposes everything the customer doesn't know — the SA never guesses GPU internals.

App derives/recommends: **GPU family**, **weight precision**, **KV precision**, **context window**,
**max concurrent sequences**, **serving-group topology**, **base replicas**, **N+1 replicas**,
**billed instances**, **utilization target**. Each carries a one-line reason and a **confidence
badge in place** (measured / measured-scaled / extrapolated / proxy / heuristic).

**App behavior:** presents a **ranked set** (recommended-balanced + alternatives + rejected-with-
reasons), not one opaque "best GPU" — see [06-recommendation-presentation.md](06-recommendation-presentation.md).

**Exit criterion:** a defensible recommended configuration with alternatives, each with confidence.

---

## Stage E — Review & override  *(who: SA)*

**Goal:** let the SA accept, edit, or compare — Simple stays clean, Expert exposes every lever.

- Accept the recommendation, or open **"Tune assumptions"** per section (Expert drawers).
- Any override flips the affected field from **Recommended** → **Expert override** and re-labels the
  fleet as manually capped where relevant.
- Every derived value that moves shows **what changed and which input drove it** (reason code, not a
  value delta).

**Exit criterion:** the SA owns the configuration and understands each change.

---

## Stage F — Explain the result  *(who: APP, for the customer)*

**Goal:** a customer-ready narrative the SA can say out loud, in the result hierarchy
([10-result-hierarchy.md](10-result-hierarchy.md)):

1. **Recommendation** — API / self-host / inconclusive.
2. **Why** — the volume, cost and SLA drivers (from engine fields, deterministic).
3. **Estimated cost** — monthly / annual / per-query.
4. **Recommended architecture** — model, GPU, fleet.
5. **Confidence** — measured / extrapolated / proxy / heuristic.
6. **Risks & exclusions** — ops, quota, load-test, HA-limitations.
7. **Advanced evidence** — formulas, benchmark point, memory/throughput math.

**Exit criterion:** the SA can defend the number without reading source code.

---

## Stage G — Compare alternatives  *(who: SA + APP)*

**Goal:** side-by-side scenarios for the customer to weigh.

- Compare recommended vs a saved scenario vs an alternative GPU/precision.
- Each column carries its own cost, confidence and binding constraint.

**Exit criterion:** the customer sees the trade space, not a single answer.

---

## Stage H — Export & hand off  *(who: SA)*

**Goal:** a report that survives review after the meeting.

- Export carries the full narrative + confidence + provenance + risks + the reconciled fleet
  equation + heuristic range (all already in the engine's JSON/Markdown as of rc-qa-11).
- The report states **"Recommended among the AWS configurations currently modeled,"** and lists what
  must be validated before purchase.

**Exit criterion:** a self-contained artifact a reviewer who wasn't in the room can trust.

---

## The flow, condensed

```
A Decide ─▶ B Workload facts ─▶ C Experience → SLA ─▶ D App recommends
                                                          │
                        H Export ◀─ G Compare ◀─ F Explain ◀─ E Review/override
```

Experienced SAs jump straight to any stage; new SAs follow the flow. The recommendation rail is
visible from Stage B onward, updating as facts arrive so the cost/answer is never more than a glance
away.
