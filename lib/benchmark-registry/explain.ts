// Trust-panel + export provenance view. The headline NEVER calls a proxy,
// extrapolation or vendor ceiling "measured" without qualification.
import type { EvidenceMatch, ProvenanceView } from "./schema";

const STATUS_WORD: Record<string, string> = {
  "measured-exact": "measured (exact)",
  "measured-scaled": "measured, scaled",
  proxy: "PROXY (equivalent system)",
  extrapolated: "EXTRAPOLATED",
  heuristic: "heuristic",
};

export function explain(match: EvidenceMatch, controlDiff: Record<string, unknown>): ProvenanceView {
  const rec = match.record;
  const p = rec.provenance;
  const status = STATUS_WORD[match.evidenceStatus] ?? match.evidenceStatus;
  const ttft = rec.ttft ? ` · ${rec.ttft.percentile.toUpperCase()} TTFT ${rec.ttft.value.toFixed(2)}s` : "";
  const illus = p.snapshotKind === "illustrative-pending-ingestion" ? " · ILLUSTRATIVE (pending ingestion)" : "";
  const headline = `${p.sourceName} (${match.confidence}) · ${rec.modelId} · ${rec.gpuSku}×${rec.gpuCount} · ${rec.weightPrecision}/${rec.kvPrecision ?? "?"} · ${rec.isl}/${rec.osl} · ${status}${ttft}${illus}`;
  const full = {
    source: p.sourceName,
    sourceClass: p.sourceClass,
    sourceUrl: p.sourceUrl,
    runId: p.runId,
    sourceCommit: p.sourceCommit,
    retrievedAt: p.retrievedAt,
    rawChecksum: p.rawChecksum,
    license: p.license,
    attribution: p.attribution,
    snapshotKind: p.snapshotKind,
    modelId: rec.modelId,
    checkpoint: rec.checkpoint,
    framework: rec.framework,
    weightPrecision: rec.weightPrecision,
    kvPrecision: rec.kvPrecision,
    gpuSku: rec.gpuSku,
    gpuCount: rec.gpuCount,
    nodeCount: rec.nodeCount,
    topology: rec.topology,
    serving: rec.serving,
    isl: rec.isl,
    osl: rec.osl,
    ttft: rec.ttft,
    measuredDate: rec.measuredDate,
    evidenceStatus: match.evidenceStatus,
    confidence: match.confidence,
    reasons: match.reasons,
    ...controlDiff,
  };
  return { headline, full };
}
