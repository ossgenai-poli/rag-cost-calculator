#!/usr/bin/env node
// Standalone refresh script — no Next.js runtime, no TypeScript. Run headless:
//   node scripts/refresh-prices.mjs
// Fetches live EC2 GPU + OpenSearch Serverless prices from the AWS Price List
// Query API (creds via AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION env
// vars), falls back to hardcoded defaults on any error, merges in the model
// price config, and writes the committed public/prices.json fallback file.
// Always exits 0 — even total AWS failure must still produce a valid file.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PricingClient, GetProductsCommand } from "@aws-sdk/client-pricing";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "public", "prices.json");

const REGION = process.env.AWS_REGION || "us-east-1";

// Keep this array in sync with lib/model-prices.ts MODEL_PRICES. Duplicated
// here because this script is plain Node/ESM and can't import a .ts file.
const MODEL_PRICES = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (Bedrock)", provider: "bedrock", bedrock: true, kind: "llm", inPricePer1K: 0.015, outPricePer1K: 0.075, verifiedAt: "2026-07-10" },
  { id: "claude-sonnet-4", label: "Claude Sonnet 4 (Bedrock)", provider: "bedrock", bedrock: true, kind: "llm", inPricePer1K: 0.003, outPricePer1K: 0.015, verifiedAt: "2026-07-10" },
  { id: "qwen2.5-72b-bedrock", label: "Qwen2.5-72B (Bedrock)", provider: "bedrock", bedrock: true, kind: "llm", inPricePer1K: 0.0009, outPricePer1K: 0.0009, verifiedAt: "2026-07-10" },
  { id: "deepseek-r1-bedrock", label: "DeepSeek-R1 (Bedrock)", provider: "bedrock", bedrock: true, kind: "llm", inPricePer1K: 0.00135, outPricePer1K: 0.0054, verifiedAt: "2026-07-10" },
  { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro (non-Bedrock)", provider: "gemini", bedrock: false, kind: "llm", inPricePer1K: 0.002, outPricePer1K: 0.012, verifiedAt: "2026-07-10" },
  { id: "grok-4.20", label: "Grok 4.20 (non-Bedrock)", provider: "grok", bedrock: false, kind: "llm", inPricePer1K: 0.002, outPricePer1K: 0.006, verifiedAt: "2026-07-10" },
  { id: "gpt-5.2", label: "GPT-5.2 (non-Bedrock)", provider: "openai", bedrock: false, kind: "llm", inPricePer1K: 0.00175, outPricePer1K: 0.014, verifiedAt: "2026-07-10" },
  { id: "titan-embed-v2", label: "Titan Text Embeddings V2 (Bedrock)", provider: "bedrock", bedrock: true, kind: "embedding", inPricePer1K: 0.00002, outPricePer1K: 0, dim: 1024, verifiedAt: "2026-07-10" },
  { id: "cohere-embed-v3", label: "Cohere Embed English V3 (Bedrock)", provider: "bedrock", bedrock: true, kind: "embedding", inPricePer1K: 0.0001, outPricePer1K: 0, dim: 1024, verifiedAt: "2026-07-10" },
  { id: "cohere-rerank-v3", label: "Cohere Rerank V3 (Bedrock)", provider: "bedrock", bedrock: true, kind: "rerank", inPricePer1K: 0.001, outPricePer1K: 0, verifiedAt: "2026-07-10" },
  { id: "bedrock-guardrails", label: "Bedrock Guardrails", provider: "bedrock", bedrock: true, kind: "guardrail", inPricePer1K: 0.00075, outPricePer1K: 0, verifiedAt: "2026-07-10" },
];

// Keep in sync with lib/model-prices.ts GPU_DEFAULTS / OPENSEARCH_DEFAULTS.
const GPU_DEFAULTS = [
  { instanceType: "p5.48xlarge", gpu: "8x H100", pricePerHr: 55.04, sustainedTokPerSec: 2600 },
  { instanceType: "p5e.48xlarge", gpu: "8x H200", pricePerHr: 47.76, sustainedTokPerSec: 3000 },
  { instanceType: "p4d.24xlarge", gpu: "8x A100", pricePerHr: 32.77, sustainedTokPerSec: 1500 },
  { instanceType: "g5.12xlarge", gpu: "4x A10G", pricePerHr: 5.672, sustainedTokPerSec: 350 },
];

const OPENSEARCH_DEFAULTS = {
  ocuPricePerHr: 0.24,
  storagePricePerGBmo: 0.024,
  gbRamPerOcu: 6,
  minOCU: 2,
};

const EC2_LOCATION_BY_REGION = {
  "us-east-1": "US East (N. Virginia)",
  "us-east-2": "US East (Ohio)",
  "us-west-1": "US West (N. California)",
  "us-west-2": "US West (Oregon)",
};

function ec2Location(region) {
  return EC2_LOCATION_BY_REGION[region] || EC2_LOCATION_BY_REGION["us-east-1"];
}

function extractOnDemandUsd(priceListJson) {
  try {
    const parsed = JSON.parse(priceListJson);
    const onDemand = parsed?.terms?.OnDemand;
    if (!onDemand) return null;
    const term = Object.values(onDemand)[0];
    const priceDimensions = term?.priceDimensions;
    if (!priceDimensions) return null;
    const dimension = Object.values(priceDimensions)[0];
    const usd = dimension?.pricePerUnit?.USD;
    if (usd === undefined) return null;
    const n = Number(usd);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function fetchGpuPrices(client) {
  const location = ec2Location(REGION);
  const results = [];
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
    const entry = res.PriceList?.[0];
    const usd = typeof entry === "string" ? extractOnDemandUsd(entry) : null;
    if (usd === null) throw new Error(`no OnDemand price for ${gpu.instanceType}`);
    results.push({ ...gpu, pricePerHr: usd });
  }
  return results;
}

async function fetchOpenSearchPrices(client) {
  const command = new GetProductsCommand({
    ServiceCode: "AmazonOpenSearchServerless",
    Filters: [{ Type: "TERM_MATCH", Field: "regionCode", Value: REGION }],
    MaxResults: 100,
  });
  const res = await client.send(command);
  const entries = (res.PriceList || []).filter((e) => typeof e === "string");

  let ocuPricePerHr = null;
  let storagePricePerGBmo = null;
  for (const entry of entries) {
    const parsed = JSON.parse(entry);
    const usagetype = parsed?.product?.attributes?.usagetype || "";
    const price = extractOnDemandUsd(entry);
    if (price === null) continue;
    if (/OCU/i.test(usagetype) && ocuPricePerHr === null) ocuPricePerHr = price;
    if (/Storage/i.test(usagetype) && storagePricePerGBmo === null) storagePricePerGBmo = price;
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

async function main() {
  let gpus = GPU_DEFAULTS;
  let opensearch = OPENSEARCH_DEFAULTS;

  try {
    const client = new PricingClient({ region: "us-east-1" });
    const [liveGpus, liveOpensearch] = await Promise.all([
      fetchGpuPrices(client),
      fetchOpenSearchPrices(client),
    ]);
    gpus = liveGpus;
    opensearch = liveOpensearch;
    console.log("Fetched live EC2 GPU + OpenSearch Serverless prices from AWS Pricing API.");
  } catch (err) {
    console.log(`AWS fetch failed, using defaults: ${err.message}`);
  }

  const priceBook = {
    updatedAt: new Date().toISOString(),
    source: "fallback",
    region: REGION,
    gpus,
    opensearch,
    models: MODEL_PRICES,
  };

  await writeFile(OUT_PATH, JSON.stringify(priceBook, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT_PATH}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Unexpected refresh-prices failure (writing nothing):", err);
    process.exit(0);
  });
