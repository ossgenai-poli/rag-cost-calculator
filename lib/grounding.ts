// ============================================================================
// grounding — validate the provisioned self-hosted GPU fleet against REAL
// InferenceX throughput at the customer's interactivity SLA. The flat
// `sustainedTokPerSec` estimate ignores that per-GPU throughput depends on the
// latency target you serve; this pins it to the measured operating point and
// reports the true minimum instances (throughput floor vs memory floor).
// See research/inference-benchmark-grounding.md.
// ============================================================================

import type { CalcInputs, PriceBook, PerQueryResult, CrossoverResult, GroundingResult } from "./types";
import { getBenchmarkCurve, operatingPointAt } from "./benchmarks";

/**
 * #25 reconciliation. When InferenceX grounding is available it is the
 * authoritative fleet requirement (measured-at-SLA throughput floor combined
 * with the memory floor). The flat-nameplate `throughputInstances` from the
 * crossover model is only a fallback. Callers must use THIS everywhere they show
 * a "needs ≥ N instances" figure so the grounded banner and the capacity warning
 * can never disagree (e.g. grounded ≥15 vs flat ≥6 for the same config).
 */
export function effectiveRequiredInstances(
  grounding: GroundingResult,
  flatThroughputInstances: number
): number {
  // MAX, not "grounded wins": the grounded (measured) figure and the flat-nameplate
  // figure are both lower bounds on a feasible fleet, so the requirement is the
  // larger of the two — taking only the grounded value would mask a bigger flat need.
  const grounded = grounding.available && grounding.minInstances != null ? grounding.minInstances : 0;
  return Math.max(grounded, flatThroughputInstances);
}

/** Parse "8x H100 80GB" → 8; default 8. */
function gpusPerBox(gpuLabel: string | undefined): number {
  const m = gpuLabel?.match(/(\d+)\s*x/i);
  return m ? Number(m[1]) : 8;
}

export function computeGrounding(
  inputs: CalcInputs,
  priceBook: PriceBook,
  perQuery: PerQueryResult,
  crossover: CrossoverResult
): GroundingResult {
  const { generation, traffic } = inputs;
  const model = priceBook.models.find((m) => m.id === generation.llmModelId);
  const provenance = model?.benchmarkProvenance;

  const curve = getBenchmarkCurve(
    model?.inferencexKey,
    generation.gpuInstanceType,
    generation.weightBits,
    perQuery.llmInputTok,
    generation.outTokens
  );

  if (!curve) {
    const gpu = priceBook.gpus.find((g) => g.instanceType === generation.gpuInstanceType);
    const note = !model?.inferencexKey
      ? `${model?.label ?? "This model"} isn't in the InferenceX benchmark set — GPU sizing uses the heuristic throughput estimate, not measured data.`
      : `No InferenceX benchmark for ${model?.label} on ${gpu?.gpu ?? generation.gpuInstanceType} (measured on B200 today) — using the heuristic estimate.`;
    return { available: false, provenance, note };
  }

  const target = generation.interactivityTarget > 0 ? generation.interactivityTarget : 1;
  const op = operatingPointAt(curve.points, target);

  const gpu = priceBook.gpus.find((g) => g.instanceType === generation.gpuInstanceType);
  const perBox = gpusPerBox(gpu?.gpu);
  const perBoxDecode = op.tputPerGpu * perBox;
  // The fleet must clear the whole month's output tokens within the hours it
  // actually runs (uptime ≤ 730), and be sized for PEAK not average load — same
  // treatment as the flat crossover model, so grounded and flat are comparable.
  const monthlyOutputTokens = traffic.queriesPerMonth * generation.outTokens;
  const peakFactor = traffic.peakFactor > 0 ? traffic.peakFactor : 1;
  const uptimeHours = Math.min(730, generation.gpuUptimeHoursPerMonth > 0 ? generation.gpuUptimeHoursPerMonth : 730);
  const requiredDecode = (monthlyOutputTokens * peakFactor) / (uptimeHours * 3600); // peak output tok/s

  const minInstancesThroughput = perBoxDecode > 0 ? Math.ceil(requiredDecode / perBoxDecode) : 0;
  const minInstancesMemory = crossover.minInstancesToLoad;
  const minInstances = Math.max(minInstancesThroughput, minInstancesMemory, 1);
  const provisioned = crossover.boxes;

  const proxyNote =
    provenance === "proxy"
      ? `Grounded via the GLM-5 benchmark (GLM-5.2 not directly measured; conservative — 5.2 is ≥ as fast).`
      : curve.precisionUsed !== (generation.weightBits <= 4 ? "fp4" : "fp8")
        ? `Nearest available precision (${curve.precisionUsed}) used.`
        : undefined;

  return {
    available: true,
    provenance,
    note: proxyNote,
    interactivityTarget: target,
    achievedInteractivity: op.achievedInteractivity,
    tputPerGpu: op.tputPerGpu,
    ttftAtSla: op.ttft,
    gpusPerBox: perBox,
    requiredDecodeTokPerSec: requiredDecode,
    minInstancesThroughput,
    minInstancesMemory,
    minInstances,
    provisionedInstances: provisioned,
    underProvisioned: provisioned < minInstances,
    slaAchievable: op.slaAchievable,
  };
}
