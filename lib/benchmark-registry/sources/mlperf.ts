// MLPerf Inference adapter — independent-reviewed validation anchor. Pure & deterministic.
// A single result is a latency/accuracy-qualified point, NOT a full concurrency curve.
import type { BenchmarkRecord, Reason, SourceAdapter } from "../schema";
import { SchemaError, strictNum, strictNumOpt, strictStr, strictStrOpt } from "../raw-validate";
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
    // Every decision-critical raw identifier is strict-validated BEFORE normalization — a number/
    // boolean where a string identifier is required fails closed, never String()-coerced (P1-BENCH-008).
    const accel = strictStr(sys.accelerator, "system.accelerator");
    const sku = skuKey(accel);
    const hostName = strictStr(sys.name, "system.name");
    const benchmark = strictStr(res.benchmark, "result.benchmark");
    const checkpoint = strictStr(res.checkpoint, "result.checkpoint");
    const framework = strictStr(res.software.framework, "software.framework");
    const weightPrecision = strictStr(res.software.precision, "software.precision");
    const kvPrecision = strictStrOpt(res.software.kv_precision, "software.kv_precision");
    const frameworkVersion = strictStrOpt(res.software.version, "software.version") ?? undefined;
    const formFactor = strictStr(sys.form_factor, "system.form_factor");
    const interconnect = strictStr(sys.interconnect, "system.interconnect");
    const scenario = strictStr(res.scenario, "result.scenario");
    const isl = strictNum(res.workload.isl, "workload.isl");
    const osl = strictNum(res.workload.osl, "workload.osl");
    const gpuCount = strictNum(sys.accelerator_count, "system.accelerator_count");
    const intrinsic: Reason[] = [];
    // Rule: never call a submitter system an AWS configuration.
    if (sys.host && String(sys.host).toLowerCase().includes("not-an-aws")) {
      intrinsic.push({ code: "not-aws-system", dimension: "hardware", message: `Submitted system "${hostName}" is not an AWS instance; usable only as an explicit host proxy.` });
    }
    if (snap.kind === "illustrative-pending-ingestion") {
      intrinsic.push({ code: "illustrative-snapshot", dimension: "provenance", message: "Illustrative pinned snapshot; numeric result pending real ingestion — not a verified measurement." });
    }
    return [
      {
        id: `mlp:${benchmark}:${sku}:${isl}/${osl}:${scenario}`,
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
        modelId: benchmark,
        checkpoint,
        weightPrecision,
        kvPrecision,
        framework,
        frameworkVersion,
        gpuSku: sku,
        formFactor,
        gpuMemGB: strictNum(sys.gpu_mem_gb, "system.gpu_mem_gb"),
        gpuCount,
        nodeCount: 1,
        topology: `${scenario} · ${gpuCount}× ${sku}`,
        interconnect,
        parallelism: { tp: gpuCount, pp: 1, ep: 1, dp: 1 },
        serving: "aggregated",
        // A submitter system is NOT an AWS instance → represents no AWS instances directly.
        hostSystem: hostName,
        awsRepresentativeInstances: [],
        isl,
        osl,
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
  const a = accel.toUpperCase(); // `accel` is already strict-validated as a non-empty string
  if (a.includes("H200")) return "H200";
  if (a.includes("H100")) return "H100";
  if (a.includes("B200")) return "B200";
  if (a.includes("GB200")) return "GB200";
  return a;
}
