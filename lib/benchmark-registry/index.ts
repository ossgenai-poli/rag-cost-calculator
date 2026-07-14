// ============================================================================
// benchmark-registry — public API. resolveOperatingPoint() returns the single
// authoritative operating point PLUS full provenance and a comparison against the
// frozen rc-qa-11 control. EXPERIMENTAL; the engine is unchanged. See DESIGN.md.
// ============================================================================
import type { BenchmarkRecord, OperatingPoint, RequestSpec, SelectionResult } from "./schema";
import { loadCatalog } from "./sources";
import { selectBest } from "./select";
import { controlResolve, type ControlRequest } from "./legacy-control";
import { explain } from "./explain";

export * from "./schema";
export { loadCatalog } from "./sources";
export type { ControlRequest } from "./legacy-control";

export interface ResolveOptions {
  /** 'control' = the frozen rc-qa-11 selection (default shipping). 'experimental' = the new layer. */
  mode: "control" | "experimental";
  /** Explicit rc-qa-11 inputs so the control can be computed for comparison. */
  control?: ControlRequest;
  /** Override the pinned catalog (tests). Defaults to loadCatalog(). */
  catalog?: BenchmarkRecord[];
}

export function resolveOperatingPoint(req: RequestSpec, opts: ResolveOptions): SelectionResult {
  const control = controlResolve(opts.control);

  // Control mode returns EXACTLY the frozen selection — proves no regression when experimental is off.
  if (opts.mode === "control") {
    return {
      status: control.status,
      mode: "control",
      operatingPoint: control.operatingPoint,
      confidence: control.status === "selected" ? "open-reproducible" : "unbenchmarked",
      reasons: [],
      control,
      differsFromControl: false,
      differenceCause: "none",
    };
  }

  const catalog = opts.catalog ?? loadCatalog();
  const best = selectBest(catalog, req);

  if (!best) {
    // No qualified measurement → unbenchmarked. NEVER fabricate from FLOPS/bandwidth.
    const differs = control.status === "selected";
    return {
      status: "unbenchmarked",
      mode: "experimental",
      confidence: "unbenchmarked",
      reasons: [{ code: "unbenchmarked", dimension: "evidence", message: "no eligible measured performance for this configuration" }],
      control,
      differsFromControl: differs,
      differenceCause: differs ? "new-data" : "none",
    };
  }

  const differs = !opEqual(best.operatingPoint, control.operatingPoint);
  const differenceCause: SelectionResult["differenceCause"] = !differs
    ? "none"
    : control.status !== "selected" || best.record.provenance.sourceName !== "InferenceX"
      ? "new-data" // the experimental pick uses a source/record the control doesn't have
      : "selection-rule"; // same underlying source data, a different selection
  const provenance = explain(best, { differsFromControl: differs, differenceCause, control });

  return {
    status: "selected",
    mode: "experimental",
    operatingPoint: best.operatingPoint,
    record: best.record,
    confidence: best.confidence,
    reasons: best.reasons,
    control,
    differsFromControl: differs,
    differenceCause,
    provenance,
  };
}

function opEqual(a?: OperatingPoint, b?: OperatingPoint): boolean {
  if (!a || !b) return false;
  const eq = (x: number | null, y: number | null) => (x == null && y == null) || (x != null && y != null && Math.abs(x - y) < 1e-9);
  return eq(a.tputPerGpu, b.tputPerGpu) && eq(a.inputTputPerGpu, b.inputTputPerGpu) && eq(a.ttftS, b.ttftS);
}
