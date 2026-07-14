// Legacy control/fallback — wraps the FROZEN rc-qa-11 benchmark selection unchanged
// (read-only import). This is the deterministic control the experimental layer is
// compared against, and the default the app keeps shipping while this is experimental.
import type { ControlResult, OperatingPoint } from "./schema";
import { getBenchmarkCurve, operatingPointAt } from "../benchmarks";

/** The rc-qa-11 inputs, expressed explicitly (kept separate from the source-agnostic RequestSpec). */
export interface ControlRequest {
  inferencexKey: string; // e.g. "dsv4"
  instanceType: string; // e.g. "p6-b200.48xlarge"
  weightBits: number; // 4 | 8 | 16
  isl: number;
  osl: number;
  interactivityTarget: number; // tok/s/user
}

export function controlResolve(cr?: ControlRequest): ControlResult {
  if (!cr) return { status: "unbenchmarked" };
  const curve = getBenchmarkCurve(cr.inferencexKey, cr.instanceType, cr.weightBits, cr.isl, cr.osl);
  if (!curve || !curve.points.length) return { status: "unbenchmarked" };
  const op = operatingPointAt(curve.points, cr.interactivityTarget);
  const operatingPoint: OperatingPoint = {
    tputPerGpu: op.tputPerGpu,
    inputTputPerGpu: op.inputTputPerGpu,
    ttftS: op.ttft,
    conc: op.conc,
    intvty: op.achievedInteractivity,
  };
  return { status: "selected", operatingPoint, sourceCommit: curve.provenance?.commit };
}
