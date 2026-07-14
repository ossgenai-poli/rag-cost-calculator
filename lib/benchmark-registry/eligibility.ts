// Deterministic, request-relative evaluation — FAIL CLOSED. A measured-exact claim
// requires the FULL decision-critical request contract (model, precision incl. KV,
// engine, a reviewed AWS instance, whole-group topology and the operating concurrency),
// an AWS-representative (or reviewed-host-equivalent) measurement, a latency-qualified
// point under an interactive SLA, and an in-bounds sequence. Sequence is the only
// dimension with a disclosed transform; every other mismatch → ineligible → unbenchmarked.
import type { BenchmarkRecord, EvidenceMatch, EvidenceStatus, OperatingPoint, Percentile, Reason, RequestSpec, Transformation } from "./schema";
import { confidenceFor } from "./confidence";
import { acceleratorEquivalence, hostEquivalence, type HostEquivalenceEntry } from "./equivalence";
import { acceleratorForInstance } from "./instance-map";
import { islLinearScale, islScaleInBounds } from "./transform";

// Sequence policy is a FIXED reviewed constant — NEVER a caller-supplied tolerance (P1-BENCH-007).
// measured-exact requires the IDENTICAL measured sequence bucket (same ISL AND same OSL). A
// non-identical but in-bounds ISL is a DISCLOSED `measured-scaled` transform, never exact; OSL has
// no transform, so any OSL difference is a hard mismatch. This removes the earlier tolerance knob
// that let a 4× sequence gap be silently labelled measured-exact.
const PCTL_RANK: Record<Percentile, number> = { mean: 0, p50: 0, p90: 1, p95: 2, p99: 3, unknown: -1 };
const REQUEST_PERCENTILES: Percentile[] = ["p50", "p90", "p95", "p99", "mean"];

// Decision-critical request fields — an under-specified request can never be measured-exact.
const REQUIRED_REQUEST: (keyof RequestSpec)[] = [
  "modelId", "checkpoint", "weightPrecision", "kvPrecision", "framework", "gpuSku", "awsInstance",
  "gpuCount", "nodeCount", "serving", "prefixCache", "specDecode", "isl", "osl", "concurrency",
];

export interface EvalOptions {
  /** Injected host-equivalence allowlist (tests). Defaults to the frozen production allowlist. */
  hostAllowlist?: readonly HostEquivalenceEntry[];
}

const posInt = (v: unknown) => typeof v === "number" && Number.isInteger(v) && Number.isFinite(v) && v > 0;
const posFinite = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
const nonEmptyStr = (v: unknown) => typeof v === "string" && v.length > 0;

/** Decision-critical fields that must be PRESENT for a resolvable request. */
export function missingRequestFields(req: RequestSpec): string[] {
  const missing: string[] = REQUIRED_REQUEST.filter((k) => req[k] == null).map((k) => String(k));
  if (!req.parallelism || req.parallelism.tp == null || req.parallelism.pp == null || req.parallelism.ep == null) missing.push("parallelism{tp,pp,ep}");
  return missing;
}

/** Public-boundary request validation (P1-BENCH-006): completeness + type/range, INDEPENDENT of any
 *  catalog. The experimental resolver runs this BEFORE selection so malformed input is reported as
 *  `invalid-request` (with reasons) — never misattributed to a benchmark-coverage gap. Returns []
 *  for a well-formed, complete request. */
export function requestBoundaryErrors(req: RequestSpec): string[] {
  return [...missingRequestFields(req).map((f) => `missing ${f}`), ...validateRequest(req)];
}

/** Runtime type/range validation of the request (P1-BENCH-002). Invalid → invalid-request. */
export function validateRequest(req: RequestSpec): string[] {
  const p: string[] = [];
  for (const k of ["modelId", "checkpoint", "weightPrecision", "kvPrecision", "framework", "gpuSku", "awsInstance", "specDecode"] as const) {
    if (!nonEmptyStr(req[k])) p.push(`${k} must be a non-empty string`);
  }
  for (const k of ["isl", "osl", "concurrency", "gpuCount", "nodeCount"] as const) {
    if (!posInt(req[k])) p.push(`${k} must be a positive finite integer`);
  }
  if (req.parallelism) for (const k of ["tp", "pp", "ep"] as const) if (!posInt(req.parallelism[k])) p.push(`parallelism.${k} must be a positive finite integer`);
  if (typeof req.prefixCache !== "boolean") p.push("prefixCache must be a boolean");
  if (req.serving !== "aggregated" && req.serving !== "disaggregated") p.push("serving must be aggregated|disaggregated");
  if (req.interactivity) {
    if (!REQUEST_PERCENTILES.includes(req.interactivity.ttftPercentile)) p.push(`interactivity.ttftPercentile must be one of ${REQUEST_PERCENTILES.join("|")}`);
    if (!posFinite(req.interactivity.ttftSlaMs)) p.push("interactivity.ttftSlaMs must be positive & finite");
    if (req.interactivity.streamingTokPerSecPerUser != null && !posFinite(req.interactivity.streamingTokPerSecPerUser)) p.push("interactivity.streamingTokPerSecPerUser must be positive & finite");
  }
  return p;
}

export function evaluate(record: BenchmarkRecord, req: RequestSpec, opts: EvalOptions = {}): EvidenceMatch {
  const reasons: Reason[] = [...record.intrinsicQualifications];
  const deny = (code: string, dimension: string, message: string): EvidenceMatch => ({
    record,
    eligible: false,
    evidenceStatus: "heuristic",
    confidence: "unbenchmarked",
    reasons: [...reasons, { code, dimension, message }],
  });

  // Request completeness — missing identity/topology/config fields → unbenchmarked.
  const missing = missingRequestFields(req);
  if (missing.length) return deny("incomplete-request", "request", `request missing decision-critical field(s): ${missing.join(", ")}`);

  // Request type/range validation — malformed values never produce measured-exact.
  const invalid = validateRequest(req);
  if (invalid.length) return deny("invalid-request", "request", `invalid request: ${invalid.join("; ")}`);

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
    const he = hostEquivalence(record.hostSystem, req.awsInstance, opts.hostAllowlist);
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

  // OSL has no transform — measured-exact requires the IDENTICAL OSL bucket; any difference denies.
  if (record.osl !== req.osl) return deny("osl-mismatch", "sequence", `OSL ${record.osl} ≠ requested ${req.osl}; no OSL transform (identical bucket required)`);

  // Per-GPU + operating concurrency.
  const requirePerGpu = req.requirePerGpu !== false;
  if (requirePerGpu && (!record.perGpuReported || record.outputTputPerGpu == null)) {
    return deny("no-per-gpu-metric", "topology", `no source-reported per-GPU metric (${record.gpuCount}× ${record.gpuSku}${record.nodeCount > 1 ? ", multi-node" : ""}); will not synthesize one`);
  }
  if (record.concurrency !== req.concurrency) {
    return deny("concurrency-not-measured", "operating-point", `requested concurrency ${req.concurrency} was not measured (record @ ${record.concurrency}); no interpolation`);
  }

  // ISL: measured-exact ONLY for the identical bucket; any other ISL is a bounded, DISCLOSED scale
  // (→ measured-scaled), and out-of-bounds → unbenchmarked. There is no "near-bucket exact" fuzz —
  // a non-identical ISL is never labelled exact (P1-BENCH-007).
  const islScaled = record.isl !== req.isl;
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
