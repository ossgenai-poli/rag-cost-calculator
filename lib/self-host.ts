// ============================================================================
// self-host — GPU memory sizing for running open-weight models on your own
// hardware. A model only "fits" if the aggregate GPU HBM across the requested
// instances can hold its weights (+ KV cache / activation overhead). This is
// the hard floor on how many GPU boxes you need, independent of throughput.
// ============================================================================

import type { GpuPricingModel } from "./types";

/**
 * Commitment discount off the on-demand GPU rate, by purchasing model. These are
 * typical mid-range PLANNING factors, not quotes: Reserved / Savings Plans vary
 * with term and payment option, and Spot fluctuates and is interruptible. Editing
 * the on-demand $/hr directly lets you plug in a real quote.
 */
export const GPU_COMMITMENT_DISCOUNT: Record<GpuPricingModel, number> = {
  "on-demand": 0,
  "reserved-1yr": 0.4, // Standard 1-yr Reserved Instance (locked instance type/AZ)
  "reserved-3yr": 0.6, // Standard 3-yr Reserved Instance
  "savings-1yr": 0.3, // 1-yr Compute Savings Plan — more flexible, so a smaller discount than Standard RI
  spot: 0.65,
};

/** Effective GPU $/hr after applying the commitment model's discount. */
export function effectiveGpuHourly(onDemandHourly: number, model: GpuPricingModel): number {
  const discount = GPU_COMMITMENT_DISCOUNT[model] ?? 0;
  return onDemandHourly * (1 - discount);
}

/** FP16 weights: 2 bytes/param. 1e9 params × 2 bytes = 2 GB per billion params. */
export const BYTES_PER_PARAM_FP16 = 2;
/** Runtime reserve over (weights + KV): activations, buffers, fragmentation, margin. */
export const RUNTIME_RESERVE = 1.15;

/** Bytes per parameter for a given weight precision (bits). Defaults to FP16. */
export function bytesPerParam(weightBits = 16): number {
  return (weightBits > 0 ? weightBits : 16) / 8;
}

/**
 * Rough decode-throughput speedup from lower precision (memory-bandwidth bound
 * decode benefits from smaller weights; FP8 also gets faster tensor cores).
 * These are order-of-magnitude planning factors, not benchmarks.
 */
export function precisionThroughputFactor(weightBits = 16): number {
  if (weightBits <= 4) return 1.8; // INT4 weight-only
  if (weightBits <= 8) return 1.6; // FP8 / INT8
  return 1; // BF16 / FP16 baseline
}

/** Raw weight footprint in GB at the given precision. */
export function modelWeightsGB(paramsB: number, weightBits = 16): number {
  return paramsB * bytesPerParam(weightBits);
}

/**
 * KV-cache footprint in GB. `kvBytesPerToken` is the architecture-derived FP16
 * cache per token (summed over attention layers). KV precision is INDEPENDENT of
 * weight precision (GPU-003): a model can run INT4 weights with BF16 KV. We scale
 * by kvBits/16. Returns 0 when the KV/serving shape is unknown/zero.
 */
export function kvCacheGB(
  kvBytesPerToken = 0,
  kvBits = 16,
  ctxLen = 0,
  concurrency = 0
): number {
  if (!(kvBytesPerToken > 0) || !(ctxLen > 0) || !(concurrency > 0)) return 0;
  const kvPrecisionScale = (kvBits > 0 ? kvBits : 16) / 16;
  return (kvBytesPerToken * kvPrecisionScale * ctxLen * concurrency) / 1e9;
}

/** Full serving memory in GB: (weights + KV cache) × runtime reserve. */
export function serviceMemoryGB(
  paramsB: number,
  weightBits = 16,
  kvBytesPerToken = 0,
  ctxLen = 0,
  concurrency = 0,
  kvBits = 16
): number {
  const weights = modelWeightsGB(paramsB, weightBits);
  const kv = kvCacheGB(kvBytesPerToken, kvBits, ctxLen, concurrency);
  return (weights + kv) * RUNTIME_RESERVE;
}

/**
 * Minimum number of GPU instances required to load + serve the model, given each
 * instance's aggregate HBM. Accounts for weight precision AND (independent) KV
 * precision. Returns 1 when inputs are unknown/zero so it never lowers a
 * throughput-derived count.
 */
export function instancesToLoad(
  paramsB: number | undefined,
  instanceTotalMemGB: number,
  weightBits = 16,
  kvBytesPerToken = 0,
  ctxLen = 0,
  concurrency = 0,
  kvBits = 16
): number {
  if (!paramsB || paramsB <= 0 || !(instanceTotalMemGB > 0)) return 1;
  const mem = serviceMemoryGB(paramsB, weightBits, kvBytesPerToken, ctxLen, concurrency, kvBits);
  return Math.max(1, Math.ceil(mem / instanceTotalMemGB));
}
