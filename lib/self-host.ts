// ============================================================================
// self-host — GPU memory sizing for running open-weight models on your own
// hardware. A model only "fits" if the aggregate GPU HBM across the requested
// instances can hold its weights (+ KV cache / activation overhead). This is
// the hard floor on how many GPU boxes you need, independent of throughput.
// ============================================================================

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
 * cache per token (summed over attention layers); KV precision follows the
 * weight precision (FP8 weights => FP8 KV), so we scale by weightBits/16.
 * Returns 0 when the model's KV shape or serving shape is unknown/zero.
 */
export function kvCacheGB(
  kvBytesPerToken = 0,
  weightBits = 16,
  ctxLen = 0,
  concurrency = 0
): number {
  if (!(kvBytesPerToken > 0) || !(ctxLen > 0) || !(concurrency > 0)) return 0;
  const kvPrecisionScale = (weightBits > 0 ? weightBits : 16) / 16;
  return (kvBytesPerToken * kvPrecisionScale * ctxLen * concurrency) / 1e9;
}

/** Full serving memory in GB: (weights + KV cache) × runtime reserve. */
export function serviceMemoryGB(
  paramsB: number,
  weightBits = 16,
  kvBytesPerToken = 0,
  ctxLen = 0,
  concurrency = 0
): number {
  const weights = modelWeightsGB(paramsB, weightBits);
  const kv = kvCacheGB(kvBytesPerToken, weightBits, ctxLen, concurrency);
  return (weights + kv) * RUNTIME_RESERVE;
}

/**
 * Minimum number of GPU instances required to load + serve the model, given each
 * instance's aggregate HBM. Accounts for weight precision and KV cache. Returns
 * 1 when inputs are unknown/zero so it never lowers a throughput-derived count.
 */
export function instancesToLoad(
  paramsB: number | undefined,
  instanceTotalMemGB: number,
  weightBits = 16,
  kvBytesPerToken = 0,
  ctxLen = 0,
  concurrency = 0
): number {
  if (!paramsB || paramsB <= 0 || !(instanceTotalMemGB > 0)) return 1;
  const mem = serviceMemoryGB(paramsB, weightBits, kvBytesPerToken, ctxLen, concurrency);
  return Math.max(1, Math.ceil(mem / instanceTotalMemGB));
}
