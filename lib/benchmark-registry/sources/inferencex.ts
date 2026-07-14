// InferenceX adapter — open-reproducible full-curve source. Pure & deterministic.
import type { BenchmarkRecord, SourceAdapter } from "../schema";
import { sha256 } from "../hash";

export const inferencexAdapter: SourceAdapter = {
  sourceName: "InferenceX",
  sourceClass: "open-reproducible",
  normalize(raw: unknown): BenchmarkRecord[] {
    const r = raw as any;
    const snap = r?._snapshot;
    const c = r?.config;
    if (!snap || !c || !Array.isArray(r?.points)) {
      throw new SchemaError("InferenceX snapshot missing _snapshot/config/points");
    }
    const checksum = sha256(raw);
    const gpuSku = String(c.hardware).toUpperCase();
    const gpuCount = c.disagg ? Number(c.num_prefill_gpu) + Number(c.num_decode_gpu) : Number(c.num_decode_gpu);
    return r.points.map((p: any): BenchmarkRecord => {
      const m = p.metrics ?? {};
      return {
        id: `inx:${c.model}:${c.hardware}:${c.precision}:${p.isl}/${p.osl}:c${p.conc}`,
        provenance: {
          sourceName: "InferenceX",
          sourceClass: "open-reproducible",
          sourceUrl: snap.sourceUrl,
          runId: String(snap.pinnedRunId),
          sourceCommit: snap.recipeCommit,
          retrievedAt: snap.retrievedAt,
          rawChecksum: checksum,
          license: snap.license,
          attribution: snap.attribution,
          snapshotKind: snap.kind,
        },
        modelId: c.model,
        checkpoint: c.checkpoint,
        weightPrecision: c.precision,
        kvPrecision: c.kv_precision ?? null,
        framework: c.framework,
        frameworkVersion: c.framework_version,
        image: c.image,
        frameworkCommit: snap.recipeCommit,
        gpuSku,
        formFactor: c.form_factor,
        gpuMemGB: Number(c.gpu_mem_gb),
        gpuCount,
        nodeCount: c.is_multinode ? Math.ceil(gpuCount / 8) : 1,
        topology: `TP${c.tp}${c.disagg ? " disaggregated" : " aggregated"}`,
        interconnect: c.interconnect,
        parallelism: { tp: c.tp, pp: c.pp, ep: c.ep, dp: c.dp },
        serving: c.disagg ? "disaggregated" : "aggregated",
        isl: Number(p.isl),
        osl: Number(p.osl),
        concurrency: Number(p.conc),
        requestRate: null,
        prefixCache: null,
        specDecode: c.spec_method ?? null,
        outputTputPerGpu: num(m.output_tput_per_gpu),
        inputTputPerGpu: num(m.input_tput_per_gpu),
        ttft: m.p99_ttft != null ? { value: Number(m.p99_ttft), percentile: "p99" } : null,
        tpot: null,
        itl: null,
        throughputTotal: null,
        perGpuReported: true, // InferenceX explicitly reports per-GPU throughput
        latencyQualified: m.p99_ttft != null, // a real TTFT at a defined concurrency
        measuredDate: c.date,
        intrinsicQualifications: [],
        unknownFields: retainUnknown(m, ["median_intvty", "output_tput_per_gpu", "input_tput_per_gpu", "p99_ttft", "median_ttft"]),
      };
    });
  },
};

export class SchemaError extends Error {}
function num(v: unknown): number | null {
  return v == null ? null : Number(v);
}
function retainUnknown(o: Record<string, unknown>, known: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) if (!known.includes(k)) out[k] = o[k];
  return out;
}
