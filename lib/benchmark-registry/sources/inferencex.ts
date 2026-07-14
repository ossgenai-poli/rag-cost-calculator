// InferenceX adapter — open-reproducible full-curve source. Pure & deterministic.
// Every numeric raw field goes through the shared strict validator (no coercion).
import type { BenchmarkRecord, SourceAdapter } from "../schema";
import { sha256 } from "../hash";
import { SchemaError, strictNum, strictNumOpt, strictStr } from "../raw-validate";
import { AWS_INSTANCE_ACCELERATOR } from "../instance-map";

// Re-export SchemaError for existing importers.
export { SchemaError } from "../raw-validate";

/** AWS instances this accelerator directly represents (reviewed hardware registry). */
function representativeInstances(accelerator: string): string[] {
  return Object.keys(AWS_INSTANCE_ACCELERATOR).filter((inst) => AWS_INSTANCE_ACCELERATOR[inst] === accelerator);
}

export const inferencexAdapter: SourceAdapter = {
  sourceName: "InferenceX",
  sourceClass: "open-reproducible",
  normalize(raw: unknown): BenchmarkRecord[] {
    const r = raw as any;
    const snap = r?._snapshot;
    const c = r?.config;
    if (!snap || !c || !Array.isArray(r?.points)) {
      throw new SchemaError("InferenceX snapshot missing _snapshot/config/points");
    }
    const checksum = sha256(raw);
    const gpuSku = strictStr(c.hardware, "config.hardware").toUpperCase();
    const gpuCount = c.disagg ? strictNum(c.num_prefill_gpu, "config.num_prefill_gpu") + strictNum(c.num_decode_gpu, "config.num_decode_gpu") : strictNum(c.num_decode_gpu, "config.num_decode_gpu");
    return r.points.map((p: any): BenchmarkRecord => {
      const m = p.metrics ?? {};
      return {
        id: `inx:${c.model}:${c.hardware}:${c.precision}:${p.isl}/${p.osl}:c${p.conc}`,
        provenance: {
          sourceName: "InferenceX",
          sourceClass: "open-reproducible",
          sourceUrl: snap.sourceUrl,
          runId: String(snap.pinnedRunId),
          sourceCommit: snap.recipeCommit,
          retrievedAt: snap.retrievedAt,
          rawChecksum: checksum,
          license: snap.license,
          attribution: snap.attribution,
          snapshotKind: snap.kind,
        },
        modelId: strictStr(c.model, "config.model"),
        checkpoint: strictStr(c.checkpoint, "config.checkpoint"),
        weightPrecision: strictStr(c.precision, "config.precision"),
        kvPrecision: c.kv_precision ?? null,
        framework: strictStr(c.framework, "config.framework"),
        frameworkVersion: c.framework_version,
        image: c.image,
        frameworkCommit: snap.recipeCommit,
        gpuSku,
        formFactor: strictStr(c.form_factor, "config.form_factor"),
        gpuMemGB: strictNum(c.gpu_mem_gb, "config.gpu_mem_gb"),
        gpuCount,
        nodeCount: c.is_multinode ? Math.ceil(gpuCount / 8) : 1,
        topology: `TP${strictNum(c.tp, "config.tp")}${c.disagg ? " disaggregated" : " aggregated"}`,
        interconnect: strictStr(c.interconnect, "config.interconnect"),
        parallelism: { tp: strictNum(c.tp, "config.tp"), pp: strictNum(c.pp, "config.pp"), ep: strictNum(c.ep, "config.ep"), dp: strictNum(c.dp, "config.dp") },
        serving: c.disagg ? "disaggregated" : "aggregated",
        hostSystem: `${gpuSku}-inferencex`,
        // Specific instances this B200 measurement represents (from the reviewed registry map).
        awsRepresentativeInstances: representativeInstances(gpuSku),
        isl: strictNum(p.isl, "point.isl"),
        osl: strictNum(p.osl, "point.osl"),
        concurrency: strictNum(p.conc, "point.conc"),
        requestRate: null,
        // Prefix-cache behavior is NOT reported by the InferenceX config → unknown (null).
        prefixCache: null,
        specDecode: c.spec_method ?? null,
        outputTputPerGpu: strictNumOpt(m.output_tput_per_gpu, "output_tput_per_gpu"),
        inputTputPerGpu: strictNumOpt(m.input_tput_per_gpu, "input_tput_per_gpu"),
        intvty: strictNumOpt(m.median_intvty, "median_intvty"),
        ttft: m.p99_ttft != null ? { value: strictNum(m.p99_ttft, "p99_ttft"), percentile: "p99" } : null,
        tpot: null,
        itl: null,
        throughputTotal: null,
        perGpuReported: true,
        latencyQualified: m.p99_ttft != null,
        measuredDate: strictStr(c.date, "config.date"),
        intrinsicQualifications: [],
        unknownFields: retainUnknown(m, ["median_intvty", "output_tput_per_gpu", "input_tput_per_gpu", "p99_ttft", "median_ttft"]),
      };
    });
  },
};

function retainUnknown(o: Record<string, unknown>, known: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) if (!known.includes(k)) out[k] = o[k];
  return out;
}
