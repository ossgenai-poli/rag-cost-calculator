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

const BOUNDS: [number, number] = [0.125, 8];

export interface IslScaleResult {
  operatingPoint: OperatingPoint;
  transformation: Transformation;
}

/** Scale a measured record's input throughput from its bucket ISL to the requested ISL. */
export function islLinearScale(
  recordIsl: number,
  reqIsl: number,
  decodeTputPerGpu: number,
  inputTputPerGpu: number | null,
  intvty: number | null
): IslScaleResult {
  const raw = recordIsl > 0 ? reqIsl / recordIsl : 1;
  const factor = Math.min(BOUNDS[1], Math.max(BOUNDS[0], raw));
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
      bounds: BOUNDS,
      note: `prefill throughput scaled ×${factor.toFixed(2)} from measured ISL ${recordIsl} to ${reqIsl}; decode & TTFT NOT transformed (TTFT invalid at a new ISL).`,
    },
  };
}
