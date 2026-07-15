// ============================================================================
// validate — ONE authoritative runtime validation of the complete public
// RecommendationRequest / CalcInputs boundary (HOLD-3 P1-2). Runs BEFORE any
// candidate is loaded or calculate() is called. Validates every decision-relevant
// enum, required nested object, finite number and domain constraint, following the
// frozen calculator's own domain rules. Fails closed (throws) on anything malformed.
// ============================================================================
import type { CalcInputs, PriceBook } from "../types";
import type { RecommendationRequest } from "./schema";

const OPTIMIZE_FOR = new Set(["cost", "latency", "confidence", "predictability"]);
const REFRESH_CADENCES = new Set(["one-time", "weekly", "monthly"]);
const INDEXING_ALGOS = new Set(["hnsw", "ivf_pq", "ivf_fp16"]);
const GEN_MODES = new Set(["api", "self-hosted"]);
const GPU_PRICING_MODELS = new Set(["on-demand", "reserved-1yr", "reserved-3yr", "savings-1yr", "spot"]);
const TRAFFIC_METHODS = new Set(["monthly", "qps"]);
const MANAGED_KB_MODES = new Set(["standard", "agentic"]);
const WEIGHT_BITS = new Set([4, 8, 16]);
const KV_BITS = new Set([8, 16]);

const fail = (m: string): never => {
  throw new Error(`recommend: ${m}`);
};
const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown, field: string): number => (isFiniteNum(v) ? v : (fail(`${field} must be a finite number`) as never));
const nonNeg = (v: unknown, field: string): number => (isFiniteNum(v) && v >= 0 ? v : (fail(`${field} must be a finite number ≥ 0`) as never));
const pos = (v: unknown, field: string): number => (isFiniteNum(v) && v > 0 ? v : (fail(`${field} must be a finite number > 0`) as never));
const posInt = (v: unknown, field: string): number => (Number.isInteger(v) && (v as number) >= 1 ? (v as number) : (fail(`${field} must be an integer ≥ 1`) as never));
const nonNegInt = (v: unknown, field: string): number => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : (fail(`${field} must be an integer ≥ 0`) as never));
const enumOf = (v: unknown, set: Set<string>, field: string): string => (typeof v === "string" && set.has(v) ? v : (fail(`invalid ${field} "${String(v)}"`) as never));
const bool = (v: unknown, field: string): boolean => (typeof v === "boolean" ? v : (fail(`${field} must be a boolean`) as never));
const str = (v: unknown, field: string): string => (typeof v === "string" && v.length > 0 ? v : (fail(`${field} must be a non-empty string`) as never));

/**
 * Validate the complete request. Also enforces the API-comparison identity contract (HOLD-3 P1-1):
 * `apiComparisonModelId` — when a non-empty string — must resolve to a model with `kind==="llm"`; an
 * empty/unset id is allowed (the frozen calculator treats it as "use the selected LLM", normalized in
 * resolveTrustedPrices — HOLD-3 P2). The self-host `llmModelId` must be a known `kind==="llm"` model.
 */
export function validateRecommendationRequest(req: RecommendationRequest, priceBook: PriceBook): void {
  if (!req || typeof req !== "object") fail("request object required");
  enumOf(req.optimizeFor, OPTIMIZE_FOR, "optimizeFor");
  if (req.experimentalProvenance != null && typeof req.experimentalProvenance !== "boolean") fail("experimentalProvenance must be a boolean");

  const w = req.workload as CalcInputs;
  if (!w || typeof w !== "object" || !w.corpus || !w.chunking || !w.vectorStore || !w.retrieval || !w.guardrails || !w.generation || !w.managedKb || !w.ops || !w.traffic) {
    fail("a complete workload (corpus/chunking/vectorStore/retrieval/guardrails/generation/managedKb/ops/traffic) is required");
  }

  if (w.ragMode !== "A" && w.ragMode !== "B") fail(`invalid ragMode "${String(w.ragMode)}"`);
  if (w.ragMode === "B") fail("ragMode 'B' (managed Bedrock KB) is not supported by the self-host recommendation sweep (Phase 1)");

  // corpus
  enumOf(w.corpus.refreshCadence, REFRESH_CADENCES, "corpus.refreshCadence");
  nonNeg(w.corpus.numDocs, "corpus.numDocs");
  nonNeg(w.corpus.avgTokensPerDoc, "corpus.avgTokensPerDoc");

  // chunking
  pos(w.chunking.chunkSize, "chunking.chunkSize");
  const overlap = num(w.chunking.overlapFraction, "chunking.overlapFraction");
  if (overlap < 0 || overlap >= 1) fail("chunking.overlapFraction must be in [0, 1)");
  pos(w.chunking.embedDim, "chunking.embedDim");
  nonNeg(w.chunking.embedPricePer1K, "chunking.embedPricePer1K");

  // vector store
  enumOf(w.vectorStore.indexingAlgo, INDEXING_ALGOS, "vectorStore.indexingAlgo");
  for (const k of ["m", "replicas", "pqCompression", "minOCU", "ocuPricePerHr", "storagePricePerGBmo", "gbRamPerOcu", "indexingOCUhrs", "qpsPerOcu"] as const) nonNeg((w.vectorStore as any)[k], `vectorStore.${k}`);

  // retrieval
  posInt(w.retrieval.topK, "retrieval.topK");
  nonNegInt(w.retrieval.topN, "retrieval.topN"); // topN > topK is allowed (reconciled to min(topN,topK))
  bool(w.retrieval.rerankEnabled, "retrieval.rerankEnabled");
  nonNeg(w.retrieval.rerankPricePer1K, "retrieval.rerankPricePer1K");

  // guardrails
  bool(w.guardrails.inputEnabled, "guardrails.inputEnabled");
  bool(w.guardrails.outputEnabled, "guardrails.outputEnabled");
  for (const k of ["inputPricePer1KUnits", "outputPricePer1KUnits", "charsPerTextUnit", "charsPerToken"] as const) nonNeg((w.guardrails as any)[k], `guardrails.${k}`);

  // generation
  const g = w.generation;
  enumOf(g.mode, GEN_MODES, "generation.mode");
  if (typeof g.llmModelId !== "string" || !priceBook.models.some((m) => m.id === g.llmModelId && m.kind === "llm")) fail(`unknown llm model "${String(g.llmModelId)}"`);
  const compId = g.apiComparisonModelId;
  if (compId != null && compId !== "") {
    const cm = priceBook.models.find((m) => m.id === compId);
    if (!cm) fail(`unknown apiComparisonModelId "${String(compId)}"`);
    if (cm!.kind !== "llm") fail(`apiComparisonModelId "${String(compId)}" must be a model with kind "llm" (a usable API generation price), not "${cm!.kind}"`);
  }
  enumOf(g.gpuPricingModel, GPU_PRICING_MODELS, "generation.gpuPricingModel");
  nonNeg(g.outTokens, "generation.outTokens");
  nonNeg(g.promptOverhead, "generation.promptOverhead");
  nonNeg(g.gpuUptimeHoursPerMonth, "generation.gpuUptimeHoursPerMonth"); // ≥0; ≤0 → engine default 730 (allowed); >730 reconciled
  nonNeg(g.gpuPricePerHr, "generation.gpuPricePerHr");
  const util = num(g.utilTarget, "generation.utilTarget");
  if (!(util > 0 && util <= 1)) fail("generation.utilTarget must be in (0, 1]");
  posInt(g.numInstances, "generation.numInstances");
  pos(g.ttftTargetMs, "generation.ttftTargetMs");
  pos(g.interactivityTarget, "generation.interactivityTarget");
  pos(g.maxContextLen, "generation.maxContextLen");
  pos(g.maxConcurrentSeqs, "generation.maxConcurrentSeqs");
  // Candidate-varying fields — the sweep overrides these per pinned candidate, but they must still be
  // well-formed exact values (HOLD-4 related cleanup); they never appear in the effective workload.
  if (!WEIGHT_BITS.has(g.weightBits as number)) fail("generation.weightBits must be one of 4 | 8 | 16");
  if (!KV_BITS.has(g.kvBits as number)) fail("generation.kvBits must be one of 8 | 16");
  nonNeg(g.sustainedTokPerSec, "generation.sustainedTokPerSec");
  bool(g.autoSizeFleet, "generation.autoSizeFleet");
  bool(g.haEnabled, "generation.haEnabled");
  str(g.gpuInstanceType, "generation.gpuInstanceType");
  if (!priceBook.gpus.some((x) => x.instanceType === g.gpuInstanceType)) fail(`unknown generation.gpuInstanceType "${String(g.gpuInstanceType)}"`);

  // managed KB
  enumOf(w.managedKb.retrievalMode, MANAGED_KB_MODES, "managedKb.retrievalMode");
  nonNeg(w.managedKb.underlyingRetrievalsPerCall, "managedKb.underlyingRetrievalsPerCall");
  nonNeg(w.managedKb.indexedDataGB, "managedKb.indexedDataGB");

  // ops
  for (const k of ["networkingMonthly$", "observabilityMonthly$", "overheadPct"] as const) nonNeg((w.ops as any)[k], `ops.${k}`);

  // traffic
  enumOf(w.traffic.method, TRAFFIC_METHODS, "traffic.method");
  pos(w.traffic.queriesPerMonth, "traffic.queriesPerMonth");
  pos(w.traffic.peakFactor, "traffic.peakFactor");
  for (const k of ["qps", "hoursPerDay", "daysPerMonth"] as const) nonNeg((w.traffic as any)[k], `traffic.${k}`);
  str(w.traffic.region, "traffic.region");

  nonNeg(w.queryTokens, "queryTokens");
}
