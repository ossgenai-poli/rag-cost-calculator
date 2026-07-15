# License & attribution manifest

Human-readable mirror of [`lib/benchmark-registry/raw/MANIFEST.json`](../../../lib/benchmark-registry/raw/MANIFEST.json)
(the machine-readable source of truth). Every accepted raw snapshot is pinned, checksummed and
attributed. A source whose license forbids redistribution is **corroboration-only** and is never stored
as a raw snapshot. Only **verified** snapshots enter the selectable catalog; **illustrative** snapshots
are test-only and never selectable.

| Source | Class | License | Attribution (carried onto every record + trust panel) | Pinned revision | Snapshot | Checksum verified at ingest |
|---|---|---|---|---|---|---|
| **InferenceX** | open-reproducible | Apache-2.0 | SemiAnalysis InferenceX | run 27434759052 · commit 45126b036e | **verified** | `sha256:cc4af14f…` |
| **MLPerf Inference v6.0** | independent-reviewed | MLCommons (attribution required) | MLCommons MLPerf Inference v6.0 | `PINNED_COMMIT_TBD` | illustrative-pending-ingestion | `sha256:2f34138a…` |
| **NVIDIA TensorRT-LLM** | vendor-measured | Apache-2.0 | NVIDIA TensorRT-LLM performance overview | `PINNED_COMMIT_TBD` | illustrative-pending-ingestion | `sha256:826531ed…` |

## Rules enforced in code

- **Checksum:** `loadCatalog()`/`loadAllSnapshots()` recompute `sha256(canonicalJson(raw))` and compare
  against the stored manifest checksum; any mismatch (tamper / unpinned edit) **fails closed**
  (`ingest: checksum mismatch …`).
- **Verified requires a real revision:** a snapshot marked `verified` with a `TBD` revision is **rejected**
  by `validateRecord` (P2-2). The two illustrative sources keep `PINNED_COMMIT_TBD` and are therefore
  never verified/selectable.
- **Redistribution:** all three sources permit redistribution with attribution. Excluded-from-ingestion
  sources (Artificial Analysis, STAC-AI, NIM tables, blogs, SPEC) are corroboration-only and never stored.
- **Attribution** text is copied onto every normalized record's `provenance.attribution` and surfaced in
  the trust/export view.

## Before a source is promoted to `verified`

Replace `PINNED_COMMIT_TBD` with the immutable commit/run, re-pin the raw snapshot, recompute the
checksum into the manifest, and confirm `validateRecord` accepts it — see
[DESIGN.md](DESIGN.md) §6 and the update-workflow position in §8.
