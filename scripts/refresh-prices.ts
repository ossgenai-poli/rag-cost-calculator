#!/usr/bin/env node
// Price refresh with a SINGLE source of truth. The model/GPU CATALOG (ids,
// metadata, defaults) comes from lib/model-prices.ts — the same authoritative
// source app/api/prices imports — and ONLY the numeric GPU + OpenSearch prices
// are overlaid from the live AWS Price List API. Falls back to catalog defaults
// on any error. Never throws; always writes a valid public/prices.json.
//
// Run headless (tsx transpiles the TS import):  npm run refresh-prices
// A drift test (lib/catalog-consistency.test.ts) fails CI if the committed
// public/prices.json ever diverges from this catalog — so the nightly job can
// no longer reintroduce an obsolete catalog.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PricingClient, GetProductsCommand } from "@aws-sdk/client-pricing";
import type { GpuInstancePrice, OpenSearchPrice, PriceBook } from "../lib/types";
import {
  MODEL_PRICES,
  GPU_DEFAULTS,
  OPENSEARCH_DEFAULTS,
  MANAGED_KB_PRICING,
} from "../lib/model-prices";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "public", "prices.json");
const REGION = process.env.AWS_REGION || "us-east-1";

const EC2_LOCATION_BY_REGION: Record<string, string> = {
  "us-east-1": "US East (N. Virginia)",
  "us-east-2": "US East (Ohio)",
  "us-west-1": "US West (N. California)",
  "us-west-2": "US West (Oregon)",
};
const ec2Location = (region: string): string =>
  EC2_LOCATION_BY_REGION[region] ?? EC2_LOCATION_BY_REGION["us-east-1"];

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// AWS Price List entries are LazyJsonString objects — coerce with String().
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

// Live GPU prices overlaid onto the AUTHORITATIVE GPU_DEFAULTS catalog (which
// carries instanceType/gpu/sustainedTokPerSec/totalMemGB) — we only replace $/hr.
async function fetchGpuPrices(client: PricingClient): Promise<GpuInstancePrice[]> {
  const location = ec2Location(REGION);
  const out: GpuInstancePrice[] = [];
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
    let usd: number | null = null;
    for (const entry of res.PriceList ?? []) {
      usd = extractOnDemandUsd(entry);
      if (usd !== null) break;
    }
    if (usd === null) throw new Error(`no OnDemand price for ${gpu.instanceType}`);
    out.push({ ...gpu, pricePerHr: usd, priceSource: "live" });
  }
  return out;
}

async function fetchOpenSearchPrices(client: PricingClient): Promise<OpenSearchPrice> {
  const command = new GetProductsCommand({
    ServiceCode: "AmazonOpenSearchServerless",
    Filters: [{ Type: "TERM_MATCH", Field: "regionCode", Value: REGION }],
    MaxResults: 100,
  });
  const res = await client.send(command);
  let ocuPricePerHr: number | null = null;
  let storagePricePerGBmo: number | null = null;
  for (const entry of res.PriceList ?? []) {
    let parsed: any;
    try {
      parsed = JSON.parse(typeof entry === "string" ? entry : String(entry));
    } catch {
      continue;
    }
    const usagetype: string = parsed?.product?.attributes?.usagetype || "";
    const price = extractOnDemandUsd(entry);
    if (price === null) continue;
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

async function main(): Promise<void> {
  let gpus: GpuInstancePrice[] = GPU_DEFAULTS;
  let opensearch: OpenSearchPrice = OPENSEARCH_DEFAULTS;
  let gotLive = false;
  const client = new PricingClient({ region: "us-east-1" });

  try {
    gpus = await fetchGpuPrices(client);
    gotLive = true;
    console.log("Fetched live EC2 GPU prices.");
  } catch (err) {
    console.log(`EC2 GPU fetch failed, using catalog defaults: ${errMsg(err)}`);
  }
  try {
    opensearch = await fetchOpenSearchPrices(client);
    gotLive = true;
    console.log("Fetched live OpenSearch Serverless prices.");
  } catch (err) {
    console.log(`OpenSearch fetch failed, using catalog defaults: ${errMsg(err)}`);
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
  await writeFile(OUT_PATH, JSON.stringify(priceBook, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT_PATH} (source: ${priceBook.source}, ${MODEL_PRICES.length} models, ${gpus.length} gpus)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Unexpected refresh-prices failure (writing nothing):", err);
    process.exit(0);
  });
