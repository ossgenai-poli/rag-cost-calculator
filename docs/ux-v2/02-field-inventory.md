# 2. Field inventory & taxonomy

Every current input classified into the four types, with the customer-language relabel, the
recommended/default behavior, its effect, and the mode it lives in.

**Taxonomy (four classes — every data field maps to exactly one; P2-2)**
- **Fact** — a customer fact the SA enters (Simple). Only used when a normal buyer plausibly knows it.
- **Derived** — calculated from other inputs; a read-only *output* unless an Expert override is opened.
- **Recommended** — a default the app selects *with a reason*; editable (editing → **Expert override**).
- **Expert** — normally hidden; editable in a Tune drawer.

**Two orthogonal concepts that are NOT field-taxonomy classes** (they were the source of the earlier
hybrid labels; now called out explicitly):
- **Scope** — session/decision inputs that *frame* the tool (e.g. "what are you deciding?", serving
  Mode). They select which fields matter; they are not data values, so they carry no taxonomy chip.
- **External (provenanced)** — values supplied by an external system with a **source state**, not by the
  customer (GPU price, benchmark evidence). They render with a *provenance* treatment
  ([16-evidence-pricing-contracts.md](16-evidence-pricing-contracts.md)); a customer edit converts the
  value into an explicit **Expert override**. An External value is never a customer **Fact**.

Each field below gets **exactly one** class (or is marked *Scope* / *External*). "Editable" recommended
fields note that an edit reclassifies them as an Expert override.

Columns: **Current label → Proposed label · Class · Mode · Recommended behavior · Effect**

---

## Workload (business facts)

| Current | Proposed label | Class | Mode | Recommended behavior | Effect |
|---|---|---|---|---|---|
| Queries per month | **Monthly question volume** | Fact | Simple · Enter | none (customer number); or derive from QPS | Linear driver of API cost, decode/prefill demand, fleet size |
| From QPS toggle | **Enter as QPS instead** | Fact | Simple · Enter | remembers method | display only; same underlying volume |
| User query length (tokens) | **Typical question length** | Fact | Simple · Enter | 40–60 tok default with "typical" hint | small input-token driver |
| Output length (tokens/answer) | **Typical answer length** | Fact | Simple · Enter | 300–600 tok by response type | decode demand + API output cost driver |
| Peak-to-average ratio | **Busiest hour vs average** | Fact | Simple · Enter (range) | 1.5× default; offer "steady/spiky/very spiky" | scales the fleet the peak must cover |

*Meaning/why:* traffic × per-query tokens = the token volume every downstream cost and the GPU fleet
are sized from. Peak ratio matters only to self-host (fleet must cover peak); it never changes API cost.

---

## Corpus

| Current | Proposed label | Class | Mode | Recommended behavior | Effect |
|---|---|---|---|---|---|
| Number of documents | **How many documents** | Fact | Simple · Enter | none | one-time + refresh embedding cost; index storage |
| Avg tokens per document | **Average document size** | Fact | Simple · Enter | "~2 pages ≈ 1,000 tok" helper | embedding token volume; index size |
| Refresh cadence | **How often the corpus changes** | Fact | Simple · Enter | Monthly default | amortized ingest cost |

---

## Chunking / Embedding

| Current | Proposed label | Class | Mode | Recommended behavior | Effect |
|---|---|---|---|---|---|
| Chunk size | Chunk size | Recommended | Expert | 512 tok; from embedding model context | chunk count → embedding cost; retrieved-context size |
| Overlap | Overlap | Recommended | Expert | 10% | inflates embedded tokens (billed incl. overlap) |
| Embedding model | **Embedding model** | Recommended | Simple · Recommend | Titan v2 default; Cohere alt | embedding price + dimension |

*Meaning/why:* chunking is an engineering detail the customer won't know. Recommend sensible defaults;
expose in Expert. Embedding model is a visible cost line so it stays selectable in Simple.

---

## Retrieval

| Current | Proposed label | Class | Mode | Recommended behavior | Effect |
|---|---|---|---|---|---|
| Top K | Chunks retrieved | Recommended | Expert | 20; ≥ Top N | vector-store query load |
| Chunks sent to the LLM (Top N) | **Context chunks sent to the model** | Recommended | Simple · Recommend (customer may state) | 4–8 | **major** input-token driver → prefill demand + API input cost |
| Rerank enabled | **Re-rank sources for quality** | Recommended | Simple · Recommend | on | adds rerank line ($/1K searches) |
| Rerank model | Rerank model | Recommended | Expert | Cohere v3 | rerank price |

*Meaning/why (P2-3):* this is the number of **retrieved chunks inserted into the LLM prompt** — the
single biggest lever on prefill-bound self-host fleets and API input cost. It is **not** the number of
citations/sources *displayed to the user* in the answer. Helper text must draw that distinction
explicitly so an SA doesn't conflate "chunks in the prompt" with "sources shown to the reader."

---

## Generation — shared

| Current | Proposed label | Class | Mode | Recommended behavior | Effect |
|---|---|---|---|---|---|
| Mode (API / Self-hosted) | **Serving approach** | *Scope* | Stage A | set by "what are you deciding?" | frames which fields show; not a data value |
| LLM (model) | **Model (or model class)** | Fact | Simple · Enter | customer/SA choice | quality, price, benchmark availability |
| API comparison model | **Compare against (API)** | Recommended | Simple · Recommend | same model (apples-to-apples) | the API side of the crossover |
| System prompt & formatting (prompt overhead) | Fixed prompt tokens | Recommended | Expert | ~150 tok | small input-token add per query |

---

## Self-hosted GPU — **mostly recommended/derived in v2** (see [03-gpu-comprehension-matrix.md](03-gpu-comprehension-matrix.md))

| Current | Proposed label | Class | Mode | Recommended behavior | Effect |
|---|---|---|---|---|---|
| GPU instance | **GPU** | Recommended | Simple · Recommend (ranked) | recommended by model/precision/benchmark/preference | $/hr, memory, throughput, benchmark confidence |
| Weight precision | **Model precision** | Recommended | Expert | default from model + benchmark | memory (instances) + decode throughput + quality |
| KV-cache precision | KV-cache precision | Recommended | Expert | BF16 default; compatibility warning | KV memory (independent of weights) |
| Max context length | **Context window** | Derived | Simple · Derive (Expert override) | min(query+sources+prompt+output) + headroom | KV memory → memory-floor instances; feasibility |
| Max concurrent seqs | Max concurrent sequences | Derived | Expert | from the chosen benchmark operating point (default 32) | operating point → throughput + KV memory |
| Number of instances | **Fleet size (instances)** | Derived · (Expert override) | Simple · Derive | **derived when auto-size on**; entry only when off | billed GPU cost |
| Auto-size fleet | **Size the fleet for me** | Recommended | Simple · Recommend | on | when on, fleet is derived; when off, manual cap |
| Serving redundancy (N+1) | **Add a spare serving replica (N+1)** | Recommended | Simple · Recommend | on for production availability | +1 complete replica of cost; serving-only redundancy |
| Interactivity target | **Streaming speed per user** | Derived | Simple · Derive (from experience preset) | from response-experience preset | selects benchmark operating point → throughput/GPUs |
| Max TTFT (ms) | **Longest acceptable wait to first word (P99)** | Derived | Simple · Derive (from preset) | from experience preset (2 s default) | feasibility gate at the P99 tail |
| On-demand GPU price ($/hr) | **GPU price** | *External (provenanced)* | Simple · show with source state | live/reference AWS price shown with its price-state (never called "live" unless it is) | GPU cost; **customer edit → Expert override → verdict qualified**; assumptions are never presented as AWS fact |
| Purchasing model | **Purchasing assumption** | Recommended | Expert | On-demand; indicative discounts separated from quotes | effective $/hr |
| GPU uptime hours/month | **Operating hours** | Derived | Simple · Derive (from schedule) | from operating schedule; capped 730 | GPU monthly cost; break-even active-window QPS |

---

## Operations

| Current | Proposed label | Class | Mode | Recommended behavior | Effect |
|---|---|---|---|---|---|
| Networking $/mo | Networking | Fact | Expert | 0 default | flat add to self-host total |
| Observability $/mo | Observability | Fact | Expert | 0 default | flat add |
| Overhead % | Ops overhead % | Recommended | Expert | 15–20% | scales self-host operating cost |

---

## Managed retrieval (Bedrock KB) & vector store

| Current | Proposed label | Class | Mode | Recommended behavior | Effect |
|---|---|---|---|---|---|
| Retrieval mode / underlying retrievals | Managed retrieval settings | Recommended | Expert | standard, 2/call | managed KB cost tree |
| Indexed data GB | **Indexed data size** | Derived | Simple · Derive | from corpus × tokens × bytes | managed storage + self-built OpenSearch OCU |
| OpenSearch OCU | OCU sizing | Derived | Hidden/Expert | from index size + query load | self-built vector-store cost |

---

## Summary counts (design intent)

| Class | Simple mode surface | Notes |
|---|---|---|
| **Fact** (SA enters) | ~8 fields | traffic, corpus, answer length, model |
| **Derived** (calculated) | shown as outputs | **context window, fleet size**, concurrency, uptime, index size |
| **Recommended** (app default, editable → override) | shown with reason | GPU, precision, rerank, embedding, N+1, auto-size, API compare, context chunks |
| **Expert** (hidden until Tune) | Expert drawers | KV precision, Top K, prompt overhead, purchasing, ops, chunking |
| *Scope* (frames the tool) | Stage A | "what are you deciding?", serving Mode |
| *External (provenanced)* | shown with source state | GPU price, benchmark evidence |

**Design rule:** a field is only a **Fact** in Simple mode if a normal buyer would plausibly know it.
Everything else is Derived (read-only), Recommended (with a reason), or Expert (hidden). Any field
scoring < 3 on the audit's comprehension/answerability scale is defaulted, derived, or moved to Expert.

**Per-field taxonomy chips (P2-2):** the chip is rendered on **each field**, not once per stage — a
stage that mixes Recommended inputs with Derived outputs shows both. In particular **Fleet size** and
**Context window** always render the **Derived** chip when auto-size is on (they are outputs), and
**Fleet size** flips to **Expert override** only when auto-size is turned off and a manual cap is set.
