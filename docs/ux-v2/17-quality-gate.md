# 17-arch. Practical-feasibility filtering + customer-facing quality gate

**Positioning:** *"Production-quality decision support with intentionally curated model and hardware
coverage."* The tool is **not** described as a POC, demo, rough estimator, or permissive marketplace.

---

## Practical-feasibility filtering (concern C)

A combination is **not viable merely because its weights can theoretically be sharded across enough
GPUs.** The feasibility layer must consider **all** of:

- model-weight memory;
- KV-cache memory by **precision, context and concurrency**;
- **weight precision independent of KV precision**;
- complete **serving-group topology**;
- tensor / expert / pipeline parallelism;
- GPU count and **interconnect** (NVLink/EFA, single- vs multi-node);
- cross-node communication cost;
- framework and quantization support;
- **prefill and decode** capacity (separately);
- batching / concurrency operating point;
- **P99 TTFT**; per-user streaming target;
- utilization and queueing headroom;
- **N+1** serving redundancy;
- operationally **unreasonable** node/fleet counts.

> Example: a very large model spread over many small **G5** instances may pass a naïve memory check yet
> be **operationally infeasible** on topology, interconnect, TTFT and complexity. The filter must reject
> it with a reason, not surface it as viable.

### Structured rejection reasons (reason-coded, testable)
- `model-does-not-fit-serving-group` — doesn't fit a complete serving group;
- `node-count-exceeds-topology` — required nodes exceed a supported topology;
- `no-compatible-runtime-or-precision` — no framework/precision path;
- `sla-unmet-ttft-or-streaming` — no benchmark point meets the TTFT/streaming SLA;
- `evidence-topology-mismatch` — available evidence uses a materially different topology;
- `fleet-exceeds-practical-limit` — fleet beyond a documented practical maximum;
- `no-usable-price` — no truthful price state;
- `research-only-or-unavailable` — hardware not customer-available.

The app **explains why** a combination was rejected without presenting it as a viable recommendation.

---

## Customer-facing quality gate (promotion into the supported catalog)

A model/GPU option may enter the **supported customer-facing catalog** only when it has **all** of:

1. **verified model and hardware facts** (schema-complete — [14](14-hardware-registry.md), [15](15-model-catalog.md));
2. a **compatible feasibility model** (concern C above);
3. **sufficient performance evidence** (measured-exact or defensible measured-scaled/extrapolated — [16](16-evidence-pricing-contracts.md));
4. a **truthful price state** ([16](16-evidence-pricing-contracts.md));
5. **explicit provenance** (availability + benchmark + price sources);
6. **deterministic calculations**;
7. **reconciled UI and export values** (the rc-qa-10 fleet-equation discipline);
8. **unit and acceptance tests**;
9. **documented limitations**.

> **If a required element is missing, exclude the option** rather than filling the gap with a plausible
> value.

---

## Gate applied to the frozen evidence (worked)

| Candidate | Facts | Feasibility | Evidence | Price | Tests | → Gate |
|---|---|---|---|---|---|---|
| DeepSeek-V4-Pro · p6-b200 · FP4 | ✅ | ✅ prefill-bound | ✅ measured-scaled | ✅ aws-public/ref | ✅ rc-qa10 | **PASS (supported)** |
| MiniMax-M3 · p6-b200 · FP8 | ✅ | ✅ | ✅ measured | ✅ | ✅ | **PASS (supported)** |
| GLM-5.2 · p6-b200 | ✅ | ✅ | ⚠ proxy | ✅ | ✅ | **Expert-only** (proxy ≠ primary) |
| DeepSeek · p5e/p5 | ✅ | ✅ | ✗ none (heuristic) | ✅ | — | **FAIL** → excluded |
| any model · p6-b300 / GB200 | ⚠ | ⚠ | ✗ none | ⚠ CB/private | — | **FAIL** → registry only |
| Nemotron / Kimi (any GPU) | ✅ | ✅ | ✗ none | ✅ | — | **FAIL** → excluded |

---

## Thought-leadership standard

Thought leadership comes from **technical depth and judgment — not the number of dropdown options.**
The app must demonstrate that recommendations account for:

- weights vs KV-cache memory; weight precision independent of KV precision;
- context × concurrency interaction; **prefill vs decode** bottlenecks;
- **P99 TTFT** percentile semantics; batching / operating points;
- serving **topology & interconnect**; framework compatibility;
- utilization & failure headroom;
- **exact / scaled / extrapolated** evidence; transparent exclusions and rejection reasons.

We do not need every model or GPU. **The combinations we support must withstand scrutiny from an
experienced inference engineer.**
