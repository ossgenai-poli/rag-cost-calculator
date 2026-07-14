// Active source adapters + the pinned catalog loader. Adding a source = adding an
// entry here; nothing else changes. Offline: reads only pinned local snapshots.
import type { BenchmarkRecord, SourceAdapter } from "../schema";
import { normalizeSafe } from "../normalize";
import { inferencexAdapter } from "./inferencex";
import { mlperfAdapter } from "./mlperf";
import { tensorrtllmAdapter } from "./tensorrtllm";
import inxRaw from "../raw/inferencex/dsv4-b200-fp4-1024.json";
import mlpRaw from "../raw/mlperf/llama3-1-70b-h200-server-v6.json";
import trtRaw from "../raw/tensorrtllm/llama3-1-70b-perf-overview.json";

export const ACTIVE_ADAPTERS: SourceAdapter[] = [inferencexAdapter, mlperfAdapter, tensorrtllmAdapter];

const PINNED: Array<{ adapter: SourceAdapter; raw: unknown }> = [
  { adapter: inferencexAdapter, raw: inxRaw },
  { adapter: mlperfAdapter, raw: mlpRaw },
  { adapter: tensorrtllmAdapter, raw: trtRaw },
];

/** Deterministically build the normalized catalog from pinned snapshots (fail-closed). */
export function loadCatalog(): BenchmarkRecord[] {
  return PINNED.flatMap(({ adapter, raw }) => normalizeSafe(adapter, raw));
}
