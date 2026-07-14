# 18. Reference cases — every structural number, from the frozen engine

**Purpose (P1-UX-001 / P1-UX-002):** every structural number shown anywhere in these artifacts
(wireframe, scripts, recommendation cards) comes from **one explicitly documented input set**, computed
on the frozen **rc-qa-11** engine (`d749309`). No number here is invented; each is reproducible.

**How these were produced (read-only, no engine change):** `calculate(inputs, priceBook)` on rc-qa-11
with `public/prices.json`, via the same `applyGpuSelection` the UI uses. Dollar values depend on the
committed reference price book and will move with a live price refresh — they are **planning figures,
not quotes**.

---

## Shared input set (the canonical workload)

| Input | Value |
|---|---|
| Model | DeepSeek-V4-Pro (open weights) · InferenceX key `dsv4` |
| GPU | p6-b200.48xlarge (8× B200) |
| Weight precision | INT4 (weight bits 4) |
| Monthly question volume | 200,000,000 |
| Input / output tokens | 2,910 / 500 (default RAG prompt) |
| Concurrency cap | 32 · Utilization target | 70% · Peak factor | 1 · N+1 | on |

Cases R3–R5 change exactly one dimension from this set (noted per row).

---

## The cases

| # | Change from canonical | `capacity.source` | Confidence chip | Binding | Fleet (boxes) | Self-host $/mo | API $/mo | Verdict | Qualified |
|---|---|---|---|---|---|---|---|---|---|
| **R1** | — (canonical) | `extrapolated` (islScale 2.84) | **Measured·scaled** | prefill | **87** (86 + 1 N+1) | $7,176,630 | $6,492,000 | API wins | no |
| **R2** | precision → FP8 | `extrapolated` (fp4 **substituted** for fp8) | **Extrapolated** | prefill | 87 (86 + 1) | $7,176,630 | $6,492,000 | API wins | no |
| **R3** | GPU → p5e (H200) | `heuristic` (no benchmark) | **Heuristic** | decode | 12 (11 + 1) | $554,420 | $6,492,000 | self-host efficient | **yes** |
| **R4** | GPU → p5 (H100) | `heuristic` (no benchmark) | **Heuristic** | decode | 13 (12 + 1) | $522,330 | $6,492,000 | self-host efficient | **yes** |
| **R5** | volume → 5,000,000 | `extrapolated` (islScale 2.84) | **Measured·scaled** | prefill | 4 (3 + 1) | $329,960 | $162,300 | API wins | no |

---

## What each case proves

### R1 — the canonical recommendation (used in the wireframe rail + scripts)
- Prefill-bound. Reconciled equation (from `fleet-explain`):
  **221,461 input tok/s ÷ (3,715 prefill tok/s/replica × 70% = 2,600) → 86 replicas**, + 1 N+1 × 1 box
  = **87 boxes**.
- `capacity.source = "extrapolated"`, `prefillEstimated = false`, `prefillIslScale ≈ 2.84`
  (measured input throughput at ISL 1,024, scaled to the 2,910-token workload) → confidence
  **Measured·scaled**. `ttftPercentile = "p99"`, P99 TTFT ≈ 1.22 s.
- **Verdict: API wins** — self-host $7.18M vs API $6.49M/mo. Break-even ≈ **84 QPS calendar ≈ 221M
  questions/mo**; at 200M we sit just below it. (This corrects the earlier "~135M" placeholder.)

### R2 — FP8 is NOT a distinct measured option (anchors P1-UX-002)
Requesting FP8 for DeepSeek resolves to the **same fp4 curve** (no DeepSeek B200 FP8 benchmark exists),
so the throughput, fleet and cost are **identical to R1**, and `capacity.source` is `extrapolated` with
the reason *"benchmark precision fp4 substituted for requested fp8."* Therefore a card labelled
**"p6 · FP8 · Measured"** would be false on two counts (not measured; not a distinct result).

### R3 / R4 — other GPUs are heuristic, not evidence (anchors P1-UX-002)
DeepSeek has **no baked benchmark on H200 or H100**, so p5e/p5 fall to the **heuristic** path:
decode-bound, ~12–13 boxes, and a "self-host efficient" verdict that is **qualified** because it rests
on a generic throughput estimate, not measurement. Per the evidence policy these are **excluded from
Simple mode** and never a primary recommendation — the too-good-to-be-true $554k/$522k figures are
exactly why.

### R5 — small workload (used in the "small customer" script)
At 5M questions/mo the same model/GPU sizes to **4 boxes**, still prefill-bound, and **API wins**
decisively ($330k self-host vs $162k API; break-even ≈ 3.9 QPS ≈ 10M/mo).

---

## The honest catalog consequence

On the **frozen evidence**, the only **evidence-qualified** DeepSeek configuration is
**B200 · FP4/INT4 (Measured·scaled)**. FP8 is the same curve substituted (extrapolated); H200/H100 are
heuristic. This is the "curated breadth, no invented coverage" position in miniature: for this model,
the tool credibly supports **one** GPU/precision path today and honestly rejects the rest — see
[13-catalog-architecture.md](13-catalog-architecture.md) and [17-quality-gate.md](17-quality-gate.md).

*(All values reproducible on rc-qa-11; the R1 structural numbers are additionally asserted by
`lib/rc-qa10.test.ts`.)*
