// ui-logic — pure input transforms shared by the UI controls AND tests, so a
// fixture built in a test is IDENTICAL to what the GPU/model selector produces
// in the app (QA-014). Never let a test hand-edit a subset of coupled fields.
import type { GenerationInputs, GpuInstancePrice, ModelPrice } from "./types";

/**
 * Apply a GPU selection exactly as the Generation panel's selector does: the
 * instance type, its on-demand price, AND its generic sustained throughput all
 * move together. (Aggregate HBM / GPU count come from the price-book lookup by
 * instanceType downstream, so they follow automatically.)
 */
export function applyGpuSelection(
  generation: GenerationInputs,
  gpu: GpuInstancePrice
): GenerationInputs {
  return {
    ...generation,
    gpuInstanceType: gpu.instanceType,
    gpuPricePerHr: gpu.pricePerHr,
    sustainedTokPerSec: gpu.sustainedTokPerSec,
  };
}

/** Apply an LLM selection as the panel does (price + comparison default). */
export function applyModelSelection(
  generation: GenerationInputs,
  model: ModelPrice
): GenerationInputs {
  return {
    ...generation,
    llmModelId: model.id,
    llmInPricePer1K: model.inPricePer1K,
    llmOutPricePer1K: model.outPricePer1K,
    apiComparisonModelId: model.id,
    apiComparisonInPricePer1K: model.inPricePer1K,
    apiComparisonOutPricePer1K: model.outPricePer1K,
  };
}
