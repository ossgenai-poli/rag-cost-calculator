# 13-arch. Catalog & recommendation architecture

**Product intent:** *Production-quality decision support with intentionally curated model and hardware
coverage.* Not a POC, demo, rough estimator, or permissive marketplace.

**Governing principles**
- **CURATED BREADTH · PRODUCTION-GRADE DEPTH · NO INVENTED COVERAGE.**
- **Catalog verified options → filter for practical feasibility → recommend only with sufficient evidence.**

We may support fewer models/GPUs/combinations, but **every supported path must be technically credible,
internally reconciled, evidence-backed, deterministic, and tested.**

---

## Five separate concerns (never collapsed into a hardcoded list or per-model conditionals)

```
A. Research registry ──▶ B. Supported catalog ──▶ E. Recommendation engine
        (evaluated)          (passes the gate)          (ranks qualified)
                                  ▲     ▲
                      C. Compatibility &   D. Performance
                         feasibility          evidence
```

### A. Internal research registry
Tracks hardware and models **being evaluated** for possible support. An item may exist here **without
appearing in the customer-facing app**. Availability state may be `research-only`. This is where
roadmap accelerators (e.g. Rubin) and un-benchmarked hardware (e.g. B300, H200 today) live.

### B. Supported catalog
Contains **only** the model and hardware options that pass the customer-facing **quality gate**
([17-quality-gate.md](17-quality-gate.md)). Everything the customer can select or be recommended comes
from here. Data-driven records — **not** a hardcoded GPU array or bespoke per-model branches.

### C. Compatibility & feasibility
Determines whether a model can **realistically** run on a configuration — memory (weights *and* KV by
precision/context/concurrency), topology, parallelism, interconnect, framework/quantization support,
prefill & decode capacity, operating point, P99 TTFT, streaming target, utilization/queueing headroom,
N+1, and operationally reasonable node/fleet counts. Produces **structured rejection reasons**
([17-quality-gate.md](17-quality-gate.md)). A model is *not* viable merely because its weights can be
sharded across enough GPUs.

### D. Performance evidence
Benchmark observations with **complete provenance**, keyed by model+version, hardware/system, framework
+version, weight precision, KV precision, ISL/OSL, operating point, topology, TTFT statistic/percentile,
throughput dimensions, date, source. Evidence states: `measured-exact · measured-scaled · extrapolated ·
proxy · none` ([16-evidence-pricing-contracts.md](16-evidence-pricing-contracts.md)).

### E. Recommendation engine
Ranks **only** combinations that pass **compatibility + feasibility + pricing + evidence**. Layered
ranking (feasibility → SLA → evidence threshold → customer preference → cost —
[06-recommendation-presentation.md](06-recommendation-presentation.md)). Proxy/heuristic never become a
primary recommendation.

---

## The five states the UI must distinguish

> **AVAILABLE ≠ COMPATIBLE ≠ BENCHMARKED ≠ PRICED ≠ RECOMMENDED**

| State | Question it answers | Source of truth |
|---|---|---|
| **Available** | Can you get this hardware on AWS at all, and how? | Availability contract ([14-hardware-registry.md](14-hardware-registry.md)) |
| **Compatible** | Can this model *run* on this configuration? | Compatibility & feasibility (C) |
| **Benchmarked** | Do we have applicable performance evidence? | Evidence registry (D) |
| **Priced** | Do we have a truthful price for it? | Pricing contract ([16](16-evidence-pricing-contracts.md)) |
| **Recommended** | Did it pass all gates and rank well? | Recommendation engine (E) |

A row can be Available but not Benchmarked (e.g. B300 today), Compatible but not Priced (private
capacity), or Benchmarked but not Recommended (proxy evidence). The UI never lets one state imply another.

---

## Worked example (frozen evidence — see [18-reference-cases.md](18-reference-cases.md))

| Config | Available | Compatible | Benchmarked | Priced | Recommended |
|---|---|---|---|---|---|
| DeepSeek · **p6-b200 · FP4/INT4** | ✅ | ✅ | ✅ measured-scaled | ✅ | ✅ **primary** |
| DeepSeek · p6-b200 · FP8 | ✅ | ✅ | ⚠ substituted (fp4) → extrapolated | ✅ | ✗ not distinct |
| DeepSeek · **p5e/H200** | ✅ | ✅ | ✗ none → heuristic | ✅ | ✗ below evidence gate |
| DeepSeek · **p6-b300/B300** | ✅ (GA) | ✅ | ✗ none | ⚠ capacity-block | ✗ registry only (not evaluated) |

This is the architecture doing its job: **B300 is *available* but not *benchmarked*, so it is not
recommended** — no invented coverage.

---

## Design constraints

- Concerns A–E are **separate data layers with separate contracts**; the recommendation engine composes
  them. Phase 0 specifies them; Phase 1 implements them headless + unit-tested (per eligibility,
  rejection, evidence-mapping, price-state, confidence transition).
- No hardcoded GPU list; no per-model `if` branches. Models and hardware are catalog **records**.
- Keep distinct: **AWS instance type · accelerator/GPU · rack/system platform · serving-group topology.**
  A GB200/GB300 **NVL72 rack** benchmark is not automatically an **EC2-instance** benchmark.
