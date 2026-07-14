// Deterministic, request-relative evaluation of one record. Produces the evidence
// status, confidence and EVERY mismatch reason — nothing silent.
import type { BenchmarkRecord, EvidenceMatch, EvidenceStatus, Reason, RequestSpec } from "./schema";
import { confidenceFor } from "./confidence";

const DEFAULT_SEQ_TOL = 1.5;

export function evaluate(record: BenchmarkRecord, req: RequestSpec): EvidenceMatch {
  const reasons: Reason[] = [...record.intrinsicQualifications];
  let eligible = true;
  let transformed = false; // → extrapolated
  let hostSwapped = false; // → proxy

  // Model must match — never transfer one model's performance to another (rule).
  if (record.modelId !== req.modelId || (req.checkpoint && record.checkpoint !== req.checkpoint)) {
    return ineligible(record, req, [{ code: "model-mismatch", dimension: "model", message: `record model ${record.modelId} ≠ requested ${req.modelId}` }]);
  }

  // Precision (weight independent of KV) — projecting across precision is extrapolation, never silent.
  if (record.weightPrecision !== req.weightPrecision) {
    transformed = true;
    reasons.push({ code: "weight-precision-mismatch", dimension: "precision", message: `weight ${record.weightPrecision} ≠ requested ${req.weightPrecision}` });
  }
  if (req.kvPrecision && record.kvPrecision && record.kvPrecision !== req.kvPrecision) {
    transformed = true;
    reasons.push({ code: "kv-precision-mismatch", dimension: "kv-precision", message: `KV ${record.kvPrecision} ≠ requested ${req.kvPrecision}` });
  }

  // Engine/framework transform.
  if (req.framework && record.framework !== req.framework) {
    transformed = true;
    reasons.push({ code: "engine-mismatch", dimension: "engine", message: `engine ${record.framework} ≠ requested ${req.framework}` });
  }

  // GPU host swap → explicit proxy (material differences surfaced).
  if (record.gpuSku !== req.gpuSku) {
    hostSwapped = true;
    reasons.push({ code: "gpu-proxy", dimension: "hardware", message: `measured on ${record.gpuSku}, requested ${req.gpuSku} — explicit host proxy; verify equivalence` });
  }

  // Sequence bucket — off-bucket ISL/OSL is extrapolation.
  const tol = req.seqTolerance ?? DEFAULT_SEQ_TOL;
  if (offBucket(record.isl, req.isl, tol)) {
    transformed = true;
    reasons.push({ code: "isl-mismatch", dimension: "sequence", message: `ISL ${record.isl} not within ${tol}× of requested ${req.isl}` });
  }
  if (req.osl > 0 && offBucket(record.osl, req.osl, tol)) {
    transformed = true;
    reasons.push({ code: "osl-mismatch", dimension: "sequence", message: `OSL ${record.osl} not within ${tol}× of requested ${req.osl}` });
  }

  // Topology — a serving-mode mismatch is surfaced; a partial group is ineligible.
  if (req.serving && record.serving !== req.serving) {
    reasons.push({ code: "serving-mismatch", dimension: "topology", message: `${record.serving} ≠ requested ${req.serving}` });
    transformed = true;
  }

  // Per-GPU requirement — no fictional per-GPU from a system total (test 6).
  const requirePerGpu = req.requirePerGpu !== false;
  if (requirePerGpu && (!record.perGpuReported || record.outputTputPerGpu == null)) {
    eligible = false;
    reasons.push({ code: "no-per-gpu-metric", dimension: "topology", message: `no source-reported per-GPU metric (${record.gpuCount}× ${record.gpuSku}${record.nodeCount > 1 ? ", multi-node" : ""}); will not synthesize one` });
  }

  // Interactive latency gate — a max-load/non-latency-qualified point cannot satisfy a TTFT SLA (test 3).
  if (req.interactivity) {
    const slaS = req.interactivity.ttftSlaMs / 1000;
    if (!record.latencyQualified || record.ttft == null) {
      eligible = false;
      reasons.push({ code: "latency-gate", dimension: "latency", message: `no latency-qualified TTFT; cannot satisfy a ${req.interactivity.ttftSlaMs}ms interactive SLA (max-load throughput is a ceiling)` });
    } else if (record.ttft.value > slaS) {
      eligible = false;
      reasons.push({ code: "latency-sla-exceeded", dimension: "latency", message: `${record.ttft.percentile.toUpperCase()} TTFT ${record.ttft.value.toFixed(2)}s > ${slaS.toFixed(2)}s SLA` });
    }
  }

  const status: EvidenceStatus = !eligible ? "heuristic" : transformed ? "extrapolated" : hostSwapped ? "proxy" : "measured-exact";
  return {
    record,
    eligible,
    evidenceStatus: status,
    confidence: eligible ? confidenceFor(record.provenance.sourceClass, status) : "unbenchmarked",
    reasons,
    operatingPoint:
      eligible && record.outputTputPerGpu != null
        ? { tputPerGpu: record.outputTputPerGpu, inputTputPerGpu: record.inputTputPerGpu, ttftS: record.ttft?.value ?? null, conc: record.concurrency, intvty: null }
        : undefined,
  };
}

function ineligible(record: BenchmarkRecord, _req: RequestSpec, reasons: Reason[]): EvidenceMatch {
  return { record, eligible: false, evidenceStatus: "heuristic", confidence: "unbenchmarked", reasons };
}

function offBucket(have: number, want: number, tol: number): boolean {
  if (have <= 0 || want <= 0) return false;
  const r = want / have;
  return r > tol || r < 1 / tol;
}
