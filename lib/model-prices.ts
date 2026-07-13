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
  // ---- API mode: Bedrock-only LLMs ----
  {
    id: "claude-fable-5",
    label: "Claude Fable 5 (Bedrock)",
    provider: "bedrock",
    bedrock: true,
    kind: "llm",
    inPricePer1K: 0.006,
    outPricePer1K: 0.03,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "gpt-5.5-bedrock",
    label: "OpenAI GPT-5.5 (Bedrock)",
    provider: "openai",
    bedrock: true,
    kind: "llm",
    inPricePer1K: 0.002,
    outPricePer1K: 0.016,
    verifiedAt: VERIFIED_AT,
  },
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
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6 (Bedrock)",
    provider: "bedrock",
    bedrock: true,
    kind: "llm",
    inPricePer1K: 0.003,
    outPricePer1K: 0.015,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "gpt-5.4-bedrock",
    label: "OpenAI GPT-5.4 (Bedrock)",
    provider: "openai",
    bedrock: true,
    kind: "llm",
    inPricePer1K: 0.00175,
    outPricePer1K: 0.014,
    verifiedAt: VERIFIED_AT,
  },
  // ---- Self-hosted mode: open-weight LLMs ----
  // inPrice/outPrice are representative hosted (serving-provider) prices used as
  // the API baseline in the crossover; paramsB drives self-host GPU sizing.
  {
    id: "glm-5.2-oss",
    label: "GLM-5.2 (open weights)",
    provider: "oss",
    bedrock: false,
    kind: "llm",
    selfHostable: true,
    paramsB: 400,
    // GQA, ~92 layers × 8 KV heads × 128 head_dim × 2 (K+V) × 2 B = 376,832 B/tok
    kvBytesPerToken: 376832,
    attentionType: "GQA",
    inPricePer1K: 0.0006,
    outPricePer1K: 0.0022,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "nemotron-3-ultra-oss",
    label: "NVIDIA Nemotron 3 Ultra 550B-A55B (open weights)",
    provider: "oss",
    bedrock: false,
    kind: "llm",
    selfHostable: true,
    paramsB: 550,
    // Hybrid Mamba: ~8% attention layers (~10 of ~120) × 2 KV heads × 128 × 2 × 2 B
    kvBytesPerToken: 10240,
    attentionType: "hybrid (Mamba)",
    inPricePer1K: 0.001,
    outPricePer1K: 0.003,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "minimax-m3-oss",
    label: "MiniMax M3 (open weights)",
    provider: "oss",
    bedrock: false,
    kind: "llm",
    selfHostable: true,
    paramsB: 480,
    // Hybrid lightning: ~1/8 softmax-attention layers (~10 of ~80) × 8 KV × 128 × 2 × 2 B
    kvBytesPerToken: 40960,
    attentionType: "hybrid (lightning)",
    inPricePer1K: 0.0003,
    outPricePer1K: 0.0011,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "deepseek-v4-pro-oss",
    label: "DeepSeek-V4-Pro (open weights)",
    provider: "oss",
    bedrock: false,
    kind: "llm",
    selfHostable: true,
    paramsB: 720,
    // MLA: ~61 layers × (kv_lora 512 + rope 64) × 2 B = 70,272 B/tok (compressed latent)
    kvBytesPerToken: 70272,
    attentionType: "MLA",
    inPricePer1K: 0.0006,
    outPricePer1K: 0.0024,
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "kimi-k2.6-oss",
    label: "Kimi K2.6 (open weights)",
    provider: "oss",
    bedrock: false,
    kind: "llm",
    selfHostable: true,
    paramsB: 1000,
    // MLA (DeepSeek-arch): ~61 layers × (512 + 64) × 2 B = 70,272 B/tok
    kvBytesPerToken: 70272,
    attentionType: "MLA",
    inPricePer1K: 0.0006,
    outPricePer1K: 0.0025,
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
    // $ per 1,000 rerank REQUESTS (one request per query, up to ~100 docs each).
    inPricePer1K: 2.0,
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
// High-end only — P5 (Hopper) and P6 (Blackwell). Lower-tier instances don't
// make sense for the 300B–1T-class models this tool targets.
export const GPU_DEFAULTS: GpuInstancePrice[] = [
  { instanceType: "p5.48xlarge", gpu: "8x H100 80GB", pricePerHr: 55.04, sustainedTokPerSec: 2600, totalMemGB: 640 },
  { instanceType: "p5e.48xlarge", gpu: "8x H200 141GB", pricePerHr: 63.29, sustainedTokPerSec: 3000, totalMemGB: 1128 },
  { instanceType: "p6-b200.48xlarge", gpu: "8x B200 192GB", pricePerHr: 113.0, sustainedTokPerSec: 5200, totalMemGB: 1536 },
];
