// ============================================================================
// share — serialize/deserialize the full parameter set to a shareable URL and
// export helpers (CSV breakdown, JSON assumptions). A URL that round-trips
// every lever is the feature architecture reviews and customer calls actually
// want. Pure string helpers here; the DOM download trigger is guarded so this
// module stays importable in tests.
// ============================================================================

import { z } from "zod";
import type { CalcInputs, CalcResult, PriceBook } from "./types";
import { deriveDisplayMetrics } from "./derived";

const PARAM_KEY = "s";
const SHARE_VERSION = 1;

// ---------------------------------------------------------------------------
// Zod schema for CalcInputs. Guards against NaN/negative/garbage from a crafted
// or stale link. Fields added after v1 are optional-with-default so older
// shared links keep decoding and get upgraded silently.
// ---------------------------------------------------------------------------

const num = z.number().finite();
const nonNeg = num.nonnegative();

const calcInputsSchema = z.object({
  ragMode: z.enum(["A", "B"]).default("A"),
  corpus: z.object({
    numDocs: nonNeg,
    avgTokensPerDoc: nonNeg,
    refreshCadence: z.enum(["one-time", "weekly", "monthly"]),
  }),
  chunking: z.object({
    chunkSize: num.positive(),
    overlapFraction: num.min(0).max(0.99),
    embedModelId: z.string(),
    embedDim: num.positive(),
    embedPricePer1K: nonNeg,
  }),
  vectorStore: z.object({
    indexingAlgo: z.enum(["hnsw", "ivf_pq", "ivf_fp16"]),
    m: nonNeg,
    replicas: num.min(1),
    pqCompression: num.positive(),
    minOCU: nonNeg,
    ocuPricePerHr: nonNeg,
    storagePricePerGBmo: nonNeg,
    gbRamPerOcu: num.positive(),
    indexingOCUhrs: nonNeg,
    qpsPerOcu: num.positive().default(2),
  }),
  retrieval: z.object({
    topK: num.positive(),
    rerankEnabled: z.boolean(),
    rerankModelId: z.string(),
    rerankPricePer1K: nonNeg,
    topN: num.positive(),
  }),
  guardrails: z.object({
    inputEnabled: z.boolean(),
    outputEnabled: z.boolean(),
    unitPricePer1K: nonNeg,
    unitsPerQuery: nonNeg,
  }),
  generation: z.object({
    mode: z.enum(["api", "self-hosted"]),
    llmModelId: z.string(),
    llmInPricePer1K: nonNeg,
    llmOutPricePer1K: nonNeg,
    outTokens: nonNeg,
    promptOverhead: nonNeg,
    gpuInstanceType: z.string(),
    gpuPricePerHr: nonNeg,
    gpuPricingModel: z
      .enum(["on-demand", "reserved-1yr", "reserved-3yr", "savings-1yr", "spot"])
      .default("on-demand"),
    gpuUptimeHoursPerMonth: num.positive().default(730),
    sustainedTokPerSec: num.positive(),
    utilTarget: num.min(0.01).max(1),
    numInstances: num.min(1).default(1),
    weightBits: num.min(1).default(16),
    apiComparisonModelId: z.string().default(""),
    apiComparisonInPricePer1K: nonNeg.default(0),
    apiComparisonOutPricePer1K: nonNeg.default(0),
    maxContextLen: num.positive().default(8192),
    maxConcurrentSeqs: num.positive().default(16),
  }),
  managedKb: z
    .object({
      retrievalMode: z.enum(["standard", "agentic"]).default("standard"),
      underlyingRetrievalsPerCall: nonNeg.default(2),
      indexedDataGB: nonNeg.default(1),
    })
    .default({ retrievalMode: "standard", underlyingRetrievalsPerCall: 2, indexedDataGB: 1 }),
  traffic: z.object({
    queriesPerMonth: nonNeg,
    region: z.string(),
    method: z.enum(["monthly", "qps"]).default("monthly"),
    qps: nonNeg.default(1),
    hoursPerDay: nonNeg.default(24),
    daysPerMonth: nonNeg.default(30),
  }),
  queryTokens: nonNeg,
});

// --- base64url (unicode-safe) ------------------------------------------------

function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = typeof btoa !== "undefined" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(param: string): string {
  const b64 = param.replace(/-/g, "+").replace(/_/g, "/");
  const binary = typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// --- inputs <-> URL ----------------------------------------------------------

export function encodeInputs(inputs: CalcInputs): string {
  return toBase64Url(JSON.stringify({ v: SHARE_VERSION, i: inputs }));
}

/**
 * Parse an encoded param back to validated inputs. Returns null on any
 * malformed/invalid data (NaN, negatives, wrong shape) so a bad link falls
 * back to defaults instead of poisoning the engine. Accepts both the versioned
 * envelope and legacy raw-inputs links.
 */
export function decodeInputs(param: string | null | undefined): CalcInputs | null {
  if (!param) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(param));
    // Versioned envelope { v, i } or legacy raw inputs object.
    const candidate =
      parsed && typeof parsed === "object" && "i" in parsed ? (parsed as { i: unknown }).i : parsed;
    return coerceInputs(candidate);
  } catch {
    return null;
  }
}

/**
 * Validate + upgrade a raw inputs object (e.g. a saved scenario persisted before
 * newer fields existed) to a complete CalcInputs. Fields added after the object
 * was stored are backfilled from the schema defaults, so old saved scenarios and
 * shared links never crash the engine. Returns null if the shape is unusable.
 */
export function coerceInputs(candidate: unknown): CalcInputs | null {
  const result = calcInputsSchema.safeParse(candidate);
  return result.success ? (result.data as CalcInputs) : null;
}

/** Read encoded inputs from the current window URL, if present. */
export function readInputsFromLocation(): CalcInputs | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return decodeInputs(params.get(PARAM_KEY));
}

/** Absolute shareable URL carrying the given inputs. */
export function buildShareUrl(inputs: CalcInputs): string {
  const base =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}`
      : "";
  return `${base}?${PARAM_KEY}=${encodeInputs(inputs)}`;
}

/** Replace the URL query (no navigation / history spam) with current inputs. */
export function syncLocation(inputs: CalcInputs): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const url = `${window.location.pathname}?${PARAM_KEY}=${encodeInputs(inputs)}`;
  window.history.replaceState(null, "", url);
}

// --- exports -----------------------------------------------------------------

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of the cost breakdown plus headline metrics for the active mode. */
export function inputsToCsv(result: CalcResult, inputs: CalcInputs): string {
  const m = deriveDisplayMetrics(result, inputs);
  const rows: (string | number)[][] = [
    ["Metric", "Value"],
    ["Estimated monthly cost (USD)", m.totalMonthly.toFixed(2)],
    ["Cost per query (USD)", m.costPerQuery.toFixed(6)],
    ["Cost per 1,000 queries (USD)", m.costPer1000.toFixed(2)],
    ["Annualized cost (USD)", m.annualized.toFixed(2)],
    ["Monthly LLM tokens", Math.round(m.monthlyLlmTokens)],
    ["Monthly input tokens", Math.round(m.monthlyInputTokens)],
    ["Monthly output tokens", Math.round(m.monthlyOutputTokens)],
    ["Queries per month", inputs.traffic.queriesPerMonth],
    [],
    ["Component", "Monthly cost (USD)", "Share (%)"],
    ...m.breakdown.map((r) => [r.label, r.monthly.toFixed(2), (r.share * 100).toFixed(2)]),
  ];
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

/** Full assumptions dump: inputs + a trimmed pricing provenance record. */
export function assumptionsToJson(
  inputs: CalcInputs,
  priceBook: PriceBook,
  asOf: string
): string {
  return JSON.stringify(
    {
      exportedFor: "AWS RAG Price Calculator",
      pricing: {
        asOf,
        region: priceBook.region,
        source: priceBook.source,
        updatedAt: priceBook.updatedAt,
        models: priceBook.models.map((mo) => ({
          id: mo.id,
          label: mo.label,
          kind: mo.kind,
          inPricePer1K: mo.inPricePer1K,
          outPricePer1K: mo.outPricePer1K,
          verifiedAt: mo.verifiedAt,
        })),
        opensearch: priceBook.opensearch,
        gpus: priceBook.gpus,
      },
      inputs,
    },
    null,
    2
  );
}

/** Browser-only: trigger a file download of a text blob. No-op server-side. */
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
