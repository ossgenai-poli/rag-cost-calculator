// Alternative selection (docs/ux-v2/06-recommendation-presentation.md card action "Use this") — the
// pure focus-resolution contract. Selection is a PRESENTATION FOCUS over the ONE structured sweep
// result (all candidates were already evaluated by the same engine in the same run — the single
// source of truth doc 06 requires): it re-anchors which EVIDENCE-QUALIFIED configuration the
// self-host card, quota risk, range tracking and export architecture describe. It NEVER changes the
// API-vs-self-host decision, the persisted cost comparator, the narrative, or any engine number —
// invariants the tests assert.
//
// Fail-closed rules:
//  - Only the card set is selectable: the optimization-ranked best + the distinct alternatives
//    (all recommendation-eligible by construction). Rejected/ineligible candidates are NEVER
//    selectable, and a selection id that stops being eligible after an input change is SUSPENDED —
//    preserved in state, visibly flagged, and the focus falls back to the engine's ranked best.
import type { CandidateEvaluation, NarratedRecommendationResult, StructuredRecommendationResult } from "@/lib/recommendation";

type AnyResult = StructuredRecommendationResult | NarratedRecommendationResult;

export interface FocusResolution {
  /** The evaluation the self-host surfaces describe (the ranked best when no valid selection). */
  evaluation: CandidateEvaluation | null;
  /** The state's selection id, preserved verbatim (null = follow the engine's ranked best). */
  selectedId: string | null;
  /** A valid selection is ACTIVE; a selection that is not currently selectable is SUSPENDED. */
  active: boolean;
  suspended: boolean;
  /** Whether the focused evaluation IS the optimization-ranked best (selection of the best is active
   *  but needs no divergence disclosure). */
  isEngineBest: boolean;
}

/** The ids a customer may select: the ranked best + the distinct alternative cards — exactly the
 *  card set doc 06 exposes "Use this" on. Every member is recommendation-eligible by construction. */
export function selectableIds(r: AnyResult): string[] {
  const ids: string[] = [];
  if (r.bestSelfHost) ids.push(r.bestSelfHost.config.id);
  for (const c of r.alternatives) if (!ids.includes(c.config.id)) ids.push(c.config.id);
  return ids;
}

/** Resolve the current focus. Pure and fail-closed: an unknown, rejected or no-longer-eligible
 *  selection suspends (falls back to the ranked best with an explicit notice), never silently sticks. */
export function resolveFocus(r: AnyResult, selectedId: string | null): FocusResolution {
  const bestId = r.bestSelfHost?.config.id ?? null;
  const fallback = bestId ? (r.evaluations.find((e) => e.config.id === bestId) ?? null) : null;
  if (!selectedId) {
    return { evaluation: fallback, selectedId: null, active: false, suspended: false, isEngineBest: true };
  }
  const evaluation = r.evaluations.find((e) => e.config.id === selectedId) ?? null;
  const selectable = selectableIds(r).includes(selectedId) && evaluation?.recommendationEligible === true;
  if (!selectable) {
    return { evaluation: fallback, selectedId, active: false, suspended: true, isEngineBest: true };
  }
  return { evaluation, selectedId, active: true, suspended: false, isEngineBest: selectedId === bestId };
}
