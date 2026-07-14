// ============================================================================
// capacity — THE single authoritative source of self-hosted decode capacity and
// feasibility (GPU-001). Everything downstream (crossover economics, realized
// utilization, break-even, verdict, scenarios, headline, exports) must read the
// effective per-instance throughput from here. It picks ONE benchmark operating
// point that satisfies the interactivity SLA, the TTFT SLA (GPU-004) and the
// concurrency cap (GPU-002), maps the benchmark's real topology (gpusInConfig)
// onto 8-GPU EC2 boxes (GPU-005/006), and labels the result measured / proxy /
// extrapolated / heuristic. No generic `sustainedTokPerSec × precision` is used
// once a benchmark point is selected.
// ============================================================================

import type { CalcInputs, PriceBook, PerQueryResult, CapacityResult, CapacitySource } from "./types";
import { getBenchmarkCurve } from "./benchmarks";
import { instancesToLoad, precisionThroughputFactor, modelWeightsGB, kvCacheGB, RUNTIME_RESERVE } from "./self-host";

export const HOURS_PER_MONTH = 730;

/** Parse "8x B200 192GB" → 8; default 8 (a p5/p6 box has 8 GPUs). */
export function gpusPerBox(gpuLabel: string | undefined): number {
  const m = gpuLabel?.match(/(\d+)\s*x/i);
  return m ? Number(m[1]) : 8;
}

export function computeCapacity(
  inputs: CalcInputs,
  priceBook: PriceBook,
  perQuery: PerQueryResult
): CapacityResult {
  const { generation } = inputs;
  const model = priceBook.models?.find((m) => m.id === generation.llmModelId);
  const gpu = priceBook.gpus?.find((g) => g.instanceType === generation.gpuInstanceType);
  const perBox = gpusPerBox(gpu?.gpu);
  const boxMemGB = gpu?.totalMemGB ?? 0;
  const maxConc = Math.max(1, Math.floor(generation.maxConcurrentSeqs || 1));
  const ttftTargetS = (generation.ttftTargetMs > 0 ? generation.ttftTargetMs : 2000) / 1000;
  const target = generation.interactivityTarget > 0 ? generation.interactivityTarget : 1;

  // Memory (GPU-003): weights at weightBits, KV at INDEPENDENT kvBits.
  const paramsB = model?.paramsB ?? 0;
  const kvBytesPerToken = model?.kvBytesPerToken ?? 0;
  const weightsGB = modelWeightsGB(paramsB, generation.weightBits);
  const kvGB = kvCacheGB(kvBytesPerToken, generation.kvBits, generation.maxContextLen, maxConc);
  const serviceMemGB = (weightsGB + kvGB) * RUNTIME_RESERVE;
  const memoryFloorBoxes = instancesToLoad(
    paramsB,
    boxMemGB,
    generation.weightBits,
    kvBytesPerToken,
    generation.maxContextLen,
    maxConc,
    generation.kvBits
  );

  const base = {
    weightsGB,
    kvCacheGB: kvGB,
    serviceMemGB,
    memoryFloorBoxes,
    gpusPerBox: perBox,
    maxConcurrency: maxConc,
    weightPrecisionBits: generation.weightBits,
    kvPrecisionBits: generation.kvBits,
  };

  const curve = getBenchmarkCurve(
    model?.inferencexKey,
    generation.gpuInstanceType,
    generation.weightBits,
    perQuery.llmInputTok,
    generation.outTokens
  );

  // -- No benchmark → heuristic (generic sustainedTokPerSec × precision) --------
  if (!curve) {
    const perGpuHeur =
      (generation.sustainedTokPerSec * precisionThroughputFactor(generation.weightBits)) / perBox;
    const note = !model?.inferencexKey
      ? `${model?.label ?? "This model"} isn't in the InferenceX benchmark set — sizing uses the heuristic throughput estimate, not measured data.`
      : `No InferenceX benchmark for ${model?.label} on ${gpu?.gpu ?? generation.gpuInstanceType} — using the heuristic estimate.`;
    return {
      ...base,
      source: "heuristic",
      extrapolationReasons: ["no benchmark curve for this model/GPU"],
      benchmarkAvailable: false,
      perGpuDecodeTokS: perGpuHeur,
      perReplicaDecodeTokS: perGpuHeur * perBox,
      perInstanceDecodeTokS: generation.sustainedTokPerSec * precisionThroughputFactor(generation.weightBits),
      chosenConcurrency: maxConc,
      achievedInteractivity: target,
      ttftS: 0,
      interactivityMet: true,
      ttftMet: true,
      concWithinLimit: true,
      slaAchievable: true, // no benchmark to reject against — heuristic can't verify SLAs
      instancesPerReplica: Math.max(1, memoryFloorBoxes),
      gpusInConfig: perBox,
      note,
    };
  }

  // -- Benchmark available: select ONE operating point under all constraints ----
  const reasons: string[] = [];
  // GPU-002: only points at or below the configured concurrency cap are valid.
  const within = curve.points.filter((p) => p.conc <= maxConc);
  const concWithinLimit = within.length > 0;
  const candidates = (concWithinLimit ? within : [...curve.points].sort((a, b) => a.conc - b.conc).slice(0, 1));
  if (!concWithinLimit) reasons.push(`concurrency cap ${maxConc} is below the benchmarked minimum ${Math.min(...curve.points.map((p) => p.conc))}`);

  const byConc = [...candidates].sort((a, b) => a.conc - b.conc); // conc asc → intvty desc, ttft asc
  // Feasible = meets interactivity AND TTFT. Among those pick MAX throughput.
  const feasible = byConc.filter((p) => p.intvty >= target && p.ttft <= ttftTargetS);
  let chosen;
  let interactivityMet: boolean;
  let ttftMet: boolean;
  if (feasible.length) {
    chosen = feasible.reduce((m, p) => (p.tputPerGpu > m.tputPerGpu ? p : m));
    interactivityMet = true;
    ttftMet = true;
  } else {
    // Nothing meets both — report the best-effort point (max throughput that at
    // least meets interactivity; else the snappiest point) and flag what failed.
    const meetsInt = byConc.filter((p) => p.intvty >= target);
    chosen = meetsInt.length
      ? meetsInt.reduce((m, p) => (p.tputPerGpu > m.tputPerGpu ? p : m))
      : byConc[0];
    interactivityMet = chosen.intvty >= target;
    ttftMet = chosen.ttft <= ttftTargetS;
    if (!interactivityMet) reasons.push(`no benchmark point delivers ${target} tok/s/user`);
    if (!ttftMet) reasons.push(`TTFT ${chosen.ttft.toFixed(1)}s exceeds the ${ttftTargetS}s target`);
  }

  // GPU-005/006: map the benchmark's real GPU count onto 8-GPU boxes.
  const gpusInConfig = curve.gpusInConfig;
  const boxesForTopology = Math.ceil(gpusInConfig / perBox);
  const instancesPerReplica = Math.max(1, boxesForTopology, memoryFloorBoxes);
  const perReplicaDecode = chosen.tputPerGpu * gpusInConfig;
  const perInstanceDecode = perReplicaDecode / instancesPerReplica;

  // GPU-005/010: provenance / extrapolation labeling.
  // Precision is a real enum — BF16/FP16 (16), FP8/INT8 (8), INT4 (4). The
  // benchmark data only carries fp4/fp8, so a BF16 request can only be SERVED by
  // an fp8 curve → that is a substitution, never an exact "measured" match.
  const requestedPrecision = generation.weightBits >= 16 ? "bf16" : generation.weightBits === 8 ? "fp8" : "fp4";
  if (curve.precisionUsed !== requestedPrecision)
    reasons.push(`benchmark precision ${curve.precisionUsed} substituted for requested ${requestedPrecision}`);
  // GPU-010: validate BOTH input (ISL) and output (OSL) sequence buckets, with a
  // tight tolerance — a broad 2× band must NOT keep a "measured" label.
  const SEQ_TOL = 1.5;
  const islUsed = Number(curve.seqUsed.split("/")[0]);
  const oslUsed = Number(curve.seqUsed.split("/")[1]);
  const islReq = perQuery.llmInputTok;
  const oslReq = generation.outTokens;
  const islRatio = islUsed > 0 && islReq > 0 ? islReq / islUsed : 1;
  const oslRatio = oslUsed > 0 && oslReq > 0 ? oslReq / oslUsed : 1;
  if (islRatio > SEQ_TOL || islRatio < 1 / SEQ_TOL)
    reasons.push(`input length ${Math.round(islReq)} not close to benchmarked ISL ${islUsed}`);
  if (oslReq > 0 && (oslRatio > SEQ_TOL || oslRatio < 1 / SEQ_TOL))
    reasons.push(`output length ${Math.round(oslReq)} not close to benchmarked OSL ${oslUsed}`);
  const seqRequested = `${Math.round(islReq)}/${Math.round(oslReq)}`;
  // Topology: a config that maps to WHOLE 8-GPU boxes (gpusInConfig a multiple of
  // perBox, incl. the exact 8-GPU or exact 64-GPU case) is a real measurement of
  // that serving group — it stays "measured" when model/precision/seq also match.
  // Only a PARTIAL box or a non-whole-multiple is a genuine topology extrapolation.
  const wholeBoxMultiple = gpusInConfig % perBox === 0;
  if (gpusInConfig < perBox)
    reasons.push(`benchmark used ${gpusInConfig} of ${perBox} GPUs per box (partial box)`);
  else if (gpusInConfig > perBox && !wholeBoxMultiple)
    reasons.push(`benchmark topology (${gpusInConfig} GPUs) does not map to whole ${perBox}-GPU boxes`);
  // Multi-box replica that maps cleanly: measured per replica; scaling to MULTIPLE
  // replicas assumes replica independence — surfaced as a note, not a downgrade.
  const scalingNote =
    gpusInConfig > perBox && wholeBoxMultiple
      ? `Measured on a ${gpusInConfig}-GPU (${boxesForTopology}-box) serving group; multiple replicas assume linear scaling.`
      : undefined;

  const provenance = model?.benchmarkProvenance;
  let source: CapacitySource;
  if (provenance === "proxy") source = "proxy";
  else if (reasons.length > 0) source = "extrapolated";
  else source = "measured";

  return {
    ...base,
    source,
    extrapolationReasons: reasons,
    benchmarkAvailable: true,
    perGpuDecodeTokS: chosen.tputPerGpu,
    perReplicaDecodeTokS: perReplicaDecode,
    perInstanceDecodeTokS: perInstanceDecode,
    chosenConcurrency: chosen.conc,
    achievedInteractivity: chosen.intvty,
    ttftS: chosen.ttft,
    interactivityMet,
    ttftMet,
    concWithinLimit,
    slaAchievable: interactivityMet && ttftMet && concWithinLimit,
    instancesPerReplica,
    gpusInConfig,
    benchModelKey: model?.inferencexKey,
    framework: curve.framework,
    precisionUsed: curve.precisionUsed,
    precisionRequested: requestedPrecision,
    seqUsed: curve.seqUsed,
    seqRequested,
    note:
      [
        provenance === "proxy"
          ? `Grounded via a proxy benchmark (${model?.label} not directly measured).`
          : undefined,
        scalingNote,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
  };
}

/** Fleet sizing from authoritative capacity + demand (GPU-006 topology/replicas/HA). */
export interface FleetSizing {
  replicasForThroughput: number;
  replicas: number;              // after HA
  instancesPerReplica: number;
  requiredInstances: number;     // replicas × instancesPerReplica
  haReplicasAdded: number;
}

export function sizeFleet(
  cap: CapacityResult,
  peakDecodeDemandTokS: number,
  haEnabled: boolean,
  utilTarget: number
): FleetSizing {
  // GPU-009: size against the EFFECTIVE serving capacity (capacity × target
  // utilization), not 100% — you never plan a fleet to run pinned at 100%.
  const ut = utilTarget > 0 && utilTarget <= 1 ? utilTarget : 1;
  const effPerReplica = cap.perReplicaDecodeTokS > 0 ? cap.perReplicaDecodeTokS * ut : Infinity;
  const replicasForThroughput = Math.max(1, Math.ceil(peakDecodeDemandTokS / effPerReplica));
  // HA (GPU-006): N+1, minimum two replicas, so a replica loss still serves peak.
  const replicas = haEnabled ? Math.max(2, replicasForThroughput + 1) : replicasForThroughput;
  return {
    replicasForThroughput,
    replicas,
    instancesPerReplica: cap.instancesPerReplica,
    requiredInstances: replicas * cap.instancesPerReplica,
    haReplicasAdded: replicas - replicasForThroughput,
  };
}
