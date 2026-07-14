# 8. Recommendation presentation

**Never present one opaque "best GPU."** Present a small ranked set the SA can defend, plus the
options that were rejected and why. All options come from running the **same engine** over candidate
configurations; the presentation layer only ranks and labels.

> Every recommendation block is captioned: **"Recommended among the AWS configurations currently
> modeled."** — it is not a claim about all possible hardware.

---

## The card set

### 1. Recommended — balanced *(primary)*
The default winner under the customer's optimization preference, subject to hard feasibility and the
minimum evidence threshold.

```
✅ Recommended — balanced
p6-b200.48xlarge · INT4 · 87 instances
$X,XXX,XXX / month   ·   Confidence: Extrapolated (measured 1024, scaled to 2,910)
Why: meets your 2 s P99 TTFT and 30 tok/s/user at the lowest cost among feasible measured configs.
[ Use this ]   [ Compare ]   [ Tune assumptions ]
```

### 2. Lowest-cost feasible alternative
Cheapest configuration that still passes every hard constraint (SLA, memory, context). May carry
lower confidence or a tighter margin.

```
💲 Lowest cost (feasible)
p5e.48xlarge · FP8 · 96 instances
−6% vs recommended   ·   Confidence: Proxy
Trade-off: relies on a proxy benchmark; validate throughput before committing.
```

### 3. Highest-confidence *or* lowest-latency alternative
Whichever best serves the *other* likely priority — the configuration with the strongest evidence
(exact measured match) or the snappiest P99 TTFT.

```
🎯 Highest confidence
p6-b200.48xlarge · FP8 · 92 instances
+4% vs recommended   ·   Confidence: Measured match
Trade-off: exact measured point, slightly more GPUs than the INT4 option.
```

### 4. Rejected / infeasible options *(collapsed, expandable)*
Every candidate that was excluded, with the **reason code** — so the specialist sees the search space,
not just the winner.

```
✕ Rejected (4)
p5.48xlarge · INT4 — infeasible: memory floor exceeds SLA-feasible fleet at your context window
p6-b200 · BF16 — dropped: 2.1× the cost of the FP8 option at equal confidence
p5e · INT4 — no benchmark: below minimum evidence threshold (heuristic only)
p5.48xlarge · FP8 — infeasible: no operating point meets the 2 s P99 TTFT under the concurrency cap
```

---

## Ranking model (deterministic, layered)

Applied in strict order — later criteria only break ties left by earlier ones:

1. **Hard feasibility** — must satisfy memory floor, context window, and have *an* operating point
   under the concurrency cap. Infeasible → rejected with a reason code.
2. **Customer SLA & operational constraints** — must meet the interactivity target and the **P99 TTFT**
   SLA; must satisfy the availability choice (N+1). Fails → rejected (SLA reason).
3. **Minimum evidence / confidence threshold** — must be at least *extrapolated* (a real benchmark
   scaled), unless the SA explicitly opts into heuristic-only. Below → shown separately as "no benchmark."
4. **Customer optimization preference** — cost / latency / confidence / predictability, from Stage A.
5. **Cost** — among otherwise comparable options, cheapest wins.

The **recommended-balanced** card is the top of this ranking; the alternatives are the best option
that *differs* from it on one axis (cheapest, highest-confidence, lowest-latency).

---

## What each card must carry

- Configuration (GPU · precision · fleet size).
- Cost (absolute + Δ vs recommended).
- **Confidence chip** (measured / measured-scaled / extrapolated / proxy / heuristic).
- The **binding constraint** (prefill- or decode-bound) in plain terms.
- One-line **trade-off** vs the recommended option.
- Actions: *Use this · Compare · Tune*.

---

## Design constraints

- The candidate set and every reason are **engine-derived** (feasibility, `capacity.source`, reason
  codes, cost). Phase 0 does **not** build this sweep — it specifies the contract for Phase 1.
- No option is labeled "best" in absolute terms — always "among modeled AWS configurations."
- A heuristic-only option is never silently promoted into the recommended slot; it appears below the
  evidence threshold with an explicit qualifier.
- Selecting an alternative re-runs the same engine and updates the rail, result hierarchy and export
  consistently (one source of truth).

## Open question for reviewers

- **Sweep breadth:** all modeled GPU families × {BF16, FP8, INT4}, or a curated shortlist per model?
  (Cost/latency of the sweep vs completeness — flagged in the decision log.)
