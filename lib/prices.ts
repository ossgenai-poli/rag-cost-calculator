// Client-side price loader. Tries the live /api/prices route first (skipped
// entirely for static-export builds, which have no server runtime), then
// falls back to the committed public/prices.json, then to an inlined
// hardcoded price book. NEVER throws — callers always get a usable PriceBook.
import { z } from "zod";
import type { LoadPricesResult, PriceBook } from "./types";
import { MODEL_PRICES, OPENSEARCH_DEFAULTS, GPU_DEFAULTS, MANAGED_KB_PRICING } from "./model-prices";

const FETCH_TIMEOUT_MS = 2000;

// ---------------------------------------------------------------------------
// Zod schema — mirrors lib/types.ts PriceBook. Reused by app/api/prices/route.ts
// so live responses are validated against the same shape as the fallback file.
// ---------------------------------------------------------------------------

const gpuInstancePriceSchema = z.object({
  instanceType: z.string(),
  gpu: z.string(),
  pricePerHr: z.number(),
  sustainedTokPerSec: z.number(),
  // Optional-with-default so a stale committed prices.json still parses; the
  // hardcoded defaults always carry a real value.
  totalMemGB: z.number().default(0),
  // PRICING-018: per-SKU provenance; default fallback (committed reference).
  priceSource: z.enum(["live", "fallback", "override"]).default("fallback"),
});

const openSearchPriceSchema = z.object({
  ocuPricePerHr: z.number(),
  storagePricePerGBmo: z.number(),
  gbRamPerOcu: z.number(),
  minOCU: z.number(),
});

const managedKbPriceSchema = z.object({
  indexStoragePerGBmo: z.number(),
  retrievePer1k: z.number(),
  agenticRetrievePer1k: z.number(),
  verifiedAt: z.string(),
});

const modelPriceSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.enum(["bedrock", "gemini", "grok", "openai", "self-hosted", "oss"]),
  bedrock: z.boolean(),
  kind: z.enum(["llm", "embedding", "rerank", "guardrail"]),
  inPricePer1K: z.number(),
  outPricePer1K: z.number(),
  dim: z.number().optional(),
  selfHostable: z.boolean().optional(),
  paramsB: z.number().optional(),
  kvBytesPerToken: z.number().optional(),
  attentionType: z.string().optional(),
  inferencexKey: z.string().optional(),
  benchmarkProvenance: z.enum(["measured", "proxy", "estimate"]).optional(),
  verifiedAt: z.string(),
});

export const priceBookSchema = z.object({
  updatedAt: z.string(),
  source: z.enum(["live", "fallback"]),
  region: z.string(),
  gpus: z.array(gpuInstancePriceSchema),
  opensearch: openSearchPriceSchema,
  // Default so a stale committed prices.json (pre-managed-KB) still parses.
  managedKb: managedKbPriceSchema.default(MANAGED_KB_PRICING),
  models: z.array(modelPriceSchema),
});

// ---------------------------------------------------------------------------
// asOf helper — human YYYY-MM-DD date derived from an ISO timestamp.
// ---------------------------------------------------------------------------

function asOfFromUpdatedAt(updatedAt: string): string {
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return updatedAt.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// Last-resort hardcoded price book, inlined from the same defaults the
// refresh script and live route fall back to. Used only if both the live API
// and the committed public/prices.json are unreachable.
function hardcodedFallback(): PriceBook {
  const updatedAt = new Date().toISOString();
  return {
    updatedAt,
    source: "fallback",
    region: "us-east-1",
    gpus: GPU_DEFAULTS,
    opensearch: OPENSEARCH_DEFAULTS,
    managedKb: MANAGED_KB_PRICING,
    models: MODEL_PRICES,
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loadCommittedFallback(): Promise<LoadPricesResult> {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const res = await fetch(`${basePath}/prices.json`);
  if (!res.ok) throw new Error(`prices.json fetch failed: ${res.status}`);
  const json = await res.json();
  const parsed = priceBookSchema.parse(json);
  const priceBook: PriceBook = { ...parsed, source: "fallback" };
  return { priceBook, stale: true, asOf: asOfFromUpdatedAt(priceBook.updatedAt) };
}

export async function loadPrices(): Promise<LoadPricesResult> {
  const isStaticExport = process.env.NEXT_PUBLIC_STATIC_EXPORT === "true";

  if (!isStaticExport) {
    try {
      const res = await fetchWithTimeout("/api/prices", FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`/api/prices fetch failed: ${res.status}`);
      const json = await res.json();
      // Respect the source the route actually reported — the route returns
      // "fallback" when AWS was unreachable, so don't mislabel it as live.
      const priceBook = priceBookSchema.parse(json);
      return {
        priceBook,
        stale: priceBook.source === "fallback",
        asOf: asOfFromUpdatedAt(priceBook.updatedAt),
      };
    } catch {
      // live route unreachable/slow/invalid — fall through to committed JSON
    }
  }

  try {
    return await loadCommittedFallback();
  } catch {
    // committed prices.json missing/unparseable — last resort
    const priceBook = hardcodedFallback();
    return { priceBook, stale: true, asOf: asOfFromUpdatedAt(priceBook.updatedAt) };
  }
}
