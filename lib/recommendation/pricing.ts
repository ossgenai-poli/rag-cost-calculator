// ============================================================================
// pricing — the SINGLE canonical derivation of a candidate's PricingAssumption
// from engine facts, plus the shared integrity validator (P1-PRICE-INT-1).
// recommend() BUILDS the assumption through expectedPricingAssumption(); the
// comparator integrity check VALIDATES a presented assumption against the same
// derivation — build and check share one code path, so they cannot drift. All
// planning factors come from the frozen engine (lib/self-host.ts), never
// duplicated here.
// ============================================================================
import { GPU_COMMITMENT_DISCOUNT, effectiveGpuHourly } from "../self-host";
import type { GpuPricingModel } from "../types";
import type { CandidateEvaluation, PricingAssumption, PricingQualification, ServingFacts } from "./schema";

/** The canonical PricingAssumption implied by a candidate's engine-reconciled serving facts
 *  (base $/hr, purchasing model, price provenance). This IS the definition — recommend() builds from
 *  it and pricingAssumptionValid() checks against it. */
export function expectedPricingAssumption(
  sf: Pick<ServingFacts, "gpuPricePerHr" | "gpuPricingModel" | "gpuPriceSource">
): PricingAssumption {
  const purchasing = sf.gpuPricingModel as GpuPricingModel;
  const qualification: PricingQualification =
    sf.gpuPriceSource === "override"
      ? "override"
      : purchasing === "spot"
        ? "indicative-spot"
        : purchasing !== "on-demand"
          ? "indicative-commitment"
          : "reference";
  return {
    qualification,
    purchasingModel: purchasing,
    onDemandBaseHourly: sf.gpuPricePerHr,
    assumedDiscountPct: Math.round((GPU_COMMITMENT_DISCOUNT[purchasing] ?? 0) * 100),
    modeledEffectiveHourly: effectiveGpuHourly(sf.gpuPricePerHr, purchasing),
    // The engine's PRICING-018 estimated state: non-live book price OR non-on-demand purchasing.
    pricingEstimated: sf.gpuPriceSource !== "live" || purchasing !== "on-demand",
    assumptionSource:
      qualification === "override"
        ? "user-override"
        : purchasing === "on-demand"
          ? "price-book:on-demand"
          : `gpu-commitment-discount:${purchasing}`,
  };
}

/**
 * P1-PRICE-INT-1 — complete pricing-assumption integrity. A candidate's PricingAssumption may only be
 * presented as customer-facing fact when EVERY field reconciles with the engine-derived expectation
 * from its own servingFacts:
 *  - all numeric fields finite and nonnegative;
 *  - purchasingModel === servingFacts.gpuPricingModel;
 *  - onDemandBaseHourly === servingFacts.gpuPricePerHr;
 *  - assumedDiscountPct === the shared engine GPU_COMMITMENT_DISCOUNT (×100);
 *  - modeledEffectiveHourly === the shared engine effectiveGpuHourly(base, purchasingModel);
 *  - qualification matches the purchasing model + gpuPriceSource derivation;
 *  - pricingEstimated matches the engine composition;
 *  - assumptionSource matches the derived qualification/source.
 * Any failed invariant → the caller must fail closed (neutral wording; no dollar winner, no
 * discount/rate claims) — never repair or substitute.
 */
export function pricingAssumptionValid(e: CandidateEvaluation): boolean {
  const pa = e.pricingAssumption;
  if (!pa || !e.servingFacts) return false;
  if (!Number.isFinite(pa.onDemandBaseHourly) || pa.onDemandBaseHourly < 0) return false;
  if (!Number.isFinite(pa.assumedDiscountPct) || pa.assumedDiscountPct < 0) return false;
  if (!Number.isFinite(pa.modeledEffectiveHourly) || pa.modeledEffectiveHourly < 0) return false;
  const exp = expectedPricingAssumption(e.servingFacts);
  return (
    pa.qualification === exp.qualification &&
    pa.purchasingModel === exp.purchasingModel &&
    pa.onDemandBaseHourly === exp.onDemandBaseHourly &&
    pa.assumedDiscountPct === exp.assumedDiscountPct &&
    pa.modeledEffectiveHourly === exp.modeledEffectiveHourly &&
    pa.pricingEstimated === exp.pricingEstimated &&
    pa.assumptionSource === exp.assumptionSource
  );
}
