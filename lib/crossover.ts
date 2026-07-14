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
    usableReplicas: 1,
    strandedBoxes: 0,
    instancesPerReplica: cap.instancesPerReplica,
    haReplicasAdded: 0,
    utilPeakPostLoss: 0,
    avgDecodeDemand,
    peakDecodeDemand,
    avgPrefillDemand: 0,
    peakPrefillDemand: 0,
    prefillBinds: false,
    providedDecodeCapacity: 0,
    providedPrefillCapacity: 0,
    utilAvg: 0,
    utilPeak: 0,
    utilAvgPrefill: 0,
    utilPeakPrefill: 0,
    bindingDim: "decode",
    breakEvenBindingDim: "decode",
    utilTargetUsed: 1,
    gpuPriceSource: "fallback",
    infeasibility: [],
    minInstancesToLoad: cap.memoryFloorBoxes,
    throughputInstances: 0,
    realizedUtil: 0,
    breakEvenFeasible: false,
    selfHostedMonthly$: 0,
    apiBlendedPricePerToken: 0,
    apiMonthly$: 0,
    breakEvenTokens: 0,
    equivalentQPS: 0,
    activeWindowQPS: 0,
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

  // Decode demand (output tok/s) AND prefill demand (input tok/s): average over
  // uptime, and peak. Prefill (GPU-008) means zero/short-output workloads are
  // still real GPU work.
  const monthlyOutputTokens = traffic.queriesPerMonth * outTokens;
  const monthlyInputTokens = traffic.queriesPerMonth * llmInputTok;
  const peakFactor = traffic.peakFactor > 0 ? traffic.peakFactor : 1;
  const avgDecodeDemand = uptimeSeconds > 0 ? monthlyOutputTokens / uptimeSeconds : 0;
  const peakDecodeDemand = avgDecodeDemand * peakFactor;
  const avgPrefillDemand = uptimeSeconds > 0 ? monthlyInputTokens / uptimeSeconds : 0;
  const peakPrefillDemand = avgPrefillDemand * peakFactor;

  if (apiBlendedPricePerToken <= 0 || capacity100 <= 0) {
    return zeroResult(
      cap, monthlyGenTokens, gpuMonthly$, capacity100, tokensPerQuery,
      outputFraction, userInstances, ownedCapacity, avgDecodeDemand, peakDecodeDemand
    );
  }

  // Fleet sizing from authoritative capacity (topology + replicas + N+1 HA),
  // sized against capacity × utilTarget (GPU-009), covering prefill AND decode.
  const utilTarget = generation.utilTarget > 0 && generation.utilTarget <= 1 ? generation.utilTarget : 1;
  const fleet = sizeFleet(cap, peakDecodeDemand, peakPrefillDemand, generation.haEnabled !== false, utilTarget);
  const requiredInstances = fleet.requiredInstances;
  const ipr = fleet.instancesPerReplica;
  const autoSize = generation.autoSizeFleet !== false;
  // GPU-011: the billed fleet is measured in COMPLETE serving groups. Auto-size
  // rounds up to a whole-group multiple; manual cap bills what's entered (≥ one
  // replica) but only COMPLETE groups provide capacity — extra boxes are stranded.
  const roundUpToGroup = (n: number) => Math.ceil(n / ipr) * ipr;
  const boxes = autoSize
    ? roundUpToGroup(Math.max(userInstances, requiredInstances))
    : Math.max(userInstances, ipr);
  const autoSized = boxes > userInstances;
  const usableReplicas = Math.floor(boxes / ipr);
  const strandedBoxes = boxes - usableReplicas * ipr; // partial group → 0 capacity
  // Feasible ⇔ enough COMPLETE serving groups to serve peak at the utilization
  // target (incl. N+1 HA) AND the benchmark operating point meets the SLAs. A
  // partial/stranded box contributes NO usable capacity (GPU-011).
  const feasible = usableReplicas >= fleet.replicas && cap.slaAchievable;
  const selfHostedMonthly$ = boxes * gpuMonthly$; // you still pay for stranded boxes

  // GPU-013: coded infeasibility reasons with targeted guidance. Only a genuine
  // CAPACITY shortage should ever suggest "add instances / enable auto-size".
  const infeasibility: CrossoverResult["infeasibility"] = [];
  if (!cap.concWithinLimit)
    infeasibility.push({ code: "concurrency-below-min", message: `Concurrency cap ${cap.maxConcurrency} is below the benchmark's minimum batch — raise max concurrent sequences.`, addingInstancesHelps: false });
  if (!cap.interactivityMet)
    infeasibility.push({ code: "interactivity", message: `No operating point delivers ${cap.chosenConcurrency > 0 ? generation.interactivityTarget : generation.interactivityTarget} tok/s/user under the concurrency cap — lower the interactivity target or pick a faster GPU/precision.`, addingInstancesHelps: false });
  if (!cap.ttftMet)
    infeasibility.push({ code: "ttft", message: `TTFT ${cap.ttftS.toFixed(2)}s exceeds the ${(generation.ttftTargetMs / 1000).toFixed(2)}s target. Adding instances does NOT reduce per-request TTFT — raise the TTFT budget, shorten the prompt, or pick a faster GPU/precision.`, addingInstancesHelps: false });
  if (cap.contextOverflow)
    infeasibility.push({ code: "context-overflow", message: `Requested ${Math.round(cap.contextRequiredTokens)} tokens (input + max output) exceeds the ${cap.maxContextConfigured}-token context window — reduce input/output or raise max context (up to the model's limit).`, addingInstancesHelps: false });
  if (!autoSize && usableReplicas < fleet.replicas)
    infeasibility.push({ code: "manual-cap", message: `Auto-size is off: ${boxes} box(es) provide only ${usableReplicas} complete serving group(s), but ${fleet.replicas} are required. Enable auto-size or raise instances to a multiple of ${ipr}.`, addingInstancesHelps: true });

  // Provided capacity comes ONLY from complete replicas (not stranded boxes).
  // Provided capacity comes ONLY from complete replicas — for BOTH prefill and decode.
  const providedDecodeCapacity = usableReplicas * cap.perReplicaDecodeTokS; // tok/s @100%
  const providedPrefillCapacity = usableReplicas * cap.perReplicaPrefillTokS; // input tok/s @100%
  const utilAvg = providedDecodeCapacity > 0 ? avgDecodeDemand / providedDecodeCapacity : 0;
  const utilPeak = providedDecodeCapacity > 0 ? peakDecodeDemand / providedDecodeCapacity : 0;
  const utilAvgPrefill = providedPrefillCapacity > 0 ? avgPrefillDemand / providedPrefillCapacity : 0;
  const utilPeakPrefill = providedPrefillCapacity > 0 ? peakPrefillDemand / providedPrefillCapacity : 0;
  // The binding dimension is whichever runs hotter (GPU-008 / P2 reporting).
  const bindingDim: "prefill" | "decode" = utilPeakPrefill > utilPeak ? "prefill" : "decode";
  // Peak utilization AFTER losing one serving group (N+1 resilience) — for BOTH
  // dimensions; report the binding one.
  const postLossReplicas = Math.max(0, usableReplicas - 1);
  const postLossDecode = postLossReplicas * cap.perReplicaDecodeTokS;
  const postLossPrefill = postLossReplicas * cap.perReplicaPrefillTokS;
  const utilPeakPostLoss = Math.max(
    postLossDecode > 0 ? peakDecodeDemand / postLossDecode : peakDecodeDemand > 0 ? Infinity : 0,
    postLossPrefill > 0 ? peakPrefillDemand / postLossPrefill : peakPrefillDemand > 0 ? Infinity : 0
  );
  // Throughput-only fleet (no HA) — kept for the "needs ≥ N" display.
  const throughputInstances = fleet.replicasForThroughput * ipr;

  const apiMonthly$ = apiBlendedPricePerToken * monthlyGenTokens;
  const breakEvenTokens = selfHostedMonthly$ / apiBlendedPricePerToken;
  const equivalentQPS = breakEvenTokens / tokensPerQuery / SECONDS_PER_MONTH; // calendar
  const activeWindowQPS =
    uptimeSeconds > 0 ? breakEvenTokens / tokensPerQuery / uptimeSeconds : equivalentQPS; // active hours
  // P0: break-even feasibility must check PREFILL and DECODE, not decode-only.
  // Split the break-even token volume back into input/output via the workload's
  // token mix, then measure each against the fixed fleet's complete-replica
  // capacity (peak-adjusted). A zero-output workload has zero decode util but real
  // prefill util — the previous decode-only check wrongly read 0% and "efficient".
  const inputFraction = tokensPerQuery > 0 ? llmInputTok / tokensPerQuery : 0;
  const monthlyOutputCapacity = usableReplicas * cap.perReplicaDecodeTokS * uptimeSeconds;
  const monthlyInputCapacity = usableReplicas * cap.perReplicaPrefillTokS * uptimeSeconds;
  const decodeUtilAtBreakEven =
    monthlyOutputCapacity > 0 ? (breakEvenTokens * outputFraction * peakFactor) / monthlyOutputCapacity : 0;
  const prefillUtilAtBreakEven =
    monthlyInputCapacity > 0 ? (breakEvenTokens * inputFraction * peakFactor) / monthlyInputCapacity : 0;
  const utilAtBreakEven = Math.max(decodeUtilAtBreakEven, prefillUtilAtBreakEven);
  const breakEvenBindingDim: "prefill" | "decode" =
    prefillUtilAtBreakEven > decodeUtilAtBreakEven ? "prefill" : "decode";
  // Feasible ⇔ BOTH prefill and decode fit at break-even volume AND the SLAs hold.
  const breakEvenFeasible =
    prefillUtilAtBreakEven <= 1 && decodeUtilAtBreakEven <= 1 && cap.slaAchievable;
  // GPU-001/004: NEVER a positive verdict when the config can't actually serve the
  // load at the required SLAs, or when break-even exceeds physical capacity.
  const verdict: CrossoverResult["verdict"] =
    feasible && breakEvenFeasible && utilAtBreakEven <= SELF_HOST_UTIL_THRESHOLD
      ? "self-host efficient"
      : "API wins in practice below sustained load";
  // A positive verdict must be QUALIFIED — never unconditional — when it rests on:
  // non-measured capacity (proxy/extrapolated/heuristic), an estimated prefill
  // bound (GPU-008), OR non-live/estimated GPU pricing (fallback SKU, or a
  // commitment/Spot discount rather than on-demand) — PRICING-018.
  const gpuRec = priceBook.gpus?.find((x) => x.instanceType === generation.gpuInstanceType);
  // P1: a manual $/hr edit (differs from the catalog SKU price) is a user OVERRIDE —
  // it is no longer the live/fallback provenance of that SKU.
  const priceIsOverride = !!gpuRec && Math.abs(gpuRec.pricePerHr - generation.gpuPricePerHr) > 1e-6;
  const gpuPriceSource: "live" | "fallback" | "override" = priceIsOverride
    ? "override"
    : gpuRec?.priceSource ?? "fallback";
  const pricingEstimated = gpuPriceSource !== "live" || generation.gpuPricingModel !== "on-demand";
  const verdictQualified =
    verdict === "self-host efficient" &&
    (cap.source !== "measured" ||
      (fleet.prefillBinds && cap.prefillEstimated) ||
      pricingEstimated);

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
    usableReplicas,
    strandedBoxes,
    instancesPerReplica: ipr,
    haReplicasAdded: fleet.haReplicasAdded,
    utilPeakPostLoss,
    avgDecodeDemand,
    peakDecodeDemand,
    avgPrefillDemand,
    peakPrefillDemand,
    prefillBinds: fleet.prefillBinds,
    providedDecodeCapacity,
    providedPrefillCapacity,
    utilAvg,
    utilPeak,
    utilAvgPrefill,
    utilPeakPrefill,
    bindingDim,
    breakEvenBindingDim,
    utilTargetUsed: utilTarget,
    gpuPriceSource,
    infeasibility,
    minInstancesToLoad: cap.memoryFloorBoxes,
    throughputInstances,
    realizedUtil: utilAvg,
    breakEvenFeasible,
    selfHostedMonthly$,
    apiBlendedPricePerToken,
    apiMonthly$,
    breakEvenTokens,
    equivalentQPS,
    activeWindowQPS,
    utilAtBreakEven,
    tokensPerQuery,
    outputFraction,
    verdict,
    verdictQualified,
    curve,
  };
}
