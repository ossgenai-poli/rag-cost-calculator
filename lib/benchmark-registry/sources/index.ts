// Active adapters + the pinned catalog loader. Ingestion VERIFIES each raw snapshot's
// checksum against the manifest (fail-closed on tamper/mismatch — P2-2) and the
// selectable catalog contains ONLY verified snapshots (P1-1). Offline: local snapshots only.
import type { BenchmarkRecord, SourceAdapter } from "../schema";
import { normalizeSafe } from "../normalize";
import { sha256 } from "../hash";
import { inferencexAdapter } from "./inferencex";
import { mlperfAdapter } from "./mlperf";
import { tensorrtllmAdapter } from "./tensorrtllm";
import inxRaw from "../raw/inferencex/dsv4-b200-fp4-1024.json";
import mlpRaw from "../raw/mlperf/llama3-1-70b-h200-server-v6.json";
import trtRaw from "../raw/tensorrtllm/llama3-1-70b-perf-overview.json";
import manifest from "../raw/MANIFEST.json";

export const ACTIVE_ADAPTERS: SourceAdapter[] = [inferencexAdapter, mlperfAdapter, tensorrtllmAdapter];

const PINNED: Array<{ adapter: SourceAdapter; raw: unknown; path: string }> = [
  { adapter: inferencexAdapter, raw: inxRaw, path: "raw/inferencex/dsv4-b200-fp4-1024.json" },
  { adapter: mlperfAdapter, raw: mlpRaw, path: "raw/mlperf/llama3-1-70b-h200-server-v6.json" },
  { adapter: tensorrtllmAdapter, raw: trtRaw, path: "raw/tensorrtllm/llama3-1-70b-perf-overview.json" },
];

const EXPECTED = new Map<string, string>();
for (const s of (manifest as any).sources) for (const rf of s.rawFiles) EXPECTED.set(rf.path, rf.rawChecksum);

/** Ingest all pinned snapshots, verifying each checksum against the manifest (fail-closed). */
function ingest(): BenchmarkRecord[] {
  return PINNED.flatMap(({ adapter, raw, path }) => {
    const expected = EXPECTED.get(path);
    if (!expected) throw new Error(`ingest: no manifest checksum for ${path}`);
    const actual = sha256(raw);
    if (actual !== expected) throw new Error(`ingest: checksum mismatch for ${path} — manifest ${expected} ≠ computed ${actual} (tampered or unpinned)`);
    return normalizeSafe(adapter, raw);
  });
}

/** Test-only: every normalized record, INCLUDING illustrative (never selectable). */
export function loadAllSnapshots(): BenchmarkRecord[] {
  return ingest();
}

/** The selectable catalog — VERIFIED snapshots only (P1-1). */
export function loadCatalog(): BenchmarkRecord[] {
  return ingest().filter((r) => r.provenance.snapshotKind === "verified");
}
