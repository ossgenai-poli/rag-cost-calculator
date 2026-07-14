// MLPerf Inference adapter — independent-reviewed validation anchor. Pure & deterministic.
// A single result is a latency/accuracy-qualified point, NOT a full concurrency curve.
import type { BenchmarkRecord, Reason, SourceAdapter } from "../schema";
import { SchemaError, strictNum, strictNumOpt } from "../raw-validate";
import { sha256 } from "../hash";

export const mlperfAdapter: SourceAdapter = {
  sourceName: "MLPerf Inference",
  sourceClass: "independent-reviewed",
  normalize(raw: unknown): BenchmarkRecord[] {
    const r = raw as any;
    const snap = r?._snapshot;
    const res = r?.result;
    if (!snap || !res?.system || !res?.measured) {
      throw new SchemaError("MLPerf snapshot missing _snapshot/result.system/result.measured");
    }
    const checksum = sha256(raw);
    const sys = res.system;
    const meas = res.measured;
    const perGpuReported = meas.per_accelerator_tokens_per_second != null;
    const intrinsic: Reason[] = [];
    // Rule: never call a submitter system an AWS configuration.
    if (sys.host && String(sys.host).toLowerCase().includes("not-an-aws")) {
      intrinsic.push({ code: "not-aws-system", dimension: "hardware", message: `Submitted system "${sys.name}" is not an AWS instance; usable only as an explicit host proxy.` });
    }
    if (snap.kind === "illustrative-pending-ingestion") {
      intrinsic.push({ code: "illustrative-snapshot", dimension: "provenance", message: "Illustrative pinned snapshot; numeric result pending real ingestion — not a verified measurement." });
    }
    const gpuCount = strictNum(sys.accelerator_count, "system.accelerator_count");
    return [
      {
        id: `mlp:${res.benchmark}:${skuKey(sys.accelerator)}:${res.workload.isl}/${res.workload.osl}:${res.scenario}`,
        provenance: {
          sourceName: "MLPerf Inference",
          sourceClass: "independent-reviewed",
          sourceUrl: snap.sourceUrl,
          sourceCommit: snap.pinnedCommit,
          retrievedAt: snap.retrievedAt,
          rawChecksum: checksum,
          license: snap.license,
          attribution: snap.attribution,
          snapshotKind: snap.kind,
        },
        modelId: res.benchmark,
        checkpoint: res.checkpoint,
        weightPrecision: res.software.precision,
        kvPrecision: res.software.kv_precision ?? null,
        framework: res.software.framework,
        frameworkVersion: res.software.version,
        gpuSku: skuKey(sys.accelerator),
        formFactor: sys.form_factor,
        gpuMemGB: strictNum(sys.gpu_mem_gb, "system.gpu_mem_gb"),
        gpuCount,
        nodeCount: 1,
        topology: `${res.scenario} · ${gpuCount}× ${skuKey(sys.accelerator)}`,
        interconnect: sys.interconnect,
        parallelism: { tp: gpuCount, pp: 1, ep: 1, dp: 1 },
        serving: "aggregated",
        // A submitter system is NOT an AWS instance → represents no AWS instances directly.
        hostSystem: String(sys.name),
        awsRepresentativeInstances: [],
        isl: strictNum(res.workload.isl, "workload.isl"),
        osl: strictNum(res.workload.osl, "workload.osl"),
        concurrency: null, // Server scenario is request-rate driven, not fixed concurrency
        requestRate: null,
        prefixCache: null,
        specDecode: null,
        outputTputPerGpu: perGpuReported ? strictNum(meas.per_accelerator_tokens_per_second, "per_accelerator_tokens_per_second") : null,
        inputTputPerGpu: strictNumOpt(meas.input_tokens_per_second_per_accelerator, "input_tokens_per_second_per_accelerator"),
        intvty: null,
        ttft: meas.ttft_p99_ms != null ? { value: strictNum(meas.ttft_p99_ms, "ttft_p99_ms") / 1000, percentile: "p99" } : null,
        tpot: meas.tpot_p99_ms != null ? strictNum(meas.tpot_p99_ms, "tpot_p99_ms") / 1000 : null,
        itl: null,
        throughputTotal: strictNumOpt(meas.tokens_per_second_system, "tokens_per_second_system"),
        perGpuReported,
        // MLPerf Server enforces a latency constraint that was met → latency-qualified.
        latencyQualified: res.latency_constraints != null && meas.ttft_p99_ms != null,
        measuredDate: res.version ? `MLPerf ${res.version}` : snap.retrievedAt,
        intrinsicQualifications: intrinsic,
        unknownFields: {},
      },
    ];
  },
};

function skuKey(accel: string): string {
  const a = String(accel).toUpperCase();
  if (a.includes("H200")) return "H200";
  if (a.includes("H100")) return "H100";
  if (a.includes("B200")) return "B200";
  if (a.includes("GB200")) return "GB200";
  return a;
}
