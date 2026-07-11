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
import { MODEL_PRICES, OPENSEARCH_DEFAULTS, GPU_DEFAULTS } from "@/lib/model-prices";
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

/** Extract the OnDemand USD price-per-unit from a raw Price List JSON string. */
function extractOnDemandUsd(priceListJson: string): number | null {
  try {
    const parsed = JSON.parse(priceListJson);
    const onDemand = parsed?.terms?.OnDemand;
    if (!onDemand) return null;
    const term = Object.values(onDemand)[0] as any;
    const priceDimensions = term?.priceDimensions;
    if (!priceDimensions) return null;
    const dimension = Object.values(priceDimensions)[0] as any;
    const usd = dimension?.pricePerUnit?.USD;
    if (usd === undefined) return null;
    const n = Number(usd);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function fetchGpuPrices(client: PricingClient): Promise<GpuInstancePrice[]> {
  const location = ec2Location(REGION);
  const results: GpuInstancePrice[] = [];

  for (const gpu of GPU_DEFAULTS) {
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
    const priceListEntry = res.PriceList?.[0];
    const usd = typeof priceListEntry === "string" ? extractOnDemandUsd(priceListEntry) : null;
    if (usd === null) throw new Error(`no OnDemand price for ${gpu.instanceType}`);
    // sustainedTokPerSec isn't in the Pricing API — merged in from defaults.
    results.push({ ...gpu, pricePerHr: usd });
  }

  return results;
}

async function fetchOpenSearchPrices(client: PricingClient): Promise<OpenSearchPrice> {
  const command = new GetProductsCommand({
    ServiceCode: "AmazonOpenSearchServerless",
    Filters: [{ Type: "TERM_MATCH", Field: "regionCode", Value: REGION }],
    MaxResults: 100,
  });
  const res = await client.send(command);
  const entries = (res.PriceList || []).filter((e: unknown): e is string => typeof e === "string");

  let ocuPricePerHr: number | null = null;
  let storagePricePerGBmo: number | null = null;

  for (const entry of entries) {
    const parsed = JSON.parse(entry);
    const usagetype: string = parsed?.product?.attributes?.usagetype || "";
    const price = extractOnDemandUsd(entry);
    if (price === null) continue;
    // OCU compute appears as usagetypes like "...OCU-IndexingHours" / "SearchOCU".
    if (/OCU|ComputeUnit/i.test(usagetype) && ocuPricePerHr === null) ocuPricePerHr = price;
    if (/Storage|GB-Mo|GB-Month/i.test(usagetype) && storagePricePerGBmo === null) storagePricePerGBmo = price;
  }

  if (ocuPricePerHr === null || storagePricePerGBmo === null) {
    throw new Error("could not resolve OpenSearch Serverless OCU/storage price");
  }

  return {
    ocuPricePerHr,
    storagePricePerGBmo,
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
      gpus = await fetchGpuPrices(client);
      gotLive = true;
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
    models: MODEL_PRICES,
  };

  try {
    return Response.json(priceBookSchema.parse(priceBook));
  } catch {
    return Response.json(priceBookSchema.parse(fallbackPriceBook()));
  }
}
