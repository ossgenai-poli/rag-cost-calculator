// Deterministic, disclosed transformations (P1-6). A mismatch reason is NOT a
// transformation — an "extrapolated" result must either carry a real transform
// (formula, inputs, bounds, provenance) or be returned as `unbenchmarked`.
//
// The ONLY transform implemented for the slice is ISL-linear-scaling of PREFILL
// (input) throughput, mirroring the frozen rc-qa-11 `prefillIslScale` (prefill work
// ∝ input tokens; the data shows input tok/s ~linear in ISL). Decode throughput and
// TTFT are NOT transformed across ISL, so an ISL-scaled record cannot satisfy an
// interactive TTFT SLA. Every other substitution (OSL, precision, model, engine,
// serving, topology) has NO transform → the caller returns `unbenchmarked`.
import type { OperatingPoint, Transformation } from "./schema";

export const ISL_SCALE_BOUNDS: [number, number] = [0.125, 8];

/** A ratio outside the bounds is NOT clamped — the caller must return `unbenchmarked`. */
export function islScaleInBounds(recordIsl: number, reqIsl: number): boolean {
  if (recordIsl <= 0 || reqIsl <= 0) return false;
  const r = reqIsl / recordIsl;
  return r >= ISL_SCALE_BOUNDS[0] && r <= ISL_SCALE_BOUNDS[1];
}

export interface IslScaleResult {
  operatingPoint: OperatingPoint;
  transformation: Transformation;
}

/** Scale a measured record's input throughput from its bucket ISL to the requested ISL.
 *  Precondition: islScaleInBounds() — the factor is NEVER clamped here. */
export function islLinearScale(
  recordIsl: number,
  reqIsl: number,
  decodeTputPerGpu: number,
  inputTputPerGpu: number | null,
  intvty: number | null
): IslScaleResult {
  const factor = recordIsl > 0 ? reqIsl / recordIsl : 1;
  const scaledInput = inputTputPerGpu == null ? null : inputTputPerGpu * factor;
  return {
    // decode + intvty unchanged; input scaled; ttft intentionally dropped (not valid at a new ISL).
    operatingPoint: { tputPerGpu: decodeTputPerGpu, inputTputPerGpu: scaledInput, ttftS: null, conc: null, intvty },
    transformation: {
      method: "isl-linear-scale",
      dimension: "sequence",
      appliedTo: "inputTputPerGpu",
      from: recordIsl,
      to: reqIsl,
      factor,
      bounds: ISL_SCALE_BOUNDS,
      note: `prefill throughput scaled ×${factor.toFixed(2)} from measured ISL ${recordIsl} to ${reqIsl}; decode & TTFT NOT transformed (TTFT invalid at a new ISL).`,
    },
  };
}
