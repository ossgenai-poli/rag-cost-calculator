// API-vs-self-hosted-GPU economics.
// Compares linear API pricing against the stepped (per-box) cost of running
// generation on dedicated GPU instances. ALL capacity here derives from the
// authoritative CapacityResult (lib/capacity.ts) — the measured benchmark
// operating point, topology and replica/HA sizing — never a generic
// `sustainedTokPerSec × precision` estimate (GPU-001).
import type { CalcInputs, PriceBook, PerQueryResult, CrossoverResult, CapacityResult } from "./types";
import { effectiveGpuHourly } from "./self-host";
import { sizeFleet } from "./capacity";

const HOURS_PER_MONTH = 730;
const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600; // 2,628,000 — unified with calc-engine
const CURVE_POINTS = 24;
const SELF_HOST_UTIL_THRESHOLD = 0.7;

/** Result shape used whenever the economics aren't computable (never throws). */
function zeroResult(
  cap: CapacityResult,
  monthlyGenTokens: number,
  gpuMonthly$: number,
  capacity100: number,
  tokensPerQuery: number,
  outputFraction: number,
  userInstances: number,
  ownedCapacity: boolean,
  avgDecodeDemand: number,
  peakDecodeDemand: number
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
    capacity: cap,
    replicas: 1,
    instancesPerReplica: cap.instancesPerReplica,
    haReplicasAdded: 0,
    avgDecodeDemand,
    peakDecodeDemand,
    providedDecodeCapacity: 0,
    utilAvg: 0,
    utilPeak: 0,
    minInstancesToLoad: cap.memoryFloorBoxes,
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
    verdictQualified: false,
    curve: [],
  };
}

export function computeCrossover(
  inputs: CalcInputs,
  priceBook: PriceBook,
  perQuery: PerQueryResult,
  cap: CapacityResult
): CrossoverResult {
  const { generation, traffic } = inputs;
  const llmInputTok = perQuery.llmInputTok;
  const outTokens = generation.outTokens;
  const tokensPerQuery = llmInputTok + outTokens;
  const outputFraction = tokensPerQuery > 0 ? outTokens / tokensPerQuery : 0;
  const userInstances = Math.max(1, Math.floor(generation.numInstances || 1));

  const monthlyGenTokens = traffic.queriesPerMonth * tokensPerQuery;
  const uptimeHours = Math.min(
    HOURS_PER_MONTH,
    generation.gpuUptimeHoursPerMonth > 0 ? generation.gpuUptimeHoursPerMonth : HOURS_PER_MONTH
  );
  const uptimeSeconds = uptimeHours * 3600;
  const effectiveHourly = effectiveGpuHourly(generation.gpuPricePerHr, generation.gpuPricingModel);
  const ownedCapacity = effectiveHourly <= 0;
  const gpuMonthly$ = effectiveHourly * uptimeHours;

  // AUTHORITATIVE per-instance decode capacity (output tokens/mo per box @100%).
  const capacity100 = cap.perInstanceDecodeTokS * uptimeSeconds;
  const apiBlendedPricePerToken =
    tokensPerQuery > 0 ? perQuery.apiComparisonGen$ / tokensPerQuery : 0;

  // Decode demand (output tok/s): average over uptime, and peak.
  const monthlyOutputTokens = traffic.queriesPerMonth * outTokens;
  const avgDecodeDemand = uptimeSeconds > 0 ? monthlyOutputTokens / uptimeSeconds : 0;
  const peakFactor = traffic.peakFactor > 0 ? traffic.peakFactor : 1;
  const peakDecodeDemand = avgDecodeDemand * peakFactor;

  if (apiBlendedPricePerToken <= 0 || capacity100 <= 0) {
    return zeroResult(
      cap, monthlyGenTokens, gpuMonthly$, capacity100, tokensPerQuery,
      outputFraction, userInstances, ownedCapacity, avgDecodeDemand, peakDecodeDemand
    );
  }

  // Fleet sizing from authoritative capacity (topology + replicas + N+1 HA).
  const fleet = sizeFleet(cap, peakDecodeDemand, generation.haEnabled !== false);
  const requiredInstances = fleet.requiredInstances;
  const autoSize = generation.autoSizeFleet !== false;
  // Manual cap still can't go below one replica (a replica is the minimum that
  // can load + serve the model across its model-parallel group).
  const boxes = autoSize
    ? Math.max(userInstances, requiredInstances)
    : Math.max(userInstances, fleet.instancesPerReplica);
  const autoSized = boxes > userInstances;
  // Feasible ⇔ the billed fleet serves peak throughput AND the benchmark operating
  // point meets interactivity + TTFT + concurrency (GPU-001/002/004). A heuristic
  // (no benchmark) can't verify SLAs, so slaAchievable=true there.
  const feasible = boxes >= requiredInstances && cap.slaAchievable;
  const selfHostedMonthly$ = boxes * gpuMonthly$;

  const providedDecodeCapacity = boxes * cap.perInstanceDecodeTokS; // output tok/s @100%
  const utilAvg = providedDecodeCapacity > 0 ? avgDecodeDemand / providedDecodeCapacity : 0;
  const utilPeak = providedDecodeCapacity > 0 ? peakDecodeDemand / providedDecodeCapacity : 0;
  // Throughput-only fleet (no HA) — kept for the "needs ≥ N" display.
  const throughputInstances = fleet.replicasForThroughput * fleet.instancesPerReplica;

  const apiMonthly$ = apiBlendedPricePerToken * monthlyGenTokens;
  const breakEvenTokens = selfHostedMonthly$ / apiBlendedPricePerToken;
  const equivalentQPS = breakEvenTokens / tokensPerQuery / SECONDS_PER_MONTH;
  // Decode utilization at break-even volume, using AUTHORITATIVE monthly capacity.
  const monthlyOutputCapacity = boxes * capacity100;
  const utilAtBreakEven =
    monthlyOutputCapacity > 0 ? (breakEvenTokens * outputFraction) / monthlyOutputCapacity : Infinity;
  const breakEvenFeasible = utilAtBreakEven <= 1 && cap.slaAchievable;
  // GPU-001/004: NEVER a positive verdict when the config can't actually serve the
  // load at the required SLAs, or when break-even exceeds physical capacity.
  const verdict: CrossoverResult["verdict"] =
    feasible && breakEvenFeasible && utilAtBreakEven <= SELF_HOST_UTIL_THRESHOLD
      ? "self-host efficient"
      : "API wins in practice below sustained load";
  // A positive verdict built on non-measured capacity (proxy/extrapolated/heuristic)
  // must be presented QUALIFIED — never an unconditional "self-host" recommendation.
  const verdictQualified = verdict === "self-host efficient" && cap.source !== "measured";

  const maxTokens = Math.max(monthlyGenTokens, breakEvenTokens) * 1.5;
  const curve: CrossoverResult["curve"] = [];
  if (maxTokens > 0) {
    const step = maxTokens / (CURVE_POINTS - 1);
    for (let i = 0; i < CURVE_POINTS; i++) {
      const tokens = step * i;
      curve.push({ tokens, api$: apiBlendedPricePerToken * tokens, selfHosted$: selfHostedMonthly$ });
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
    capacity: cap,
    replicas: fleet.replicas,
    instancesPerReplica: fleet.instancesPerReplica,
    haReplicasAdded: fleet.haReplicasAdded,
    avgDecodeDemand,
    peakDecodeDemand,
    providedDecodeCapacity,
    utilAvg,
    utilPeak,
    minInstancesToLoad: cap.memoryFloorBoxes,
    throughputInstances,
    realizedUtil: utilAvg,
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
    verdictQualified,
    curve,
  };
}
