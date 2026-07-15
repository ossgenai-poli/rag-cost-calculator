// Deterministic mapping from a candidate + workload + frozen calculation → a benchmark-registry
// RequestSpec (DESIGN §4.3). CRITICAL (approval note): fields we do not honestly know are left UNSET —
// they are NEVER invented to make the registry resolve. In particular the pinned InferenceX snapshot has
// no prefix-cache / speculative-decoding / checkpoint / reviewed-topology facts, so those stay unknown
// and the registry returns `invalid-request` (incomplete) → the candidate stays `unbenchmarked`.
import type { RequestSpec } from "../benchmark-registry";
import type { CalcInputs, CalcResult } from "../types";
import type { CandidateConfig } from "./schema";

/** Weight/KV bit-width → the registry's precision string. 4→fp4, 8→fp8, 16→bf16. */
export function precisionFromBits(bits: number): string {
  if (bits === 4) return "fp4";
  if (bits === 8) return "fp8";
  if (bits === 16) return "bf16";
  return `w${bits}`; // unknown width → a non-matching token (fails closed on match, never coerced)
}

/**
 * Build the registry request from REAL derived facts only. KNOWN (set): modelId, weight/KV precision,
 * gpuSku, awsInstance, gpuCount, isl, osl, concurrency, interactivity SLA, and serving/parallelism WHEN
 * the frozen benchmark provenance actually reports them. UNKNOWN (left unset → incomplete → invalid):
 * checkpoint, framework, prefix-cache, speculative-decoding, node topology we cannot establish.
 */
export function buildRegistryRequest(candidate: CandidateConfig, workload: CalcInputs, calc: CalcResult): RequestSpec {
  const cap = calc.crossover.capacity;
  const prov = cap.benchmarkProvenance;

  const req: RequestSpec = {
    modelId: candidate.llmModelId,
    weightPrecision: precisionFromBits(candidate.weightBits),
    kvPrecision: precisionFromBits(candidate.kvBits),
    gpuSku: candidate.gpuSku,
    awsInstance: candidate.instanceType,
    gpuCount: cap.gpusInConfig,
    isl: calc.perQuery.llmInputTok,
    osl: workload.generation.outTokens,
    concurrency: cap.chosenConcurrency,
    interactivity: {
      ttftSlaMs: workload.generation.ttftTargetMs,
      ttftPercentile: "p99",
      streamingTokPerSecPerUser: workload.generation.interactivityTarget,
    },
    // framework only if the frozen curve actually named one (else UNKNOWN — never invented).
    ...(cap.framework ? { framework: cap.framework } : {}),
    // serving only if the provenance actually reports the disagg state (else UNKNOWN).
    ...(prov ? { serving: prov.disagg ? "disaggregated" : "aggregated" } : {}),
    // checkpoint / parallelism{tp,pp,ep} / nodeCount / prefixCache / specDecode are DELIBERATELY unset —
    // the pinned snapshot does not establish them, so the registry must return incomplete/unbenchmarked.
  };
  return req;
}
