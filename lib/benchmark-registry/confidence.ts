// Confidence category — the small explicit taxonomy. Category + reasons matter,
// NOT one opaque numeric score.
import type { ConfidenceCategory, EvidenceStatus, SourceClass } from "./schema";

export function confidenceFor(sourceClass: SourceClass, status: EvidenceStatus): ConfidenceCategory {
  if (status === "extrapolated") return "extrapolated";
  if (status === "proxy") return "proxy";
  if (status === "heuristic") return "heuristic";
  // measured-exact / measured-scaled → carry the source class through.
  switch (sourceClass) {
    case "independent-reviewed":
      return "independent-reviewed";
    case "open-reproducible":
      return "open-reproducible";
    case "vendor-measured":
      return "vendor-measured";
    case "research-measured":
      return "research-measured";
  }
}

/** Deterministic precedence rank (lower = preferred). */
export function statusRank(status: EvidenceStatus): number {
  return { "measured-exact": 0, "measured-scaled": 1, proxy: 2, extrapolated: 3, heuristic: 9 }[status];
}
export function sourceRank(sourceClass: SourceClass): number {
  return { "independent-reviewed": 0, "open-reproducible": 1, "vendor-measured": 2, "research-measured": 3 }[sourceClass];
}
