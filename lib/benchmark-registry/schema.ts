// ============================================================================
// benchmark-registry/schema — canonical, source-agnostic benchmark record and
// the selection contract. EXPERIMENTAL (ux/v2-benchmarks). This layer decides
// WHICH qualified operating point is available and how confidently it may be
// used; it never changes the frozen rc-qa-11 economics/capacity math.
// ============================================================================

/** How independent/authoritative the source is (drives precedence). */
export type SourceClass =
  | "independent-reviewed" // MLPerf
  | "open-reproducible" // InferenceX
  | "vendor-measured" // NVIDIA TensorRT-LLM
  | "research-measured"; // e.g. Argonne (future)

/** How the record relates to the requested config. */
export type EvidenceStatus =
  | "measured-exact"
  | "measured-scaled"
  | "extrapolated"
  | "proxy"
  | "heuristic";

/** Small, explicit confidence taxonomy (category + reasons, NOT one opaque score). */
export type ConfidenceCategory =
  | "independent-reviewed"
  | "open-reproducible"
  | "vendor-measured"
  | "research-measured"
  | "proxy"
  | "extrapolated"
  | "heuristic"
  | "unbenchmarked";

export type Serving = "aggregated" | "disaggregated";
export type SnapshotKind = "verified" | "illustrative-pending-ingestion";
export type Percentile = "p50" | "p90" | "p95" | "p99" | "mean" | "unknown";

export interface Provenance {
  sourceName: string;
  sourceClass: SourceClass;
  sourceUrl: string;
  runId?: string;
  sourceCommit?: string;
  retrievedAt: string; // ISO date the snapshot was pinned
  rawChecksum: string; // sha256 of the immutable raw snapshot
  license: string;
  attribution: string;
  snapshotKind: SnapshotKind;
}

/** Every mismatch/qualification is explicit — never silent. */
export interface Reason {
  code: string;
  message: string;
  dimension: string;
}

export interface Ttft {
  value: number; // seconds
  percentile: Percentile;
}

export interface BenchmarkRecord {
  id: string;
  provenance: Provenance;
  // model
  modelId: string;
  checkpoint: string;
  // precision (weight independent of KV)
  weightPrecision: string;
  kvPrecision: string | null;
  // software
  framework: string;
  frameworkVersion?: string;
  image?: string;
  frameworkCommit?: string;
  // hardware / topology
  gpuSku: string;
  formFactor: string; // "SXM" | "UltraServer/NVL72" | ...
  gpuMemGB: number;
  gpuCount: number;
  nodeCount: number;
  topology: string;
  interconnect: string;
  parallelism: { tp: number; pp: number; ep: number; dp: number };
  serving: Serving;
  // workload
  isl: number;
  osl: number;
  concurrency: number | null;
  requestRate: number | null;
  prefixCache: boolean | null;
  specDecode: string | null;
  // metrics (per-GPU only when the source explicitly reports it)
  outputTputPerGpu: number | null;
  inputTputPerGpu: number | null;
  ttft: Ttft | null;
  tpot: number | null;
  itl: number | null;
  throughputTotal: number | null; // total tok/s across all GPUs (used only when per-GPU is absent)
  perGpuReported: boolean; // did the source explicitly report a valid per-GPU metric?
  latencyQualified: boolean; // is this a latency-qualified point (real TTFT under a defined load)?
  measuredDate: string;
  /** Intrinsic caveats the source itself carries (e.g. "max-load only"). Request-relative
   *  mismatches are computed by eligibility(), not stored here. */
  intrinsicQualifications: Reason[];
  unknownFields: Record<string, unknown>; // retained, never dropped
}

/** The request-relative evaluation of one record. evidenceStatus is relative to the
 *  request (a record is measured-exact for one request, extrapolated for another). */
export interface EvidenceMatch {
  record: BenchmarkRecord;
  eligible: boolean;
  evidenceStatus: EvidenceStatus;
  confidence: ConfidenceCategory;
  reasons: Reason[]; // every mismatch/qualification, explicit
  operatingPoint?: OperatingPoint; // only when a valid per-GPU point exists
}

/** The requested configuration to resolve an operating point for. */
export interface RequestSpec {
  modelId: string;
  checkpoint?: string;
  weightPrecision: string;
  kvPrecision?: string;
  framework?: string;
  gpuSku: string;
  gpuCount?: number;
  nodeCount?: number;
  serving?: Serving;
  isl: number;
  osl: number;
  concurrency?: number;
  /** An interactive TTFT SLA triggers the latency gate (max-load results can't satisfy it). */
  interactivity?: { ttftSlaMs: number };
  /** ISL/OSL tolerance for an "exact" bucket match (default 1.5×, matching rc-qa-11). */
  seqTolerance?: number;
  /** Require a valid per-GPU metric (fleet sizing needs it). Default true. */
  requirePerGpu?: boolean;
}

/** The single authoritative operating point the engine consumes (rc-qa-11 shape). */
export interface OperatingPoint {
  tputPerGpu: number; // decode/output tok/s per GPU
  inputTputPerGpu: number | null; // prefill/input tok/s per GPU
  ttftS: number | null;
  conc: number | null;
  intvty: number | null;
}

export interface ControlResult {
  status: "selected" | "unbenchmarked";
  operatingPoint?: OperatingPoint;
  sourceCommit?: string; // the pinned catalog the control ran against
}

export interface ProvenanceView {
  /** Concise, correctly-qualified — never calls a proxy/extrapolation "measured". */
  headline: string;
  /** Complete provenance for the export/trust panel. */
  full: Record<string, unknown>;
}

export interface SelectionResult {
  status: "selected" | "unbenchmarked";
  mode: "control" | "experimental";
  operatingPoint?: OperatingPoint;
  record?: BenchmarkRecord;
  confidence: ConfidenceCategory;
  reasons: Reason[];
  control: ControlResult;
  differsFromControl: boolean;
  differenceCause: "new-data" | "selection-rule" | "none";
  provenance?: ProvenanceView;
}

/** A source adapter: pure function from an immutable raw snapshot → normalized records. */
export interface SourceAdapter {
  sourceName: string;
  sourceClass: SourceClass;
  /** Parse a pinned raw snapshot into 0+ normalized records. Deterministic; no I/O. */
  normalize(raw: unknown): BenchmarkRecord[];
}
