// ============================================================================
// benchmark-registry — public API. resolveOperatingPoint() returns the single
// authoritative operating point PLUS full provenance and a comparison against the
// frozen rc-qa-11 control. EXPERIMENTAL; the engine is unchanged. See DESIGN.md.
// ============================================================================
import type { BenchmarkRecord, OperatingPoint, Reason, RequestSpec, SelectionResult } from "./schema";
import type { HostEquivalenceEntry } from "./equivalence";
import { loadCatalog } from "./sources";
import { selectBest } from "./select";
import { requestBoundaryErrors } from "./eligibility";
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
  // NOTE (P1-BENCH-010 / P1/P2-BENCH-009): the PUBLIC resolver exposes NO catalog and NO trust-policy
  // injection. Production ALWAYS consumes the pinned, checksum-verified loadCatalog() and the frozen
  // equivalence policy — an ordinary caller cannot supply arbitrary (unnormalized, unverified) records
  // or an unreviewed equivalence. Synthetic fixtures go through the internal test-only resolver below.
}

/** INTERNAL, TEST-ONLY options — allows a synthetic (already-normalized) catalog and an injected
 *  reviewed host-equivalence for unit fixtures. NOT part of the production API. */
export interface TestResolveOptions extends ResolveOptions {
  /** Synthetic catalog for tests ONLY. Production has no way to reach this path. */
  catalog?: BenchmarkRecord[];
  /** Injected reviewed host-equivalence for tests ONLY. */
  hostAllowlist?: readonly HostEquivalenceEntry[];
}

/** PUBLIC resolver. Always uses the pinned, verified catalog and frozen policy — no caller override. */
export function resolveOperatingPoint(req: RequestSpec, opts: ResolveOptions): SelectionResult {
  return resolveCore(req, { mode: opts.mode, control: opts.control });
}

/** TEST-ONLY resolver. Accepts a synthetic catalog / injected host equivalence. Never call from
 *  production or UI code — it deliberately bypasses the pinned-catalog trust boundary for fixtures. */
export function __resolveOperatingPointForTest(req: RequestSpec, opts: TestResolveOptions): SelectionResult {
  return resolveCore(req, opts);
}

interface CoreResolveOptions {
  mode: "control" | "experimental";
  control?: ControlRequest;
  catalog?: BenchmarkRecord[];
  hostAllowlist?: readonly HostEquivalenceEntry[];
}

function resolveCore(req: RequestSpec, opts: CoreResolveOptions): SelectionResult {
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

  // P1-BENCH-006: validate the request at the PUBLIC boundary, BEFORE catalog selection. A
  // malformed/incomplete request is `invalid-request` (with detailed reasons) — never a coverage
  // gap. This runs independently of the catalog (so it also fires for an empty catalog).
  const problems = requestBoundaryErrors(req);
  if (problems.length) {
    const reasons: Reason[] = problems.map((message) => ({ code: "invalid-request", dimension: "request", message }));
    return {
      status: "invalid-request",
      mode: "experimental",
      confidence: "unbenchmarked",
      reasons,
      control,
      differsFromControl: false,
      differenceCause: "none",
    };
  }

  // Production ALWAYS resolves the pinned, checksum-verified catalog; only the test-only resolver
  // supplies a synthetic catalog / injected equivalence (never reachable from the public API).
  const catalog = opts.catalog ?? loadCatalog();
  const best = selectBest(catalog, req, { hostAllowlist: opts.hostAllowlist });

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
  const provenance = explain(best, {
    differsFromControl: differs,
    differenceCause,
    transformations: best.transformations ?? null,
    control,
  });

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

// P2-1: compare EVERY decision-relevant operating-point field — throughput, TTFT,
// concurrency and interactivity — so a different concurrency/interactivity is never
// reported as "no difference".
function opEqual(a?: OperatingPoint, b?: OperatingPoint): boolean {
  if (!a || !b) return false;
  const eq = (x: number | null, y: number | null) => (x == null && y == null) || (x != null && y != null && Math.abs(x - y) < 1e-9);
  return (
    eq(a.tputPerGpu, b.tputPerGpu) &&
    eq(a.inputTputPerGpu, b.inputTputPerGpu) &&
    eq(a.ttftS, b.ttftS) &&
    eq(a.conc, b.conc) &&
    eq(a.intvty, b.intvty)
  );
}
