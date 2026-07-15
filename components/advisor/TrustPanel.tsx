"use client";

// "Where did this come from?" (docs/ux-v2/09-trust-provenance.md) — read-only, structured,
// deterministic: serializes structured fields verbatim (pricing provenance, per-candidate serving
// facts + evidence states, experimental registry status). It never authors claims about the data.
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import { ConfidenceChip } from "./ConfidenceChip";

export function TrustPanel({ result }: { result: NarratedRecommendationResult }) {
  const p = result.pricing;
  return (
    <section aria-labelledby="trust-heading" data-testid="trust-panel" className="rounded-lg border border-slate-200 bg-white p-4">
      <details>
        <summary id="trust-heading" className="cursor-pointer text-base font-semibold text-slate-700">
          Where did this come from?
        </summary>

        {/* Pricing provenance — pricing.{source,asOf,region,gpuPriceSource}. Never says "live" on fallback. */}
        <dl className="mt-3 grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-2" data-testid="pricing-provenance">
          <div><dt className="inline text-slate-500">Price book: </dt><dd className="inline" data-testid="pricing-source">{p.source === "live" ? "live" : "committed reference (fallback)"}</dd></div>
          <div><dt className="inline text-slate-500">As of: </dt><dd className="inline">{p.asOf}</dd></div>
          <div><dt className="inline text-slate-500">Region: </dt><dd className="inline">{p.region}</dd></div>
          <div><dt className="inline text-slate-500">GPU price source: </dt><dd className="inline">{p.gpuPriceSource}</dd></div>
        </dl>

        {/* Per-candidate evidence — evaluations[].{engineConfidence, effectiveConfidence, registry} */}
        <h3 className="mt-4 text-sm font-semibold text-slate-700">Evidence by configuration</h3>
        <ul className="mt-1 space-y-2" data-testid="evidence-list">
          {result.evaluations.map((e) => (
            <li key={e.config.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-800">{e.config.label}</span>
                <ConfidenceChip confidence={e.effectiveConfidence} />
                {e.registry && e.effectiveConfidence !== e.engineConfidence && (
                  <span className="text-xs text-slate-500" data-testid="demotion-note">
                    engine: {e.engineConfidence} → held at {e.effectiveConfidence} by the cross-source registry
                  </span>
                )}
              </div>
              {e.ttftS != null && e.ttftPercentile && (
                <p className="mt-1 text-xs text-slate-600" data-testid="ttft-line">
                  TTFT ({e.ttftPercentile.toUpperCase()}): {e.ttftS.toFixed(2)}s — a tail statistic under benchmark conditions, not the average.
                </p>
              )}
              {e.registry && (
                <p className="mt-1 text-xs text-slate-500" data-testid="registry-note">
                  Cross-source registry: {e.registry.status}
                  {e.registry.status !== "selected" &&
                    " — an internal evidence-metadata limitation (e.g. no reviewed AWS-host or prefix-cache facts), not a problem with your inputs."}
                </p>
              )}
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs text-slate-500">
          Planning capacity, not an availability or tail-latency guarantee. Validate with your intended
          serving stack and a production-shaped load test before committing.
        </p>
      </details>
    </section>
  );
}
