// API-vs-self-hosted-GPU economics.
// Compares linear API pricing against the stepped (per-box) cost of running
// generation on dedicated GPU instances, and reports the token volume at
// which self-hosting a box starts paying for itself.
import type { CalcInputs, PriceBook, PerQueryResult, CrossoverResult } from "./types";
import { instancesToLoad, precisionThroughputFactor } from "./self-host";

const HOURS_PER_MONTH = 730;
const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600; // 2,628,000 — unified with calc-engine
const CURVE_POINTS = 24;
const SELF_HOST_UTIL_THRESHOLD = 0.7;

/** Result shape used whenever the economics aren't computable (never throws). */
function zeroResult(
  monthlyGenTokens: number,
  gpuMonthly$: number,
  capacity100: number
): CrossoverResult {
  return {
    monthlyGenTokens,
    gpuMonthly$,
    capacity100,
    boxes: 1,
    minInstancesToLoad: 1,
    throughputInstances: 0,
    realizedUtil: 0,
    breakEvenFeasible: false,
    selfHostedMonthly$: 0,
    apiBlendedPricePerToken: 0,
    apiMonthly$: 0,
    breakEvenTokens: 0,
    equivalentQPS: 0,
    utilAtBreakEven: 0,
    verdict: "API wins in practice below sustained load",
    curve: [],
  };
}

export function computeCrossover(
  inputs: CalcInputs,
  priceBook: PriceBook,
  perQuery: PerQueryResult
): CrossoverResult {
  const { generation, traffic } = inputs;
  const llmInputTok = perQuery.llmInputTok;
  const outTokens = generation.outTokens;
  const tokensPerQuery = llmInputTok + outTokens;

  const monthlyGenTokens = traffic.queriesPerMonth * tokensPerQuery;
  const gpuMonthly$ = generation.gpuPricePerHr * HOURS_PER_MONTH;
  // Decode capacity (output tokens/mo), scaled by the precision speedup — lower
  // precision decodes faster, so it raises capacity as well as lowering memory.
  const capacity100 =
    generation.sustainedTokPerSec * precisionThroughputFactor(generation.weightBits) * SECONDS_PER_MONTH;
  const apiBlendedPricePerToken =
    tokensPerQuery > 0 ? perQuery.apiGen$ / tokensPerQuery : 0;

  if (apiBlendedPricePerToken <= 0 || capacity100 <= 0) {
    return zeroResult(monthlyGenTokens, gpuMonthly$, capacity100);
  }

  const utilTarget = generation.utilTarget > 0 ? generation.utilTarget : 1;
  const capacityEff = capacity100 * utilTarget;

  // Memory floor: an open-weight model must fit in aggregate GPU HBM, so you
  // need at least this many boxes just to load it — regardless of throughput.
  const model = priceBook.models?.find((m) => m.id === generation.llmModelId);
  const gpu = priceBook.gpus?.find((g) => g.instanceType === generation.gpuInstanceType);
  const minInstancesToLoad = instancesToLoad(model?.paramsB, gpu?.totalMemGB ?? 0, generation.weightBits);

  // The billed fleet is what the user provisioned, never below the memory floor.
  // We do NOT auto-scale it to demand — instead we report how many instances the
  // throughput would need, so an under-provisioned fleet is surfaced as a warning.
  const boxes = Math.max(1, generation.numInstances || 1, minInstancesToLoad);
  const selfHostedMonthly$ = boxes * gpuMonthly$;

  // Capacity is DECODE-bound: sustainedTokPerSec is output tokens/sec, so it only
  // applies to output tokens — never to total (input + output) tokens.
  const outputFraction = tokensPerQuery > 0 ? outTokens / tokensPerQuery : 0;
  const monthlyOutputTokens = traffic.queriesPerMonth * outTokens;
  const throughputInstances = Math.max(1, Math.ceil(monthlyOutputTokens / capacityEff));
  const realizedUtil = boxes * capacity100 > 0 ? monthlyOutputTokens / (boxes * capacity100) : 0;

  const apiMonthly$ = apiBlendedPricePerToken * monthlyGenTokens;
  // Break-even is where the whole provisioned FLEET's fixed cost equals the API's
  // linear cost — so it scales with the number of instances the user provisions.
  const breakEvenTokens = selfHostedMonthly$ / apiBlendedPricePerToken;
  const equivalentQPS = breakEvenTokens / tokensPerQuery / SECONDS_PER_MONTH;
  // Decode utilization the fleet would run at break-even volume (output tokens
  // only). > 1 means break-even exceeds the fleet's physical capacity => not
  // achievable, so the API wins regardless.
  const utilAtBreakEven =
    boxes * capacity100 > 0 ? (breakEvenTokens * outputFraction) / (boxes * capacity100) : Infinity;
  const breakEvenFeasible = utilAtBreakEven <= 1;
  const verdict: CrossoverResult["verdict"] =
    breakEvenFeasible && utilAtBreakEven <= SELF_HOST_UTIL_THRESHOLD
      ? "self-host efficient"
      : "API wins in practice below sustained load";

  const maxTokens = Math.max(monthlyGenTokens, breakEvenTokens) * 1.5;
  const curve: CrossoverResult["curve"] = [];
  if (maxTokens > 0) {
    const step = maxTokens / (CURVE_POINTS - 1);
    for (let i = 0; i < CURVE_POINTS; i++) {
      const tokens = step * i;
      const api$ = apiBlendedPricePerToken * tokens;
      // Fixed provisioned fleet: cost is flat regardless of volume. Crosses the
      // rising API line at break-even — the classic fixed-vs-variable crossover.
      curve.push({ tokens, api$, selfHosted$: selfHostedMonthly$ });
    }
  }

  return {
    monthlyGenTokens,
    gpuMonthly$,
    capacity100,
    boxes,
    minInstancesToLoad,
    throughputInstances,
    realizedUtil,
    breakEvenFeasible,
    selfHostedMonthly$,
    apiBlendedPricePerToken,
    apiMonthly$,
    breakEvenTokens,
    equivalentQPS,
    utilAtBreakEven,
    verdict,
    curve,
  };
}
