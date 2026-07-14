# 8. Recommendation presentation

**Never present one opaque "best GPU."** Present a small ranked set the SA can defend, plus the options
that were rejected and why. All options come from running the **same engine** over candidate
configurations that **passed compatibility, feasibility, pricing and evidence gates**
([13-catalog-architecture.md](13-catalog-architecture.md), [17-quality-gate.md](17-quality-gate.md));
the presentation layer only ranks and labels.

> Every recommendation block is captioned: **"Recommended among currently modeled and evidence-qualified
> AWS configurations."** — not a claim about all possible hardware.

**Phase-0 status of the numbers below:** the multi-option cards require the Phase-1 **recommendation
sweep** (not built in Phase 0). Until it exists, this doc specifies (1) the card **structure** and the
**ranking contract**, and (2) a **worked real example** whose every number is a reference case computed
on the frozen rc-qa-11 engine ([18-reference-cases.md](18-reference-cases.md)). No fleet count, delta or
confidence label here is invented.

---

## The card set (structure)

### 1. Recommended — balanced *(primary)*
The default winner under the customer's optimization preference, subject to hard feasibility and the
minimum-evidence threshold.

### 2. Lowest-cost feasible alternative
Cheapest configuration that still passes every hard constraint **and** the evidence threshold. May carry
lower confidence or a tighter margin.

### 3. Highest-confidence *or* lowest-latency alternative
Whichever best serves the *other* likely priority — strongest evidence (exact measured match) or the
snappiest P99 TTFT.

### 4. Rejected / infeasible options *(collapsed, expandable)*
Every excluded candidate with its **structured reason code** — so the specialist sees the search space,
not just the winner.

Each visible card carries: configuration · cost (absolute + Δ) · **confidence chip** · binding
constraint (plain terms) · one-line trade-off · actions *(Use this · Compare · Tune)*.

---

## Worked real example — DeepSeek-V4-Pro, 200M questions/mo *(all numbers = reference cases)*

On the **frozen evidence**, DeepSeek has measured data on **B200 only**, at **FP4** precision. So the
honest option set for this workload is **one evidence-qualified configuration** plus rejections — a
faithful demonstration of *curated breadth, no invented coverage*:

```
✅ Recommended — balanced                                    [R1]
   p6-b200.48xlarge · INT4 · 87 instances (86 + 1 N+1)
   $7.18M / month · prefill-bound
   Confidence: Measured·scaled  (measured at ISL 1,024, scaled to 2,910)
   Why: the only evidence-qualified DeepSeek config that meets the 2 s P99 TTFT
        and 30 tok/s/user SLA.

💲 Lowest cost (feasible, evidence-qualified)
   — none below the recommended.  The cheaper GPUs (H200/H100) have no DeepSeek
     benchmark and are excluded (see rejected).

🎯 Highest confidence
   — none.  No exact Measured match exists: your 2,910/500 sequence is off the
     measured 1,024/1,024 bucket, so the best available evidence is Measured·scaled.

✕ Rejected (3)
   p5e (H200) · INT4  — no DeepSeek benchmark → heuristic, below evidence threshold   [R3]
   p5  (H100) · INT4  — no DeepSeek benchmark → heuristic, below evidence threshold   [R4]
   p6-b200 · FP8      — no DeepSeek FP8 benchmark; reuses the FP4 curve (precision
                        substituted) → not a distinct or higher-confidence option     [R2]
```

The heuristic H200/H100 paths would *display* a cheaper "self-host efficient" answer
($554k / $522k) — which is exactly why they are **rejected, not shown as alternatives**: the number
isn't evidence, and a customer must not be handed it as one.

Once the Phase-1 sweep spans **multiple models and B200/B300 with real evidence**, cards 2 and 3
populate with genuinely distinct configurations; the structure and ranking are unchanged.

---

## Ranking contract (deterministic, layered)

Applied in strict order — later criteria only break ties left by earlier ones (owner-confirmed order):

1. **Hard feasibility** — memory floor, context window, a valid operating point under the concurrency
   cap, complete serving-group topology. Fail → rejected (feasibility reason).
2. **Customer SLA & operational constraints** — interactivity target, **P99 TTFT**, availability (N+1).
   Fail → rejected (SLA reason).
3. **Minimum evidence threshold** — must be **measured-exact** or a defensible **measured-scaled /
   extrapolated** path on a *real, applicable* benchmark. **Proxy and heuristic never qualify as a
   primary recommendation** — they are excluded from Simple mode (kept only in Expert evidence review,
   unmistakably qualified).
4. **Customer optimization preference** — cost / latency / confidence / predictability (Stage A).
5. **Cost** — among otherwise comparable options, cheapest wins.

The **recommended-balanced** card tops this ranking; alternatives are the best option that *differs* on
one axis. A config missing any gate is **rejected with a reason code**, never silently promoted.

---

## Design constraints

- The candidate set and every reason are **engine/registry-derived** (feasibility, `capacity.source`,
  reason codes, cost). Phase 0 specifies the contract; Phase 1 builds the sweep with tests per
  eligibility decision and rejection reason.
- No option is labelled "best" in absolute terms — always "among modeled AWS configs."
- Never label a model/precision/hardware/topology mismatch as **Measured** (P1-UX-002).
- Selecting an alternative re-runs the same engine and updates the rail, hierarchy and export
  consistently (one source of truth).
