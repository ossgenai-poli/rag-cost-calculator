// Live AWS pricing route — fetches EC2 GPU + OpenSearch Serverless prices from
// the AWS Price List Query API and merges in the typed model-prices config.
// Guarded end-to-end: any AWS/network/parse failure returns the same
// GPU_DEFAULTS + OPENSEARCH_DEFAULTS + MODEL_PRICES fallback used by
// scripts/refresh-prices.mjs, so this route never throws and the static
// build (which has no AWS creds) never breaks.
//
// force-static + revalidate keep this route compatible with `output: 'export'`
// builds — Next.js treats it as a build-time-generated static response.
export const dynamic = "force-static";
export const revalidate = 3600;

import { PricingClient, GetProductsCommand } from "@aws-sdk/client-pricing";
import type { PriceBook, GpuInstancePrice, OpenSearchPrice } from "@/lib/types";
import { MODEL_PRICES, OPENSEARCH_DEFAULTS, GPU_DEFAULTS, MANAGED_KB_PRICING } from "@/lib/model-prices";
import { priceBookSchema } from "@/lib/prices";

const REGION = process.env.AWS_REGION || "us-east-1";

// AWS Price List Query API only runs out of us-east-1 / ap-south-1 endpoints
// and addresses regions by human-readable "location", not region code.
const EC2_LOCATION_BY_REGION: Record<string, string> = {
  "us-east-1": "US East (N. Virginia)",
  "us-east-2": "US East (Ohio)",
  "us-west-1": "US West (N. California)",
  "us-west-2": "US West (Oregon)",
};

function ec2Location(region: string): string {
  return EC2_LOCATION_BY_REGION[region] || EC2_LOCATION_BY_REGION["us-east-1"];
}

/**
 * Extract the first positive OnDemand USD price-per-unit from a Price List
 * entry. The AWS SDK returns entries as LazyJsonString objects (NOT plain
 * strings), so we coerce with String() rather than checking typeof, and we
 * scan every term/dimension instead of assuming the first one.
 */
function extractOnDemandUsd(entry: unknown): number | null {
  try {
    const parsed = JSON.parse(typeof entry === "string" ? entry : String(entry));
    const onDemand = parsed?.terms?.OnDemand;
    if (!onDemand) return null;
    for (const term of Object.values(onDemand) as any[]) {
      const dims = term?.priceDimensions;
      if (!dims) continue;
      for (const dim of Object.values(dims) as any[]) {
        const usd = dim?.pricePerUnit?.USD;
        const n = usd != null ? Number(usd) : NaN;
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Resilient: fetch each GPU independently. An instance type that has no
// OnDemand SKU (e.g. newest GPUs sold only via Capacity Blocks) keeps its
// catalog default price instead of discarding the whole set. Returns which
// instances resolved live so the caller can mark `source` accurately.
async function fetchGpuPrices(
  client: PricingClient
): Promise<{ gpus: GpuInstancePrice[]; liveCount: number }> {
  const location = ec2Location(REGION);
  const results: GpuInstancePrice[] = [];
  let liveCount = 0;

  // Fetch each GPU independently. An instance type with no OnDemand SKU in this
  // region (e.g. p5e.48xlarge, which AWS sells only via Capacity Blocks / other
  // regions) keeps its catalog default rather than discarding the whole set.
  for (const gpu of GPU_DEFAULTS) {
    try {
      const command = new GetProductsCommand({
        ServiceCode: "AmazonEC2",
        Filters: [
          { Type: "TERM_MATCH", Field: "instanceType", Value: gpu.instanceType },
          { Type: "TERM_MATCH", Field: "tenancy", Value: "Shared" },
          { Type: "TERM_MATCH", Field: "operatingSystem", Value: "Linux" },
          { Type: "TERM_MATCH", Field: "capacitystatus", Value: "Used" },
          { Type: "TERM_MATCH", Field: "preInstalledSw", Value: "NA" },
          { Type: "TERM_MATCH", Field: "location", Value: location },
        ],
        MaxResults: 5,
      });
      const res = await client.send(command);
      let usd: number | null = null;
      for (const entry of res.PriceList ?? []) {
        usd = extractOnDemandUsd(entry);
        if (usd !== null) break;
      }
      if (usd !== null) {
        // sustainedTokPerSec isn't in the Pricing API — merged in from defaults.
        results.push({ ...gpu, pricePerHr: usd });
        liveCount++;
      } else {
        results.push({ ...gpu }); // no OnDemand SKU here — keep default
      }
    } catch {
      results.push({ ...gpu }); // transient error for this instance — keep default
    }
  }

  return { gpus: results, liveCount };
}

async function fetchOpenSearchPrices(client: PricingClient): Promise<OpenSearchPrice> {
  // OpenSearch Serverless (OCU-based) pricing is published under the AmazonES
  // service code in the Price List API, NOT "AmazonOpenSearchServerless" (which
  // returns zero products). OCU usagetypes: USE1-SemanticSearchOCU / -IndexingOCU
  // (both $0.24/hr in us-east-1). We take OCU live and keep the catalog storage
  // default: the only serverless storage SKU present is priced per byte-hour
  // (OpenSearch-Vectors-TimedStorage-ByteHrs), not per GB-month, so trusting it
  // as storagePricePerGBmo would be a wrong-unit regression.
  const command = new GetProductsCommand({
    ServiceCode: "AmazonES",
    Filters: [{ Type: "TERM_MATCH", Field: "regionCode", Value: REGION }],
    MaxResults: 100,
  });
  const res = await client.send(command);

  let ocuPricePerHr: number | null = null;
  for (const entry of res.PriceList ?? []) {
    // Entries are LazyJsonString objects — coerce with String(), don't typeof-filter.
    let parsed: any;
    try {
      parsed = JSON.parse(typeof entry === "string" ? entry : String(entry));
    } catch {
      continue;
    }
    const usagetype: string = parsed?.product?.attributes?.usagetype || "";
    if (!/OCU/i.test(usagetype)) continue;
    const price = extractOnDemandUsd(entry);
    if (price !== null) {
      ocuPricePerHr = price;
      break;
    }
  }

  if (ocuPricePerHr === null) {
    throw new Error("could not resolve OpenSearch Serverless OCU price");
  }

  return {
    ocuPricePerHr,
    storagePricePerGBmo: OPENSEARCH_DEFAULTS.storagePricePerGBmo, // stable; no GB-mo SKU exposed
    gbRamPerOcu: OPENSEARCH_DEFAULTS.gbRamPerOcu,
    minOCU: OPENSEARCH_DEFAULTS.minOCU,
  };
}

function fallbackPriceBook(): PriceBook {
  return {
    updatedAt: new Date().toISOString(),
    source: "fallback",
    region: REGION,
    gpus: GPU_DEFAULTS,
    opensearch: OPENSEARCH_DEFAULTS,
    managedKb: MANAGED_KB_PRICING,
    models: MODEL_PRICES,
  };
}

export async function GET() {
  // Fetch GPU and OpenSearch prices INDEPENDENTLY. A failure in one must not
  // discard the other (GPU prices are the volatile ones and matter most).
  // `source` is "live" if we obtained ANY live data, else "fallback".
  let gpus: GpuInstancePrice[] = GPU_DEFAULTS;
  let opensearch: OpenSearchPrice = OPENSEARCH_DEFAULTS;
  let gotLive = false;

  try {
    const client = new PricingClient({ region: "us-east-1" });

    try {
      const gpuResult = await fetchGpuPrices(client);
      gpus = gpuResult.gpus;
      if (gpuResult.liveCount > 0) gotLive = true; // live if ANY instance resolved
    } catch {
      gpus = GPU_DEFAULTS; // keep accurate defaults for GPU
    }

    try {
      opensearch = await fetchOpenSearchPrices(client);
      gotLive = true;
    } catch {
      opensearch = OPENSEARCH_DEFAULTS; // OCU/storage price is stable — default is fine
    }
  } catch {
    // client construction / no-creds (e.g. static build) -> full fallback
  }

  const priceBook: PriceBook = {
    updatedAt: new Date().toISOString(),
    source: gotLive ? "live" : "fallback",
    region: REGION,
    gpus,
    opensearch,
    managedKb: MANAGED_KB_PRICING,
    models: MODEL_PRICES,
  };

  try {
    return Response.json(priceBookSchema.parse(priceBook));
  } catch {
    return Response.json(priceBookSchema.parse(fallbackPriceBook()));
  }
}
