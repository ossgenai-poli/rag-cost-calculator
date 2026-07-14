// ============================================================================
// share — serialize/deserialize the full parameter set to a shareable URL and
// export helpers (CSV breakdown, JSON assumptions). A URL that round-trips
// every lever is the feature architecture reviews and customer calls actually
// want. Pure string helpers here; the DOM download trigger is guarded so this
// module stays importable in tests.
// ============================================================================

import { z } from "zod";
import type { CalcInputs, CalcResult, PriceBook } from "./types";
import { deriveDisplayMetrics } from "./derived";
import { buildScenarios } from "./scenarios";

const PARAM_KEY = "s";
const SHARE_VERSION = 1;

// ---------------------------------------------------------------------------
// Zod schema for CalcInputs. Guards against NaN/negative/garbage from a crafted
// or stale link. Fields added after v1 are optional-with-default so older
// shared links keep decoding and get upgraded silently.
// ---------------------------------------------------------------------------

const num = z.number().finite();
const nonNeg = num.nonnegative();

const calcInputsSchema = z.object({
  ragMode: z.enum(["A", "B"]).default("A"),
  corpus: z.object({
    numDocs: nonNeg,
    avgTokensPerDoc: nonNeg,
    refreshCadence: z.enum(["one-time", "weekly", "monthly"]),
  }),
  chunking: z.object({
    chunkSize: num.positive(),
    overlapFraction: num.min(0).max(0.99),
    embedModelId: z.string(),
    embedDim: num.positive(),
    embedPricePer1K: nonNeg,
  }),
  vectorStore: z.object({
    indexingAlgo: z.enum(["hnsw", "ivf_pq", "ivf_fp16"]),
    m: nonNeg,
    replicas: num.min(1),
    pqCompression: num.positive(),
    minOCU: nonNeg,
    ocuPricePerHr: nonNeg,
    storagePricePerGBmo: nonNeg,
    gbRamPerOcu: num.positive(),
    indexingOCUhrs: nonNeg,
    qpsPerOcu: num.positive().default(2),
  }),
  retrieval: z.object({
    topK: num.positive(),
    rerankEnabled: z.boolean(),
    rerankModelId: z.string(),
    rerankPricePer1K: nonNeg,
    topN: num.positive(),
  }),
  guardrails: z.object({
    inputEnabled: z.boolean(),
    outputEnabled: z.boolean(),
    inputPricePer1KUnits: nonNeg.default(0.75),
    outputPricePer1KUnits: nonNeg.default(0.75),
    charsPerTextUnit: num.positive().default(400),
    charsPerToken: num.positive().default(4),
  }),
  generation: z.object({
    mode: z.enum(["api", "self-hosted"]),
    llmModelId: z.string(),
    llmInPricePer1K: nonNeg,
    llmOutPricePer1K: nonNeg,
    outTokens: nonNeg,
    promptOverhead: nonNeg,
    gpuInstanceType: z.string(),
    gpuPricePerHr: nonNeg,
    gpuPricingModel: z
      .enum(["on-demand", "reserved-1yr", "reserved-3yr", "savings-1yr", "spot"])
      .default("on-demand"),
    // A month has at most 730 GPU-hours — clamp rather than reject so old links load.
    gpuUptimeHoursPerMonth: num
      .positive()
      .default(730)
      .transform((v) => Math.min(730, v)),
    sustainedTokPerSec: num.positive(),
    utilTarget: num.min(0.01).max(1),
    // Instances must be a whole number — floor (2.5 → 2) rather than reject.
    numInstances: num
      .min(1)
      .default(1)
      .transform((v) => Math.max(1, Math.floor(v))),
    autoSizeFleet: z.boolean().default(true),
    weightBits: num.min(1).default(16),
    kvBits: num.min(1).default(16), // KV precision, independent of weights (GPU-003)
    ttftTargetMs: num.positive().default(2000), // TTFT SLA gate (GPU-004)
    haEnabled: z.boolean().default(true), // N+1 redundancy by default (GPU-006)
    apiComparisonModelId: z.string().default(""),
    apiComparisonInPricePer1K: nonNeg.default(0),
    apiComparisonOutPricePer1K: nonNeg.default(0),
    maxContextLen: num.positive().default(8192),
    maxConcurrentSeqs: num.positive().default(16),
    interactivityTarget: num.positive().default(30),
  }),
  managedKb: z
    .object({
      retrievalMode: z.enum(["standard", "agentic"]).default("standard"),
      underlyingRetrievalsPerCall: nonNeg.default(2),
      indexedDataGB: nonNeg.default(1),
    })
    .default({ retrievalMode: "standard", underlyingRetrievalsPerCall: 2, indexedDataGB: 1 }),
  ops: z
    .object({
      networkingMonthly$: nonNeg.default(0),
      observabilityMonthly$: nonNeg.default(0),
      overheadPct: nonNeg.default(0),
    })
    .default({ networkingMonthly$: 0, observabilityMonthly$: 0, overheadPct: 0 }),
  traffic: z.object({
    queriesPerMonth: nonNeg,
    region: z.string(),
    method: z.enum(["monthly", "qps"]).default("monthly"),
    qps: nonNeg.default(1),
    hoursPerDay: nonNeg.default(24),
    daysPerMonth: nonNeg.default(30),
    peakFactor: num.positive().default(1),
  }),
  queryTokens: nonNeg,
});

// --- base64url (unicode-safe) ------------------------------------------------

function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = typeof btoa !== "undefined" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(param: string): string {
  const b64 = param.replace(/-/g, "+").replace(/_/g, "/");
  const binary = typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// --- inputs <-> URL ----------------------------------------------------------

export function encodeInputs(inputs: CalcInputs): string {
  return toBase64Url(JSON.stringify({ v: SHARE_VERSION, i: inputs }));
}

/**
 * Parse an encoded param back to validated inputs. Returns null on any
 * malformed/invalid data (NaN, negatives, wrong shape) so a bad link falls
 * back to defaults instead of poisoning the engine. Accepts both the versioned
 * envelope and legacy raw-inputs links.
 */
export function decodeInputs(param: string | null | undefined): CalcInputs | null {
  if (!param) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(param));
    // Versioned envelope { v, i } or legacy raw inputs object.
    const candidate =
      parsed && typeof parsed === "object" && "i" in parsed ? (parsed as { i: unknown }).i : parsed;
    return coerceInputs(candidate);
  } catch {
    return null;
  }
}

/**
 * Validate + upgrade a raw inputs object (e.g. a saved scenario persisted before
 * newer fields existed) to a complete CalcInputs. Fields added after the object
 * was stored are backfilled from the schema defaults, so old saved scenarios and
 * shared links never crash the engine. Returns null if the shape is unusable.
 */
export function coerceInputs(candidate: unknown): CalcInputs | null {
  const result = calcInputsSchema.safeParse(candidate);
  return result.success ? (result.data as CalcInputs) : null;
}

/** Read encoded inputs from the current window URL, if present. */
export function readInputsFromLocation(): CalcInputs | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return decodeInputs(params.get(PARAM_KEY));
}

/** Absolute shareable URL carrying the given inputs. */
export function buildShareUrl(inputs: CalcInputs): string {
  const base =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}`
      : "";
  return `${base}?${PARAM_KEY}=${encodeInputs(inputs)}`;
}

/** Replace the URL query (no navigation / history spam) with current inputs. */
export function syncLocation(inputs: CalcInputs): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const url = `${window.location.pathname}?${PARAM_KEY}=${encodeInputs(inputs)}`;
  window.history.replaceState(null, "", url);
}

// --- exports -----------------------------------------------------------------

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of the cost breakdown plus headline metrics for the active mode. */
export function inputsToCsv(result: CalcResult, inputs: CalcInputs): string {
  const m = deriveDisplayMetrics(result, inputs);
  const rows: (string | number)[][] = [
    ["Metric", "Value"],
    ["Estimated monthly cost (USD)", m.totalMonthly.toFixed(2)],
    ["Cost per query (USD)", m.costPerQuery.toFixed(6)],
    ["Cost per 1,000 queries (USD)", m.costPer1000.toFixed(2)],
    ["Annualized cost (USD)", m.annualized.toFixed(2)],
    ["Monthly LLM tokens", Math.round(m.monthlyLlmTokens)],
    ["Monthly input tokens", Math.round(m.monthlyInputTokens)],
    ["Monthly output tokens", Math.round(m.monthlyOutputTokens)],
    ["Queries per month", inputs.traffic.queriesPerMonth],
    [],
    ["Component", "Monthly cost (USD)", "Share (%)"],
    // Stable CANONICAL order (docs/EXPORT_SPEC.md §1), not the cost-descending
    // display sort — exports must be deterministic for diffing/QA. #28.
    ...result.breakdown.map((r) => [
      r.label,
      r.monthly$.toFixed(2),
      (m.totalMonthly > 0 ? (r.monthly$ / m.totalMonthly) * 100 : 0).toFixed(2),
    ]),
  ];
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

/** Full assumptions dump: inputs + a trimmed pricing provenance record. */
export function assumptionsToJson(
  inputs: CalcInputs,
  priceBook: PriceBook,
  asOf: string,
  result?: CalcResult
): string {
  const cx = result?.crossover;
  // Billed/required fleet (M) so the export reflects what's actually charged, not
  // just the entered count (N) inside `inputs`. Present only for self-hosted mode.
  const fleet =
    cx && inputs.generation.mode === "self-hosted"
      ? {
          enteredInstances: cx.userInstances,
          billedInstances: cx.boxes,
          requiredInstances: cx.requiredInstances,
          autoSized: cx.autoSized,
          feasible: cx.feasible,
          ownedCapacity: cx.ownedCapacity,
          replicas: cx.replicas,
          instancesPerReplica: cx.instancesPerReplica,
          haEnabled: inputs.generation.haEnabled,
          haReplicasAdded: cx.haReplicasAdded,
          capacity: {
            source: cx.capacity.source,
            slaAchievable: cx.capacity.slaAchievable,
            benchmark: cx.capacity.benchmarkAvailable
              ? {
                  model: cx.capacity.benchModelKey,
                  framework: cx.capacity.framework,
                  precisionUsed: cx.capacity.precisionUsed,
                  seqBucket: cx.capacity.seqUsed,
                  gpusInConfig: cx.capacity.gpusInConfig,
                }
              : null,
            extrapolationReasons: cx.capacity.extrapolationReasons,
            chosenConcurrency: cx.capacity.chosenConcurrency,
            perGpuDecodeTokS: cx.capacity.perGpuDecodeTokS,
            achievedInteractivity: cx.capacity.achievedInteractivity,
            ttftS: cx.capacity.ttftS,
            weightPrecisionBits: cx.capacity.weightPrecisionBits,
            kvPrecisionBits: cx.capacity.kvPrecisionBits,
            weightsGB: cx.capacity.weightsGB,
            kvCacheGB: cx.capacity.kvCacheGB,
          },
          demand: {
            avgDecodeTokS: cx.avgDecodeDemand,
            peakDecodeTokS: cx.peakDecodeDemand,
            providedDecodeTokS: cx.providedDecodeCapacity,
            utilAvg: cx.utilAvg,
            utilPeak: cx.utilPeak,
          },
        }
      : undefined;
  return JSON.stringify(
    {
      exportedFor: "AWS RAG Price Calculator",
      ...(fleet ? { fleet } : {}),
      pricing: {
        asOf,
        region: priceBook.region,
        source: priceBook.source,
        updatedAt: priceBook.updatedAt,
        models: priceBook.models.map((mo) => ({
          id: mo.id,
          label: mo.label,
          kind: mo.kind,
          inPricePer1K: mo.inPricePer1K,
          outPricePer1K: mo.outPricePer1K,
          verifiedAt: mo.verifiedAt,
        })),
        opensearch: priceBook.opensearch,
        gpus: priceBook.gpus,
      },
      inputs,
    },
    null,
    2
  );
}

/**
 * Human-readable Markdown report: headline metrics, the full cost breakdown, the
 * scenario comparison, the crossover verdict, and the key assumptions behind them.
 * `resultA` MUST be the Mode-A (self-built) result so the scenarios reflect real
 * GPU economics. Pure string builder — safe to call anywhere.
 */
export function buildReport(
  inputs: CalcInputs,
  resultA: CalcResult,
  priceBook: PriceBook,
  asOf: string
): string {
  const m = deriveDisplayMetrics(resultA, inputs);
  const g = inputs.generation;
  const usd = (n: number, d = 2) =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  const selfHosted = g.mode === "self-hosted";

  const lines: string[] = [];
  lines.push(`# RAG Cost Report`);
  lines.push("");
  lines.push(`- **Region:** ${priceBook.region}`);
  lines.push(`- **Pricing as of:** ${asOf} (source: ${priceBook.source})`);
  lines.push(`- **Deployment:** ${selfHosted ? "Self-hosted GPU" : "Bedrock API"} · ${g.llmModelId}`);
  lines.push(`- **Traffic:** ${inputs.traffic.queriesPerMonth.toLocaleString()} queries/mo` +
    (inputs.traffic.peakFactor > 1 ? ` · ${inputs.traffic.peakFactor}× peak-to-average` : ""));
  lines.push("");

  lines.push(`## Headline`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Estimated monthly cost | ${usd(m.totalMonthly)} |`);
  lines.push(`| Cost per query | ${usd(m.costPerQuery, 6)} |`);
  lines.push(`| Cost per 1,000 queries | ${usd(m.costPer1000)} |`);
  lines.push(`| Annualized | ${usd(m.annualized)} |`);
  lines.push(`| Largest driver | ${resultA.dominantLever.label} (${Math.round(resultA.dominantLever.share * 100)}%) |`);
  lines.push("");

  lines.push(`## Cost breakdown (monthly)`);
  lines.push("");
  lines.push(`| Component | Monthly | Share |`);
  lines.push(`| --- | ---: | ---: |`);
  for (const r of m.breakdown) {
    lines.push(`| ${r.label} | ${usd(r.monthly)} | ${(r.share * 100).toFixed(1)}% |`);
  }
  lines.push(`| **Total** | **${usd(m.totalMonthly)}** | 100% |`);
  lines.push("");

  lines.push(`## Scenario comparison`);
  lines.push("");
  lines.push(`| Scenario | Monthly | Per 1K | vs baseline |`);
  lines.push(`| --- | ---: | ---: | ---: |`);
  for (const s of buildScenarios(resultA, inputs)) {
    const monthly = s.monthly == null ? "—" : usd(s.monthly);
    const per1k = s.per1000 == null ? "—" : usd(s.per1000);
    lines.push(`| ${s.label} | ${monthly} | ${per1k} | ${s.difference} |`);
  }
  lines.push("");

  const cx = resultA.crossover;
  lines.push(`## Self-host vs API crossover`);
  lines.push("");
  lines.push(`- **Verdict:** ${cx.verdict}`);
  if (cx.breakEvenTokens > 0) {
    lines.push(`- **Break-even:** ${Math.round(cx.breakEvenTokens).toLocaleString()} tokens/mo (~${cx.equivalentQPS.toFixed(2)} QPS)`);
    lines.push(`- **Utilization to break even:** ${cx.utilAtBreakEven <= 1 ? `${Math.round(cx.utilAtBreakEven * 100)}%` : `${cx.utilAtBreakEven.toFixed(1)}× capacity (infeasible)`}`);
  }
  lines.push("");

  lines.push(`## Key assumptions`);
  lines.push("");
  if (selfHosted) {
    lines.push(`- **GPU:** ${g.gpuInstanceType} at ${usd(g.gpuPricePerHr)}/hr on-demand · ${g.gpuPricingModel} · ${Math.min(730, g.gpuUptimeHoursPerMonth)} hrs/mo uptime`);
    lines.push(
      cx.autoSized
        ? `- **Fleet:** entered ${cx.userInstances}, billed **${cx.boxes}** — auto-sized from ${cx.userInstances} to ${cx.boxes} to serve this workload (memory floor ${cx.minInstancesToLoad}, throughput needs ${cx.throughputInstances})`
        : !cx.feasible
          ? `- **Fleet:** ${cx.boxes} instance(s) — **infeasible** for this load (needs ≥ ${cx.requiredInstances}); auto-size is off`
          : `- **Fleet:** ${cx.boxes} instance(s); memory floor ${cx.minInstancesToLoad}, throughput needs ${cx.throughputInstances}`
    );
    lines.push(`- **Precision:** ${g.weightBits}-bit weights · ${g.kvBits}-bit KV cache · ${g.maxContextLen} ctx × ${g.maxConcurrentSeqs} max concurrent`);
    const cap = cx.capacity;
    lines.push(
      `- **Capacity source:** ${cap.source}${cap.benchmarkAvailable ? ` (${cap.benchModelKey} · ${cap.framework} · ${cap.precisionUsed} · ${cap.seqUsed} · ${cap.gpusInConfig} GPUs measured)` : ""}`
    );
    if (cap.extrapolationReasons.length > 0)
      lines.push(`- **Extrapolation:** ${cap.extrapolationReasons.join("; ")}`);
    lines.push(
      `- **Operating point:** ${cap.chosenConcurrency} concurrent · ${Math.round(cap.perGpuDecodeTokS)} tok/s/GPU · ${Math.round(cap.achievedInteractivity)} tok/s/user (target ${g.interactivityTarget}) · TTFT ${cap.ttftS.toFixed(1)}s (max ${(g.ttftTargetMs / 1000).toFixed(1)}s) · SLA ${cap.slaAchievable ? "met" : "**NOT met — infeasible**"}`
    );
    lines.push(
      `- **Topology:** ${cx.replicas} replica(s) × ${cx.instancesPerReplica} box(es) = ${cx.requiredInstances} instances · HA ${g.haEnabled ? `N+1 (on, +${cx.haReplicasAdded} replica)` : "**excluded (off)**"}`
    );
    lines.push(
      `- **Memory:** weights ${Math.round(cap.weightsGB)} GB + KV ${Math.round(cap.kvCacheGB)} GB + reserve → memory floor ${cap.memoryFloorBoxes} box(es)`
    );
  } else {
    lines.push(`- **API model:** ${g.llmModelId} (in ${usd(g.llmInPricePer1K, 5)} / out ${usd(g.llmOutPricePer1K, 5)} per 1K)`);
  }
  lines.push(`- **Retrieval:** topK ${inputs.retrieval.topK}, topN ${inputs.retrieval.topN}, rerank ${inputs.retrieval.rerankEnabled ? "on" : "off"}`);
  lines.push(`- **Guardrails:** input ${inputs.guardrails.inputEnabled ? "on" : "off"}, output ${inputs.guardrails.outputEnabled ? "on" : "off"}`);
  const ops = inputs.ops;
  if (ops.networkingMonthly$ || ops.observabilityMonthly$ || ops.overheadPct) {
    lines.push(`- **Ops & overhead:** networking ${usd(ops.networkingMonthly$)}/mo, observability ${usd(ops.observabilityMonthly$)}/mo, +${ops.overheadPct}% overhead`);
  }
  lines.push("");
  lines.push(`_Generated by the RAG Cost Calculator. Figures are planning estimates from the assumptions above._`);
  lines.push("");

  return lines.join("\n");
}

/** Browser-only: trigger a file download of a text blob. No-op server-side. */
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
