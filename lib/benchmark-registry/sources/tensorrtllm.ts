// NVIDIA TensorRT-LLM adapter — vendor-measured supplement. Pure & deterministic.
// Max-load rows are a capacity CEILING, not an interactive result unless latency-qualified.
import type { BenchmarkRecord, Reason, SourceAdapter } from "../schema";
import { SchemaError, strictNum, strictNumOpt } from "../raw-validate";
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
      const gpuCount = strictNum(row.gpu_count, "row.gpu_count");
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
        gpuMemGB: strictNum(row.gpu_mem_gb, "row.gpu_mem_gb"),
        gpuCount,
        nodeCount: row.multinode ? Math.ceil(gpuCount / 8) : 1,
        topology: `TP${strictNum(row.tp, "row.tp")}${row.multinode ? " multi-node" : " single-node"}`,
        interconnect: row.interconnect,
        parallelism: { tp: strictNum(row.tp, "row.tp"), pp: strictNum(row.pp, "row.pp"), ep: 1, dp: 1 },
        serving: "aggregated",
        // Vendor perf tables are not an AWS-instance measurement → represent no AWS instances.
        hostSystem: `${String(row.gpu).toUpperCase()}-nvidia-perf`,
        awsRepresentativeInstances: [],
        isl: strictNum(row.isl, "row.isl"),
        osl: strictNum(row.osl, "row.osl"),
        concurrency: strictNum(row.concurrency, "row.concurrency"),
        requestRate: null,
        prefixCache: null,
        specDecode: null,
        // NEVER synthesize a per-GPU value when the source didn't report one.
        outputTputPerGpu: perGpuReported ? strictNumOpt(row.output_tokens_per_second_per_gpu, "output_tokens_per_second_per_gpu") : null,
        inputTputPerGpu: perGpuReported ? strictNumOpt(row.input_tokens_per_second_per_gpu, "input_tokens_per_second_per_gpu") : null,
        intvty: null,
        // Vendor perf tables report mean/median TTFT — NEVER a P99 SLA statistic.
        ttft: row.ttft_ms != null ? { value: strictNum(row.ttft_ms, "row.ttft_ms") / 1000, percentile: "mean" } : null,
        tpot: row.tpot_ms != null ? strictNum(row.tpot_ms, "row.tpot_ms") / 1000 : null,
        itl: null,
        throughputTotal: strictNumOpt(row.system_tokens_per_second_total, "system_tokens_per_second_total"),
        perGpuReported,
        latencyQualified: !maxLoad && row.ttft_ms != null,
        measuredDate: snap.retrievedAt,
        intrinsicQualifications: intrinsic,
        unknownFields: {},
      };
    });
  },
};
