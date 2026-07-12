// Typed model price config — the source of truth the refresh script and the
// live pricing route fall back to when the AWS Price List API is unreachable
// (models, embeddings, rerank, and guardrails aren't in the Pricing API at all).
//
// Verified against, 2026-07-10:
//   - Bedrock model pricing:  https://aws.amazon.com/bedrock/pricing/
//   - Gemini API pricing:     https://ai.google.dev/gemini-api/docs/pricing
//   - xAI Grok API pricing:   https://x.ai/api#pricing
//   - OpenAI API pricing:     https://openai.com/api/pricing/
//
// Prices are USD per 1K tokens (vendor pages quote per-1M; divide by 1000).
import type { ModelPrice, OpenSearchPrice, GpuInstancePrice } from "./types";

const VERIFIED_AT = "2026-07-10";

export const MODEL_PRICES: ModelPrice[] = [
  // ---- Bedrock LLMs ----
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8 (Bedrock)",
    provider: "bedrock",
    bedrock: true,
    kind: "llm",
    inPricePer1K: 0.015,
    outPricePer1K: 0.075,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "claude-sonnet-4",
    label: "Claude Sonnet 4 (Bedrock)",
    provider: "bedrock",
    bedrock: true,
    kind: "llm",
    inPricePer1K: 0.003,
    outPricePer1K: 0.015,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "qwen2.5-72b-bedrock",
    label: "Qwen2.5-72B (Bedrock)",
    provider: "bedrock",
    bedrock: true,
    kind: "llm",
    inPricePer1K: 0.0009,
    outPricePer1K: 0.0009,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "deepseek-r1-bedrock",
    label: "DeepSeek-R1 (Bedrock)",
    provider: "bedrock",
    bedrock: true,
    kind: "llm",
    inPricePer1K: 0.00135,
    outPricePer1K: 0.0054,
    verifiedAt: VERIFIED_AT,
  },
  // ---- non-Bedrock LLMs (direct vendor API, egress applies) ----
  {
    id: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro (non-Bedrock)",
    provider: "gemini",
    bedrock: false,
    kind: "llm",
    inPricePer1K: 0.002,
    outPricePer1K: 0.012,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "grok-4.20",
    label: "Grok 4.20 (non-Bedrock)",
    provider: "grok",
    bedrock: false,
    kind: "llm",
    inPricePer1K: 0.002,
    outPricePer1K: 0.006,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "gpt-5.2",
    label: "GPT-5.2 (non-Bedrock)",
    provider: "openai",
    bedrock: false,
    kind: "llm",
    inPricePer1K: 0.00175,
    outPricePer1K: 0.014,
    verifiedAt: VERIFIED_AT,
  },
  // ---- Bedrock embeddings ----
  {
    id: "titan-embed-v2",
    label: "Titan Text Embeddings V2 (Bedrock)",
    provider: "bedrock",
    bedrock: true,
    kind: "embedding",
    inPricePer1K: 0.00002,
    outPricePer1K: 0,
    dim: 1024,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "cohere-embed-v3",
    label: "Cohere Embed English V3 (Bedrock)",
    provider: "bedrock",
    bedrock: true,
    kind: "embedding",
    inPricePer1K: 0.0001,
    outPricePer1K: 0,
    dim: 1024,
    verifiedAt: VERIFIED_AT,
  },
  // ---- Bedrock rerank ----
  {
    id: "cohere-rerank-v3",
    label: "Cohere Rerank V3 (Bedrock)",
    provider: "bedrock",
    bedrock: true,
    kind: "rerank",
    inPricePer1K: 0.001,
    outPricePer1K: 0,
    verifiedAt: VERIFIED_AT,
  },
  // ---- Bedrock guardrails ----
  {
    id: "bedrock-guardrails",
    label: "Bedrock Guardrails",
    provider: "bedrock",
    bedrock: true,
    kind: "guardrail",
    // $ per 1,000 text units (1 text unit ≈ 1000 chars). ~$0.75/1K units.
    inPricePer1K: 0.75,
    outPricePer1K: 0,
    verifiedAt: VERIFIED_AT,
  },
];

// OpenSearch Serverless defaults (us-east-1), used as the fallback when the
// live Price List API call for AmazonOpenSearchServerless fails.
export const OPENSEARCH_DEFAULTS: OpenSearchPrice = {
  ocuPricePerHr: 0.24,
  storagePricePerGBmo: 0.024,
  gbRamPerOcu: 6,
  minOCU: 2,
};

// EC2 GPU instance defaults (us-east-1, on-demand). sustainedTokPerSec is a
// rough estimate for a 70B-class model and is never available from the
// Pricing API, so it's always merged in from here even on a "live" fetch.
export const GPU_DEFAULTS: GpuInstancePrice[] = [
  { instanceType: "p5.48xlarge", gpu: "8x H100", pricePerHr: 55.04, sustainedTokPerSec: 2600 },
  { instanceType: "p5e.48xlarge", gpu: "8x H200", pricePerHr: 47.76, sustainedTokPerSec: 3000 },
  { instanceType: "p4d.24xlarge", gpu: "8x A100", pricePerHr: 32.77, sustainedTokPerSec: 1500 },
  { instanceType: "g5.12xlarge", gpu: "4x A10G", pricePerHr: 5.672, sustainedTokPerSec: 350 },
];
