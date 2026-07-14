// Vertical-slice tests for the multi-source benchmark provenance layer.
// Determinism · precedence · provenance · fail-closed · legacy-control preservation.
import { describe, it, expect } from "vitest";
import type { BenchmarkRecord, Provenance, RequestSpec } from "./schema";
import { resolveOperatingPoint } from "./index";
import { loadCatalog } from "./sources";
import { inferencexAdapter } from "./sources/inferencex";
import { normalizeSafe, validateRecord } from "./normalize";
import { evaluate } from "./eligibility";
import { selectBest } from "./select";
import { canonicalJson } from "./hash";
// Frozen rc-qa-11 primitives — used ONLY to prove the control is unchanged.
import { getBenchmarkCurve, operatingPointAt } from "../benchmarks";

// ---- helpers ---------------------------------------------------------------
function prov(sourceClass: Provenance["sourceClass"], sourceName: string): Provenance {
  return {
    sourceName,
    sourceClass,
    sourceUrl: "https://example/pinned",
    retrievedAt: "2026-07-14",
    rawChecksum: "sha256:test",
    license: "Apache-2.0",
    attribution: sourceName,
    snapshotKind: "verified",
  };
}
function mk(o: Partial<BenchmarkRecord> & { id: string }): BenchmarkRecord {
  return {
    provenance: prov("open-reproducible", "InferenceX"),
    modelId: "llama3.1-70b",
    checkpoint: "Llama-3.1-70B-Instruct",
    weightPrecision: "fp8",
    kvPrecision: "fp8",
    framework: "tensorrt-llm",
    gpuSku: "H200",
    formFactor: "SXM",
    gpuMemGB: 141,
    gpuCount: 8,
    nodeCount: 1,
    topology: "TP8 aggregated single-node",
    interconnect: "NVLink",
    parallelism: { tp: 8, pp: 1, ep: 1, dp: 1 },
    serving: "aggregated",
    isl: 1024,
    osl: 1024,
    concurrency: 8,
    requestRate: null,
    prefixCache: null,
    specDecode: null,
    outputTputPerGpu: 600,
    inputTputPerGpu: 590,
    ttft: { value: 0.5, percentile: "p99" },
    tpot: null,
    itl: null,
    throughputTotal: null,
    perGpuReported: true,
    latencyQualified: true,
    measuredDate: "2026-07-14",
    intrinsicQualifications: [],
    unknownFields: {},
    ...o,
  };
}
const llamaReq: RequestSpec = { modelId: "llama3.1-70b", weightPrecision: "fp8", kvPrecision: "fp8", gpuSku: "H200", isl: 1024, osl: 1024, concurrency: 8 };

// ---- 1 ---------------------------------------------------------------------
describe("1 — exact beats proxy beats extrapolated", () => {
  it("selects the exact record over a gpu-proxy and a seq-extrapolated one", () => {
    const exact = mk({ id: "exact", provenance: prov("open-reproducible", "InferenceX") });
    const proxy = mk({ id: "proxy", gpuSku: "B200", provenance: prov("vendor-measured", "TRT") });
    const extrap = mk({ id: "extrap", isl: 8192, provenance: prov("vendor-measured", "TRT") });
    const best = selectBest([proxy, extrap, exact], llamaReq)!;
    expect(best.record.id).toBe("exact");
    expect(best.evidenceStatus).toBe("measured-exact");
    expect(evaluate(proxy, llamaReq).evidenceStatus).toBe("proxy");
    expect(evaluate(extrap, llamaReq).evidenceStatus).toBe("extrapolated");
  });
});

// ---- 2 ---------------------------------------------------------------------
describe("2 — independent-reviewed exact beats vendor exact", () => {
  it("MLPerf wins over TensorRT-LLM when both are exact", () => {
    const mlperf = mk({ id: "mlp", provenance: prov("independent-reviewed", "MLPerf Inference") });
    const vendor = mk({ id: "trt", provenance: prov("vendor-measured", "NVIDIA TensorRT-LLM") });
    const best = selectBest([vendor, mlperf], llamaReq)!;
    expect(best.record.provenance.sourceClass).toBe("independent-reviewed");
    expect(best.confidence).toBe("independent-reviewed");
  });
});

// ---- 3 ---------------------------------------------------------------------
describe("3 — a max-throughput-only result cannot pass an interactive latency gate", () => {
  const interactive: RequestSpec = { ...llamaReq, interactivity: { ttftSlaMs: 2000 } };
  it("max-load record is ineligible under an interactive SLA → unbenchmarked when alone", () => {
    const maxLoad = mk({ id: "max", latencyQualified: false, ttft: null, tpot: 0.22, concurrency: 512 });
    expect(evaluate(maxLoad, interactive).eligible).toBe(false);
    expect(evaluate(maxLoad, interactive).reasons.map((r) => r.code)).toContain("latency-gate");
    const res = resolveOperatingPoint(interactive, { mode: "experimental", catalog: [maxLoad] });
    expect(res.status).toBe("unbenchmarked");
  });
  it("a latency-qualified record under the SLA IS selected", () => {
    const maxLoad = mk({ id: "max", latencyQualified: false, ttft: null, concurrency: 512 });
    const ok = mk({ id: "ok", ttft: { value: 0.5, percentile: "p99" }, latencyQualified: true });
    expect(selectBest([maxLoad, ok], interactive)!.record.id).toBe("ok");
  });
});

// ---- 4 ---------------------------------------------------------------------
describe("4 — precision/KV/model/engine/sequence/topology mismatches are never silent", () => {
  it("each mismatch yields an explicit reason code", () => {
    const codes = (r: BenchmarkRecord, req: RequestSpec) => evaluate(r, req).reasons.map((x) => x.code);
    expect(codes(mk({ id: "a", weightPrecision: "fp4" }), llamaReq)).toContain("weight-precision-mismatch");
    expect(codes(mk({ id: "b", kvPrecision: "bf16" }), llamaReq)).toContain("kv-precision-mismatch");
    expect(codes(mk({ id: "c", framework: "vllm" }), { ...llamaReq, framework: "tensorrt-llm" })).toContain("engine-mismatch");
    expect(codes(mk({ id: "d", isl: 8192 }), llamaReq)).toContain("isl-mismatch");
    expect(codes(mk({ id: "e", gpuSku: "B200" }), llamaReq)).toContain("gpu-proxy");
    expect(codes(mk({ id: "f", serving: "disaggregated" }), { ...llamaReq, serving: "aggregated" })).toContain("serving-mismatch");
    // model mismatch → ineligible with a reason (never a silent transfer)
    const m = evaluate(mk({ id: "g", modelId: "other" }), llamaReq);
    expect(m.eligible).toBe(false);
    expect(m.reasons.map((x) => x.code)).toContain("model-mismatch");
  });
});

// ---- 5 ---------------------------------------------------------------------
describe("5 — whole serving-group topology is preserved (never reshaped)", () => {
  it("selected operating point uses the record's real per-GPU value and whole-group topology", () => {
    const rec = mk({ id: "grp", gpuCount: 8, outputTputPerGpu: 600, topology: "TP8 aggregated single-node" });
    const m = selectBest([rec], llamaReq)!;
    expect(m.record.gpuCount).toBe(8);
    expect(m.operatingPoint!.tputPerGpu).toBe(600); // unchanged, not re-derived
    const res = resolveOperatingPoint(llamaReq, { mode: "experimental", catalog: [rec] });
    expect(res.provenance!.full.topology).toBe("TP8 aggregated single-node");
  });
});

// ---- 6 ---------------------------------------------------------------------
describe("6 — a multi-node result is never divided into fictional single-GPU performance", () => {
  it("the GB200 NVL72 record reports only a system total; no per-GPU synthesized; ineligible for a per-GPU need", () => {
    const cat = loadCatalog();
    const gb200 = cat.find((r) => r.gpuSku === "GB200")!;
    expect(gb200.perGpuReported).toBe(false);
    expect(gb200.outputTputPerGpu).toBeNull(); // NOT throughputTotal / gpuCount
    expect(gb200.throughputTotal).toBeGreaterThan(0);
    expect(gb200.nodeCount).toBeGreaterThan(1);
    const req: RequestSpec = { modelId: gb200.modelId, weightPrecision: gb200.weightPrecision, gpuSku: "GB200", isl: 1024, osl: 1024 };
    expect(evaluate(gb200, req).reasons.map((r) => r.code)).toContain("no-per-gpu-metric");
    expect(resolveOperatingPoint(req, { mode: "experimental", catalog: [gb200] }).status).toBe("unbenchmarked");
  });
});

// ---- 7 ---------------------------------------------------------------------
describe("7 — unbenchmarked when no qualified measurement exists", () => {
  it("returns unbenchmarked, no operating point, no fabrication", () => {
    const req: RequestSpec = { modelId: "nonexistent-model", weightPrecision: "fp8", gpuSku: "H200", isl: 1024, osl: 1024 };
    const res = resolveOperatingPoint(req, { mode: "experimental" });
    expect(res.status).toBe("unbenchmarked");
    expect(res.confidence).toBe("unbenchmarked");
    expect(res.operatingPoint).toBeUndefined();
  });
});

// ---- 8 ---------------------------------------------------------------------
describe("8 — legacy rc-qa-11 result is unchanged when the experimental selector is disabled", () => {
  it("control mode == raw getBenchmarkCurve + operatingPointAt", () => {
    const control = { inferencexKey: "dsv4", instanceType: "p6-b200.48xlarge", weightBits: 4, isl: 2910, osl: 500, interactivityTarget: 30 };
    const res = resolveOperatingPoint({ modelId: "dsv4", weightPrecision: "fp4", gpuSku: "B200", isl: 2910, osl: 500 }, { mode: "control", control });
    const curve = getBenchmarkCurve("dsv4", "p6-b200.48xlarge", 4, 2910, 500)!;
    const op = operatingPointAt(curve.points, 30);
    expect(res.status).toBe("selected");
    expect(res.operatingPoint!.tputPerGpu).toBe(op.tputPerGpu);
    expect(res.operatingPoint!.inputTputPerGpu).toBe(op.inputTputPerGpu);
    expect(res.operatingPoint!.ttftS).toBe(op.ttft);
    expect(res.differsFromControl).toBe(false);
  });
});

// ---- 9 ---------------------------------------------------------------------
describe("9 — every selected result reconciles with its trust-panel/export provenance", () => {
  it("provenance view maps to the selected record", () => {
    const req: RequestSpec = { modelId: "dsv4", weightPrecision: "fp4", kvPrecision: "fp8", gpuSku: "B200", isl: 1024, osl: 1024, concurrency: 8 };
    const res = resolveOperatingPoint(req, { mode: "experimental" });
    expect(res.status).toBe("selected");
    const rec = res.record!;
    expect(res.provenance!.full.rawChecksum).toBe(rec.provenance.rawChecksum);
    expect(res.provenance!.full.source).toBe(rec.provenance.sourceName);
    expect(res.provenance!.full.evidenceStatus).toBe("measured-exact");
    expect(res.operatingPoint!.tputPerGpu).toBe(rec.outputTputPerGpu);
    expect(res.provenance!.headline).toContain("dsv4");
    expect(res.provenance!.headline).toContain("B200");
  });
});

// ---- 10 --------------------------------------------------------------------
describe("10 — identical pinned data → byte-identical normalized output", () => {
  it("loadCatalog() is deterministic", () => {
    expect(canonicalJson(loadCatalog())).toBe(canonicalJson(loadCatalog()));
  });
});

// ---- 11 --------------------------------------------------------------------
describe("11 — a source schema change fails closed", () => {
  it("adapter throws on a structural change instead of corrupting the catalog", () => {
    expect(() => inferencexAdapter.normalize({ _snapshot: {}, config: {} /* no points */ })).toThrow();
  });
  it("validateRecord rejects a per-GPU metric without perGpuReported (no fictional split)", () => {
    const bad = mk({ id: "bad", perGpuReported: false, outputTputPerGpu: 123 });
    expect(() => validateRecord(bad)).toThrow();
  });
  it("normalizeSafe rejects a record missing a required field", () => {
    const brokenAdapter = {
      sourceName: "x",
      sourceClass: "vendor-measured" as const,
      normalize: () => [{ ...mk({ id: "x", provenance: prov("vendor-measured", "x") }), modelId: undefined as unknown as string }],
    };
    expect(() => normalizeSafe(brokenAdapter, {})).toThrow();
  });
});

// ---- 12 --------------------------------------------------------------------
describe("12 — builds/runs completely offline from pinned data", () => {
  it("loadCatalog resolves from local snapshots only, with checksums", () => {
    const cat = loadCatalog();
    expect(cat.length).toBeGreaterThanOrEqual(3);
    for (const r of cat) expect(r.provenance.rawChecksum.startsWith("sha256:")).toBe(true);
    // a verified InferenceX record and at least one illustrative record are present & labeled
    expect(cat.some((r) => r.provenance.sourceName === "InferenceX" && r.provenance.snapshotKind === "verified")).toBe(true);
    expect(cat.some((r) => r.provenance.snapshotKind === "illustrative-pending-ingestion")).toBe(true);
  });
});
