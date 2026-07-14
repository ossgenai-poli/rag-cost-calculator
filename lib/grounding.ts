// ============================================================================
// grounding — a DISPLAY view over the authoritative CapacityResult + fleet sizing
// (lib/capacity.ts, lib/crossover.ts). It no longer computes throughput itself:
// every number here is read from the single capacity source (GPU-001), so the
// grounded banner and the capacity/economics can never disagree.
// See research/inference-benchmark-grounding.md.
// ============================================================================

import type { CalcInputs, PriceBook, CrossoverResult, CapacityResult, GroundingResult } from "./types";

/**
 * The authoritative required-instance figure lives on the crossover result
 * (`requiredInstances`, sized from measured capacity + topology + HA). Kept for
 * callers that still combine a grounded figure with a flat one — returns the max.
 */
export function effectiveRequiredInstances(
  grounding: GroundingResult,
  flatThroughputInstances: number
): number {
  const grounded = grounding.available && grounding.minInstances != null ? grounding.minInstances : 0;
  return Math.max(grounded, flatThroughputInstances);
}

export function computeGrounding(
  inputs: CalcInputs,
  priceBook: PriceBook,
  cap: CapacityResult,
  crossover: CrossoverResult
): GroundingResult {
  const { generation } = inputs;
  const model = priceBook.models.find((m) => m.id === generation.llmModelId);
  const provenance = model?.benchmarkProvenance;

  if (!cap.benchmarkAvailable) {
    return { available: false, provenance, note: cap.note };
  }

  const reasonNote =
    cap.extrapolationReasons.length > 0
      ? `Extrapolated: ${cap.extrapolationReasons.join("; ")}.`
      : cap.note;

  return {
    available: true,
    provenance,
    note: reasonNote,
    interactivityTarget: generation.interactivityTarget,
    achievedInteractivity: cap.achievedInteractivity,
    tputPerGpu: cap.perGpuDecodeTokS,
    ttftAtSla: cap.ttftS,
    gpusPerBox: cap.gpusPerBox,
    requiredDecodeTokPerSec: crossover.peakDecodeDemand,
    minInstancesThroughput: crossover.throughputInstances,
    minInstancesMemory: cap.memoryFloorBoxes,
    minInstances: crossover.requiredInstances,
    provisionedInstances: crossover.boxes,
    underProvisioned: crossover.boxes < crossover.requiredInstances,
    slaAchievable: cap.slaAchievable,
  };
}
