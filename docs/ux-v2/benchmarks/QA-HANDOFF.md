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
npx vitest run lib/benchmark-registry     # 15/15 — the 12 required tests + sub-cases
npx vitest run                            # 199/199 — frozen 184 + new 15 (no regression)
npx tsc --noEmit                          # clean
```

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
