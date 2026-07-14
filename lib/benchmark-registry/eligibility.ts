// Deterministic, request-relative evaluation — FAIL CLOSED. A record is only
// eligible when the model, precision (weight AND KV), engine, accelerator+host,
// full topology, operating point (concurrency/statistic) and — under an interactive
// SLA — the latency percentile all match. Sequence-length is the only dimension with
// a disclosed transform (measured-scaled); every other mismatch → ineligible
// (→ unbenchmarked). Nothing is silent.
import type { BenchmarkRecord, EvidenceMatch, EvidenceStatus, OperatingPoint, Percentile, Reason, RequestSpec, Transformation } from "./schema";
import { confidenceFor } from "./confidence";
import { acceleratorEquivalence } from "./equivalence";
import { islLinearScale } from "./transform";

const DEFAULT_SEQ_TOL = 1.5;
const PCTL_RANK: Record<Percentile, number> = { mean: 0, p50: 0, p90: 1, p95: 2, p99: 3, unknown: -1 };

export function evaluate(record: BenchmarkRecord, req: RequestSpec): EvidenceMatch {
  const reasons: Reason[] = [...record.intrinsicQualifications];
  const deny = (code: string, dimension: string, message: string): EvidenceMatch => ({
    record,
    eligible: false,
    evidenceStatus: "heuristic",
    confidence: "unbenchmarked",
    reasons: [...reasons, { code, dimension, message }],
  });

  // P1-1: only verified snapshots are ever selectable.
  if (record.provenance.snapshotKind !== "verified") {
    return deny("not-verified", "provenance", `snapshotKind "${record.provenance.snapshotKind}" is not verified — never selectable`);
  }
  // Model must match — never transfer one model's performance to another.
  if (record.modelId !== req.modelId || (req.checkpoint && record.checkpoint !== req.checkpoint)) {
    return deny("model-mismatch", "model", `record model ${record.modelId} ≠ requested ${req.modelId}`);
  }
  // P1-4: precision. Unknown KV vs a specified KV cannot be exact; any precision mismatch → unbenchmarked (no transform).
  if (record.weightPrecision !== req.weightPrecision) {
    return deny("weight-precision-mismatch", "precision", `weight ${record.weightPrecision} ≠ requested ${req.weightPrecision} (no precision transform)`);
  }
  if (req.kvPrecision) {
    if (record.kvPrecision == null) return deny("kv-precision-unknown", "kv-precision", `record KV precision unknown; cannot be exact for requested ${req.kvPrecision}`);
    if (record.kvPrecision !== req.kvPrecision) return deny("kv-precision-mismatch", "kv-precision", `KV ${record.kvPrecision} ≠ requested ${req.kvPrecision}`);
  }
  // Engine mismatch → unbenchmarked (no engine transform).
  if (req.framework && record.framework !== req.framework) {
    return deny("engine-mismatch", "engine", `engine ${record.framework} ≠ requested ${req.framework}`);
  }

  // P1-2: accelerator equivalence — deny by default. Same accelerator + non-AWS host → proxy.
  let hostSwapped = false;
  if (record.gpuSku !== req.gpuSku) {
    const eq = acceleratorEquivalence(record.gpuSku, req.gpuSku);
    if (!eq) return deny("gpu-not-equivalent", "hardware", `${record.gpuSku} is not a reviewed equivalent of ${req.gpuSku} — no cross-accelerator substitution`);
    hostSwapped = true;
    reasons.push({ code: "gpu-proxy", dimension: "hardware", message: `reviewed equivalence ${eq.from}→${eq.to}: ${eq.materialDifferences}` });
  } else if (!record.hostIsAwsRepresentative) {
    hostSwapped = true;
    reasons.push({ code: "host-proxy", dimension: "hardware", message: `measured on ${record.hostSystem} (not the requested AWS host) — host proxy; verify equivalence` });
  }

  // P1-3: topology must match (whole serving group + parallelism + node mapping).
  if (req.gpuCount != null && record.gpuCount !== req.gpuCount) return deny("gpu-count-mismatch", "topology", `record ${record.gpuCount}-GPU group ≠ requested ${req.gpuCount}`);
  if (req.nodeCount != null && record.nodeCount !== req.nodeCount) return deny("node-count-mismatch", "topology", `record ${record.nodeCount} node(s) ≠ requested ${req.nodeCount}`);
  if (req.serving && record.serving !== req.serving) return deny("serving-mismatch", "topology", `${record.serving} ≠ requested ${req.serving}`);
  if (req.parallelism) {
    for (const k of ["tp", "pp", "ep"] as const) {
      const want = req.parallelism[k];
      if (want != null && record.parallelism[k] !== want) return deny(`${k}-mismatch`, "topology", `${k.toUpperCase()} ${record.parallelism[k]} ≠ requested ${want}`);
    }
  }

  // OSL mismatch → unbenchmarked (no OSL transform). ISL beyond tolerance → disclosed scale.
  const tol = req.seqTolerance ?? DEFAULT_SEQ_TOL;
  if (req.osl > 0 && offBucket(record.osl, req.osl, tol)) return deny("osl-mismatch", "sequence", `OSL ${record.osl} not within ${tol}× of requested ${req.osl} (no OSL transform)`);

  // P1-5: per-GPU + concurrency (operating point) + latency percentile/streaming.
  const requirePerGpu = req.requirePerGpu !== false;
  if (requirePerGpu && (!record.perGpuReported || record.outputTputPerGpu == null)) {
    return deny("no-per-gpu-metric", "topology", `no source-reported per-GPU metric (${record.gpuCount}× ${record.gpuSku}${record.nodeCount > 1 ? ", multi-node" : ""}); will not synthesize one`);
  }
  // Exact requires the ACTUAL operating point (concurrency) to match — not just model/GPU fields.
  if (req.concurrency != null && record.concurrency !== req.concurrency) {
    return deny("concurrency-not-measured", "operating-point", `requested concurrency ${req.concurrency} was not measured (record @ ${record.concurrency}); no interpolation`);
  }

  const islScaled = offBucket(record.isl, req.isl, tol);
  const transformations: Transformation[] = [];
  let operatingPoint: OperatingPoint | undefined;
  if (islScaled) {
    if (record.outputTputPerGpu == null) return deny("no-per-gpu-metric", "topology", "cannot scale without a per-GPU decode metric");
    const s = islLinearScale(record.isl, req.isl, record.outputTputPerGpu, record.inputTputPerGpu, record.intvty);
    transformations.push(s.transformation);
    operatingPoint = s.operatingPoint; // ttftS is null after scaling
    reasons.push({ code: "isl-scaled", dimension: "sequence", message: s.transformation.note });
  } else if (record.outputTputPerGpu != null) {
    operatingPoint = { tputPerGpu: record.outputTputPerGpu, inputTputPerGpu: record.inputTputPerGpu, ttftS: record.ttft?.value ?? null, conc: record.concurrency, intvty: record.intvty };
  }

  // Interactive latency gate — percentile-aware, streaming-aware.
  if (req.interactivity) {
    const reqRank = PCTL_RANK[req.interactivity.ttftPercentile];
    const ttftS = operatingPoint?.ttftS;
    if (ttftS == null || record.ttft == null) {
      return deny("latency-gate", "latency", `no latency-qualified TTFT at the requested operating point (max-load, or ISL-scaled → TTFT invalid); cannot satisfy a ${req.interactivity.ttftSlaMs}ms ${req.interactivity.ttftPercentile.toUpperCase()} SLA`);
    }
    if (PCTL_RANK[record.ttft.percentile] < reqRank) {
      return deny("ttft-percentile-insufficient", "latency", `record TTFT is ${record.ttft.percentile.toUpperCase()}; cannot establish a ${req.interactivity.ttftPercentile.toUpperCase()} SLA`);
    }
    if (ttftS > req.interactivity.ttftSlaMs / 1000) {
      return deny("latency-sla-exceeded", "latency", `${record.ttft.percentile.toUpperCase()} TTFT ${ttftS.toFixed(2)}s > ${(req.interactivity.ttftSlaMs / 1000).toFixed(2)}s SLA`);
    }
    if (req.interactivity.streamingTokPerSecPerUser != null) {
      if (operatingPoint?.intvty == null) return deny("interactivity-unknown", "latency", "record has no measured streaming interactivity to compare against the streaming target");
      if (operatingPoint.intvty < req.interactivity.streamingTokPerSecPerUser) {
        return deny("streaming-below-target", "latency", `measured ${operatingPoint.intvty} tok/s/user < requested ${req.interactivity.streamingTokPerSecPerUser}`);
      }
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
