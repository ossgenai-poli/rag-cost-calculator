# QA handoff — multi-source benchmark provenance layer (vertical slice)

**Status:** EXPERIMENTAL vertical slice · additive · **rc-qa-11 engine unchanged and preserved as the
control**. Not merged, not deployed. Judge whether the multi-source architecture improves accuracy/trust
before we expand coverage.

- **Branch:** `ux/v2-benchmarks` (child of `ux/v2`). **Baseline:** rc-qa-11 = `d749309` (frozen).
- **Design (read first):** [DESIGN.md](DESIGN.md) — deliverables 1–8. **Code:** `lib/benchmark-registry/`.

## Isolation invariants (mechanical — all must pass)

```
git rev-parse main            # d749309… (unchanged)
git diff --name-only rc-qa-11 ux/v2-benchmarks | grep -vE '^(lib/benchmark-registry/|docs/ux-v2/)'   # empty
git diff --stat rc-qa-11 ux/v2-benchmarks -- lib/capacity.ts lib/benchmarks.ts lib/crossover.ts lib/calc-engine.ts components .github   # no changes
gh run list --limit 5         # no CI/Pages run for this branch (both are main-only)
```
The layer **imports** the frozen `lib/benchmarks.ts` read-only (the control wrapper) but modifies nothing.

## Run the tests

```
npx vitest run lib/benchmark-registry     # 34/34 — the guarantees + all P1/P2 reproductions (five rounds)
npx vitest run                            # 218/218 — frozen 184 + new 34 (no regression)
npx tsc --noEmit                          # clean
```

**Round 5 (fifth HOLD) — public-boundary + policy-immutability fixes:**

| Finding | Fix |
|---|---|
| **P1-BENCH-006** public resolver misreports bad input as a coverage gap | `resolveOperatingPoint()` validates the request (`requestBoundaryErrors` = completeness + type/range) **before** catalog selection and returns a distinct `invalid-request` status with detailed reasons; `unbenchmarked` is now reserved for a valid request with no evidence. Validation precedes catalog access (fires on an empty catalog). Public acceptance tests added (invalid → invalid-request incl. empty catalog; valid+empty → unbenchmarked) |
| **P1-BENCH-007** caller tolerance could label a 4× ISL gap measured-exact | removed the caller-controlled `seqTolerance`; measured-exact requires the **identical** ISL/OSL bucket; a non-identical in-bounds ISL → disclosed `measured-scaled`, OSL differs → `osl-mismatch`. Public resolver test: record ISL 1024 vs request ISL 4096 → `measured-scaled` (factor 4), never exact |
| **P1-BENCH-008** MLPerf/TRT still `String()`-coerced identifiers | every raw accelerator/GPU, host/system name, model, checkpoint, framework, precision, form factor, interconnect, scenario/row-kind is `strictStr`/`strictStrOpt`-validated before normalization in **all** adapters. Reproductions added: MLPerf `accelerator=123` / `name=123` and TRT `gpu=123` all throw |
| **P1/P2-BENCH-009** policy partly mutable / publicly overrideable | `ACCELERATOR_ALLOWLIST` + `AWS_INSTANCE_ACCELERATOR` are now `Object.freeze`-immutable (with `HOST_ALLOWLIST`); the public `ResolveOptions` no longer exposes `hostAllowlist` — injection is confined to the internal `evaluate`/`selectBest` for tests. Tests assert all three registries are frozen and that `resolveOperatingPoint` cannot proxy an unreviewed host |

**Round 4 (fourth HOLD) — final fail-closed + hygiene fixes:**

| Finding | Fix |
|---|---|
| InferenceX SKU-derived AWS representation | `awsRepresentativeInstances` comes ONLY from an explicit reviewed snapshot mapping — never derived from GPU SKU. The pinned snapshot has none → `[]` → the record requires reviewed host equivalence (empty) → `unbenchmarked`. Negative test: same SKU alone ≠ measured-exact |
| request validation fail-open | runtime `validateRequest` at the evaluate/resolve boundary — finite positive ints for ISL/OSL/concurrency/GPU/node/TP·PP·EP, `seqTolerance` finite in (1,4], interactivity percentile enum + positive finite SLA/streaming; invalid → `invalid-request`. Adversarial tests (0, negative, NaN, Infinity, bad enum) |
| non-numeric raw fields coerced | `strictBool`/`strictBoolOpt`/`strictStrOpt` added; `disagg`/`is_multinode`/`per_gpu_reported`/`kv_precision`/`spec_method` and all string/bool config fields validated in every adapter; `validateRecord` type-checks `kvPrecision`/`prefixCache`/`specDecode`. No truthiness |
| production allowlist mutated by tests | `HOST_ALLOWLIST` is `Object.freeze([])`; equivalence takes an injected `allowlist`; `evaluate`/`selectBest`/`resolveOperatingPoint` accept `hostAllowlist` — tests inject, never mutate |
| stale "one exact selection" claim | replaced with the honest architecture-only status (zero measured-exact from the pinned catalog; end-to-end proven via synthetic record) |

**Round 3 (third HOLD) — final fail-closed fixes:**

| Finding | Fix |
|---|---|
| exact contract incomplete | measured-exact now requires **checkpoint**, **full TP/PP/EP parallelism**, and explicit **prefixCache** + **specDecode** in the request; unknown record prefix-cache/spec-decode → not exact (the verified InferenceX snapshot lacks prefix-cache metadata, so it honestly returns `unbenchmarked` — a strong fail-closed demonstration) |
| strict raw validation partial | one shared `raw-validate.ts` strict validator (`strictNum`/`strictNumOpt`/`strictStr`) used across **every** adapter and **every** numeric field (InferenceX config + point, MLPerf, TensorRT-LLM); a string/boolean where a number is required fails closed |
| synthetic host allowlist | production `HOST_ALLOWLIST` is **empty** (no invented "reviewed" entry); unit tests inject a temporary fixture; a record now names the **specific** `awsRepresentativeInstances` it represents, not a broad boolean |

## Hardening (this round — HOLD fixes; all fail-closed)

| Finding | Fix |
|---|---|
| **P1-1** illustrative selectable | `loadCatalog()` verified-only; eligibility denies `snapshotKind!=="verified"`; test: illustrative independent-reviewed can't outrank verified |
| **P1-2** arbitrary GPU proxy | `equivalence.ts` — reviewed allowlist, **deny by default**; cross-accelerator → `unbenchmarked`; same-accelerator non-AWS host → host proxy w/ recorded differences |
| **P1-3** topology unenforced | eligibility compares gpuCount/nodeCount/serving/TP·PP·EP; negative tests (8-GPU→1, 1-node→multi, TP mismatch) |
| **P1-4** unknown KV → exact | request KV + record KV null/mismatch → ineligible (`kv-precision-unknown`/`kv-precision-mismatch`) |
| **P1-5** latency/oppoint unsafe | `interactivity` requires `ttftPercentile` (+ optional streaming); mean/p50 can't satisfy P99; intvty preserved+returned; concurrency-exact required for exact |
| **P1-6** label-only extrapolation | only transform = bounded **ISL-linear-scale** (`transform.ts`) → `measured-scaled` + metadata (input scaled, TTFT dropped); all other substitutions → `unbenchmarked` |
| **P1-7** validation not closed | exhaustive `validateRecord` (enums, finite/positive, dates, hashes, urls, topology consistency); raw validated before `Number()`; adversarial tests |
| **P2-1** control-diff partial | `opEqual` now compares throughput/TTFT/**concurrency/interactivity** |
| **P2-2** provenance chain | manifest stores per-file checksums, verified at ingest (tamper fails closed); `LICENSE-MANIFEST.md` added; verified snapshot with TBD revision rejected |
| **P2-3** overstated coverage | the reproductions above are now acceptance tests |

**Round 2 (second HOLD) — additional fail-closed fixes:**

| Finding | Fix |
|---|---|
| `latencyQualified=false` still passed | interactive gate now requires `record.latencyQualified === true` before the TTFT checks |
| ISL 100× silently clamped | bounds are eligibility limits — an out-of-`[0.125,8]` ratio → `unbenchmarked` (`isl-scale-out-of-bounds`), never clamped |
| under-specified request → exact | a measured-exact claim needs the full request contract (model, precision incl. KV, engine, reviewed **awsInstance**, whole-group topology, concurrency); missing → `incomplete-request`; unknown/inconsistent instance → denied (`instance-map.ts`) |
| generic host proxy | same-accelerator non-AWS host now needs a **reviewed host-equivalence** entry (`HOST_ALLOWLIST`); unreviewed → `unbenchmarked` |
| malformed date/url/string-number | strict ISO-date round-trip + `new URL()` https/hostname parse; raw numeric fields must already be finite numbers (no `Number("8")` coercion) |

Parent Phase-0 fixes are incorporated (branch rebased onto `ux/v2 @ c2d41f4`).

The 12 required guarantees (mapped in [DESIGN.md](DESIGN.md) §7): exact>proxy>extrapolated ·
independent>vendor · latency gate rejects max-load · no silent mismatch · whole-group topology preserved ·
no fictional per-GPU split · `unbenchmarked` when no evidence · **legacy unchanged when experimental
disabled** · provenance reconciles · byte-identical normalization · fail-closed schema · offline.

## Vertical slice — what it proves (ARCHITECTURE-ONLY; not coverage)

> **Honest status (P1/P2-BENCH-004):** the pinned production catalog currently yields **zero**
> measured-exact selections. The one verified snapshot (InferenceX dsv4·B200·FP4) is
> **`unbenchmarked`** because it has **no reviewed AWS-host mapping** and **no prefix-cache metadata** —
> neither is inferred. MLPerf/TensorRT-LLM stay illustrative and non-selectable. This is an
> **architecture-only slice**: it proves ingestion → validation → eligibility → selection → provenance
> end-to-end, with the measured-exact path exercised by a **fully-specified synthetic test record**.
> A real end-to-end exact selection awaits a source-backed record that *establishes* (not infers)
> prefix-cache state and a reviewed AWS-host identity/equivalence.

- **3 adapters, pinned snapshots:** InferenceX (`raw/inferencex/…`, **verified** real: run 27434759052,
  commit 45126b03), MLPerf + TensorRT-LLM (**`illustrative-pending-ingestion`** — real structure/
  provenance, placeholder numbers; never selectable). License/attribution in `raw/MANIFEST.json`.
- **The verified InferenceX record → `unbenchmarked`** (`host-not-equivalent`, and `prefix-cache-unknown`
  once host is supplied) — the fail-closed refusal to invent AWS-host or prefix-cache facts.
- **Transform/proxy semantics** — cross-accelerator substitution **denied** (`unbenchmarked`); a
  same-accelerator **reviewed** host equivalence (injected in tests only) → `proxy`; an in-bounds
  off-bucket ISL → a disclosed, bounded `measured-scaled` transform (out-of-bounds → `unbenchmarked`).
- **One deliberately `unbenchmarked`** case (GB200 NVL72 system total → no per-GPU → not fabricated).
- **Comparison vs the unchanged control** (`resolveOperatingPoint(mode:'control')` === raw
  `getBenchmarkCurve`+`operatingPointAt`; `differsFromControl` / `differenceCause` reported).

## What to check (design review, not a functional app test)

1. Isolation invariants above.
2. The selection rules match [DESIGN.md](DESIGN.md) §3 and the confidence taxonomy §Confidence — no
   averaging, no silent interpolation, no DGX/HGX→AWS relabel, no per-GPU split, `unbenchmarked` never
   fabricated.
3. Every selected result's `provenance` reconciles with the record (checksum, source, evidence status).
4. Illustrative vs verified snapshots are unmistakable; the headline never calls a proxy/extrapolation
   "measured".
5. The 7 **open decisions** in [DESIGN.md](DESIGN.md) §8 (InferenceX Release gap, independent-vs-vendor
   override, proxy equivalence table, illustrative→verified gate, engine plug-in point, `unbenchmarked`
   UX, update-workflow trigger).

## Guardrails

Do **not** merge to `main` or deploy to Vercel/Pages · do **not** modify rc-qa-11 behavior · this stays
experimental behind the control until the source adapters, license manifest, schema validation and
rollback have passed review. **Sequence after the current UX-v2 iteration; fold in its QA findings before
declaring this ready.**
