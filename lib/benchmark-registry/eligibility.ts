// Deterministic, request-relative evaluation — FAIL CLOSED. A measured-exact claim
// requires the FULL decision-critical request contract (model, precision incl. KV,
// engine, a reviewed AWS instance, whole-group topology and the operating concurrency),
// an AWS-representative (or reviewed-host-equivalent) measurement, a latency-qualified
// point under an interactive SLA, and an in-bounds sequence. Sequence is the only
// dimension with a disclosed transform; every other mismatch → ineligible → unbenchmarked.
import type { BenchmarkRecord, EvidenceMatch, EvidenceStatus, OperatingPoint, Percentile, Reason, RequestSpec, Transformation } from "./schema";
import { confidenceFor } from "./confidence";
import { acceleratorEquivalence, hostEquivalence } from "./equivalence";
import { acceleratorForInstance } from "./instance-map";
import { islLinearScale, islScaleInBounds } from "./transform";

const DEFAULT_SEQ_TOL = 1.5;
const PCTL_RANK: Record<Percentile, number> = { mean: 0, p50: 0, p90: 1, p95: 2, p99: 3, unknown: -1 };

// Decision-critical request fields — an under-specified request can never be measured-exact.
const REQUIRED_REQUEST: (keyof RequestSpec)[] = [
  "modelId", "checkpoint", "weightPrecision", "kvPrecision", "framework", "gpuSku", "awsInstance",
  "gpuCount", "nodeCount", "serving", "prefixCache", "specDecode", "isl", "osl", "concurrency",
];

export function evaluate(record: BenchmarkRecord, req: RequestSpec): EvidenceMatch {
  const reasons: Reason[] = [...record.intrinsicQualifications];
  const deny = (code: string, dimension: string, message: string): EvidenceMatch => ({
    record,
    eligible: false,
    evidenceStatus: "heuristic",
    confidence: "unbenchmarked",
    reasons: [...reasons, { code, dimension, message }],
  });

  // Request completeness — missing identity/topology/config fields → unbenchmarked.
  const missing: string[] = REQUIRED_REQUEST.filter((k) => req[k] == null).map((k) => String(k));
  if (!req.parallelism || req.parallelism.tp == null || req.parallelism.pp == null || req.parallelism.ep == null) missing.push("parallelism{tp,pp,ep}");
  if (missing.length) return deny("incomplete-request", "request", `request missing decision-critical field(s): ${missing.join(", ")}`);

  // P1-1: only verified snapshots are ever selectable.
  if (record.provenance.snapshotKind !== "verified") {
    return deny("not-verified", "provenance", `snapshotKind "${record.provenance.snapshotKind}" is not verified — never selectable`);
  }

  // AWS instance must resolve to a reviewed accelerator, and be self-consistent with gpuSku.
  const mappedAccel = acceleratorForInstance(req.awsInstance);
  if (!mappedAccel) return deny("unknown-aws-instance", "hardware", `AWS instance "${req.awsInstance}" is not in the reviewed instance→accelerator map`);
  if (mappedAccel !== req.gpuSku) return deny("instance-accelerator-inconsistent", "hardware", `instance ${req.awsInstance} is ${mappedAccel}, not the requested ${req.gpuSku}`);

  // Model + exact checkpoint must match — never transfer one model's performance to another.
  if (record.modelId !== req.modelId) return deny("model-mismatch", "model", `record model ${record.modelId} ≠ requested ${req.modelId}`);
  if (record.checkpoint !== req.checkpoint) return deny("checkpoint-mismatch", "model", `record checkpoint ${record.checkpoint} ≠ requested ${req.checkpoint}`);
  // Precision (weight independent of KV). Unknown/mismatched → unbenchmarked (no precision transform).
  if (record.weightPrecision !== req.weightPrecision) return deny("weight-precision-mismatch", "precision", `weight ${record.weightPrecision} ≠ requested ${req.weightPrecision}`);
  if (record.kvPrecision == null) return deny("kv-precision-unknown", "kv-precision", `record KV precision unknown; cannot be exact for requested ${req.kvPrecision}`);
  if (record.kvPrecision !== req.kvPrecision) return deny("kv-precision-mismatch", "kv-precision", `KV ${record.kvPrecision} ≠ requested ${req.kvPrecision}`);
  // Engine.
  if (record.framework !== req.framework) return deny("engine-mismatch", "engine", `engine ${record.framework} ≠ requested ${req.framework}`);

  // P1-2 / host: accelerator + host must match or be REVIEWED-equivalent (deny by default).
  let hostSwapped = false;
  if (record.gpuSku !== req.gpuSku) {
    const eq = acceleratorEquivalence(record.gpuSku, req.gpuSku);
    if (!eq) return deny("gpu-not-equivalent", "hardware", `${record.gpuSku} is not a reviewed equivalent of ${req.gpuSku}`);
    hostSwapped = true;
    reasons.push({ code: "gpu-proxy", dimension: "hardware", message: `reviewed equivalence ${eq.from}→${eq.to}: ${eq.materialDifferences}` });
  } else if (!record.awsRepresentativeInstances.includes(req.awsInstance!)) {
    // Same accelerator, but this measurement does not directly represent the requested
    // instance — only a REVIEWED host equivalence permits a proxy (deny by default).
    const he = hostEquivalence(record.hostSystem, req.awsInstance);
    if (!he) return deny("host-not-equivalent", "hardware", `measured on ${record.hostSystem} (represents ${JSON.stringify(record.awsRepresentativeInstances)}), no reviewed host equivalence for ${req.awsInstance}`);
    hostSwapped = true;
    reasons.push({ code: "host-proxy", dimension: "hardware", message: `reviewed host equivalence ${he.recordHost}→${he.awsInstance}: ${he.materialDifferences}` });
  }

  // P1-3: topology.
  if (record.gpuCount !== req.gpuCount) return deny("gpu-count-mismatch", "topology", `record ${record.gpuCount}-GPU group ≠ requested ${req.gpuCount}`);
  if (record.nodeCount !== req.nodeCount) return deny("node-count-mismatch", "topology", `record ${record.nodeCount} node(s) ≠ requested ${req.nodeCount}`);
  if (record.serving !== req.serving) return deny("serving-mismatch", "topology", `${record.serving} ≠ requested ${req.serving}`);
  for (const k of ["tp", "pp", "ep"] as const) {
    if (record.parallelism[k] !== req.parallelism![k]) return deny(`${k}-mismatch`, "topology", `${k.toUpperCase()} ${record.parallelism[k]} ≠ requested ${req.parallelism![k]}`);
  }

  // Prefix-cache and speculative-decoding materially affect performance — required for
  // measured-exact; unknown on the record → cannot be exact (P1).
  if (record.prefixCache == null) return deny("prefix-cache-unknown", "config", "record does not report prefix-cache behavior; cannot be measured-exact");
  if (record.prefixCache !== req.prefixCache) return deny("prefix-cache-mismatch", "config", `prefix-cache ${record.prefixCache} ≠ requested ${req.prefixCache}`);
  if (record.specDecode == null) return deny("spec-decode-unknown", "config", "record does not report speculative-decoding state; cannot be measured-exact");
  if (record.specDecode !== req.specDecode) return deny("spec-decode-mismatch", "config", `spec-decode ${record.specDecode} ≠ requested ${req.specDecode}`);

  // OSL mismatch → unbenchmarked (no OSL transform).
  const tol = req.seqTolerance ?? DEFAULT_SEQ_TOL;
  if (offBucket(record.osl, req.osl, tol)) return deny("osl-mismatch", "sequence", `OSL ${record.osl} not within ${tol}× of requested ${req.osl}`);

  // Per-GPU + operating concurrency.
  const requirePerGpu = req.requirePerGpu !== false;
  if (requirePerGpu && (!record.perGpuReported || record.outputTputPerGpu == null)) {
    return deny("no-per-gpu-metric", "topology", `no source-reported per-GPU metric (${record.gpuCount}× ${record.gpuSku}${record.nodeCount > 1 ? ", multi-node" : ""}); will not synthesize one`);
  }
  if (record.concurrency !== req.concurrency) {
    return deny("concurrency-not-measured", "operating-point", `requested concurrency ${req.concurrency} was not measured (record @ ${record.concurrency}); no interpolation`);
  }

  // ISL: exact within tolerance, or a bounded disclosed scale; out-of-bounds → unbenchmarked.
  const islScaled = offBucket(record.isl, req.isl, tol);
  const transformations: Transformation[] = [];
  let operatingPoint: OperatingPoint | undefined;
  if (islScaled) {
    if (!islScaleInBounds(record.isl, req.isl)) return deny("isl-scale-out-of-bounds", "sequence", `ISL ratio ${(req.isl / record.isl).toFixed(1)}× is outside the transform bounds; no extrapolation`);
    const s = islLinearScale(record.isl, req.isl, record.outputTputPerGpu!, record.inputTputPerGpu, record.intvty);
    transformations.push(s.transformation);
    operatingPoint = s.operatingPoint; // ttftS null after scaling
    reasons.push({ code: "isl-scaled", dimension: "sequence", message: s.transformation.note });
  } else {
    operatingPoint = { tputPerGpu: record.outputTputPerGpu!, inputTputPerGpu: record.inputTputPerGpu, ttftS: record.ttft?.value ?? null, conc: record.concurrency, intvty: record.intvty };
  }

  // Interactive latency gate — latency-qualified, percentile-aware, streaming-aware.
  if (req.interactivity) {
    if (!record.latencyQualified) return deny("latency-gate", "latency", `record is not latency-qualified (max-load / no defined-load TTFT); cannot satisfy a ${req.interactivity.ttftSlaMs}ms ${req.interactivity.ttftPercentile.toUpperCase()} SLA`);
    const ttftS = operatingPoint?.ttftS;
    if (ttftS == null || record.ttft == null) return deny("latency-gate", "latency", `no valid TTFT at the requested operating point (e.g. ISL-scaled → TTFT invalid)`);
    if (PCTL_RANK[record.ttft.percentile] < PCTL_RANK[req.interactivity.ttftPercentile]) {
      return deny("ttft-percentile-insufficient", "latency", `record TTFT is ${record.ttft.percentile.toUpperCase()}; cannot establish a ${req.interactivity.ttftPercentile.toUpperCase()} SLA`);
    }
    if (ttftS > req.interactivity.ttftSlaMs / 1000) return deny("latency-sla-exceeded", "latency", `${record.ttft.percentile.toUpperCase()} TTFT ${ttftS.toFixed(2)}s > ${(req.interactivity.ttftSlaMs / 1000).toFixed(2)}s SLA`);
    if (req.interactivity.streamingTokPerSecPerUser != null) {
      if (operatingPoint?.intvty == null) return deny("interactivity-unknown", "latency", "no measured streaming interactivity to compare against the streaming target");
      if (operatingPoint.intvty < req.interactivity.streamingTokPerSecPerUser) return deny("streaming-below-target", "latency", `measured ${operatingPoint.intvty} tok/s/user < requested ${req.interactivity.streamingTokPerSecPerUser}`);
    }
  }

  const status: EvidenceStatus = transformations.length ? "measured-scaled" : hostSwapped ? "proxy" : "measured-exact";
  return {
    record,
    eligible: true,
    evidenceStatus: status,
    confidence: confidenceFor(record.provenance.sourceClass, status),
    reasons,
    operatingPoint,
    transformations: transformations.length ? transformations : undefined,
  };
}

function offBucket(have: number, want: number, tol: number): boolean {
  if (have <= 0 || want <= 0) return false;
  const r = want / have;
  return r > tol || r < 1 / tol;
}
