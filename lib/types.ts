// ============================================================================
// SHARED CONTRACT — every sub-agent composes against these types.
// Do not change field names/shapes without updating the orchestrator contract.
// ============================================================================

// ---------------------------------------------------------------------------
// PriceBook — normalized output of the pricing backend (live or fallback)
// ---------------------------------------------------------------------------

/** A single EC2 GPU instance option (from live Price List API). */
export interface GpuInstancePrice {
  instanceType: string;      // e.g. "p5.48xlarge"
  gpu: string;               // e.g. "8x H100"
  pricePerHr: number;        // on-demand USD/hr, us-east-1
  /** rough sustained generation throughput for a 70B-class model, tok/s */
  sustainedTokPerSec: number;
  /** aggregate GPU HBM across the instance, GB (e.g. 8×80 = 640 for p5) */
  totalMemGB: number;
  /** per-SKU price provenance (PRICING-018): live = fetched from AWS this build;
   * fallback = committed reference default; override = user-entered. */
  priceSource?: "live" | "fallback" | "override";
}

/** OpenSearch Serverless pricing (from live Price List API). */
export interface OpenSearchPrice {
  ocuPricePerHr: number;     // USD per OCU-hour
  storagePricePerGBmo: number; // USD per GB-month
  gbRamPerOcu: number;       // ~6
  minOCU: number;            // always-on floor (indexing + search), e.g. 2
}

/** Amazon Bedrock Managed Knowledge Bases pricing (aws.amazon.com/bedrock/pricing). */
export interface ManagedKbPrice {
  indexStoragePerGBmo: number;  // $ per GB of raw indexed data / month
  retrievePer1k: number;        // $ per 1,000 Retrieve API calls
  agenticRetrievePer1k: number; // $ per 1,000 Agentic Retrieve API calls
  verifiedAt: string;           // ISO date the rate was verified against the AWS page
}

/** LLM / embedding model price (from typed model-prices.ts config). */
export interface ModelPrice {
  id: string;                // stable key, e.g. "claude-opus-4-8"
  label: string;             // human label
  provider: "bedrock" | "gemini" | "grok" | "openai" | "self-hosted" | "oss";
  bedrock: boolean;          // true => runs in-VPC via Bedrock (no egress note)
  kind: "llm" | "embedding" | "rerank" | "guardrail";
  inPricePer1K: number;      // USD per 1K input tokens (hosted/API price; for OSS this is a serving-provider price)
  outPricePer1K: number;     // USD per 1K output tokens (0 for embed/rerank/guardrail)
  dim?: number;              // embedding dimension (embedding models only)
  /** true => open weights that can run on your own GPUs (self-hosted mode). */
  selfHostable?: boolean;
  /** total parameter count in billions — drives GPU memory sizing for self-hosting. */
  paramsB?: number;
  /** model's supported maximum context window (tokens); undefined = not constrained here. */
  maxContextTokens?: number;
  /** KV-cache bytes per token at FP16, summed over attention layers (arch-derived). */
  kvBytesPerToken?: number;
  /** attention family — explains the KV footprint: "MLA" | "GQA" | "hybrid". */
  attentionType?: string;
  /** InferenceX benchmark model key for GPU-sizing grounding (undefined = no data). */
  inferencexKey?: string;
  /** how the benchmark data relates to this model: measured | proxy | estimate. */
  benchmarkProvenance?: "measured" | "proxy" | "estimate";
  verifiedAt: string;        // ISO date the price was validated against vendor page
}

/** Full normalized price book returned by loadPrices(). */
export interface PriceBook {
  updatedAt: string;         // ISO timestamp of this PriceBook
  source: "live" | "fallback"; // filled by loadPrices at runtime
  region: string;            // e.g. "us-east-1"
  gpus: GpuInstancePrice[];
  opensearch: OpenSearchPrice;
  managedKb: ManagedKbPrice;
  models: ModelPrice[];      // all LLM/embed/rerank/guardrail models
}

/** Result of loadPrices — never throws; carries freshness + live/stale flag. */
export interface LoadPricesResult {
  priceBook: PriceBook;
  stale: boolean;            // true if we fell back to committed prices.json
  asOf: string;              // ISO date to render "prices as of <date>"
}

// ---------------------------------------------------------------------------
// CalcInputs — the engineer-mode parameter set (UI-owned, engine-consumed)
// ---------------------------------------------------------------------------

export type IndexingAlgo = "hnsw" | "ivf_pq" | "ivf_fp16";
export type GenerationMode = "api" | "self-hosted";
export type RagMode = "A" | "B"; // A = self-built, B = Bedrock Knowledge Bases
export type RefreshCadence = "one-time" | "weekly" | "monthly";

export interface CorpusInputs {
  numDocs: number;
  avgTokensPerDoc: number;
  refreshCadence: RefreshCadence;
}

export interface ChunkingInputs {
  chunkSize: number;          // tokens per chunk
  overlapFraction: number;    // [0,1)
  embedModelId: string;       // -> ModelPrice (kind=embedding)
  embedDim: number;           // patched from selected model
  embedPricePer1K: number;    // patched from selected model
  // embeddings are API-only (no self-hosted embed) per spec
}

export interface VectorStoreInputs {
  indexingAlgo: IndexingAlgo;
  m: number;                  // HNSW neighbors, default 16
  replicas: number;           // >= 1
  pqCompression: number;      // e.g. 32 for ivf_pq
  minOCU: number;
  ocuPricePerHr: number;
  storagePricePerGBmo: number;
  gbRamPerOcu: number;        // ~6
  indexingOCUhrs: number;     // one-time / periodic indexing OCU-hours
  qpsPerOcu: number;          // search queries/sec one OCU can serve (load-based OCU sizing)
}

export interface RetrievalInputs {
  topK: number;               // docs retrieved
  rerankEnabled: boolean;
  rerankModelId: string;
  rerankPricePer1K: number;
  topN: number;               // chunks kept after rerank -> LLM context
}

export interface GuardrailInputs {
  inputEnabled: boolean;       // guard the input prompt (retrieved context + query)
  outputEnabled: boolean;      // guard the model response
  // Bedrock Guardrails bill per "text unit" — a fixed block of characters — per
  // configured policy. Input and output are separate evaluations, so each side
  // has its own price (you can run different policy sets on each).
  inputPricePer1KUnits: number;   // USD per 1,000 text units, input policy
  outputPricePer1KUnits: number;  // USD per 1,000 text units, output policy
  charsPerTextUnit: number;    // characters per text unit (400 for content filters / denied topics / PII; 600 for contextual grounding)
  charsPerToken: number;       // token→character conversion to estimate text units (~4 for English)
}

/** GPU purchasing model — applies a commitment discount to the on-demand rate. */
export type GpuPricingModel =
  | "on-demand"
  | "reserved-1yr"
  | "reserved-3yr"
  | "savings-1yr"
  | "spot";

export interface GenerationInputs {
  mode: GenerationMode;       // api | self-hosted
  llmModelId: string;         // -> ModelPrice (kind=llm)
  llmInPricePer1K: number;    // patched from model
  llmOutPricePer1K: number;   // patched from model
  outTokens: number;          // output tokens per answer
  promptOverhead: number;     // system/prompt tokens per query
  // self-hosted GPU params:
  gpuInstanceType: string;    // -> GpuInstancePrice
  gpuPricePerHr: number;      // ON-DEMAND price, patched from instance
  gpuPricingModel: GpuPricingModel; // commitment model → discount off on-demand
  gpuUptimeHoursPerMonth: number;   // hours/mo the fleet runs (730 = always-on)
  sustainedTokPerSec: number; // patched from instance (editable)
  utilTarget: number;         // (0,1] target GPU utilization
  numInstances: number;       // provisioned GPU instances; defaults to the min needed to load the model
  autoSizeFleet: boolean;     // when true (default), bill the fleet up to what serves the load; when false, bill exactly numInstances and mark infeasible if that can't serve it
  weightBits: number;         // weight precision: 16 (BF16/FP16), 8 (FP8/INT8), 4 (INT4) — drives WEIGHT memory
  kvBits: number;             // KV-cache precision (INDEPENDENT of weightBits): 16 (BF16/FP16) or 8 (FP8) — drives KV memory. Default 16 (conservative). GPU-003
  ttftTargetMs: number;       // max acceptable time-to-first-token (ms). A benchmark point must meet BOTH this and interactivityTarget or the config is infeasible. GPU-004
  haEnabled: boolean;         // production redundancy: when true (default), provision N+1 replicas (min 2). GPU-006
  // API cost COMPARISON model (crossover + "Self-built + API" row). Defaults to
  // the selected model (apples-to-apples); can be a different model as a proxy.
  apiComparisonModelId: string;
  apiComparisonInPricePer1K: number;
  apiComparisonOutPricePer1K: number;
  // Serving shape — drives KV-cache memory. KV precision follows weightBits.
  maxContextLen: number;      // max sequence length held in KV cache (tokens)
  maxConcurrentSeqs: number;  // concurrent sequences (batch) held in KV cache
  // Interactivity SLA for benchmark-grounded GPU sizing: target output tok/s per
  // user. Higher = snappier UX = lower per-GPU throughput = more GPUs needed.
  interactivityTarget: number;
}

export type ManagedKbRetrievalMode = "standard" | "agentic";

export interface ManagedKbInputs {
  retrievalMode: ManagedKbRetrievalMode;
  underlyingRetrievalsPerCall: number; // avg Retrieve calls per Agentic call (agentic only)
  indexedDataGB: number;               // raw indexed data size, $/GB-mo storage basis
}

export type TrafficMethod = "monthly" | "qps";

export interface TrafficInputs {
  queriesPerMonth: number;
  region: string;
  // How queriesPerMonth was derived — persisted so shared links restore the
  // QPS helper. queriesPerMonth stays the single source of truth for the engine.
  method: TrafficMethod;
  qps: number;
  hoursPerDay: number;
  daysPerMonth: number;
  // Peak-to-average ratio: a self-hosted fleet must be provisioned for PEAK load,
  // so the throughput-required instance count scales by this (1 = flat traffic).
  peakFactor: number;
}

/** Production operational costs the core model doesn't otherwise capture. */
export interface OpsInputs {
  networkingMonthly$: number;    // data transfer / NAT / load balancers
  observabilityMonthly$: number; // logging + monitoring (CloudWatch, dashboards)
  overheadPct: number;           // % markup on all other costs (on-call, redundancy, misc)
}

export interface CalcInputs {
  ragMode: RagMode;
  corpus: CorpusInputs;
  chunking: ChunkingInputs;
  vectorStore: VectorStoreInputs;
  retrieval: RetrievalInputs;
  guardrails: GuardrailInputs;
  generation: GenerationInputs;
  managedKb: ManagedKbInputs;
  ops: OpsInputs;
  traffic: TrafficInputs;
  queryTokens: number;        // user query length in tokens
}

// ---------------------------------------------------------------------------
// CalcResult — deterministic output of the cost engine
// ---------------------------------------------------------------------------

export interface IngestionResult {
  corpusTokens: number;
  effChunk: number;
  numVectors: number;         // N
  embedIngest$: number;       // one-time (amortized monthly if cadence != one-time)
  embedIngestMonthly$: number;// monthly amortization based on refreshCadence
}

export interface VectorStoreResult {
  ramBytes: number;
  ramGB: number;
  searchOCU: number;
  storageGB: number;
  opensearchMonthly$: number;
  opensearchFloor$: number;   // always-on baseline
  hnswBytes: number;          // pre-quantization reference
}

export interface PerQueryResult {
  guardrailIn$: number;
  embedQuery$: number;
  rerank$: number;
  llmInputTok: number;
  apiGen$: number;            // API generation for the SELECTED model (headline in API mode)
  apiComparisonGen$: number;  // API generation for the comparison model (crossover/scenario baseline)
  guardrailOut$: number;
  infraCrumbs$: number;
  perQuery$: number;
}

/**
 * Benchmark-grounded GPU sizing check — validates the provisioned self-hosted
 * fleet against real InferenceX throughput at the customer's interactivity SLA.
 * `available` is false when no benchmark curve exists for the model/GPU/precision.
 */
export interface GroundingResult {
  available: boolean;
  provenance?: "measured" | "proxy" | "estimate";
  note?: string;                 // why unavailable, or the proxy/estimate caveat
  interactivityTarget?: number;  // the SLA used (tok/s/user)
  achievedInteractivity?: number;// tok/s/user at the chosen operating point
  tputPerGpu?: number;           // decode tok/s per GPU at the SLA (benchmark)
  ttftAtSla?: number;            // TTFT (s) at that operating point
  gpusPerBox?: number;
  requiredDecodeTokPerSec?: number; // qps × output tokens
  minInstancesThroughput?: number;  // ceil(required / (tputPerGpu × gpusPerBox))
  minInstancesMemory?: number;      // memory floor (from crossover)
  minInstances?: number;            // max(throughput, memory)
  provisionedInstances?: number;    // what the user provisioned
  underProvisioned?: boolean;
  slaAchievable?: boolean;          // false when target > best interactivity in the curve
}

export interface CostBreakdownLine {
  label: string;
  monthly$: number;
  category: "ingestion" | "vectorstore" | "query" | "rerank" | "generation" | "guardrails" | "ops";
}

/** Managed Bedrock KB scenario — its own independent cost tree (retrieval only;
 *  LLM generation is added on top by the consumer). */
export interface ManagedKbResult {
  storageMonthly$: number;      // indexed data × $/GB-mo
  retrievalMonthly$: number;    // standard or agentic + underlying retrievals
  managedSubtotal$: number;     // storage + retrieval (matches AWS's published example totals)
  generationMonthly$: number;   // API LLM generation (Retrieve does not generate)
  guardrailsMonthly$: number;
  total$: number;               // full RAG monthly for the managed scenario
}

export interface CalcResult {
  ingestion: IngestionResult;
  vectorStore: VectorStoreResult;
  perQuery: PerQueryResult;
  queryMonthly$: number;       // perQuery$ * queriesPerMonth
  totalMonthly$: number;       // grand total for the selected mode
  breakdown: CostBreakdownLine[];
  dominantLever: { label: string; monthly$: number; share: number };
  crossover: CrossoverResult;
  managedKb: ManagedKbResult;
  grounding: GroundingResult;
  mode: RagMode;
  /** The NORMALIZED (clamped) inputs the engine actually computed with. This is
   * authoritative for display, scenarios, sensitivity and exports — the raw
   * entered inputs are only audit/warning metadata (INPUT-020). */
  effectiveInputs: CalcInputs;
}

// ---------------------------------------------------------------------------
// CrossoverResult — API vs self-hosted GPU economics
// ---------------------------------------------------------------------------

export type CapacitySource = "measured" | "proxy" | "extrapolated" | "heuristic";

/** Authoritative self-hosted decode capacity + operating point + topology (GPU-001). */
export interface CapacityResult {
  source: CapacitySource;
  extrapolationReasons: string[];
  benchmarkAvailable: boolean;
  perGpuDecodeTokS: number;
  perReplicaDecodeTokS: number;
  perInstanceDecodeTokS: number;
  // Prefill (input) throughput — ALWAYS estimated (no benchmark prefill data), so
  // when prefill binds the fleet the result can never be an unqualified "measured".
  perReplicaPrefillTokS: number;
  prefillEstimated: boolean;
  // Context feasibility (GPU-012):
  contextRequiredTokens: number;   // input + max output for one request
  maxContextConfigured: number;    // the configured KV context window
  contextOverflow: boolean;        // requiredTokens > configured (or model max)
  chosenConcurrency: number;
  achievedInteractivity: number;
  ttftS: number;
  interactivityMet: boolean;
  ttftMet: boolean;
  concWithinLimit: boolean;
  slaAchievable: boolean;
  maxConcurrency: number;
  gpusPerBox: number;
  gpusInConfig: number;
  instancesPerReplica: number;
  memoryFloorBoxes: number;
  weightsGB: number;
  kvCacheGB: number;
  serviceMemGB: number;
  benchModelKey?: string;
  framework?: string;
  precisionUsed?: string;      // fp4/fp8 actually in the benchmark
  precisionRequested?: string; // bf16/fp8/fp4 the config asked for (GPU-010)
  weightPrecisionBits: number;
  kvPrecisionBits: number;
  seqUsed?: string;            // benchmarked ISL/OSL bucket
  seqRequested?: string;       // requested ISL/OSL (GPU-010)
  note?: string;
}

export interface CrossoverResult {
  monthlyGenTokens: number;
  gpuMonthly$: number;
  capacity100: number;         // tokens/mo at 100% util per box
  boxes: number;               // instances actually billed — auto-sized up to serve the load (never below what's required)
  userInstances: number;       // the integer count the user requested (before auto-sizing)
  requiredInstances: number;   // max(memory floor, throughput need, grounded need) — the minimum feasible fleet
  autoSized: boolean;          // true when boxes had to exceed the user's requested count to serve the load
  feasible: boolean;           // false when the billed fleet can't meet throughput/concurrency/TTFT/memory (no positive verdict)
  ownedCapacity: boolean;      // true when the GPU $/hr is 0 (owned/free capacity) — crossover savings not meaningful

  // Authoritative capacity + topology (GPU-001/005/006). ALL capacity/economics
  // above derive from `capacity.perInstanceDecodeTokS`, never a generic estimate.
  capacity: CapacityResult;
  replicas: number;                // serving replicas billed (incl. HA)
  usableReplicas: number;          // COMPLETE serving groups (floor(boxes/ipr)) — only these serve traffic
  strandedBoxes: number;           // billed boxes that don't complete a group → zero serving capacity (GPU-011)
  instancesPerReplica: number;     // 8-GPU boxes per replica
  haReplicasAdded: number;         // extra replicas added for N+1 HA (0 if HA off)
  utilPeakPostLoss: number;        // peak util after losing one serving group (N+1 check)
  // Peak/uptime telemetry (label both — GPU peak reporting):
  avgDecodeDemand: number;         // output tok/s, monthly average
  peakDecodeDemand: number;        // output tok/s at peak (× peakFactor)
  avgPrefillDemand: number;        // input tok/s, monthly average (GPU-008)
  peakPrefillDemand: number;       // input tok/s at peak
  prefillBinds: boolean;           // prefill (not decode) sets the fleet size
  providedDecodeCapacity: number;  // output tok/s the billed fleet delivers at 100% util
  providedPrefillCapacity: number; // input tok/s the billed fleet delivers at 100% util
  utilAvg: number;                 // avg DECODE demand ÷ provided decode capacity
  utilPeak: number;                // peak decode demand ÷ provided decode capacity
  utilAvgPrefill: number;          // avg PREFILL demand ÷ provided prefill capacity
  utilPeakPrefill: number;         // peak prefill demand ÷ provided prefill capacity
  bindingDim: "prefill" | "decode"; // which dimension runs hotter at the current workload
  breakEvenBindingDim: "prefill" | "decode"; // which dimension binds at break-even volume
  gpuPriceSource: "live" | "fallback" | "override"; // provenance of the $/hr used (P1)
  /** Coded infeasibility reasons for targeted UI guidance (GPU-013). Empty ⇒ feasible. */
  infeasibility: Array<{ code: string; message: string; addingInstancesHelps: boolean }>;
  minInstancesToLoad: number;  // memory floor — min instances to hold the weights
  throughputInstances: number; // instances the current load would need for decode throughput
  realizedUtil: number;        // actual decode utilization of the fleet at the current workload
  breakEvenFeasible: boolean;  // false when break-even needs > fleet capacity (not achievable)
  selfHostedMonthly$: number;
  apiBlendedPricePerToken: number;
  apiMonthly$: number;         // linear API cost at current volume
  breakEvenTokens: number;
  equivalentQPS: number;       // break-even QPS over the CALENDAR month (730 h)
  activeWindowQPS: number;     // break-even QPS over the fleet's ACTIVE hours (uptime) — GPU-019
  utilAtBreakEven: number;     // honesty check (<~0.5 => GPU idle)
  tokensPerQuery: number;      // total (input+output) LLM tokens per query — converts the token axis to queries/QPS
  outputFraction: number;      // output ÷ total tokens — converts the token axis to output/input tokens and derives decode util
  verdict: "self-host efficient" | "API wins in practice below sustained load";
  /** True when a POSITIVE verdict rests on non-measured capacity (proxy/extrapolated/
   * heuristic) — the recommendation must be shown qualified, never unconditional. */
  verdictQualified: boolean;
  /** sampled points for the Recharts crossover chart */
  curve: Array<{ tokens: number; api$: number; selfHosted$: number }>;
}
