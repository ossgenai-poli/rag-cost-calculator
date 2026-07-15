"use client";

// Range view (doc 08) — base + band with the TWO SEPARATE confidence channels: evidence confidence
// (the benchmark ladder, untouched by input uncertainty) and input confidence (how many range-capable
// inputs are ranges). Every band value is a REAL engine recompute at the bounds (ranges.ts); a metric
// that cannot be derived at a bound fails closed to an explicit unavailable line, never a guess.
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import { decisionScenarioSentence, rangeDisclosures, RANGE_FIELD_LABELS, RANGE_FIELDS, type RangeComputation } from "./ranges";

const usd = (v: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
const num = (v: number): string => new Intl.NumberFormat("en-US").format(v);

export function RangeBandPanel({ result, computation }: { result: NarratedRecommendationResult; computation: RangeComputation | null }) {
  if (!computation) return null;
  const { band, fields, largestEffect } = computation;
  const evidence = result.bestSelfHost ? result.bestSelfHost.confidence : "none qualified";
  return (
    <section aria-labelledby="range-heading" data-testid="range-band-panel" className="rounded-lg border border-sky-300 bg-sky-50 p-4">
      <h2 id="range-heading" className="text-sm font-semibold text-slate-900">Range view — about, not exact</h2>
      <p className="mt-1 text-xs text-slate-600" data-testid="range-about">
        Inputs include customer ranges; the headline shows the base case. Bands come from re-running the engine at the bounds (every range input at its low / at its high) — real recomputes, never percentage estimates.
      </p>
      {/* Two INDEPENDENT channels (doc 08 / UI5-D3): evidence confidence (the benchmark ladder) and
          RANGE COVERAGE — the count of range inputs is coverage, never a trust measure. */}
      <p className="mt-2 text-xs text-slate-700" data-testid="range-confidence-channels">
        <span className="font-medium">Evidence confidence:</span> {evidence} · <span className="font-medium">Range coverage:</span> {fields.length} of {RANGE_FIELDS.length} supported uncertainty inputs {fields.length === 1 ? "uses" : "use"} a range ({fields.map((f) => RANGE_FIELD_LABELS[f]).join(", ")})
      </p>
      <ul className="mt-2 space-y-1 text-sm text-slate-800">
        <li data-testid="range-fleet">
          {band.fleet
            ? <>Fleet: {num(band.fleet.low)}–{num(band.fleet.high)} boxes (base {num(band.fleet.base)})</>
            : "Fleet band unavailable — the base configuration is not modeled at the range bounds."}
        </li>
        <li data-testid="range-selfhost">
          {band.selfHost
            ? <>Self-host: {usd(band.selfHost.low)}–{usd(band.selfHost.high)}/mo (base {usd(band.selfHost.base)})</>
            : "Self-host cost band unavailable at the range bounds."}
        </li>
        <li data-testid="range-api">
          {band.api
            ? <>API: {usd(band.api.low)}–{usd(band.api.high)}/mo (base {usd(band.api.base)})</>
            : "API cost band unavailable at the range bounds."}
        </li>
        {/* P1-UI5-2: exactly what was evaluated — three scenarios — never a range-stability claim. */}
        <li data-testid="range-decision" className={band.sampledPointsAgree ? "" : "font-medium text-amber-900"}>
          {decisionScenarioSentence(band)}
        </li>
        {largestEffect && (
          <li data-testid="range-largest-effect">
            Largest modeled range effect: {RANGE_FIELD_LABELS[largestEffect.field]} ({num(largestEffect.bounds.low)}–{num(largestEffect.bounds.high)}) → fleet {num(largestEffect.fleetLow)}–{num(largestEffect.fleetHigh)} boxes.
          </li>
        )}
        {/* P1-UI5-3: bound-scenario disclosures — engine reconciliations + tracked eligibility. */}
        {rangeDisclosures(computation).map((note, i) => (
          <li key={i} data-testid={`range-note-${i}`} className="text-xs text-amber-900">{note}</li>
        ))}
      </ul>
    </section>
  );
}
