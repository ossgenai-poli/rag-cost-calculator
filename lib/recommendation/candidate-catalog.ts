// Pinned, curated candidate catalog (concern B) + fail-closed validation. The catalog is loaded
// INTERNALLY by recommend() — callers never supply candidates (rev-4 trust boundary). Every entry is
// validated against the frozen engine's own data (priceBook models/gpus) + the allowed precision set +
// a canonical id + dedup; any violation fails closed. This mirrors the benchmark registry's pinned,
// validated snapshot discipline. No coverage expansion: these are exactly the configs the R1-R5
// reference cases already exercise on the frozen engine.
import type { PriceBook } from "../types";
import type { CandidateConfig } from "./schema";
import pricesJson from "../../public/prices.json";

const ALLOWED_WEIGHT_BITS = new Set([4, 8, 16]);
const ALLOWED_KV_BITS = new Set([8, 16]);

/** The single canonical id for a candidate — the only accepted `id` value (rev-2 #4). */
export function canonicalCandidateId(c: Pick<CandidateConfig, "llmModelId" | "instanceType" | "weightBits" | "kvBits">): string {
  return `${c.llmModelId}·${c.instanceType}·w${c.weightBits}kv${c.kvBits}`;
}

/** The pinned catalog. Curated dsv4 (DeepSeek-V4-Pro) infra/precision points only. */
export const PINNED_CANDIDATES: CandidateConfig[] = [
  { id: "deepseek-v4-pro-oss·p6-b200.48xlarge·w4kv16", llmModelId: "deepseek-v4-pro-oss", instanceType: "p6-b200.48xlarge", gpuSku: "B200", weightBits: 4, kvBits: 16, label: "p6-b200 · INT4" },
  { id: "deepseek-v4-pro-oss·p6-b200.48xlarge·w8kv16", llmModelId: "deepseek-v4-pro-oss", instanceType: "p6-b200.48xlarge", gpuSku: "B200", weightBits: 8, kvBits: 16, label: "p6-b200 · FP8" },
  { id: "deepseek-v4-pro-oss·p5e.48xlarge·w4kv16", llmModelId: "deepseek-v4-pro-oss", instanceType: "p5e.48xlarge", gpuSku: "H200", weightBits: 4, kvBits: 16, label: "p5e (H200) · INT4" },
  { id: "deepseek-v4-pro-oss·p5.48xlarge·w4kv16", llmModelId: "deepseek-v4-pro-oss", instanceType: "p5.48xlarge", gpuSku: "H100", weightBits: 4, kvBits: 16, label: "p5 (H100) · INT4" },
];

/** Validate a candidate catalog against the price book. Fail closed (throws) on: empty set, malformed
 *  field, unsupported model, unknown AWS instance, invalid precision, non-canonical id, or a duplicate. */
export function validateCandidateCatalog(entries: unknown, priceBook: PriceBook): CandidateConfig[] {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("candidate-catalog: empty or non-array catalog");
  const modelIds = new Set(priceBook.models.map((m) => m.id));
  const instanceTypes = new Set(priceBook.gpus.map((g) => g.instanceType));
  const seen = new Set<string>();
  const out: CandidateConfig[] = [];
  for (const raw of entries) {
    const c = raw as Partial<CandidateConfig>;
    if (typeof c.llmModelId !== "string" || !c.llmModelId) throw new Error("candidate-catalog: malformed llmModelId");
    if (typeof c.instanceType !== "string" || !c.instanceType) throw new Error("candidate-catalog: malformed instanceType");
    if (typeof c.gpuSku !== "string" || !c.gpuSku) throw new Error("candidate-catalog: malformed gpuSku");
    if (typeof c.label !== "string" || !c.label) throw new Error("candidate-catalog: malformed label");
    if (typeof c.id !== "string" || !c.id) throw new Error("candidate-catalog: malformed id");
    if (!Number.isInteger(c.weightBits) || !ALLOWED_WEIGHT_BITS.has(c.weightBits as number)) throw new Error(`candidate-catalog: invalid weightBits ${c.weightBits}`);
    if (!Number.isInteger(c.kvBits) || !ALLOWED_KV_BITS.has(c.kvBits as number)) throw new Error(`candidate-catalog: invalid kvBits ${c.kvBits}`);
    if (!modelIds.has(c.llmModelId)) throw new Error(`candidate-catalog: unsupported model ${c.llmModelId}`);
    if (!instanceTypes.has(c.instanceType)) throw new Error(`candidate-catalog: unknown AWS instance ${c.instanceType}`);
    const canonical = canonicalCandidateId(c as CandidateConfig);
    if (c.id !== canonical) throw new Error(`candidate-catalog: non-canonical id ${c.id} (expected ${canonical})`);
    if (seen.has(canonical)) throw new Error(`candidate-catalog: duplicate candidate ${canonical}`);
    seen.add(canonical);
    out.push(c as CandidateConfig);
  }
  return out;
}

/** Load the pinned, validated candidate catalog. Tests module-mock THIS to control the sweep set — the
 *  public recommend() never accepts a caller catalog. */
export function loadCandidateCatalog(): CandidateConfig[] {
  return validateCandidateCatalog(PINNED_CANDIDATES, pricesJson as unknown as PriceBook);
}
