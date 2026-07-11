// API-vs-self-hosted-GPU economics.
// Compares linear API pricing against the stepped (per-box) cost of running
// generation on dedicated GPU instances, and reports the token volume at
// which self-hosting a box starts paying for itself.
import type { CalcInputs, PriceBook, PerQueryResult, CrossoverResult } from "./types";

const HOURS_PER_MONTH = 730;
const SECONDS_PER_MONTH = 2.6298e6; // 730 hrs/mo convention used for sustained-throughput capacity
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
  _priceBook: PriceBook,
  perQuery: PerQueryResult
): CrossoverResult {
  const { generation, traffic } = inputs;
  const llmInputTok = perQuery.llmInputTok;
  const outTokens = generation.outTokens;
  const tokensPerQuery = llmInputTok + outTokens;

  const monthlyGenTokens = traffic.queriesPerMonth * tokensPerQuery;
  const gpuMonthly$ = generation.gpuPricePerHr * HOURS_PER_MONTH;
  const capacity100 = generation.sustainedTokPerSec * SECONDS_PER_MONTH;
  const apiBlendedPricePerToken =
    tokensPerQuery > 0 ? perQuery.apiGen$ / tokensPerQuery : 0;

  if (apiBlendedPricePerToken <= 0 || capacity100 <= 0) {
    return zeroResult(monthlyGenTokens, gpuMonthly$, capacity100);
  }

  const utilTarget = generation.utilTarget > 0 ? generation.utilTarget : 1;
  const capacityEff = capacity100 * utilTarget;

  const boxes = Math.max(1, Math.ceil(monthlyGenTokens / capacityEff));
  const selfHostedMonthly$ = boxes * gpuMonthly$;

  const apiMonthly$ = apiBlendedPricePerToken * monthlyGenTokens;
  const breakEvenTokens = gpuMonthly$ / apiBlendedPricePerToken;
  const equivalentQPS = breakEvenTokens / tokensPerQuery / SECONDS_PER_MONTH;
  const utilAtBreakEven = breakEvenTokens / capacity100;
  const verdict: CrossoverResult["verdict"] =
    utilAtBreakEven > SELF_HOST_UTIL_THRESHOLD
      ? "self-host efficient"
      : "API wins in practice below sustained load";

  const maxTokens = Math.max(monthlyGenTokens, breakEvenTokens) * 1.5;
  const curve: CrossoverResult["curve"] = [];
  if (maxTokens > 0) {
    const step = maxTokens / (CURVE_POINTS - 1);
    for (let i = 0; i < CURVE_POINTS; i++) {
      const tokens = step * i;
      const api$ = apiBlendedPricePerToken * tokens;
      const stepBoxes = Math.max(1, Math.ceil(tokens / capacityEff));
      const selfHosted$ = stepBoxes * gpuMonthly$;
      curve.push({ tokens, api$, selfHosted$ });
    }
  }

  return {
    monthlyGenTokens,
    gpuMonthly$,
    capacity100,
    boxes,
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
