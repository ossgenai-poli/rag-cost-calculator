// Hardened vertical-slice tests: fail-closed eligibility, evidence-state, topology,
// latency, transformation, schema validation, provenance + the reviewer reproductions.
import { describe, it, expect } from "vitest";
import type { BenchmarkRecord, Provenance, RequestSpec } from "./schema";
import { resolveOperatingPoint } from "./index";
import { loadCatalog, loadAllSnapshots } from "./sources";
import { inferencexAdapter } from "./sources/inferencex";
import { normalizeSafe, validateRecord } from "./normalize";
import { evaluate } from "./eligibility";
import { selectBest } from "./select";
import { canonicalJson, sha256 } from "./hash";
import { getBenchmarkCurve, operatingPointAt } from "../benchmarks";
import manifest from "./raw/MANIFEST.json";
import inxRaw from "./raw/inferencex/dsv4-b200-fp4-1024.json";

// ---- helpers ---------------------------------------------------------------
function prov(sourceClass: Provenance["sourceClass"], sourceName: string, snapshotKind: Provenance["snapshotKind"] = "verified"): Provenance {
  return {
    sourceName,
    sourceClass,
    sourceUrl: "https://example/pinned",
    sourceCommit: "pinned0000",
    runId: "1",
    retrievedAt: "2026-07-14",
    rawChecksum: "sha256:" + "a".repeat(64),
    license: "Apache-2.0",
    attribution: sourceName,
    snapshotKind,
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
    hostSystem: "H200-aws",
    hostIsAwsRepresentative: true,
    isl: 1024,
    osl: 1024,
    concurrency: 8,
    requestRate: null,
    prefixCache: null,
    specDecode: null,
    outputTputPerGpu: 600,
    inputTputPerGpu: 590,
    intvty: 40,
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
const req: RequestSpec = { modelId: "llama3.1-70b", weightPrecision: "fp8", kvPrecision: "fp8", gpuSku: "H200", isl: 1024, osl: 1024 };
const codes = (r: BenchmarkRecord, q: RequestSpec) => evaluate(r, q).reasons.map((x) => x.code);

// ---- 1 exact > proxy > scaled ---------------------------------------------
describe("1 — exact > proxy(host) > scaled(seq)", () => {
  it("selects exact over a host-proxy and an ISL-scaled record", () => {
    const exact = mk({ id: "exact" });
    const proxy = mk({ id: "proxy", hostIsAwsRepresentative: false, hostSystem: "HGX-nonaws" });
    const scaled = mk({ id: "scaled", isl: 8192 });
    expect(selectBest([proxy, scaled, exact], req)!.record.id).toBe("exact");
    expect(evaluate(proxy, req).evidenceStatus).toBe("proxy");
    expect(evaluate(scaled, req).evidenceStatus).toBe("measured-scaled");
  });
});

// ---- 2 independent > vendor (contract first) ------------------------------
describe("2 — independent-reviewed exact > vendor exact (tie-break after eligibility)", () => {
  it("MLPerf wins over TRT when both are exact-eligible", () => {
    const mlp = mk({ id: "mlp", provenance: prov("independent-reviewed", "MLPerf Inference") });
    const trt = mk({ id: "trt", provenance: prov("vendor-measured", "NVIDIA TensorRT-LLM") });
    expect(selectBest([trt, mlp], req)!.record.provenance.sourceClass).toBe("independent-reviewed");
  });
});

// ---- 3 latency gate --------------------------------------------------------
describe("3 — max-load / mean-TTFT cannot pass an interactive P99 gate (P1-5)", () => {
  const interactive: RequestSpec = { ...req, concurrency: 8, interactivity: { ttftSlaMs: 2000, ttftPercentile: "p99" } };
  it("max-load (no TTFT) is ineligible", () => {
    const max = mk({ id: "max", latencyQualified: false, ttft: null, tpot: 0.22 });
    expect(codes(max, interactive)).toContain("latency-gate");
  });
  it("a MEAN TTFT record cannot satisfy a P99 SLA", () => {
    const mean = mk({ id: "mean", ttft: { value: 0.52, percentile: "mean" } });
    expect(codes(mean, { ...req, concurrency: 8, interactivity: { ttftSlaMs: 1000, ttftPercentile: "p99" } })).toContain("ttft-percentile-insufficient");
  });
  it("a P99 record under the SLA is selected; streaming target is enforced", () => {
    const ok = mk({ id: "ok", ttft: { value: 0.5, percentile: "p99" }, intvty: 40 });
    expect(selectBest([ok], interactive)!.record.id).toBe("ok");
    expect(codes(ok, { ...interactive, interactivity: { ttftSlaMs: 2000, ttftPercentile: "p99", streamingTokPerSecPerUser: 60 } })).toContain("streaming-below-target");
  });
});

// ---- 4 mismatches never silent --------------------------------------------
describe("4 — precision/KV/model/engine/GPU/topology mismatches are never silent", () => {
  it("each mismatch yields an explicit reason code", () => {
    expect(codes(mk({ id: "a", weightPrecision: "fp4" }), req)).toContain("weight-precision-mismatch");
    expect(codes(mk({ id: "b", kvPrecision: "bf16" }), req)).toContain("kv-precision-mismatch");
    expect(codes(mk({ id: "c", framework: "vllm" }), { ...req, framework: "tensorrt-llm" })).toContain("engine-mismatch");
    expect(codes(mk({ id: "d", modelId: "other" }), req)).toContain("model-mismatch");
    expect(codes(mk({ id: "e", gpuSku: "B200" }), req)).toContain("gpu-not-equivalent");
    expect(codes(mk({ id: "f", serving: "disaggregated" }), { ...req, serving: "aggregated" })).toContain("serving-mismatch");
  });
});

// ---- P1-1 verified-only ----------------------------------------------------
describe("P1-1 — illustrative snapshots are never selectable", () => {
  it("an illustrative independent-reviewed record cannot outrank verified evidence", () => {
    const illus = mk({ id: "illus", provenance: prov("independent-reviewed", "MLPerf Inference", "illustrative-pending-ingestion") });
    const verified = mk({ id: "verified" });
    expect(evaluate(illus, req).eligible).toBe(false);
    expect(codes(illus, req)).toContain("not-verified");
    expect(selectBest([illus, verified], req)!.record.id).toBe("verified");
  });
  it("loadCatalog() contains only verified snapshots; loadAllSnapshots() includes illustrative", () => {
    expect(loadCatalog().every((r) => r.provenance.snapshotKind === "verified")).toBe(true);
    expect(loadAllSnapshots().some((r) => r.provenance.snapshotKind === "illustrative-pending-ingestion")).toBe(true);
  });
});

// ---- P1-2 accelerator equivalence -----------------------------------------
describe("P1-2 — arbitrary GPU substitution is denied (unbenchmarked)", () => {
  it("B200→T4 request is not a proxy — it is unbenchmarked", () => {
    const rec = mk({ id: "b200", gpuSku: "B200" });
    const res = resolveOperatingPoint({ ...req, gpuSku: "T4" }, { mode: "experimental", catalog: [rec] });
    expect(res.status).toBe("unbenchmarked");
  });
});

// ---- P1-3 topology enforcement --------------------------------------------
describe("P1-3 — requested topology mismatch is rejected", () => {
  it("8-GPU record requested as 1 GPU → ineligible", () => {
    expect(codes(mk({ id: "g", gpuCount: 8 }), { ...req, gpuCount: 1 })).toContain("gpu-count-mismatch");
  });
  it("single-node record requested as multi-node → ineligible", () => {
    expect(codes(mk({ id: "h", nodeCount: 1 }), { ...req, nodeCount: 2 })).toContain("node-count-mismatch");
  });
  it("TP mismatch → ineligible", () => {
    expect(codes(mk({ id: "i", parallelism: { tp: 8, pp: 1, ep: 1, dp: 1 } }), { ...req, parallelism: { tp: 4 } })).toContain("tp-mismatch");
  });
});

// ---- P1-4 KV unknown -------------------------------------------------------
describe("P1-4 — unknown KV precision cannot become measured-exact", () => {
  it("record KV null + requested fp8 → ineligible (kv-precision-unknown)", () => {
    const m = evaluate(mk({ id: "kv", kvPrecision: null }), req);
    expect(m.eligible).toBe(false);
    expect(m.reasons.map((r) => r.code)).toContain("kv-precision-unknown");
  });
});

// ---- P1-5 concurrency operating point -------------------------------------
describe("P1-5 — exact requires the measured operating point (concurrency)", () => {
  it("requested concurrency 20 with a record at 16 → concurrency-not-measured (not silent exact)", () => {
    expect(codes(mk({ id: "c16", concurrency: 16 }), { ...req, concurrency: 20 })).toContain("concurrency-not-measured");
  });
  it("streaming interactivity is preserved and returned", () => {
    const m = evaluate(mk({ id: "iv", intvty: 42.8 }), req);
    expect(m.operatingPoint!.intvty).toBe(42.8);
  });
});

// ---- P1-6 real transform ---------------------------------------------------
describe("P1-6 — ISL extrapolation applies a disclosed, bounded transform", () => {
  it("ISL 1024→8192 scales input throughput ×8, drops TTFT, and returns metadata", () => {
    const m = evaluate(mk({ id: "t", isl: 1024, inputTputPerGpu: 590 }), { ...req, isl: 8192 });
    expect(m.evidenceStatus).toBe("measured-scaled");
    expect(m.transformations![0].method).toBe("isl-linear-scale");
    expect(m.transformations![0].factor).toBe(8);
    expect(m.operatingPoint!.inputTputPerGpu).toBeCloseTo(590 * 8, 6);
    expect(m.operatingPoint!.ttftS).toBeNull(); // TTFT invalid at a new ISL
  });
  it("a precision substitution is NOT a transform → unbenchmarked", () => {
    const res = resolveOperatingPoint({ ...req, weightPrecision: "fp4" }, { mode: "experimental", catalog: [mk({ id: "p", weightPrecision: "fp8" })] });
    expect(res.status).toBe("unbenchmarked");
  });
});

// ---- 6 multi-node no fictional per-GPU (from the illustrative catalog) -----
describe("6 — multi-node system total is never split into per-GPU", () => {
  it("GB200 NVL72 record reports only a total; no per-GPU synthesized; ineligible for a per-GPU need", () => {
    const gb200 = loadAllSnapshots().find((r) => r.gpuSku === "GB200")!;
    expect(gb200.perGpuReported).toBe(false);
    expect(gb200.outputTputPerGpu).toBeNull();
    expect(gb200.throughputTotal).toBeGreaterThan(0);
    expect(codes(gb200, { modelId: gb200.modelId, weightPrecision: gb200.weightPrecision, gpuSku: "GB200", isl: 1024, osl: 1024 })).toContain("no-per-gpu-metric");
  });
});

// ---- 7 unbenchmarked -------------------------------------------------------
describe("7 — unbenchmarked when no qualified measurement exists", () => {
  it("no fabrication", () => {
    const res = resolveOperatingPoint({ modelId: "nope", weightPrecision: "fp8", gpuSku: "H200", isl: 1024, osl: 1024 }, { mode: "experimental" });
    expect(res.status).toBe("unbenchmarked");
    expect(res.operatingPoint).toBeUndefined();
  });
});

// ---- 8 legacy control unchanged -------------------------------------------
describe("8 — legacy rc-qa-11 result unchanged when experimental is disabled", () => {
  it("control mode == raw getBenchmarkCurve + operatingPointAt", () => {
    const control = { inferencexKey: "dsv4", instanceType: "p6-b200.48xlarge", weightBits: 4, isl: 2910, osl: 500, interactivityTarget: 30 };
    const res = resolveOperatingPoint({ modelId: "dsv4", weightPrecision: "fp4", gpuSku: "B200", isl: 2910, osl: 500 }, { mode: "control", control });
    const curve = getBenchmarkCurve("dsv4", "p6-b200.48xlarge", 4, 2910, 500)!;
    const op = operatingPointAt(curve.points, 30);
    expect(res.operatingPoint!.tputPerGpu).toBe(op.tputPerGpu);
    expect(res.operatingPoint!.inputTputPerGpu).toBe(op.inputTputPerGpu);
    expect(res.differsFromControl).toBe(false);
  });
});

// ---- 9 provenance reconciles (verified InferenceX) ------------------------
describe("9 — selected result reconciles with its provenance", () => {
  it("dsv4 exact from the verified InferenceX snapshot", () => {
    const q: RequestSpec = { modelId: "dsv4", weightPrecision: "fp4", kvPrecision: "fp8", gpuSku: "B200", isl: 1024, osl: 1024, concurrency: 8 };
    const res = resolveOperatingPoint(q, { mode: "experimental" });
    expect(res.status).toBe("selected");
    expect(res.confidence).toBe("open-reproducible");
    expect(res.provenance!.full.rawChecksum).toBe(res.record!.provenance.rawChecksum);
    expect(res.operatingPoint!.tputPerGpu).toBe(res.record!.outputTputPerGpu);
    expect(res.provenance!.headline).toContain("dsv4");
  });
});

// ---- 10 byte-identical -----------------------------------------------------
describe("10 — deterministic normalization", () => {
  it("loadCatalog() is byte-identical across calls", () => {
    expect(canonicalJson(loadCatalog())).toBe(canonicalJson(loadCatalog()));
  });
});

// ---- P1-7 exhaustive fail-closed validation -------------------------------
describe("P1-7 — schema validation fails closed on malformed data", () => {
  const bad = (o: Partial<BenchmarkRecord>) => () => validateRecord(mk({ id: "b", ...o }));
  it("rejects non-positive / non-finite numbers & inconsistent topology", () => {
    expect(bad({ gpuCount: -8 })).toThrow();
    expect(bad({ gpuMemGB: NaN })).toThrow();
    expect(bad({ parallelism: { tp: 0, pp: 1, ep: 1, dp: 1 } })).toThrow();
    expect(bad({ parallelism: { tp: 8, pp: -1, ep: 1, dp: 1 } })).toThrow();
    expect(bad({ nodeCount: 9, gpuCount: 8 })).toThrow(); // nodes > gpus
    expect(bad({ outputTputPerGpu: Infinity })).toThrow();
  });
  it("rejects bad enums / hashes / urls / dates / per-GPU", () => {
    expect(bad({ serving: "x" as any })).toThrow();
    expect(bad({ provenance: { ...prov("open-reproducible", "x"), rawChecksum: "nope" } })).toThrow();
    expect(bad({ provenance: { ...prov("open-reproducible", "x"), sourceUrl: "http://x" } })).toThrow();
    expect(bad({ provenance: { ...prov("open-reproducible", "x"), retrievedAt: "yesterday" } })).toThrow();
    expect(bad({ perGpuReported: false, outputTputPerGpu: 123 })).toThrow();
  });
  it("rejects a VERIFIED snapshot with a TBD/absent revision", () => {
    expect(bad({ provenance: { ...prov("open-reproducible", "x"), sourceCommit: "PINNED_COMMIT_TBD", runId: undefined } })).toThrow();
    expect(bad({ provenance: { ...prov("open-reproducible", "x"), sourceCommit: undefined, runId: undefined } })).toThrow();
  });
  it("adapter validates raw inputs before coercion (non-finite conc throws)", () => {
    const broken = JSON.parse(JSON.stringify(inxRaw));
    broken.points[0].conc = "abc";
    expect(() => inferencexAdapter.normalize(broken)).toThrow();
  });
  it("normalizeSafe rejects a record missing a required field", () => {
    const adapter = { sourceName: "x", sourceClass: "vendor-measured" as const, normalize: () => [{ ...mk({ id: "x" }), modelId: undefined as unknown as string }] };
    expect(() => normalizeSafe(adapter, {})).toThrow();
  });
});

// ---- P2-2 checksum / tamper ------------------------------------------------
describe("P2-2 — pinned checksums are verified; tamper fails closed", () => {
  it("the InferenceX snapshot matches its manifest checksum; a mutation does not", () => {
    const entry = (manifest as any).sources.find((s: any) => s.sourceName === "InferenceX").rawFiles[0];
    expect(sha256(inxRaw)).toBe(entry.rawChecksum);
    const tampered = JSON.parse(JSON.stringify(inxRaw));
    tampered.points[0].metrics.output_tput_per_gpu = 9999;
    expect(sha256(tampered)).not.toBe(entry.rawChecksum);
  });
});

// ---- P2-1 control diff -----------------------------------------------------
describe("P2-1 — control-diff compares concurrency & interactivity", () => {
  it("differing concurrency/interactivity is reported as a difference", () => {
    // control has an op point; experimental picks a different concurrency point → differs.
    const rec = mk({ id: "d", modelId: "dsv4", gpuSku: "B200", weightPrecision: "fp4", kvPrecision: "fp8", concurrency: 16, outputTputPerGpu: 106.4, inputTputPerGpu: 107.5, intvty: 56.7, ttft: { value: 2.24, percentile: "p99" } });
    const control = { inferencexKey: "dsv4", instanceType: "p6-b200.48xlarge", weightBits: 4, isl: 1024, osl: 1024, interactivityTarget: 30 };
    const res = resolveOperatingPoint({ modelId: "dsv4", weightPrecision: "fp4", kvPrecision: "fp8", gpuSku: "B200", isl: 1024, osl: 1024, concurrency: 16 }, { mode: "experimental", catalog: [rec], control });
    expect(res.status).toBe("selected");
    // control op (target 30 → some conc/intvty) vs experimental (conc 16, intvty 56.7) → differ.
    expect(res.differsFromControl).toBe(true);
  });
});

// ---- 12 offline ------------------------------------------------------------
describe("12 — offline from pinned data", () => {
  it("catalog resolves from local snapshots with valid checksums", () => {
    const cat = loadCatalog();
    expect(cat.length).toBeGreaterThan(0);
    for (const r of cat) expect(/^sha256:[0-9a-f]{64}$/.test(r.provenance.rawChecksum)).toBe(true);
  });
});
