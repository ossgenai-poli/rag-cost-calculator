// ============================================================================
// self-host — GPU memory sizing for running open-weight models on your own
// hardware. A model only "fits" if the aggregate GPU HBM across the requested
// instances can hold its weights (+ KV cache / activation overhead). This is
// the hard floor on how many GPU boxes you need, independent of throughput.
// ============================================================================

/** FP16 weights: 2 bytes/param. 1e9 params × 2 bytes = 2 GB per billion params. */
export const BYTES_PER_PARAM_FP16 = 2;
/** Headroom for KV cache, activations, and fragmentation. */
export const MEM_OVERHEAD = 1.2;

/** Bytes per parameter for a given weight precision (bits). Defaults to FP16. */
export function bytesPerParam(weightBits = 16): number {
  return (weightBits > 0 ? weightBits : 16) / 8;
}

/** Raw weight footprint in GB at the given precision. */
export function modelWeightsGB(paramsB: number, weightBits = 16): number {
  return paramsB * bytesPerParam(weightBits);
}

/** Serving memory footprint in GB (weights + overhead) at the given precision. */
export function modelMemoryGB(paramsB: number, weightBits = 16): number {
  return modelWeightsGB(paramsB, weightBits) * MEM_OVERHEAD;
}

/**
 * Minimum number of GPU instances required just to load the model, given each
 * instance's aggregate HBM and the weight precision. Returns 1 when inputs are
 * unknown/zero so it never lowers a throughput-derived box count.
 */
export function instancesToLoad(
  paramsB: number | undefined,
  instanceTotalMemGB: number,
  weightBits = 16
): number {
  if (!paramsB || paramsB <= 0 || !(instanceTotalMemGB > 0)) return 1;
  return Math.max(1, Math.ceil(modelMemoryGB(paramsB, weightBits) / instanceTotalMemGB));
}
