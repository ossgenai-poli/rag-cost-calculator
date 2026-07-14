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

import type { CalcInputs, PriceBook, PerQueryResult, CapacityResult, CapacitySource, BenchmarkProvenance } from "./types";
import {
  getBenchmarkCurve,
  BENCHMARK_SOURCE,
  BENCHMARK_SOURCE_URL,
  BENCHMARK_METHODOLOGY_URL,
  BENCHMARK_AS_OF,
  BENCHMARK_TTFT_PERCENTILE,
} from "./benchmarks";
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

  // GPU-012: a single request needs input + its max output tokens of KV context.
  // If that exceeds the configured window (or the model's supported max), the
  // config is infeasible — we never silently truncate to the smaller window.
  const contextRequiredTokens = perQuery.llmInputTok + generation.outTokens;
  const modelMaxContext = model?.maxContextTokens ?? Infinity;
  const maxContextConfigured = Math.min(generation.maxContextLen, modelMaxContext);
  const contextOverflow = contextRequiredTokens > maxContextConfigured;

  const base = {
    weightsGB,
    kvCacheGB: kvGB,
    serviceMemGB,
    memoryFloorBoxes,
    gpusPerBox: perBox,
    maxConcurrency: maxConc,
    weightPrecisionBits: generation.weightBits,
    kvPrecisionBits: generation.kvBits,
    contextRequiredTokens,
    maxContextConfigured,
    contextOverflow,
  };
  // INF-002: prefill (input) and decode (output) throughput are read as SEPARATE
  // measured quantities from the benchmark operating point (below). Only when NO
  // benchmark curve exists do we estimate prefill — and then from the workload's
  // own input/output ratio (prefill tok/s ≈ decode tok/s × ISL/OSL), not a single
  // universal 8× constant, and we report a RANGE rather than one precise count.
  const islOslRatio =
    generation.outTokens > 0 ? Math.max(0.25, perQuery.llmInputTok / generation.outTokens) : 8;

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
      // No measured prefill throughput → estimate from ISL/OSL and report a range.
      perReplicaPrefillTokS: perGpuHeur * perBox * islOslRatio,
      prefillEstimated: true,
      prefillRatioUsed: islOslRatio,
      perReplicaPrefillTokSLow: perGpuHeur * perBox * islOslRatio * 0.5,
      perReplicaPrefillTokSHigh: perGpuHeur * perBox * islOslRatio * 2,
      chosenConcurrency: maxConc,
      achievedInteractivity: target,
      ttftS: 0,
      interactivityMet: true,
      ttftMet: true,
      concWithinLimit: true,
      // Heuristic can't verify throughput SLAs, but context overflow IS checkable
      // and is a hard infeasibility even without a benchmark.
      slaAchievable: !contextOverflow,
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
  // INF-002: decode capacity = measured output_tput_per_gpu; prefill capacity =
  // measured input_tput_per_gpu — both at the SAME operating point, so no fixed
  // 8× ratio is applied and prefill is no longer an estimate on the benchmark path.
  //
  // Prefill throughput (input tok/s) is measured at the benchmark's ISL bucket.
  // Prefill work is ~proportional to input tokens, and the data confirms input
  // tok/s scales roughly linearly with ISL (1024→8192 ≈ 7×). When the workload's
  // ISL differs from the bucket, scale the measured input throughput to the actual
  // ISL so a long-context RAG prompt isn't sized against a short-prompt prefill
  // rate (which would grossly over-size the prefill fleet). Clamped to keep the
  // extrapolation bounded; the ISL mismatch is already flagged as a reason below.
  const benchISL = Number(curve.seqUsed.split("/")[0]) || perQuery.llmInputTok || 1;
  const prefillIslScale = Math.min(8, Math.max(0.125, (perQuery.llmInputTok || benchISL) / benchISL));
  const perGpuPrefill = chosen.inputTputPerGpu * prefillIslScale;
  const perReplicaDecode = chosen.tputPerGpu * gpusInConfig;
  const perReplicaPrefill = perGpuPrefill * gpusInConfig;
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

  // INF-001: a point can only be "measured" if it is traceable to a specific
  // InferenceX run (workflow URL + recipe commit). Our baked curves always carry
  // this, but the gate enforces the rule so an un-sourced curve is downgraded.
  const prov = curve.provenance;
  const traceable = !!(prov?.runUrl && prov?.commit);
  if (!traceable) reasons.push("benchmark provenance is not traceable to a specific run");

  const benchmarkProvenance: BenchmarkProvenance | undefined = traceable
    ? {
        source: BENCHMARK_SOURCE,
        sourceUrl: BENCHMARK_SOURCE_URL,
        methodologyUrl: BENCHMARK_METHODOLOGY_URL,
        asOf: BENCHMARK_AS_OF,
        runId: prov.runId,
        runUrl: prov.runUrl,
        commit: prov.commit,
        date: prov.date,
        image: prov.image,
        specMethod: prov.specMethod,
        disagg: prov.disagg,
        // INF-010: in an AGGREGATED deployment prefill and decode share the SAME
        // GPUs — never render "X prefill + Y decode" (it reads as double the GPUs).
        topology: `TP${prov.decodeTp} · ${
          prov.disagg
            ? `${prov.numPrefillGpu} prefill GPUs + ${prov.numDecodeGpu} decode GPUs (disaggregated)`
            : `${prov.numDecodeGpu} GPUs handle prefill and decode (aggregated)`
        }${prov.isMultinode ? " · multi-node" : ""}${
          prov.specMethod && prov.specMethod !== "none" ? ` · spec-decode:${prov.specMethod}` : " · no spec-decode"
        }`,
      }
    : undefined;
  const ttftPercentile = prov?.ttftPercentile ?? BENCHMARK_TTFT_PERCENTILE;

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
    perReplicaPrefillTokS: perReplicaPrefill,
    perGpuPrefillTokS: perGpuPrefill,
    prefillIslScale,
    prefillEstimated: false, // real measured input throughput at this operating point
    chosenConcurrency: chosen.conc,
    achievedInteractivity: chosen.intvty,
    ttftS: chosen.ttft,
    ttftPercentile,
    interactivityMet,
    ttftMet,
    concWithinLimit,
    slaAchievable: interactivityMet && ttftMet && concWithinLimit && !contextOverflow,
    instancesPerReplica,
    gpusInConfig,
    benchModelKey: model?.inferencexKey,
    framework: curve.framework,
    precisionUsed: curve.precisionUsed,
    precisionRequested: requestedPrecision,
    seqUsed: curve.seqUsed,
    seqRequested,
    benchmarkProvenance,
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
  replicasDecode: number;
  replicasPrefill: number;
  prefillBinds: boolean;         // prefill needs more replicas than decode (GPU-008)
  replicas: number;              // after HA
  instancesPerReplica: number;
  requiredInstances: number;     // replicas × instancesPerReplica
  haReplicasAdded: number;
}

export function sizeFleet(
  cap: CapacityResult,
  peakDecodeDemandTokS: number,
  peakPrefillDemandTokS: number,
  haEnabled: boolean,
  utilTarget: number
): FleetSizing {
  // GPU-009: size against the EFFECTIVE serving capacity (capacity × target
  // utilization), not 100%. GPU-008: the fleet must serve BOTH prefill (input)
  // and decode (output) — replicas = max of the two, so zero/short-output
  // workloads are never treated as zero GPU work.
  const ut = utilTarget > 0 && utilTarget <= 1 ? utilTarget : 1;
  const effDecode = cap.perReplicaDecodeTokS > 0 ? cap.perReplicaDecodeTokS * ut : Infinity;
  const effPrefill = cap.perReplicaPrefillTokS > 0 ? cap.perReplicaPrefillTokS * ut : Infinity;
  const replicasDecode = Math.ceil(peakDecodeDemandTokS / effDecode) || 0;
  const replicasPrefill = Math.ceil(peakPrefillDemandTokS / effPrefill) || 0;
  const replicasForThroughput = Math.max(1, replicasDecode, replicasPrefill);
  const prefillBinds = replicasPrefill > replicasDecode;
  // HA (GPU-006): N+1, minimum two replicas, so a replica loss still serves peak.
  const replicas = haEnabled ? Math.max(2, replicasForThroughput + 1) : replicasForThroughput;
  return {
    replicasForThroughput,
    replicasDecode,
    replicasPrefill,
    prefillBinds,
    replicas,
    instancesPerReplica: cap.instancesPerReplica,
    requiredInstances: replicas * cap.instancesPerReplica,
    haReplicasAdded: replicas - replicasForThroughput,
  };
}
