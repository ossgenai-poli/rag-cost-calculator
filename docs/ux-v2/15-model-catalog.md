# 15-arch. Curated model catalog + selection criteria

**Policy:** propose **up to ~10** open-weight model configurations. **Ten is a ceiling, not a quota** —
if only six or eight meet the standard, support six or eight. **Do not add a model for catalog variety,
popularity or leaderboard position.** Models are **data-driven catalog records** — no per-model
conditionals.

---

## Model record schema (required before a model is supported)

| Field | Example | Required for |
|---|---|---|
| id / label / version | `deepseek-v4-pro-oss` / "DeepSeek-V4-Pro" | identity |
| architecture · dense/MoE · total & active params | MoE · 720B total (active TBD) | memory sizing |
| context limit | 163,840 | context feasibility |
| supported weight precisions | FP4/INT4, FP8, BF16 | precision × memory × throughput |
| supported KV precisions | BF16, FP8 | KV memory |
| license (commercial usability) | open-weights, commercial-OK | eligibility |
| serving-framework compatibility | TRT-LLM / SGLang / vLLM | feasibility |
| memory-sizing inputs | paramsB, kvBytesPerToken | engine |
| **applicable evidence path** | InferenceX `dsv4`, B200 FP4, measured | recommendation gate |
| metadata sources | model card / InferenceX registry | provenance |

---

## Selection criteria

Commercial usability · meaningful adoption · active serving-framework support · RAG/instruction/reasoning
relevance · reliable technical metadata · representation across useful size/architecture classes · **at
least one defensible evidence path**. HF leaderboards, downloads and ecosystem adoption may *inform*
selection, but **model-quality rankings are not inference-performance evidence.**

---

## Proposed curated table (from the frozen registry + evidence)

Evidence and metadata are taken from the frozen engine (`lib/model-prices.ts`) and the InferenceX
registry (the project's authoritative performance source).

| Model | Params (ctx) | InferenceX key | Evidence (B200) | Catalog status |
|---|---|---|---|---|
| **DeepSeek-V4-Pro** | 720B (163,840) | `dsv4` | **measured** — FP4 | ✅ **Supported (primary-eligible)** |
| **MiniMax-M3** | 480B (1,000,000) | `minimaxm3` | **measured** — FP8 | ✅ **Supported (primary-eligible)** |
| **GLM-5.2** | 400B (131,072) | `glm5` (GLM-5) | **proxy** — FP4/FP8 | ⚠ **Expert evidence only** — proxy never primary (Q7) |
| Nemotron-3-Ultra 550B-A55B | 550B / A55B (131,072) | — | **none** → heuristic | ✗ **Excluded from supported** (registry only) |
| Kimi-K2.6 | ~1T (262,144) | not baked | **none** → heuristic | ✗ **Excluded from supported** (registry only) |

**Curated supported set today = 2 primary (DeepSeek-V4-Pro, MiniMax-M3) + 1 proxy-qualified (GLM-5.2,
Expert only).** Nemotron and Kimi are **dropped from the customer catalog** because they have no
applicable benchmark — showing their heuristic numbers would violate "no invented coverage."

### Candidate expansion (research registry → evaluate, don't expose yet)
The InferenceX registry also keys models that could be evaluated **if** B200 evidence + full metadata
exist: `dsr1` (DeepSeek-R1), `qwen3.5` (Qwen-3.5-397B-A17B), `llama70b` (Llama-3.3-70B-FP8),
`gptoss120b` (gpt-oss-120b), `kimik2.5`. Each must pass the quality gate before entering the catalog;
none is exposed on the strength of existing-elsewhere data alone.

---

## Data-provenance gap (must close before promotion)

The frozen catalog uses **near-future model identities** (2026 naming). Before any model is promoted to
the customer-facing catalog it needs its **authoritative metadata sources attached** — a real released
model card (architecture, total/active params, context, license, precision support) plus the InferenceX
run(s) for its evidence. Any model whose released identity/metadata cannot be sourced stays
**research-only**. We never present a speculative model's specs as authoritative fact.

---

## UX consequence

- **Simple mode** offers only **primary-eligible** models (measured evidence). The SA selects an exact
  model or a model **class** that must resolve to a concrete supported model before any cost/capacity is
  computed (Q6).
- **GLM-5.2 (proxy)** appears only in Expert, unmistakably qualified; it is never the primary
  recommendation.
- **Nemotron / Kimi** do not appear as selectable supported models; they remain in the internal registry
  as "not evaluated."
- Thought leadership comes from this **judgment and depth**, not from a long dropdown. The supported
  combinations must withstand scrutiny from an experienced inference engineer.
