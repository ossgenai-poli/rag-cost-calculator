// ============================================================================
// calc-engine — pure, deterministic RAG cost model. No I/O, no React.
// Composes against the frozen contract in ./types.ts.
// ============================================================================

import type {
  CalcInputs,
  PriceBook,
  CalcResult,
  IngestionResult,
  VectorStoreResult,
  PerQueryResult,
  CostBreakdownLine,
  OpsInputs,
  RagMode,
} from "./types";
import { computeCrossover } from "./crossover";
import { computeGrounding } from "./grounding";

/** Fixed tiny S3/network per-query overhead ($), keeps golden tests stable. */
export const INFRA_CRUMBS_PER_QUERY = 0.00002;

/** 730 hrs/mo × 3600 s/hr — single seconds-per-month convention used everywhere. */
export const SECONDS_PER_MONTH = 730 * 3600;

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

function computeIngestion(inputs: CalcInputs): IngestionResult {
  const { corpus, chunking } = inputs;

  const corpusTokens = corpus.numDocs * corpus.avgTokensPerDoc;
  const effChunk = chunking.chunkSize * (1 - chunking.overlapFraction);
  const numVectors = corpusTokens / effChunk;
  // Overlap re-embeds shared tokens, so the billed token count is the sum of
  // full chunks (numVectors × chunkSize = corpusTokens / (1 − overlap)), not
  // the raw corpus. Falls back to corpusTokens when effChunk is degenerate.
  const embeddedTokens = Number.isFinite(effChunk) && effChunk > 0 ? numVectors * chunking.chunkSize : corpusTokens;
  const embedIngestOnce = (embeddedTokens / 1000) * chunking.embedPricePer1K;

  // Amortize the one-time embed cost according to how often the corpus refreshes.
  const embedIngestMonthly =
    corpus.refreshCadence === "one-time"
      ? embedIngestOnce / 12
      : corpus.refreshCadence === "weekly"
        ? embedIngestOnce * 4.345
        : embedIngestOnce * 1; // "monthly"

  return {
    corpusTokens,
    effChunk,
    numVectors,
    "embedIngest$": embedIngestOnce,
    embedIngestMonthly$: embedIngestMonthly,
  };
}

// ---------------------------------------------------------------------------
// Vector store (OpenSearch Serverless)
// ---------------------------------------------------------------------------

function computeVectorStore(inputs: CalcInputs, numVectors: number): VectorStoreResult {
  const { chunking, vectorStore, traffic } = inputs;
  const dim = chunking.embedDim;
  const { m, replicas, indexingAlgo, pqCompression, minOCU, ocuPricePerHr, storagePricePerGBmo, gbRamPerOcu, indexingOCUhrs, qpsPerOcu } =
    vectorStore;

  const hnswBytes = 1.1 * (4 * dim + 8 * m) * numVectors * (1 + replicas);

  const ramBytes =
    indexingAlgo === "hnsw"
      ? hnswBytes
      : indexingAlgo === "ivf_pq"
        ? hnswBytes / pqCompression
        : hnswBytes / 2; // "ivf_fp16"

  const ramGB = ramBytes / 1e9;
  // Search OCUs are the max of three floors: the always-on minimum, the RAM the
  // index needs resident, and the compute the query load demands.
  const ramOCU = Math.ceil(ramGB / gbRamPerOcu);
  const qps = traffic.queriesPerMonth / SECONDS_PER_MONTH;
  const loadOCU = qpsPerOcu > 0 ? Math.ceil(qps / qpsPerOcu) : 0;
  const searchOCU = Math.max(minOCU, ramOCU, loadOCU);
  const storageGB = (4 * dim * numVectors) / 1e9; // raw fp32 vectors, unquantized

  const opensearchMonthly = (indexingOCUhrs + searchOCU * 730) * ocuPricePerHr + storageGB * storagePricePerGBmo;
  const opensearchFloor = minOCU * ocuPricePerHr * 730; // always-on baseline

  return {
    ramBytes,
    ramGB,
    searchOCU,
    storageGB,
    opensearchMonthly$: opensearchMonthly,
    opensearchFloor$: opensearchFloor,
    hnswBytes,
  };
}

// ---------------------------------------------------------------------------
// Per-query cost
// ---------------------------------------------------------------------------

function computePerQuery(inputs: CalcInputs): PerQueryResult {
  const { guardrails, chunking, retrieval, generation, queryTokens } = inputs;

  const embedQuery = (queryTokens / 1000) * chunking.embedPricePer1K;
  // Reranking is billed per search REQUEST (one per query), not per token.
  // rerankPricePer1K is $ per 1,000 rerank requests.
  const rerank = retrieval.rerankEnabled ? retrieval.rerankPricePer1K / 1000 : 0;
  // Enforce the retrieval invariant at the calc boundary: you can't send more
  // chunks to the LLM than you retrieved (topN ≤ topK). This guards every input
  // path (UI, shared link, saved scenario) against billing an impossible config;
  // the panel also shows a warning when the raw input violates it.
  const effectiveTopN = Math.min(retrieval.topN, retrieval.topK);
  const llmInputTok = effectiveTopN * chunking.chunkSize + generation.promptOverhead + queryTokens;
  const apiGen = (llmInputTok / 1000) * generation.llmInPricePer1K + (generation.outTokens / 1000) * generation.llmOutPricePer1K;
  // API generation cost for the COMPARISON model (falls back to the selected
  // model's price when unset, so old links / same-model comparisons match apiGen).
  const compIn = generation.apiComparisonInPricePer1K || generation.llmInPricePer1K;
  const compOut = generation.apiComparisonOutPricePer1K || generation.llmOutPricePer1K;
  const apiComparisonGen = (llmInputTok / 1000) * compIn + (generation.outTokens / 1000) * compOut;

  // Guardrails bill per text unit (a fixed block of characters) per policy. The
  // input policy scans the whole prompt (retrieved context + overhead + query);
  // the output policy scans the generated response. Estimate characters from
  // tokens, then text units from characters — so a long RAG prompt is charged for
  // the many text units it actually is, not a flat "1 unit/query".
  const charsPerUnit = guardrails.charsPerTextUnit > 0 ? guardrails.charsPerTextUnit : 1;
  const inputTextUnits = (llmInputTok * guardrails.charsPerToken) / charsPerUnit;
  const outputTextUnits = (generation.outTokens * guardrails.charsPerToken) / charsPerUnit;
  const guardrailIn = guardrails.inputEnabled
    ? (inputTextUnits / 1000) * guardrails.inputPricePer1KUnits
    : 0;
  const guardrailOut = guardrails.outputEnabled
    ? (outputTextUnits / 1000) * guardrails.outputPricePer1KUnits
    : 0;
  const infraCrumbs = INFRA_CRUMBS_PER_QUERY;

  const perQuery = guardrailIn + embedQuery + rerank + apiGen + guardrailOut + infraCrumbs;

  return {
    guardrailIn$: guardrailIn,
    embedQuery$: embedQuery,
    rerank$: rerank,
    llmInputTok,
    apiGen$: apiGen,
    apiComparisonGen$: apiComparisonGen,
    guardrailOut$: guardrailOut,
    infraCrumbs$: infraCrumbs,
    perQuery$: perQuery,
  };
}

// ---------------------------------------------------------------------------
// Breakdown + dominant lever
// ---------------------------------------------------------------------------

function buildBreakdown(
  ingestion: IngestionResult,
  vectorStore: VectorStoreResult,
  perQuery: PerQueryResult,
  queriesPerMonth: number,
  generationMonthly: number,
  generationLabel: string,
  ops: OpsInputs
): CostBreakdownLine[] {
  const guardrailsMonthly = (perQuery.guardrailIn$ + perQuery.guardrailOut$) * queriesPerMonth;
  const rerankMonthly = perQuery.rerank$ * queriesPerMonth;
  const queryOtherMonthly = (perQuery.embedQuery$ + perQuery.infraCrumbs$) * queriesPerMonth;

  // Operations & overhead: fixed networking + observability line items, plus a
  // percentage markup on every OTHER line (on-call, redundancy, misc production
  // reality). All default to 0, so the base model is unchanged until opted in.
  const baseCosts =
    ingestion.embedIngestMonthly$ +
    vectorStore.opensearchMonthly$ +
    rerankMonthly +
    generationMonthly +
    guardrailsMonthly +
    queryOtherMonthly;
  const opsMonthly =
    ops.networkingMonthly$ + ops.observabilityMonthly$ + (ops.overheadPct / 100) * baseCosts;

  return [
    { label: "Ingestion (embedding)", monthly$: ingestion.embedIngestMonthly$, category: "ingestion" },
    { label: "Vector store (OpenSearch Serverless)", monthly$: vectorStore.opensearchMonthly$, category: "vectorstore" },
    { label: "Reranking", monthly$: rerankMonthly, category: "rerank" },
    { label: generationLabel, monthly$: generationMonthly, category: "generation" },
    { label: "Guardrails", monthly$: guardrailsMonthly, category: "guardrails" },
    { label: "Query overhead (query embedding + infra)", monthly$: queryOtherMonthly, category: "query" },
    { label: "Operations & overhead", monthly$: opsMonthly, category: "ops" },
  ];
}

function findDominantLever(breakdown: CostBreakdownLine[], totalMonthly: number) {
  const dominant = breakdown.reduce((max, line) => (line.monthly$ > max.monthly$ ? line : max), breakdown[0]);
  return {
    label: dominant.label,
    monthly$: dominant.monthly$,
    share: totalMonthly > 0 ? dominant.monthly$ / totalMonthly : 0,
  };
}

// ---------------------------------------------------------------------------
// Managed Bedrock Knowledge Bases — independent cost tree (verified AWS rates).
// Parsing / embeddings / reranking are included in the retrieval price, so this
// scenario does NOT reuse the self-built vector-store / embed / rerank costs.
// ---------------------------------------------------------------------------

function computeManagedKb(inputs: CalcInputs, priceBook: PriceBook, perQuery: PerQueryResult) {
  const { managedKb, traffic, guardrails } = inputs;
  const kb = priceBook.managedKb;
  const queries = traffic.queriesPerMonth;

  const storageMonthly = managedKb.indexedDataGB * kb.indexStoragePerGBmo;
  const retrievalMonthly =
    managedKb.retrievalMode === "agentic"
      ? (queries / 1000) * kb.agenticRetrievePer1k +
        ((queries * managedKb.underlyingRetrievalsPerCall) / 1000) * kb.retrievePer1k
      : (queries / 1000) * kb.retrievePer1k;
  const managedSubtotal = storageMonthly + retrievalMonthly;

  // Retrieve returns chunks; generation is a separate LLM call. Use the API
  // comparison model so it lines up with the "Self-built + API" scenario.
  const generationMonthly = perQuery.apiComparisonGen$ * queries;
  const guardrailsMonthly =
    (guardrails.inputEnabled || guardrails.outputEnabled ? perQuery.guardrailIn$ + perQuery.guardrailOut$ : 0) *
    queries;

  return {
    storageMonthly$: storageMonthly,
    retrievalMonthly$: retrievalMonthly,
    managedSubtotal$: managedSubtotal,
    generationMonthly$: generationMonthly,
    guardrailsMonthly$: guardrailsMonthly,
    total$: managedSubtotal + generationMonthly + guardrailsMonthly,
  };
}

// ---------------------------------------------------------------------------
// calculate()
// ---------------------------------------------------------------------------

function computeForMode(effectiveInputs: CalcInputs, priceBook: PriceBook, reportedMode: RagMode): CalcResult {
  const ingestion = computeIngestion(effectiveInputs);
  const vectorStore = computeVectorStore(effectiveInputs, ingestion.numVectors);
  const perQuery = computePerQuery(effectiveInputs);
  // Crossover is computed first so self-hosted mode can bill the GPU fleet. It
  // auto-sizes the fleet to the flat-nameplate throughput need. Then grounding may
  // reveal a LARGER measured requirement; if so, re-run the crossover with that as
  // a floor so the billed fleet (and every downstream cost/scenario/export) is sized
  // to actually serve the load — no cheaper-but-inadequate fleet is ever billed.
  const crossover0 = computeCrossover(effectiveInputs, priceBook, perQuery);
  const grounding0 = computeGrounding(effectiveInputs, priceBook, perQuery, crossover0);
  const groundedFloor =
    grounding0.available && grounding0.minInstances != null ? grounding0.minInstances : 0;
  const crossover =
    groundedFloor > crossover0.boxes
      ? computeCrossover(effectiveInputs, priceBook, perQuery, groundedFloor)
      : crossover0;
  const grounding =
    crossover === crossover0
      ? grounding0
      : computeGrounding(effectiveInputs, priceBook, perQuery, crossover);

  const queriesPerMonth = effectiveInputs.traffic.queriesPerMonth;
  const selfHosted = effectiveInputs.generation.mode === "self-hosted";

  // Generation is billed by tokens (API) OR by the provisioned GPU fleet
  // (self-hosted). THIS is what makes the headline reflect the selected mode.
  const apiGenMonthly = perQuery.apiGen$ * queriesPerMonth;
  const generationMonthly = selfHosted ? crossover.selfHostedMonthly$ : apiGenMonthly;
  const generationLabel = selfHosted
    ? "GPU infrastructure (self-hosted LLM)"
    : "Generation (LLM API)";

  // Non-generation per-query costs (embed, rerank, guardrails, infra crumbs).
  const nonGenQueryMonthly = (perQuery.perQuery$ - perQuery.apiGen$) * queriesPerMonth;
  const baseMonthly =
    ingestion.embedIngestMonthly$ + vectorStore.opensearchMonthly$ + nonGenQueryMonthly + generationMonthly;
  // Operations & overhead layered on top (0 by default → base model unchanged).
  const ops = effectiveInputs.ops;
  const opsMonthly =
    ops.networkingMonthly$ + ops.observabilityMonthly$ + (ops.overheadPct / 100) * baseMonthly;
  const totalMonthly = baseMonthly + opsMonthly;
  // Preserved for callers/tests: the per-query variable cost × volume (API-style).
  const queryMonthly = perQuery.perQuery$ * queriesPerMonth;

  const breakdown = buildBreakdown(
    ingestion,
    vectorStore,
    perQuery,
    queriesPerMonth,
    generationMonthly,
    generationLabel,
    ops
  );
  const dominantLever = findDominantLever(breakdown, totalMonthly);

  return {
    ingestion,
    vectorStore,
    perQuery,
    queryMonthly$: queryMonthly,
    totalMonthly$: totalMonthly,
    breakdown,
    dominantLever,
    crossover,
    managedKb: computeManagedKb(effectiveInputs, priceBook, perQuery),
    grounding,
    mode: reportedMode,
  };
}

/**
 * Compute the full RAG cost model for one mode.
 *
 * ragMode "A" (self-built) uses inputs as-is. ragMode "B" (Bedrock Knowledge
 * Bases) clones inputs and overrides the vector store / generation params to
 * reflect the managed service (HNSW-only, redundant OCUs, API-only
 * generation) so the managed premium shows up naturally in the totals.
 */
export function calculate(inputs: CalcInputs, priceBook: PriceBook): CalcResult {
  if (inputs.ragMode === "B") {
    const effectiveInputs: CalcInputs = {
      ...inputs,
      vectorStore: {
        ...inputs.vectorStore,
        indexingAlgo: "hnsw",
        replicas: Math.max(2, inputs.vectorStore.replicas),
      },
      generation: {
        ...inputs.generation,
        mode: "api",
      },
    };
    return computeForMode(effectiveInputs, priceBook, "B");
  }
  return computeForMode(inputs, priceBook, "A");
}

// ---------------------------------------------------------------------------
// defaultInputs()
// ---------------------------------------------------------------------------

/** Sensible engineer defaults derived from the priceBook. */
export function defaultInputs(priceBook: PriceBook): CalcInputs {
  const embedModel = priceBook.models.find((model) => model.kind === "embedding");
  const llmModel = priceBook.models.find((model) => model.kind === "llm");
  const rerankModel = priceBook.models.find((model) => model.kind === "rerank");
  const guardrailModel = priceBook.models.find((model) => model.kind === "guardrail");
  const gpu = priceBook.gpus[0];

  if (!embedModel || !llmModel || !gpu) {
    throw new Error("defaultInputs: priceBook is missing a required embedding model, llm model, or gpu instance");
  }

  const chunkSize = 512;

  return {
    ragMode: "A",
    corpus: {
      numDocs: 10000,
      avgTokensPerDoc: 800,
      refreshCadence: "monthly",
    },
    chunking: {
      chunkSize,
      overlapFraction: 0.1,
      embedModelId: embedModel.id,
      embedDim: embedModel.dim ?? 1024,
      embedPricePer1K: embedModel.inPricePer1K,
    },
    vectorStore: {
      indexingAlgo: "hnsw",
      m: 16,
      replicas: 1,
      pqCompression: 32,
      minOCU: priceBook.opensearch.minOCU,
      ocuPricePerHr: priceBook.opensearch.ocuPricePerHr,
      storagePricePerGBmo: priceBook.opensearch.storagePricePerGBmo,
      gbRamPerOcu: priceBook.opensearch.gbRamPerOcu,
      indexingOCUhrs: 10,
      qpsPerOcu: 2,
    },
    retrieval: {
      topK: 20,
      rerankEnabled: !!rerankModel,
      rerankModelId: rerankModel?.id ?? "",
      rerankPricePer1K: rerankModel?.inPricePer1K ?? 0,
      topN: 5,
    },
    guardrails: {
      inputEnabled: false,
      outputEnabled: false,
      inputPricePer1KUnits: guardrailModel?.inPricePer1K ?? 0,
      outputPricePer1KUnits: guardrailModel?.inPricePer1K ?? 0,
      charsPerTextUnit: 400, // Bedrock content-filter / denied-topics / PII text-unit size
      charsPerToken: 4,
    },
    generation: {
      mode: "api",
      llmModelId: llmModel.id,
      llmInPricePer1K: llmModel.inPricePer1K,
      llmOutPricePer1K: llmModel.outPricePer1K,
      outTokens: 500,
      promptOverhead: 300,
      gpuInstanceType: gpu.instanceType,
      gpuPricePerHr: gpu.pricePerHr,
      gpuPricingModel: "on-demand",
      gpuUptimeHoursPerMonth: 730,
      sustainedTokPerSec: gpu.sustainedTokPerSec,
      utilTarget: 0.7,
      numInstances: 1,
      weightBits: 16,
      apiComparisonModelId: llmModel.id,
      apiComparisonInPricePer1K: llmModel.inPricePer1K,
      apiComparisonOutPricePer1K: llmModel.outPricePer1K,
      maxContextLen: 8192,
      maxConcurrentSeqs: 16,
      interactivityTarget: 30,
    },
    managedKb: {
      retrievalMode: "standard",
      underlyingRetrievalsPerCall: 2,
      // Raw indexed data size; default is a text estimate (~4 B/token) — raise
      // it for multimodal (PDFs/images) which dominate storage.
      indexedDataGB: Math.max(1, Math.round((10000 * 800 * 4) / 1e9)),
    },
    ops: {
      networkingMonthly$: 0,
      observabilityMonthly$: 0,
      overheadPct: 0,
    },
    traffic: {
      queriesPerMonth: 100000,
      region: priceBook.region,
      method: "monthly",
      qps: 1,
      hoursPerDay: 24,
      daysPerMonth: 30,
      peakFactor: 1,
    },
    queryTokens: 50,
  };
}
