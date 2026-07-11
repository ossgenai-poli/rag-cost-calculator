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
}

/** OpenSearch Serverless pricing (from live Price List API). */
export interface OpenSearchPrice {
  ocuPricePerHr: number;     // USD per OCU-hour
  storagePricePerGBmo: number; // USD per GB-month
  gbRamPerOcu: number;       // ~6
  minOCU: number;            // always-on floor (indexing + search), e.g. 2
}

/** LLM / embedding model price (from typed model-prices.ts config). */
export interface ModelPrice {
  id: string;                // stable key, e.g. "claude-opus-4-8"
  label: string;             // human label
  provider: "bedrock" | "gemini" | "grok" | "openai" | "self-hosted" | "oss";
  bedrock: boolean;          // true => runs in-VPC via Bedrock (no egress note)
  kind: "llm" | "embedding" | "rerank" | "guardrail";
  inPricePer1K: number;      // USD per 1K input tokens
  outPricePer1K: number;     // USD per 1K output tokens (0 for embed/rerank/guardrail)
  dim?: number;              // embedding dimension (embedding models only)
  verifiedAt: string;        // ISO date the price was validated against vendor page
}

/** Full normalized price book returned by loadPrices(). */
export interface PriceBook {
  updatedAt: string;         // ISO timestamp of this PriceBook
  source: "live" | "fallback"; // filled by loadPrices at runtime
  region: string;            // e.g. "us-east-1"
  gpus: GpuInstancePrice[];
  opensearch: OpenSearchPrice;
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
}

export interface RetrievalInputs {
  topK: number;               // docs retrieved
  rerankEnabled: boolean;
  rerankModelId: string;
  rerankPricePer1K: number;
  topN: number;               // chunks kept after rerank -> LLM context
}

export interface GuardrailInputs {
  inputEnabled: boolean;
  outputEnabled: boolean;
  unitPricePer1K: number;     // guardrail price per 1K units
  unitsPerQuery: number;      // guardrail units charged per query text (approx)
}

export interface GenerationInputs {
  mode: GenerationMode;       // api | self-hosted
  llmModelId: string;         // -> ModelPrice (kind=llm)
  llmInPricePer1K: number;    // patched from model
  llmOutPricePer1K: number;   // patched from model
  outTokens: number;          // output tokens per answer
  promptOverhead: number;     // system/prompt tokens per query
  // self-hosted GPU params:
  gpuInstanceType: string;    // -> GpuInstancePrice
  gpuPricePerHr: number;      // patched from instance
  sustainedTokPerSec: number; // patched from instance (editable)
  utilTarget: number;         // (0,1] target GPU utilization
}

export interface TrafficInputs {
  queriesPerMonth: number;
  region: string;
}

export interface CalcInputs {
  ragMode: RagMode;
  corpus: CorpusInputs;
  chunking: ChunkingInputs;
  vectorStore: VectorStoreInputs;
  retrieval: RetrievalInputs;
  guardrails: GuardrailInputs;
  generation: GenerationInputs;
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
  apiGen$: number;
  guardrailOut$: number;
  infraCrumbs$: number;
  perQuery$: number;
}

export interface CostBreakdownLine {
  label: string;
  monthly$: number;
  category: "ingestion" | "vectorstore" | "query" | "generation" | "guardrails";
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
  mode: RagMode;
}

// ---------------------------------------------------------------------------
// CrossoverResult — API vs self-hosted GPU economics
// ---------------------------------------------------------------------------

export interface CrossoverResult {
  monthlyGenTokens: number;
  gpuMonthly$: number;
  capacity100: number;         // tokens/mo at 100% util per box
  boxes: number;
  selfHostedMonthly$: number;
  apiBlendedPricePerToken: number;
  apiMonthly$: number;         // linear API cost at current volume
  breakEvenTokens: number;
  equivalentQPS: number;       // break-even tokens expressed as QPS
  utilAtBreakEven: number;     // honesty check (<~0.5 => GPU idle)
  verdict: "self-host efficient" | "API wins in practice below sustained load";
  /** sampled points for the Recharts crossover chart */
  curve: Array<{ tokens: number; api$: number; selfHosted$: number }>;
}
