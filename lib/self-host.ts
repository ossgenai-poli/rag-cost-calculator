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

/** Raw weight footprint in GB at FP16. */
export function modelWeightsGB(paramsB: number): number {
  return paramsB * BYTES_PER_PARAM_FP16;
}

/** Serving memory footprint in GB (weights + overhead). */
export function modelMemoryGB(paramsB: number): number {
  return modelWeightsGB(paramsB) * MEM_OVERHEAD;
}

/**
 * Minimum number of GPU instances required just to load the model, given each
 * instance's aggregate HBM. Returns 1 when inputs are unknown/zero so it never
 * lowers a throughput-derived box count.
 */
export function instancesToLoad(paramsB: number | undefined, instanceTotalMemGB: number): number {
  if (!paramsB || paramsB <= 0 || !(instanceTotalMemGB > 0)) return 1;
  return Math.max(1, Math.ceil(modelMemoryGB(paramsB) / instanceTotalMemGB));
}
