// API-vs-self-hosted-GPU economics.
// Compares linear API pricing against the stepped (per-box) cost of running
// generation on dedicated GPU instances, and reports the token volume at
// which self-hosting a box starts paying for itself.
import type { CalcInputs, PriceBook, PerQueryResult, CrossoverResult } from "./types";
import { effectiveGpuHourly, instancesToLoad, precisionThroughputFactor } from "./self-host";

const HOURS_PER_MONTH = 730;
const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600; // 2,628,000 — unified with calc-engine
const CURVE_POINTS = 24;
const SELF_HOST_UTIL_THRESHOLD = 0.7;

/** Result shape used whenever the economics aren't computable (never throws). */
function zeroResult(
  monthlyGenTokens: number,
  gpuMonthly$: number,
  capacity100: number,
  tokensPerQuery = 0,
  outputFraction = 0,
  userInstances = 1,
  ownedCapacity = false
): CrossoverResult {
  return {
    monthlyGenTokens,
    gpuMonthly$,
    capacity100,
    boxes: 1,
    userInstances,
    requiredInstances: 1,
    autoSized: false,
    feasible: true,
    ownedCapacity,
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
    tokensPerQuery,
    outputFraction,
    verdict: "API wins in practice below sustained load",
    curve: [],
  };
}

export function computeCrossover(
  inputs: CalcInputs,
  priceBook: PriceBook,
  perQuery: PerQueryResult,
  // Floor on the billed fleet from a more-accurate model (e.g. grounded, measured
  // per-GPU throughput). computeForMode re-runs with this so billing is never
  // below the true requirement even when it exceeds the flat-nameplate estimate.
  minRequiredInstances = 0
): CrossoverResult {
  const { generation, traffic } = inputs;
  const llmInputTok = perQuery.llmInputTok;
  const outTokens = generation.outTokens;
  const tokensPerQuery = llmInputTok + outTokens;
  // Fraction of each query's tokens that are decode (output) — used to convert the
  // token axis to output/input tokens and to derive decode utilization per point.
  const outputFraction = tokensPerQuery > 0 ? outTokens / tokensPerQuery : 0;
  // The user's requested fleet: an INTEGER count (P2 — 2.5 instances is invalid).
  const userInstances = Math.max(1, Math.floor(generation.numInstances || 1));

  const monthlyGenTokens = traffic.queriesPerMonth * tokensPerQuery;
  // Fleet cost reflects the commitment model (discount off on-demand) and how many
  // hours/month the fleet actually runs. Default uptime (730) = always-on; a month
  // has at most 730 GPU-hours, so cap it there (P2 — uptime > 730 is impossible).
  const uptimeHours = Math.min(
    HOURS_PER_MONTH,
    generation.gpuUptimeHoursPerMonth > 0 ? generation.gpuUptimeHoursPerMonth : HOURS_PER_MONTH
  );
  const effectiveHourly = effectiveGpuHourly(generation.gpuPricePerHr, generation.gpuPricingModel);
  // Owned/free capacity: a $0 GPU rate makes self-host trivially "cheapest" — flag
  // it so the UI/scenarios don't present a meaningless -100% saving (P2).
  const ownedCapacity = effectiveHourly <= 0;
  const gpuMonthly$ = effectiveHourly * uptimeHours;
  // Decode capacity (output tokens/mo), scaled by the precision speedup — lower
  // precision decodes faster, so it raises capacity as well as lowering memory. A
  // fleet that only runs part of the month can process proportionally fewer tokens.
  const capacity100 =
    generation.sustainedTokPerSec * precisionThroughputFactor(generation.weightBits) * (uptimeHours * 3600);
  // The API baseline for the crossover uses the COMPARISON model (defaults to the
  // selected model — same-model, apples-to-apples).
  const apiBlendedPricePerToken =
    tokensPerQuery > 0 ? perQuery.apiComparisonGen$ / tokensPerQuery : 0;

  if (apiBlendedPricePerToken <= 0 || capacity100 <= 0) {
    return zeroResult(
      monthlyGenTokens,
      gpuMonthly$,
      capacity100,
      tokensPerQuery,
      outputFraction,
      userInstances,
      ownedCapacity
    );
  }

  const utilTarget = generation.utilTarget > 0 ? generation.utilTarget : 1;
  const capacityEff = capacity100 * utilTarget;

  // Memory floor: an open-weight model must fit in aggregate GPU HBM, so you
  // need at least this many boxes just to load it — regardless of throughput.
  const model = priceBook.models?.find((m) => m.id === generation.llmModelId);
  const gpu = priceBook.gpus?.find((g) => g.instanceType === generation.gpuInstanceType);
  const minInstancesToLoad = instancesToLoad(
    model?.paramsB,
    gpu?.totalMemGB ?? 0,
    generation.weightBits,
    model?.kvBytesPerToken,
    generation.maxContextLen,
    generation.maxConcurrentSeqs
  );

  // Capacity is DECODE-bound: sustainedTokPerSec is output tokens/sec, so it only
  // applies to output tokens — never to total (input + output) tokens.
  const monthlyOutputTokens = traffic.queriesPerMonth * outTokens;
  // A self-hosted fleet must be provisioned for PEAK load, not the monthly average,
  // so the throughput-required instance count scales by the peak-to-average ratio.
  // (peakFactor = 1 → provision for the flat average, unchanged.)
  const peakFactor = traffic.peakFactor > 0 ? traffic.peakFactor : 1;
  const throughputInstances = Math.max(1, Math.ceil((monthlyOutputTokens * peakFactor) / capacityEff));

  // The minimum feasible fleet: memory floor + throughput need + any external
  // (grounded/measured) floor. The model physically can't load below the memory
  // floor, so that is always enforced; throughput/grounded are what auto-sizing adds.
  const requiredInstances = Math.max(1, minInstancesToLoad, throughputInstances, Math.ceil(minRequiredInstances));
  // Auto-size (default): bill up to serve the load — the comparison must be
  // apples-to-apples, never a cheaper-but-inadequate fleet (P1-a). Manual cap
  // (autoSizeFleet=false): bill exactly what the user entered (still ≥ memory floor,
  // which is physical), and flag `feasible=false` if that can't serve the load —
  // scenarios then mark it infeasible and suppress savings.
  const autoSize = generation.autoSizeFleet !== false;
  const boxes = autoSize
    ? Math.max(userInstances, requiredInstances)
    : Math.max(userInstances, minInstancesToLoad);
  const autoSized = boxes > userInstances;
  const feasible = boxes >= requiredInstances;
  const selfHostedMonthly$ = boxes * gpuMonthly$;

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
    userInstances,
    requiredInstances,
    autoSized,
    feasible,
    ownedCapacity,
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
    tokensPerQuery,
    outputFraction,
    verdict,
    curve,
  };
}
