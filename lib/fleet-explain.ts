// ============================================================================
// fleet-explain — the SINGLE source of the human-readable fleet-sizing equation
// (INF-005/006/007). The UI renders exactly what this returns, and regression
// tests assert it reconciles with the authoritative CrossoverResult, so the
// displayed arithmetic can never contradict the engine again.
//
// rc-qa-9 defect this fixes: the card always displayed the DECODE equation
// (peak output tok/s ÷ decode tok/s/replica) but appended the COMBINED fleet
// count max(prefill, decode) sized at the utilization target — "38,052 ÷ 1,311
// → 86" is false arithmetic. The equation must show the BINDING dimension's
// demand and the target-utilization-adjusted capacity.
// ============================================================================

import type { CrossoverResult } from "./types";

export interface FleetEquation {
  /** Which dimension actually set the fleet size. */
  dimension: "prefill" | "decode";
  /** Peak demand of the BINDING dimension (input tok/s if prefill, output tok/s if decode). */
  peakDemandTokS: number;
  /** Per-replica capacity of the binding dimension at 100% utilization. */
  perReplicaTokS: number;
  /** Utilization target the fleet was sized against (0–1]. */
  utilTarget: number;
  /** perReplicaTokS × utilTarget — the effective serving capacity used in the division. */
  effPerReplicaTokS: number;
  /** ceil(peakDemandTokS / effPerReplicaTokS) — replicas needed for throughput. */
  throughputReplicas: number;
  /** Extra complete replicas added for N+1 (0 when HA off). */
  haReplicas: number;
  /** 8-GPU boxes per serving replica. */
  instancesPerReplica: number;
  /** Boxes needed for throughput alone (throughputReplicas × instancesPerReplica). */
  throughputBoxes: number;
  /** (throughputReplicas + haReplicas) × instancesPerReplica — the required fleet. */
  requiredBoxes: number;
  /** Boxes actually billed (≥ requiredBoxes when the user over-provisions). */
  billedBoxes: number;
  /** True when the recomputed equation matches the engine's figures exactly. */
  reconciles: boolean;
}

/**
 * Recompute the fleet-sizing equation from the authoritative result, using the
 * SAME formula as sizeFleet (ceil of demand over target-adjusted capacity for
 * the binding dimension). Returns every term the UI needs to display it.
 */
export function explainFleetSizing(cx: CrossoverResult): FleetEquation {
  const cap = cx.capacity;
  const dimension: "prefill" | "decode" = cx.prefillBinds ? "prefill" : "decode";
  const peakDemandTokS = dimension === "prefill" ? cx.peakPrefillDemand : cx.peakDecodeDemand;
  const perReplicaTokS =
    dimension === "prefill" ? cap.perReplicaPrefillTokS : cap.perReplicaDecodeTokS;
  const utilTarget = cx.utilTargetUsed > 0 && cx.utilTargetUsed <= 1 ? cx.utilTargetUsed : 1;
  const effPerReplicaTokS = perReplicaTokS * utilTarget;
  // Same rounding as sizeFleet: ceil per dimension, floor of 1 replica overall.
  const throughputReplicas = Math.max(
    1,
    effPerReplicaTokS > 0 ? Math.ceil(peakDemandTokS / effPerReplicaTokS) || 0 : 0
  );
  const instancesPerReplica = cx.instancesPerReplica;
  const throughputBoxes = throughputReplicas * instancesPerReplica;
  const requiredBoxes = (throughputReplicas + cx.haReplicasAdded) * instancesPerReplica;
  return {
    dimension,
    peakDemandTokS,
    perReplicaTokS,
    utilTarget,
    effPerReplicaTokS,
    throughputReplicas,
    haReplicas: cx.haReplicasAdded,
    instancesPerReplica,
    throughputBoxes,
    requiredBoxes,
    billedBoxes: cx.boxes,
    reconciles:
      throughputBoxes === cx.throughputInstances && requiredBoxes === cx.requiredInstances,
  };
}

/** INF-006: which prefill-provenance wording the UI must use when prefill binds. */
export type PrefillWording = "measured" | "measured-scaled" | "estimated";

export function prefillWording(cx: CrossoverResult): PrefillWording {
  const cap = cx.capacity;
  if (cap.prefillEstimated) return "estimated";
  const scale = cap.prefillIslScale ?? 1;
  // Treat anything beyond ±2% as a real scaling step worth disclosing.
  return Math.abs(scale - 1) > 0.02 ? "measured-scaled" : "measured";
}

/** INF-007: the heuristic prefill uncertainty range, resolved to fleet bounds. */
export interface HeuristicRange {
  ratioUsed: number;              // input/decode throughput ratio applied (ISL/OSL based)
  perReplicaLowTokS: number;      // conservative prefill capacity bound
  perReplicaBaseTokS: number;     // the value the headline fleet uses
  perReplicaHighTokS: number;     // optimistic bound
  /** Throughput replicas at each capacity bound (fleet = max(prefill, decode) at the util target).
   * Low capacity ⇒ MORE replicas, so fleetMaxReplicas corresponds to perReplicaLowTokS. */
  fleetMinReplicas: number;       // at the HIGH capacity bound
  fleetBaseReplicas: number;      // what the headline uses
  fleetMaxReplicas: number;       // at the LOW capacity bound
}

export function heuristicPrefillRange(cx: CrossoverResult): HeuristicRange | null {
  const cap = cx.capacity;
  if (
    !cap.prefillEstimated ||
    cap.prefillRatioUsed == null ||
    cap.perReplicaPrefillTokSLow == null ||
    cap.perReplicaPrefillTokSHigh == null
  )
    return null;
  const utilTarget = cx.utilTargetUsed > 0 && cx.utilTargetUsed <= 1 ? cx.utilTargetUsed : 1;
  const decodeReplicas =
    cap.perReplicaDecodeTokS > 0
      ? Math.ceil(cx.peakDecodeDemand / (cap.perReplicaDecodeTokS * utilTarget)) || 0
      : 0;
  const replicasAt = (prefillCap: number) =>
    Math.max(
      1,
      decodeReplicas,
      prefillCap > 0 ? Math.ceil(cx.peakPrefillDemand / (prefillCap * utilTarget)) || 0 : 0
    );
  return {
    ratioUsed: cap.prefillRatioUsed,
    perReplicaLowTokS: cap.perReplicaPrefillTokSLow,
    perReplicaBaseTokS: cap.perReplicaPrefillTokS,
    perReplicaHighTokS: cap.perReplicaPrefillTokSHigh,
    fleetMinReplicas: replicasAt(cap.perReplicaPrefillTokSHigh),
    fleetBaseReplicas: replicasAt(cap.perReplicaPrefillTokS),
    fleetMaxReplicas: replicasAt(cap.perReplicaPrefillTokSLow),
  };
}
