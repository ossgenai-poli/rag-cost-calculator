# Multi-source benchmark provenance layer — design (deliverables 1–8)

**Status:** EXPERIMENTAL · additive · isolated on `ux/v2-benchmarks` (child of `ux/v2`).
**Non-negotiable:** does **not** change, replace, or regress the frozen **rc-qa-11** calculation logic.
The existing engine keeps consuming an authoritative operating point; this layer only decides **which**
qualified operating point is available, **where** it came from, **how closely** it matches, and **how
confidently** it may be used. rc-qa-11 selection is preserved as the deterministic **control/fallback**.

```
Official raw sources → versioned source adapters → normalized benchmark records
→ eligibility & confidence evaluation → ONE authoritative operating point
→ existing capacity/economics engine → UX explanation & exports
```

The first objective is to prove **data architecture · deterministic selection · provenance ·
testability** — not to ingest every GPU/model combination. Sequenced **after** the current UX-v2
iteration; incorporate the upcoming QA findings before declaring ready.

---

## 1. Proposed files / modules & boundaries

New, self-contained package `lib/benchmark-registry/` — imports the frozen engine **read-only**, never
modifies it:

```
lib/benchmark-registry/
  schema.ts          canonical BenchmarkRecord, ConfidenceCategory, RequestSpec, SelectionResult, reason codes
  raw/               IMMUTABLE pinned snapshots (JSON) + checksums + MANIFEST.json (license/attribution/revisions)
    inferencex/*.json  mlperf/*.json  tensorrtllm/*.json  MANIFEST.json
  sources/
    inferencex.ts    adapter: raw snapshot → normalized record(s)
    mlperf.ts        adapter
    tensorrtllm.ts   adapter
    index.ts         ACTIVE_ADAPTERS registry (add sources independently)
  normalize.ts       schema validation + fail-closed guard (unknown/critical-missing → ineligible or reject)
  eligibility.ts     match scoring, mismatch reason codes, interactive-latency gate
  select.ts          DETERMINISTIC precedence + selection (no averaging, no silent interpolation)
  confidence.ts      confidence-category assignment (+ reasons)
  legacy-control.ts  wraps rc-qa-11 getBenchmarkCurve/operatingPointAt as the control (read-only)
  explain.ts         trust-panel + export provenance view (headline vs full)
  index.ts           resolveOperatingPoint(request, {mode}) → SelectionResult (+ control-diff)
  benchmark-registry.test.ts   the 12 required tests
docs/ux-v2/benchmarks/
  DESIGN.md          this file
  LICENSE-MANIFEST.md   attribution/redistribution design (mirrors raw/MANIFEST.json)
```

**Boundary rules**
- `lib/capacity.ts`, `lib/benchmarks.ts`, `lib/crossover.ts`, components, workflows — **untouched**.
- The layer's public output is an `OperatingPoint` (the shape the engine already consumes:
  `tputPerGpu`, `inputTputPerGpu`, `ttftS`, `conc`, `intvty`) **plus** a full provenance `record`. Wiring
  it *into* `computeCapacity` behind a flag is a **later** phase; the slice runs standalone + tested.
- No runtime network dependency. Adapters read only pinned local snapshots.

---

## 2. Canonical TypeScript schema (summary; full in `schema.ts`)

`BenchmarkRecord` preserves, at minimum:

- **provenance:** `sourceName`, `sourceClass`, `sourceUrl`, `runId`, `sourceCommit`, `retrievedAt`,
  `rawChecksum`, `license`, `attribution`, `snapshotKind` (`verified` | `illustrative-pending-ingestion`).
- **model:** `modelId`, `checkpoint`.
- **precision:** `weightPrecision`, `kvPrecision`.
- **software:** `framework`, `frameworkVersion`, `image`, `frameworkCommit`.
- **hardware/topology:** `gpuSku`, `formFactor`, `gpuMemGB`, `gpuCount`, `nodeCount`, `topology`,
  `interconnect`, `parallelism {tp,pp,ep,dp}`, `serving` (`aggregated` | `disaggregated`).
- **workload:** `isl`, `osl` (or distributions), `concurrency` and/or `requestRate`,
  `prefixCache`, `specDecode`.
- **metrics:** `outputTputPerGpu?`, `inputTputPerGpu?`, `ttft {value, percentile}`,
  `tpot?`, `itl?`, `throughputTotal?`.
- **status:** `evidenceStatus` (`measured-exact | measured-scaled | extrapolated | proxy | heuristic`),
  `confidence` (category, §Confidence), `measuredDate`, `qualifications: Reason[]`.

`Reason = { code, message, dimension }` — **every** mismatch/qualification is explicit. Decision-critical
metadata that is missing → the record is **ineligible** or **visibly qualified**; nothing is discarded
silently (`unknownFields` are retained on the record, not dropped).

`RequestSpec` = the requested config (model, gpuSku, precisions, isl/osl, concurrency/rate, latency SLA,
topology, serving). `SelectionResult` = `{ status, operatingPoint?, record?, confidence?, reasons,
control, differsFromControl, differenceCause, provenance }`.

---

## 3. Source-precedence & eligibility decision table

**Eligibility gates (a record must pass ALL to be selectable):**

| Gate | Rule | Fail → |
|---|---|---|
| Model | `record.modelId + checkpoint` == request | ineligible (`model-mismatch`) |
| Precision | weight **and** KV precision match (KV unknown → qualify, not silent) | ineligible / qualified |
| Engine | framework compatible with request (or recorded proxy) | qualify (`engine-mismatch`) |
| Sequence | ISL/OSL within tolerance bucket | exact / qualify (`seq-mismatch`) |
| Topology | whole serving group; TP/PP/EP/DP + node/interconnect compatible | ineligible (`topology-mismatch`) |
| Latency | if request has an interactive TTFT SLA, record must carry a **latency-qualified** curve point meeting it | ineligible (`latency-gate`) — a max-load throughput number cannot satisfy it |
| Per-GPU | per-GPU metric only if the source **explicitly** reports a valid one | reject fictional split (`no-per-gpu`) |
| Metadata | decision-critical fields present | ineligible / qualified |

**Precedence (deterministic; applied to the eligible set):**

1. **Exact configuration match** beats everything.
2. Among exact matches, source class order: `independent-reviewed` (MLPerf) ≥ `open-reproducible`
   (InferenceX) ≥ `vendor-measured` (TRT-LLM) ≥ `research-measured`. A **vendor** exact result **cannot
   silently override** an independently-reviewed exact result.
3. Then `proxy` (explicit equivalent host/topology, differences recorded).
4. Then `extrapolated` (disclosed transformation, reason given).
5. If nothing eligible → **`unbenchmarked`** (never fabricate from FLOPS/bandwidth).

**Never:** average across workloads/engines/precisions/topologies · silently interpolate between measured
points · relabel a DGX/HGX result as an AWS measurement · divide a multi-GPU/node result into a fictional
per-GPU number · project across precision/model/engine/sequence/partial-group without an `extrapolated`
label + reason.

---

## 4. Legacy control / fallback preservation

- `legacy-control.ts` calls the frozen rc-qa-11 `getBenchmarkCurve()` + `operatingPointAt()` **unchanged**
  and returns the operating point rc-qa-11 would pick. It is a **read-only import**.
- `resolveOperatingPoint(req, { mode })`:
  - `mode: 'control'` → returns exactly the rc-qa-11 selection (proves *no regression when experimental is
    off* — test 8). Ships as the default.
  - `mode: 'experimental'` → selects from the registry; if nothing eligible → `unbenchmarked` (does **not**
    silently fall back, so the coverage gap is visible). The control is still computed for the **diff**.
- The control is **always** computed alongside experimental so the UX/export can state whether the
  selection differs and **why** (`new-data` vs `selection-rule`) — and that diff is only shown when both
  sides ran against their **explicitly pinned** catalogs/engines.

---

## 5. Initial adapter scope & exact source revisions (pinned)

Only three adapters are active in the slice; the registry allows adding more independently.

| Source | Class | Use | Pinned revision (slice) | License |
|---|---|---|---|---|
| **InferenceX** | `open-reproducible` | full concurrency curves, TTFT, throughput/interactivity, precision, engine, topology | run `27434759052`, recipe commit `45126b036e…` (dsv4·B200·FP4, 2026-06-12) — **verified** real snapshot | Apache-2.0 |
| **MLPerf Inference v6.0** | `independent-reviewed` | standards-grade validation; latency/accuracy-qualified points | repo `mlcommons/inference_results_v6.0` @ pinned commit — slice uses a labelled pinned example (`illustrative-pending-ingestion`) | MLCommons terms (attribution) |
| **NVIDIA TensorRT-LLM** | `vendor-measured` | curated H100/H200/B200/GB200 gaps, modern models; **max-load = capacity ceiling**, not interactive unless latency-qualified | perf-overview page + repo `NVIDIA/TensorRT-LLM` @ pinned commit — slice uses a labelled pinned example | Apache-2.0 |

**Not activated (adapter points designed, off):** MLPerf Endpoints, Argonne LLM-Inference-Bench, AMD ATOM.
**Excluded from automated ingestion (corroboration only, never scraped):** Artificial Analysis (commercial),
STAC-AI (subscription), NVIDIA NIM web tables, vendor/cloud blogs, community leaderboards, SPEC.

> Ingestion note: the site claims weekly InferenceX GitHub **Release** snapshots, but the repo currently
> has **no Releases** — tracked as an **unresolved ingestion-stability risk** (§8). We pin an immutable
> **run/commit**, not a Release, and never depend on an undocumented dashboard DB endpoint.

---

## 6. License / attribution manifest design

`raw/MANIFEST.json` (mirrored in `LICENSE-MANIFEST.md`) — one entry per pinned snapshot:

```jsonc
{
  "sourceName": "InferenceX",
  "sourceUrl": "https://github.com/SemiAnalysisAI/InferenceX",
  "license": "Apache-2.0",
  "attribution": "SemiAnalysis InferenceX",
  "pinnedRevision": "run 27434759052 / commit 45126b036e…",
  "retrievedAt": "2026-07-14",
  "rawFile": "raw/inferencex/dsv4-b200-fp4-1024.json",
  "rawChecksum": "sha256:…",
  "redistribution": "permitted-with-attribution",
  "snapshotKind": "verified"
}
```

Rules: every accepted source revision is **pinned** and **checksummed**; redistribution status is
explicit; attribution text is carried onto every record and surfaced in the trust panel/exports; a source
whose license forbids redistribution is **corroboration-only** and never stored as a raw snapshot.

---

## 7. Test plan (determinism · provenance · fail-closed)

The 12 required tests (in `benchmark-registry.test.ts`):

1. Exact match wins over proxy and extrapolated.
2. Independently-reviewed exact wins over vendor exact (unless an explicit policy overrides).
3. Max-throughput-only record fails an interactive latency gate.
4. Precision / KV / model / engine / sequence / topology mismatches are **never silent** (each yields a reason code).
5. Whole serving-group topology preserved (no partial-group selection).
6. Multi-node result cannot be split into fictional single-GPU performance.
7. `unbenchmarked` returned when no qualified measurement exists (no FLOPS/bandwidth fabrication).
8. Legacy rc-qa-11 result **unchanged** when the experimental selector is disabled.
9. Every selected result reconciles with its trust-panel + export provenance.
10. Importing identical pinned source data → **byte-identical** normalized output.
11. A source schema change **fails closed** (rejects) instead of corrupting the catalog.
12. Builds/runs completely **offline** from pinned data.

Plus determinism: the selector is a pure function of (RequestSpec, pinned catalog); no clock/network/random.

---

## 8. Open decisions requiring product judgment

1. **InferenceX Release gap** — the repo has no Releases despite the "weekly snapshot" claim. Pin
   runs/commits for now; do we (a) wait for Releases, (b) mirror runs into our own pinned store, or (c)
   accept per-run pinning as the stable interface? *(recommend c + b mirror.)*
2. **Independent-vs-vendor precedence override** — is there ever a case where a vendor **exact** result
   should outrank an MLPerf **exact** result (e.g. MLPerf lacks the interactive point)? Default: no.
3. **Proxy host-equivalence policy** — which GPU/host substitutions count as "materially equivalent"
   (e.g. HGX H200 ↔ p5en) and what differences must be surfaced? Needs an explicit equivalence table.
4. **Illustrative fixtures** — the slice's MLPerf/TRT-LLM records are `illustrative-pending-ingestion`.
   Confirm the update workflow admits **only `verified`** snapshots into the shipping catalog.
5. **Where the layer plugs into the engine** — behind which flag, and does experimental ever become the
   default before full QA? Default: control ships; experimental is opt-in until proven.
6. **`unbenchmarked` UX** — when experimental returns `unbenchmarked` but control has a heuristic answer,
   what does Simple mode show? (Proposed: exclude from Simple; Expert shows the gap.)
7. **Update-workflow trigger** — manual-only until adapter + license manifest + schema validation +
   rollback pass review (no unattended cron scraper before then).

---

## Guardrails (restated)

Additive/experimental only · `ux/v2-benchmarks` (child of `ux/v2`) · **no** changes to `main`, prod
deploy, or rc-qa-11 behavior · rc-qa-11 remains the control/fallback · **no deploy** to GitHub Pages or
Vercel · stop after the vertical slice, document findings, hand off for QA before expanding coverage.
