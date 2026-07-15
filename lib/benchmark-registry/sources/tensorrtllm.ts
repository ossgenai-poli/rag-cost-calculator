// NVIDIA TensorRT-LLM adapter — vendor-measured supplement. Pure & deterministic.
// Max-load rows are a capacity CEILING, not an interactive result unless latency-qualified.
import type { BenchmarkRecord, Reason, SourceAdapter } from "../schema";
import { SchemaError, strictBool, strictEnum, strictNum, strictNumOpt, strictStr, strictStrOpt } from "../raw-validate";

// Supported TensorRT-LLM row kinds — an unknown value must fail closed, NOT default to latency.
const TRT_ROW_KINDS = ["latency-qualified", "max-throughput"] as const;
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
      // Every decision-critical raw identifier is strict-validated BEFORE normalization — a number/
      // boolean where a string identifier is required fails closed, never String()-coerced (P1-BENCH-008).
      const rowKind = strictEnum(row.row_kind, "row.row_kind", TRT_ROW_KINDS);
      const maxLoad = rowKind === "max-throughput";
      const perGpuReported = strictBool(row.per_gpu_reported, "row.per_gpu_reported");
      const multinode = strictBool(row.multinode, "row.multinode");
      const gpu = strictStr(row.gpu, "row.gpu").toUpperCase();
      const model = strictStr(r.model, "model");
      const checkpoint = strictStr(r.checkpoint, "checkpoint");
      const framework = strictStr(r.framework, "framework");
      const frameworkVersion = strictStrOpt(r.version, "version") ?? undefined;
      const weightPrecision = strictStr(row.precision, "row.precision");
      const kvPrecision = strictStrOpt(row.kv_precision, "row.kv_precision");
      const formFactor = strictStr(row.form_factor, "row.form_factor");
      const interconnect = strictStr(row.interconnect, "row.interconnect");
      const tp = strictNum(row.tp, "row.tp");
      const pp = strictNum(row.pp, "row.pp");
      const gpuCount = strictNum(row.gpu_count, "row.gpu_count");
      const isl = strictNum(row.isl, "row.isl");
      const osl = strictNum(row.osl, "row.osl");
      const concurrency = strictNum(row.concurrency, "row.concurrency");
      const intrinsic: Reason[] = [];
      if (maxLoad) intrinsic.push({ code: "max-load-ceiling", dimension: "latency", message: "Max-load throughput is a capacity ceiling, not an interactive-RAG operating point." });
      if (multinode && !perGpuReported) intrinsic.push({ code: "no-per-gpu-metric", dimension: "topology", message: `Multi-node ${gpu} result reports only a system total; no valid per-GPU metric — must not be split into a fictional per-GPU number.` });
      if (snap.kind === "illustrative-pending-ingestion") intrinsic.push({ code: "illustrative-snapshot", dimension: "provenance", message: "Illustrative pinned snapshot; numbers pending real ingestion — not a verified measurement." });
      return {
        id: `trt:${model}:${gpu}:${weightPrecision}:${isl}/${osl}:c${concurrency}:${rowKind}`,
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
        modelId: model,
        checkpoint,
        weightPrecision,
        kvPrecision,
        framework,
        frameworkVersion,
        gpuSku: gpu,
        formFactor,
        gpuMemGB: strictNum(row.gpu_mem_gb, "row.gpu_mem_gb"),
        gpuCount,
        nodeCount: multinode ? Math.ceil(gpuCount / 8) : 1,
        topology: `TP${tp}${multinode ? " multi-node" : " single-node"}`,
        interconnect,
        parallelism: { tp, pp, ep: 1, dp: 1 },
        serving: "aggregated",
        // Vendor perf tables are not an AWS-instance measurement → represent no AWS instances.
        hostSystem: `${gpu}-nvidia-perf`,
        awsRepresentativeInstances: [],
        isl,
        osl,
        concurrency,
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
        // Only an explicit latency-qualified row with a real TTFT qualifies — never inferred from "not max-load".
        latencyQualified: rowKind === "latency-qualified" && row.ttft_ms != null,
        measuredDate: snap.retrievedAt,
        intrinsicQualifications: intrinsic,
        unknownFields: {},
      };
    });
  },
};
