// Hardened vertical-slice tests: fail-closed eligibility, evidence-state, topology,
// latency, transformation, request-contract, schema validation + reviewer reproductions.
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
  return { sourceName, sourceClass, sourceUrl: "https://example.com/pinned", sourceCommit: "pinned0000", runId: "1", retrievedAt: "2026-07-14", rawChecksum: "sha256:" + "a".repeat(64), license: "Apache-2.0", attribution: sourceName, snapshotKind };
}
function mk(o: Partial<BenchmarkRecord> & { id: string }): BenchmarkRecord {
  return {
    provenance: prov("open-reproducible", "InferenceX"),
    modelId: "llama3.1-70b", checkpoint: "Llama-3.1-70B-Instruct", weightPrecision: "fp8", kvPrecision: "fp8",
    framework: "tensorrt-llm", gpuSku: "H200", formFactor: "SXM", gpuMemGB: 141, gpuCount: 8, nodeCount: 1,
    topology: "TP8 aggregated single-node", interconnect: "NVLink", parallelism: { tp: 8, pp: 1, ep: 1, dp: 1 },
    serving: "aggregated", hostSystem: "H200-aws", hostIsAwsRepresentative: true,
    isl: 1024, osl: 1024, concurrency: 8, requestRate: null, prefixCache: null, specDecode: null,
    outputTputPerGpu: 600, inputTputPerGpu: 590, intvty: 40, ttft: { value: 0.5, percentile: "p99" },
    tpot: null, itl: null, throughputTotal: null, perGpuReported: true, latencyQualified: true,
    measuredDate: "2026-07-14", intrinsicQualifications: [], unknownFields: {},
    ...o,
  };
}
// Complete decision-critical requests.
const fullReq = (o: Partial<RequestSpec> = {}): RequestSpec => ({ modelId: "llama3.1-70b", weightPrecision: "fp8", kvPrecision: "fp8", framework: "tensorrt-llm", gpuSku: "H200", awsInstance: "p5en.48xlarge", gpuCount: 8, nodeCount: 1, serving: "aggregated", isl: 1024, osl: 1024, concurrency: 8, ...o });
const dsv4Req = (o: Partial<RequestSpec> = {}): RequestSpec => ({ modelId: "dsv4", weightPrecision: "fp4", kvPrecision: "fp8", framework: "trt", gpuSku: "B200", awsInstance: "p6-b200.48xlarge", gpuCount: 8, nodeCount: 1, serving: "aggregated", isl: 1024, osl: 1024, concurrency: 8, ...o });
const codes = (r: BenchmarkRecord, q: RequestSpec) => evaluate(r, q).reasons.map((x) => x.code);

// ---- precedence ------------------------------------------------------------
describe("precedence — exact > proxy(reviewed host) > scaled(seq)", () => {
  it("selects exact over an approved host-proxy and an ISL-scaled record", () => {
    const exact = mk({ id: "exact" });
    const proxy = mk({ id: "proxy", hostSystem: "hgx-h200-reviewed", hostIsAwsRepresentative: false });
    const scaled = mk({ id: "scaled", isl: 512 });
    expect(selectBest([proxy, scaled, exact], fullReq())!.record.id).toBe("exact");
    expect(evaluate(proxy, fullReq()).evidenceStatus).toBe("proxy");
    expect(evaluate(scaled, fullReq()).evidenceStatus).toBe("measured-scaled");
  });
  it("independent-reviewed exact > vendor exact (tie-break after eligibility)", () => {
    const mlp = mk({ id: "mlp", provenance: prov("independent-reviewed", "MLPerf Inference") });
    const trt = mk({ id: "trt", provenance: prov("vendor-measured", "NVIDIA TensorRT-LLM") });
    expect(selectBest([trt, mlp], fullReq())!.record.provenance.sourceClass).toBe("independent-reviewed");
  });
});

// ---- P1: latencyQualified enforced (NEW) -----------------------------------
describe("P1 — latencyQualified=false cannot satisfy an interactive SLA", () => {
  const interactive = fullReq({ interactivity: { ttftSlaMs: 2000, ttftPercentile: "p99" } });
  it("a record with P99 TTFT present but latencyQualified=false is rejected", () => {
    const rec = mk({ id: "nlq", latencyQualified: false, ttft: { value: 0.5, percentile: "p99" } });
    const m = evaluate(rec, interactive);
    expect(m.eligible).toBe(false);
    expect(m.reasons.map((r) => r.code)).toContain("latency-gate");
  });
  it("mean TTFT cannot satisfy P99; a P99 latency-qualified record passes", () => {
    expect(codes(mk({ id: "mean", ttft: { value: 0.4, percentile: "mean" } }), interactive)).toContain("ttft-percentile-insufficient");
    expect(evaluate(mk({ id: "ok" }), interactive).eligible).toBe(true);
  });
});

// ---- P1: ISL out-of-bounds (NEW) -------------------------------------------
describe("P1 — out-of-bounds ISL extrapolation → unbenchmarked (never clamped)", () => {
  it("ISL 1024→102400 (100×) is rejected, not silently clamped to 8×", () => {
    const m = evaluate(mk({ id: "oob", isl: 1024 }), fullReq({ isl: 102400 }));
    expect(m.eligible).toBe(false);
    expect(m.reasons.map((r) => r.code)).toContain("isl-scale-out-of-bounds");
  });
  it("an in-bounds ISL scale (8×) still works with the real factor", () => {
    const m = evaluate(mk({ id: "ok", isl: 1024, inputTputPerGpu: 590 }), fullReq({ isl: 8192 }));
    expect(m.evidenceStatus).toBe("measured-scaled");
    expect(m.transformations![0].factor).toBe(8);
    expect(m.operatingPoint!.inputTputPerGpu).toBeCloseTo(590 * 8, 6);
    expect(m.operatingPoint!.ttftS).toBeNull();
  });
});

// ---- P1: request contract (NEW) --------------------------------------------
describe("P1 — an incomplete/inconsistent request cannot become measured-exact", () => {
  it("a request missing decision-critical fields → unbenchmarked", () => {
    const partial = { modelId: "llama3.1-70b", weightPrecision: "fp8", gpuSku: "H200", isl: 1024, osl: 1024 } as unknown as RequestSpec;
    expect(codes(mk({ id: "x" }), partial)).toContain("incomplete-request");
    expect(resolveOperatingPoint(partial, { mode: "experimental", catalog: [mk({ id: "x" })] }).status).toBe("unbenchmarked");
  });
  it("a made-up AWS instance → unknown-aws-instance", () => {
    expect(codes(mk({ id: "x" }), fullReq({ awsInstance: "made-up-b200-instance" }))).toContain("unknown-aws-instance");
  });
  it("an instance/accelerator inconsistency → rejected", () => {
    expect(codes(mk({ id: "x", gpuSku: "B200" }), fullReq({ gpuSku: "B200", awsInstance: "p5en.48xlarge" }))).toContain("instance-accelerator-inconsistent");
  });
});

// ---- P1: host equivalence deny-by-default (NEW) ----------------------------
describe("P1 — same-accelerator non-AWS host needs a reviewed equivalence", () => {
  it("an unreviewed non-AWS host → unbenchmarked (not a generic proxy)", () => {
    expect(codes(mk({ id: "h", hostSystem: "hgx-random", hostIsAwsRepresentative: false }), fullReq())).toContain("host-not-equivalent");
  });
  it("a reviewed host equivalence → proxy", () => {
    expect(evaluate(mk({ id: "h", hostSystem: "hgx-h200-reviewed", hostIsAwsRepresentative: false }), fullReq()).evidenceStatus).toBe("proxy");
  });
});

// ---- mismatches never silent -----------------------------------------------
describe("mismatches never silent (precision/KV/model/engine/GPU/topology)", () => {
  it("each mismatch yields an explicit reason code", () => {
    expect(codes(mk({ id: "a", weightPrecision: "fp4" }), fullReq())).toContain("weight-precision-mismatch");
    expect(codes(mk({ id: "b", kvPrecision: "bf16" }), fullReq())).toContain("kv-precision-mismatch");
    expect(codes(mk({ id: "b2", kvPrecision: null }), fullReq())).toContain("kv-precision-unknown");
    expect(codes(mk({ id: "c", framework: "vllm" }), fullReq({ framework: "tensorrt-llm" }))).toContain("engine-mismatch");
    expect(codes(mk({ id: "d", modelId: "other" }), fullReq())).toContain("model-mismatch");
    expect(codes(mk({ id: "e", gpuSku: "B200" }), fullReq({ gpuSku: "T4", awsInstance: "g4dn.xlarge" }))).toContain("gpu-not-equivalent");
    expect(codes(mk({ id: "f", serving: "disaggregated" }), fullReq())).toContain("serving-mismatch");
    expect(codes(mk({ id: "g", gpuCount: 8 }), fullReq({ gpuCount: 1 }))).toContain("gpu-count-mismatch");
    expect(codes(mk({ id: "h", nodeCount: 1 }), fullReq({ nodeCount: 2 }))).toContain("node-count-mismatch");
    expect(codes(mk({ id: "i", concurrency: 16 }), fullReq({ concurrency: 20 }))).toContain("concurrency-not-measured");
  });
});

// ---- illustrative / catalog ------------------------------------------------
describe("P1-1 — illustrative snapshots are never selectable", () => {
  it("illustrative record ineligible; verified wins", () => {
    const illus = mk({ id: "illus", provenance: prov("independent-reviewed", "MLPerf Inference", "illustrative-pending-ingestion") });
    expect(codes(illus, fullReq())).toContain("not-verified");
    expect(selectBest([illus, mk({ id: "verified" })], fullReq())!.record.id).toBe("verified");
  });
  it("loadCatalog() verified-only; loadAllSnapshots() includes illustrative", () => {
    expect(loadCatalog().every((r) => r.provenance.snapshotKind === "verified")).toBe(true);
    expect(loadAllSnapshots().some((r) => r.provenance.snapshotKind === "illustrative-pending-ingestion")).toBe(true);
  });
});

// ---- cross-accelerator ------------------------------------------------------
describe("P1-2 — cross-accelerator substitution is denied", () => {
  it("B200 record for a T4 request → unbenchmarked", () => {
    expect(resolveOperatingPoint(fullReq({ gpuSku: "T4", awsInstance: "g4dn.xlarge" }), { mode: "experimental", catalog: [mk({ id: "b", gpuSku: "B200" })] }).status).toBe("unbenchmarked");
  });
});

// ---- multi-node / unbenchmarked / control / provenance ---------------------
describe("multi-node, unbenchmarked, control, provenance", () => {
  it("GB200 NVL72 total is never split into per-GPU", () => {
    const gb200 = loadAllSnapshots().find((r) => r.gpuSku === "GB200")!;
    expect(gb200.perGpuReported).toBe(false);
    expect(gb200.outputTputPerGpu).toBeNull();
    expect(gb200.throughputTotal).toBeGreaterThan(0);
  });
  it("unbenchmarked when no qualified measurement exists", () => {
    const res = resolveOperatingPoint(fullReq({ modelId: "nope" }), { mode: "experimental" });
    expect(res.status).toBe("unbenchmarked");
    expect(res.operatingPoint).toBeUndefined();
  });
  it("legacy control unchanged when experimental disabled", () => {
    const control = { inferencexKey: "dsv4", instanceType: "p6-b200.48xlarge", weightBits: 4, isl: 2910, osl: 500, interactivityTarget: 30 };
    const res = resolveOperatingPoint(dsv4Req({ isl: 2910, osl: 500 }), { mode: "control", control });
    const op = operatingPointAt(getBenchmarkCurve("dsv4", "p6-b200.48xlarge", 4, 2910, 500)!.points, 30);
    expect(res.operatingPoint!.tputPerGpu).toBe(op.tputPerGpu);
    expect(res.differsFromControl).toBe(false);
  });
  it("selected result reconciles with provenance (verified dsv4 exact)", () => {
    const res = resolveOperatingPoint(dsv4Req({ concurrency: 8 }), { mode: "experimental" });
    expect(res.status).toBe("selected");
    expect(res.confidence).toBe("open-reproducible");
    expect(res.provenance!.full.rawChecksum).toBe(res.record!.provenance.rawChecksum);
    expect(res.operatingPoint!.tputPerGpu).toBe(res.record!.outputTputPerGpu);
    expect(res.provenance!.headline).toContain("dsv4");
  });
});

// ---- determinism / control-diff --------------------------------------------
describe("determinism & control-diff", () => {
  it("loadCatalog() is byte-identical across calls", () => {
    expect(canonicalJson(loadCatalog())).toBe(canonicalJson(loadCatalog()));
  });
  it("control-diff compares concurrency/interactivity", () => {
    const rec = mk({ id: "d", modelId: "dsv4", gpuSku: "B200", weightPrecision: "fp4", kvPrecision: "fp8", framework: "trt", concurrency: 16, outputTputPerGpu: 106.4, inputTputPerGpu: 107.5, intvty: 56.7, ttft: { value: 2.24, percentile: "p99" } });
    const control = { inferencexKey: "dsv4", instanceType: "p6-b200.48xlarge", weightBits: 4, isl: 1024, osl: 1024, interactivityTarget: 30 };
    const res = resolveOperatingPoint(dsv4Req({ concurrency: 16 }), { mode: "experimental", catalog: [rec], control });
    expect(res.status).toBe("selected");
    expect(res.differsFromControl).toBe(true);
  });
});

// ---- P1-7 exhaustive validation --------------------------------------------
describe("P1-7 — schema validation fails closed", () => {
  const bad = (o: Partial<BenchmarkRecord>) => () => validateRecord(mk({ id: "b", ...o }));
  it("rejects malformed numbers & inconsistent topology", () => {
    expect(bad({ gpuCount: -8 })).toThrow();
    expect(bad({ gpuMemGB: NaN })).toThrow();
    expect(bad({ parallelism: { tp: 0, pp: 1, ep: 1, dp: 1 } })).toThrow();
    expect(bad({ parallelism: { tp: 8, pp: -1, ep: 1, dp: 1 } })).toThrow();
    expect(bad({ nodeCount: 9, gpuCount: 8 })).toThrow();
    expect(bad({ outputTputPerGpu: Infinity })).toThrow();
  });
  it("rejects bad enums / hashes / urls / dates / per-GPU", () => {
    expect(bad({ serving: "x" as any })).toThrow();
    expect(bad({ provenance: { ...prov("open-reproducible", "x"), rawChecksum: "nope" } })).toThrow();
    expect(bad({ provenance: { ...prov("open-reproducible", "x"), sourceUrl: "https://" } })).toThrow(); // no host
    expect(bad({ provenance: { ...prov("open-reproducible", "x"), retrievedAt: "2026-99-99garbage" } })).toThrow();
    expect(bad({ perGpuReported: false, outputTputPerGpu: 123 })).toThrow();
  });
  it("rejects a VERIFIED snapshot with a TBD/absent revision", () => {
    expect(bad({ provenance: { ...prov("open-reproducible", "x"), sourceCommit: "PINNED_COMMIT_TBD", runId: undefined } })).toThrow();
    expect(bad({ provenance: { ...prov("open-reproducible", "x"), sourceCommit: undefined, runId: undefined } })).toThrow();
  });
  it("adapter rejects a raw STRING where a number is required (no silent coercion)", () => {
    const broken = JSON.parse(JSON.stringify(inxRaw));
    broken.points[0].conc = "8"; // string, not number
    expect(() => inferencexAdapter.normalize(broken)).toThrow();
  });
  it("normalizeSafe rejects a record missing a required field", () => {
    const adapter = { sourceName: "x", sourceClass: "vendor-measured" as const, normalize: () => [{ ...mk({ id: "x" }), modelId: undefined as unknown as string }] };
    expect(() => normalizeSafe(adapter, {})).toThrow();
  });
});

// ---- P2-2 checksum / tamper ------------------------------------------------
describe("P2-2 — pinned checksums verified; tamper fails closed", () => {
  it("InferenceX snapshot matches its manifest checksum; a mutation does not", () => {
    const entry = (manifest as any).sources.find((s: any) => s.sourceName === "InferenceX").rawFiles[0];
    expect(sha256(inxRaw)).toBe(entry.rawChecksum);
    const tampered = JSON.parse(JSON.stringify(inxRaw));
    tampered.points[0].metrics.output_tput_per_gpu = 9999;
    expect(sha256(tampered)).not.toBe(entry.rawChecksum);
  });
});

// ---- offline ---------------------------------------------------------------
describe("offline from pinned data", () => {
  it("catalog resolves locally with valid checksums", () => {
    const cat = loadCatalog();
    expect(cat.length).toBeGreaterThan(0);
    for (const r of cat) expect(/^sha256:[0-9a-f]{64}$/.test(r.provenance.rawChecksum)).toBe(true);
  });
});
