// Demote-only evidence reconciliation (DESIGN §3.1). The experimental registry can only LOWER the
// effective confidence below the frozen engine's, never raise it. Control mode returns the engine value
// unchanged. Deterministic; pure.
import type { EffectiveConfidence, EngineConfidence, RegistryEvidence } from "./schema";
import { CONFIDENCE_RANK } from "./schema";

const RANK_TO_CONFIDENCE: Record<number, EffectiveConfidence> = Object.fromEntries(
  (Object.entries(CONFIDENCE_RANK) as Array<[EffectiveConfidence, number]>).map(([k, v]) => [v, k])
) as Record<number, EffectiveConfidence>;

/** The effective-confidence CEILING (rank) the registry evidence imposes. A `selected` result maps by its
 *  ConfidenceCategory; anything else (unbenchmarked / invalid-request) fails closed to 0. */
export function registryCeilingRank(reg: RegistryEvidence): number {
  if (reg.status !== "selected") return 0; // unbenchmarked | invalid-request → floor
  switch (reg.confidence) {
    case "independent-reviewed":
    case "open-reproducible":
    case "vendor-measured":
    case "research-measured":
      return CONFIDENCE_RANK.measured; // a real measured selection — does not demote a measured/scaled engine result
    case "extrapolated":
      return CONFIDENCE_RANK.extrapolated;
    case "proxy":
      return CONFIDENCE_RANK.proxy;
    case "heuristic":
      return CONFIDENCE_RANK.heuristic;
    default:
      return 0; // "unbenchmarked" or any unexpected value → floor (fail closed)
  }
}

/** effectiveConfidence = engine (control) OR min(engine, registryCeiling) (experimental, demote-only). */
export function reconcileConfidence(
  engine: EngineConfidence,
  registry: RegistryEvidence | undefined,
  mode: "control" | "experimental"
): EffectiveConfidence {
  if (mode === "control" || !registry) return engine;
  const rank = Math.min(CONFIDENCE_RANK[engine], registryCeilingRank(registry));
  return RANK_TO_CONFIDENCE[rank];
}
