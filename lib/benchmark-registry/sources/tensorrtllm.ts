// NVIDIA TensorRT-LLM adapter — vendor-measured supplement. Pure & deterministic.
// Max-load rows are a capacity CEILING, not an interactive result unless latency-qualified.
import type { BenchmarkRecord, Reason, SourceAdapter } from "../schema";
import { SchemaError } from "./inferencex";
import { sha256 } from "../hash";

export const tensorrtllmAdapter: SourceAdapter = {
  sourceName: "NVIDIA TensorRT-LLM",
  sourceClass: "vendor-measured",
  normalize(raw: unknown): BenchmarkRecord[] {
    const r = raw as any;
    const snap = r?._snapshot;
    if (!snap || !Array.isArray(r?.rows)) {
      throw new SchemaError("TensorRT-LLM snapshot missing _snapshot/rows");
    }
    const checksum = sha256(raw);
    return r.rows.map((row: any, i: number): BenchmarkRecord => {
      const maxLoad = row.row_kind === "max-throughput";
      const perGpuReported = row.per_gpu_reported === true;
      const intrinsic: Reason[] = [];
      if (maxLoad) intrinsic.push({ code: "max-load-ceiling", dimension: "latency", message: "Max-load throughput is a capacity ceiling, not an interactive-RAG operating point." });
      if (row.multinode && !perGpuReported) intrinsic.push({ code: "no-per-gpu-metric", dimension: "topology", message: `Multi-node ${row.gpu} result reports only a system total; no valid per-GPU metric — must not be split into a fictional per-GPU number.` });
      if (snap.kind === "illustrative-pending-ingestion") intrinsic.push({ code: "illustrative-snapshot", dimension: "provenance", message: "Illustrative pinned snapshot; numbers pending real ingestion — not a verified measurement." });
      const gpuCount = Number(row.gpu_count);
      return {
        id: `trt:${r.model}:${row.gpu}:${row.precision}:${row.isl}/${row.osl}:c${row.concurrency}:${row.row_kind}`,
        provenance: {
          sourceName: "NVIDIA TensorRT-LLM",
          sourceClass: "vendor-measured",
          sourceUrl: snap.sourceUrl,
          sourceCommit: snap.pinnedCommit,
          retrievedAt: snap.retrievedAt,
          rawChecksum: checksum,
          license: snap.license,
          attribution: snap.attribution,
          snapshotKind: snap.kind,
        },
        modelId: r.model,
        checkpoint: r.checkpoint,
        weightPrecision: row.precision,
        kvPrecision: row.kv_precision ?? null,
        framework: r.framework,
        frameworkVersion: r.version,
        gpuSku: String(row.gpu).toUpperCase(),
        formFactor: row.form_factor,
        gpuMemGB: Number(row.gpu_mem_gb),
        gpuCount,
        nodeCount: row.multinode ? Math.ceil(gpuCount / 8) : 1,
        topology: `TP${row.tp ?? "?"}${row.multinode ? " multi-node" : " single-node"}`,
        interconnect: row.interconnect,
        parallelism: { tp: Number(row.tp ?? gpuCount), pp: Number(row.pp ?? 1), ep: 1, dp: 1 },
        serving: "aggregated",
        isl: Number(row.isl),
        osl: Number(row.osl),
        concurrency: Number(row.concurrency),
        requestRate: null,
        prefixCache: null,
        specDecode: null,
        // NEVER synthesize a per-GPU value when the source didn't report one.
        outputTputPerGpu: perGpuReported ? num(row.output_tokens_per_second_per_gpu) : null,
        inputTputPerGpu: perGpuReported ? num(row.input_tokens_per_second_per_gpu) : null,
        ttft: row.ttft_ms != null ? { value: Number(row.ttft_ms) / 1000, percentile: "mean" } : null,
        tpot: row.tpot_ms != null ? Number(row.tpot_ms) / 1000 : null,
        itl: null,
        throughputTotal: row.system_tokens_per_second_total != null ? Number(row.system_tokens_per_second_total) : null,
        perGpuReported,
        latencyQualified: !maxLoad && row.ttft_ms != null,
        measuredDate: snap.retrievedAt,
        intrinsicQualifications: intrinsic,
        unknownFields: {},
      };
    });
  },
};

function num(v: unknown): number | null {
  return v == null ? null : Number(v);
}
