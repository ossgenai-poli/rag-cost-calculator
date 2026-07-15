# 16-arch. Evidence, pricing & provenance contracts

Three contracts the supported catalog and recommendation engine must honor. All three already have
partial support in the frozen engine (rc-qa-11); this specifies the production-grade target.

---

## A. Benchmark / evidence contract

**Every evidence record is keyed by at least:** model + version · hardware/system · serving framework +
version · weight precision · KV-cache precision (where known) · input & output sequence length ·
concurrency/batch operating point · serving topology · **TTFT statistic + percentile** · throughput
dimensions (decode & prefill) · benchmark date · source.

**Evidence states:** `measured-exact · measured-scaled · extrapolated · proxy · none`.

**A supported evidence path is:** an **exact** measurement, **or** a clearly-defined
**measured-scaled/extrapolated** result from a *real, applicable* benchmark with a **technically
defensible transformation** and **explicit qualification** (e.g. the rc-qa-11 ISL-scaling of measured
input throughput → `Measured·scaled`).

**Never:**
- create capacity from marketing multipliers;
- map an NVL72 (rack) result onto an unrelated EC2 8-GPU topology;
- transfer one model's performance to another and present it as credible sizing;
- label a precision/framework/topology mismatch as **Measured**;
- display benchmark results without enough metadata to interpret them.

**If no applicable benchmark exists (`none`):**
- do **not** show throughput, TTFT, fleet, or cost/performance conclusions;
- **omit the combination from Simple-mode comparison**;
- retain it only in the research registry as "not evaluated."

**Proxy & heuristic** paths are **never the primary recommendation** (Q7). If retained at all, they live
in **Expert evidence review**, unmistakably qualified. *(This is why the frozen Nemotron/Kimi heuristic
paths and the H200/H100 DeepSeek heuristic — see [18-reference-cases.md](18-reference-cases.md) — are
excluded from Simple.)*

**Mapping to the frozen engine:** `capacity.source ∈ {measured, extrapolated, proxy, heuristic}` +
`prefillIslScale` + `extrapolationReasons` already carry this. v2 adds the explicit **`measured-exact`
vs `measured-scaled`** split at the presentation layer (extrapolated **with** `prefillIslScale≠1` and no
other mismatch → measured-scaled).

---

## B. Pricing-state contract

**Explicit price states:** `aws-public · capacity-block-public · customer-private · user-assumption ·
user-override · unavailable`.

**Every known price carries:** amount or range · currency · billing unit · region · as-of date · source.

| State | Meaning | Ranking behavior |
|---|---|---|
| `aws-public` | source-backed AWS on-demand/RI/Savings price | included in cost ranking |
| `capacity-block-public` | published Capacity Blocks price (variable/time-bound) | included, flagged variable |
| `customer-private` | negotiated / AI-Factory / private capacity | **"Customer price required"** → excluded from auto cost-ranking until supplied |
| `user-assumption` | explicit scenario assumption the user typed | included **only** in that scenario, labeled assumption |
| `user-override` | customer edited a shown price | included, **verdict qualified** |
| `unavailable` | no price known | excluded; no cost shown |

**Rules:**
- For **publicly priced** hardware, use **source-backed AWS pricing**.
- For **legitimately private** pricing: show *"Customer price required"*; let the customer enter the
  negotiated hourly/system price; record it as a **customer override**; **qualify** the cost result;
  **exclude** the hardware from automatic cost ranking until a price is supplied.
- The app must **never originate a plausible-looking assumed price and present it as an AWS or market
  fact.** Explicit scenario modeling may accept a user assumption, clearly labeled.
- **Never call an assumption or override "live AWS pricing."**

**Mapping to the frozen engine:** `GpuInstancePrice.priceSource ∈ {live, fallback, override}` maps to
`aws-public` (live), `aws-public (reference/cached)` (fallback — shown as **reference**, never "live"),
`user-override` (override). **Gap to close in Phase 1:** the Capacity-Blocks-delivered B200/B300 are
priced today from a single committed reference; production must model `capacity-block-public` (variable)
and `customer-private` explicitly, and mark GB200/GB300 UltraServers as `customer-private` until a real
delivery price exists.

---

## C. Source & provenance policy

- **Prefer official AWS sources** for hardware availability and pricing; **reviewed, versioned
  ingestion** — **no uncontrolled runtime web scraping**.
- **InferenceX is an independent third-party benchmark source** — labeled *independent benchmark*, never
  "AWS published" (INF-009). Its provenance (run URL, recipe commit, image, topology, date, P99
  statistic) is surfaced verbatim ([09-trust-provenance.md](09-trust-provenance.md)).
- Every External/provenanced value (price, benchmark) renders with its **source state**; a customer edit
  becomes an explicit **Expert override**, never re-badged as an authoritative source.
- Availability facts follow the availability contract ([14-hardware-registry.md](14-hardware-registry.md))
  with source URL + org + verified date + region + mechanism.

**Determinism:** every customer-facing claim maps to a structured field/reason code across all three
contracts; nothing is inferred from before/after value deltas.
