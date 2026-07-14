# Inference-benchmark grounding

This document explains how the self-hosted GPU sizing in the RAG cost calculator is
grounded in **measured** inference-throughput data, and how each "measured" claim is
made independently auditable (INF-001 / INF-002 / INF-003 / INF-004).

## Source

- **Provider:** SemiAnalysis **InferenceX** — a public benchmark harness that runs
  production inference frameworks (TensorRT-LLM, SGLang, vLLM) on real GPU hardware
  (B200, H200, H100) and records per-concurrency throughput/latency.
- **Methodology:** https://inferencex.semianalysis.com/about
- **Portal:** https://inferencex.semianalysis.com
- **Access used to bake the curves:** the InferenceX benchmark database (the
  `latest_benchmarks` view joined to `configs` and `workflow_runs`), pulled offline
  and frozen into [`lib/benchmarks-data.json`](../lib/benchmarks-data.json). The
  snapshot date is recorded in that file's `generatedAt`.

Software optimisation moves these numbers fast — SemiAnalysis has documented a
7.7× throughput gain on one model in 25 days from framework/recipe changes alone
(https://inferencex.semianalysis.com/blog/mi355x-kimi-k2-5-vllm-aiter-7x-speedup).
That is exactly why every baked curve is pinned to a **specific recipe commit,
container image and run** — the number is only meaningful with its provenance.

## What each baked point contains

Each series is one `model → gpu → precision → isl/osl` curve. Every concurrency
point carries:

| field | meaning | InferenceX column |
|---|---|---|
| `intvty` | interactivity — output tok/s per user | `median_intvty` |
| `tputPerGpu` | **decode** (output) throughput, tok/s/GPU | `output_tput_per_gpu` |
| `inputTputPerGpu` | **prefill** (input) throughput, tok/s/GPU | `input_tput_per_gpu` |
| `ttft` | time to first token, seconds — **P99 tail** | `p99_ttft` |

Every series also carries a `provenance` block: the GitHub Actions `runId` + direct
`runUrl`, the recipe/source `commit` (head SHA), the measurement `date`, the
container `image`, the framework, the `specMethod` (speculative decoding — **off**
for every baked series), `disagg`, the TP topology and prefill/decode GPU counts.

## INF-002 — prefill is measured, not a fixed 8×

Earlier builds estimated prefill (input) throughput as a flat `8 × decode`
throughput. That is wrong in both directions:

- For **short-input** workloads (ISL ≈ OSL) the real ratio is ≈ **1×**, so the 8×
  heuristic overstated prefill capacity ~8× and hid a real prefill bottleneck.
- For **long-context RAG** (ISL ≫ OSL) the ratio approaches the ISL/OSL ratio.

We now read the measured `input_tput_per_gpu` at the selected operating point.
Because prefill work is ~proportional to input tokens (and the data confirms input
tok/s scales roughly linearly with ISL — the 1024→8192 bucket step is ≈7×), when the
workload's input length differs from the benchmarked ISL bucket we **scale the
measured input throughput to the actual ISL** rather than sizing a 3K-token RAG
prompt against a 1K-token prefill rate. The fleet is `max(prefill-bound,
decode-bound)` replicas, so input-heavy RAG is correctly reported as prefill-bound.

## INF-003 — TTFT is the P99 tail, and it is labelled as such

The baked `ttft` is `p99_ttft` (seconds), and it is labelled **"P99 TTFT"**
everywhere it appears (grounded card, JSON, Markdown). The TTFT SLA gate compares
the customer's target against this P99 tail — never against an unlabelled or median
statistic. Note that at very low concurrency the benchmark P99 includes cold-start
warmup and is not monotonic; the default concurrency (32) selects a well-sampled
operating point rather than a warmup-dominated one.

## "measured" vs "extrapolated" vs "proxy" vs "heuristic"

A point is only labelled **measured** when the model, GPU, precision, ISL, OSL,
topology (whole-box multiple) **and** provenance (a traceable run URL + recipe
commit) all match. Any substitution — precision swapped, sequence length off the
bucket by more than 1.5×, a partial/odd GPU topology, or a proxy model — downgrades
the label to **extrapolated** (or **proxy** for a proxy model, **heuristic** when no
curve exists) and the recommendation is shown **qualified**.

## Model → InferenceX key mapping

| RAG-calc model | InferenceX key | provenance |
|---|---|---|
| DeepSeek-V4-Pro (OSS) | `dsv4` | measured |
| MiniMax-M3 (OSS) | `minimaxm3` | measured |
| GLM-5.2 (OSS) | `glm5` | proxy (GLM-5 curve) |
| Nemotron-3-Ultra (OSS) | — | none → heuristic |
| Kimi-K2.6 (OSS) | `kimik2.6` | not baked → heuristic |

## INF-004 — planning capacity, not a guarantee

Sizing here is a **directional planning estimate**, not an availability or
tail-latency guarantee. A disclaimer to that effect travels with the grounded card
and every export: validate with the intended serving stack and a production-shaped
load test before committing.

## Refreshing the data

Re-pull the curves from the InferenceX DB (`latest_benchmarks` joined to `configs`
and `workflow_runs`), keeping `output_tput_per_gpu`, `input_tput_per_gpu` and
`p99_ttft` plus the full provenance block, and rewrite
[`lib/benchmarks-data.json`](../lib/benchmarks-data.json) with a fresh `generatedAt`.
See the cross-project reference at
`C:\Users\pnrao\OneDrive\Documents\research\inference-benchmark-grounding.md` for the
source catalogue and schema.
