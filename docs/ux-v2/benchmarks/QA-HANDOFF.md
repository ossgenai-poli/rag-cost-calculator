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
npx vitest run lib/benchmark-registry     # 30/30 — the 12 guarantees + P1/P2 hardening reproductions
npx vitest run                            # 214/214 — frozen 184 + new 30 (no regression)
npx tsc --noEmit                          # clean
```

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
- **One qualified proxy / extrapolation** (gpu-swap → `proxy`; off-bucket ISL → `extrapolated`, with reasons).
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
