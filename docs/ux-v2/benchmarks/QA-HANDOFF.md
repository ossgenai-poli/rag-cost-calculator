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
npx vitest run lib/benchmark-registry     # 25/25 — the guarantees + all P1/P2 reproductions (three rounds)
npx vitest run                            # 209/209 — frozen 184 + new 25 (no regression)
npx tsc --noEmit                          # clean
```

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

## Vertical slice — what it proves (not coverage)

- **3 adapters, pinned snapshots:** InferenceX (`raw/inferencex/…`, **verified** real: run 27434759052,
  commit 45126b03), MLPerf + TensorRT-LLM (**`illustrative-pending-ingestion`** — real structure/
  provenance, placeholder numbers; clearly labelled, never shown as verified). License/attribution in
  `raw/MANIFEST.json`.
- **One exact selection** (dsv4·B200·FP4 → InferenceX, `measured-exact`, full provenance + checksum).
- **One qualified proxy / scaled result** — cross-accelerator substitution is **denied** (`unbenchmarked`);
  a same-accelerator, **reviewed** host equivalence → `proxy`; an in-bounds off-bucket ISL → a disclosed,
  bounded `measured-scaled` transform (out-of-bounds → `unbenchmarked`).
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
