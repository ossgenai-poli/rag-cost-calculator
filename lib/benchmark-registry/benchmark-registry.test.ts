// Hardened vertical-slice tests (4 review rounds). Fail-closed eligibility, evidence
// state, topology, latency, transformation, full request contract + runtime request
// validation, strict raw validation (numbers/strings/booleans), evidence hygiene,
// provenance, and injected (never-mutated) host equivalence.
import { describe, it, expect } from "vitest";
import type { BenchmarkRecord, Provenance, RequestSpec } from "./schema";
import { resolveOperatingPoint } from "./index";
import { loadCatalog, loadAllSnapshots } from "./sources";
import { inferencexAdapter } from "./sources/inferencex";
import { mlperfAdapter } from "./sources/mlperf";
import { tensorrtllmAdapter } from "./sources/tensorrtllm";
import { normalizeSafe, validateRecord } from "./normalize";
import { evaluate } from "./eligibility";
import { selectBest } from "./select";
import { ACCELERATOR_ALLOWLIST, HOST_ALLOWLIST } from "./equivalence";
import { AWS_INSTANCE_ACCELERATOR } from "./instance-map";
import { canonicalJson, sha256 } from "./hash";
import { getBenchmarkCurve, operatingPointAt } from "../benchmarks";
import manifest from "./raw/MANIFEST.json";
import inxRaw from "./raw/inferencex/dsv4-b200-fp4-1024.json";
import mlpRaw from "./raw/mlperf/llama3-1-70b-h200-server-v6.json";
import trtRaw from "./raw/tensorrtllm/llama3-1-70b-perf-overview.json";

// Test-only reviewed host equivalence, injected via options (never mutates production policy).
const TEST_HOST = [{ recordHost: "hgx-h200-reviewed", awsInstance: "p5en.48xlarge", compatible: { power: true, memoryConfig: true, interconnect: true, servingTopology: true }, materialDifferences: "test fixture", reviewedBy: "unit-test" }];

function prov(sourceClass: Provenance["sourceClass"], sourceName: string, snapshotKind: Provenance["snapshotKind"] = "verified"): Provenance {
  return { sourceName, sourceClass, sourceUrl: "https://example.com/pinned", sourceCommit: "pinned0000", runId: "1", retrievedAt: "2026-07-14", rawChecksum: "sha256:" + "a".repeat(64), license: "Apache-2.0", attribution: sourceName, snapshotKind };
}
function mk(o: Partial<BenchmarkRecord> & { id: string }): BenchmarkRecord {
  return {
    provenance: prov("open-reproducible", "InferenceX"),
    modelId: "llama3.1-70b", checkpoint: "Llama-3.1-70B-Instruct", weightPrecision: "fp8", kvPrecision: "fp8",
    framework: "tensorrt-llm", gpuSku: "H200", formFactor: "SXM", gpuMemGB: 141, gpuCount: 8, nodeCount: 1,
    topology: "TP8 aggregated single-node", interconnect: "NVLink", parallelism: { tp: 8, pp: 1, ep: 1, dp: 1 },
    serving: "aggregated", hostSystem: "H200-aws", awsRepresentativeInstances: ["p5en.48xlarge"],
    isl: 1024, osl: 1024, concurrency: 8, requestRate: null, prefixCache: false, specDecode: "none",
    outputTputPerGpu: 600, inputTputPerGpu: 590, intvty: 40, ttft: { value: 0.5, percentile: "p99" },
    tpot: null, itl: null, throughputTotal: null, perGpuReported: true, latencyQualified: true,
    measuredDate: "2026-07-14", intrinsicQualifications: [], unknownFields: {},
    ...o,
  };
}
const fullReq = (o: Partial<RequestSpec> = {}): RequestSpec => ({ modelId: "llama3.1-70b", checkpoint: "Llama-3.1-70B-Instruct", weightPrecision: "fp8", kvPrecision: "fp8", framework: "tensorrt-llm", gpuSku: "H200", awsInstance: "p5en.48xlarge", gpuCount: 8, nodeCount: 1, serving: "aggregated", parallelism: { tp: 8, pp: 1, ep: 1 }, prefixCache: false, specDecode: "none", isl: 1024, osl: 1024, concurrency: 8, ...o });
const dsv4Req = (o: Partial<RequestSpec> = {}): RequestSpec => ({ modelId: "dsv4", checkpoint: "DeepSeek-V4-Pro", weightPrecision: "fp4", kvPrecision: "fp8", framework: "trt", gpuSku: "B200", awsInstance: "p6-b200.48xlarge", gpuCount: 8, nodeCount: 1, serving: "aggregated", parallelism: { tp: 8, pp: 1, ep: 1 }, prefixCache: false, specDecode: "none", isl: 1024, osl: 1024, concurrency: 8, ...o });
const codes = (r: BenchmarkRecord, q: RequestSpec, o = {}) => evaluate(r, q, o).reasons.map((x) => x.code);

describe("precedence — exact > proxy(injected reviewed host) > scaled", () => {
  it("selects exact over an injected host-proxy and an ISL-scaled record", () => {
    const exact = mk({ id: "exact" });
    const proxy = mk({ id: "proxy", hostSystem: "hgx-h200-reviewed", awsRepresentativeInstances: [] });
    const scaled = mk({ id: "scaled", isl: 512 });
    expect(selectBest([proxy, scaled, exact], fullReq(), { hostAllowlist: TEST_HOST })!.record.id).toBe("exact");
    expect(evaluate(proxy, fullReq(), { hostAllowlist: TEST_HOST }).evidenceStatus).toBe("proxy");
    expect(evaluate(scaled, fullReq()).evidenceStatus).toBe("measured-scaled");
  });
  it("independent-reviewed exact > vendor exact", () => {
    const mlp = mk({ id: "mlp", provenance: prov("independent-reviewed", "MLPerf Inference") });
    const trt = mk({ id: "trt", provenance: prov("vendor-measured", "NVIDIA TensorRT-LLM") });
    expect(selectBest([trt, mlp], fullReq())!.record.provenance.sourceClass).toBe("independent-reviewed");
  });
});

describe("R4-P1-BENCH-001 — AWS representation is never derived from GPU SKU alone", () => {
  it("a same-SKU record with no reviewed representation cannot be measured-exact", () => {
    const rec = mk({ id: "sku", gpuSku: "H200", awsRepresentativeInstances: [], hostSystem: "H200-somewhere" });
    const m = evaluate(rec, fullReq()); // no host allowlist
    expect(m.eligible).toBe(false);
    expect(m.reasons.map((r) => r.code)).toContain("host-not-equivalent");
    expect(m.evidenceStatus).not.toBe("measured-exact");
  });
  it("the real InferenceX snapshot has no reviewed AWS host mapping → not directly representative", () => {
    expect(loadCatalog().every((r) => r.awsRepresentativeInstances.length === 0)).toBe(true);
  });
});

describe("R4-P1-BENCH-002 — malformed requests are rejected (invalid-request), never measured-exact", () => {
  it("zero / NaN / Infinity / bad-enum inputs are denied", () => {
    expect(codes(mk({ id: "x" }), fullReq({ isl: 0 }))).toContain("invalid-request");
    expect(codes(mk({ id: "x" }), fullReq({ osl: 0 }))).toContain("invalid-request");
    expect(codes(mk({ id: "x" }), fullReq({ gpuCount: Infinity }))).toContain("invalid-request");
    expect(codes(mk({ id: "x" }), fullReq({ concurrency: -4 }))).toContain("invalid-request");
    expect(codes(mk({ id: "x" }), fullReq({ interactivity: { ttftSlaMs: NaN, ttftPercentile: "bogus" as any } }))).toContain("invalid-request");
  });
});

describe("R4-P1-BENCH-003 — strict boolean/enum raw validation across adapters", () => {
  const clone = (o: unknown) => JSON.parse(JSON.stringify(o));
  it("InferenceX rejects a string boolean / numeric enum / boolean precision", () => {
    const a = clone(inxRaw); a.config.disagg = "false";
    expect(() => inferencexAdapter.normalize(a)).toThrow();
    const b = clone(inxRaw); b.config.spec_method = 123;
    expect(() => inferencexAdapter.normalize(b)).toThrow();
    const c = clone(inxRaw); c.config.kv_precision = true;
    expect(() => inferencexAdapter.normalize(c)).toThrow();
    const d = clone(inxRaw); d.config.is_multinode = "yes";
    expect(() => inferencexAdapter.normalize(d)).toThrow();
  });
  it("MLPerf & TensorRT-LLM reject string-numbers / string-booleans", () => {
    const m = clone(mlpRaw); m.result.system.accelerator_count = "8";
    expect(() => mlperfAdapter.normalize(m)).toThrow();
    const t = clone(trtRaw); t.rows[0].per_gpu_reported = "true";
    expect(() => tensorrtllmAdapter.normalize(t)).toThrow();
  });
  it("validateRecord rejects wrong-typed config fields", () => {
    expect(() => validateRecord(mk({ id: "b", prefixCache: "false" as any }))).toThrow();
    expect(() => validateRecord(mk({ id: "b", kvPrecision: 5 as any }))).toThrow();
    expect(() => validateRecord(mk({ id: "b", specDecode: 7 as any }))).toThrow();
  });
});

describe("evidence hygiene — production host allowlist is not mutated by tests", () => {
  it("an unreviewed non-AWS host is denied; only an INJECTED equivalence yields a proxy", () => {
    const rec = mk({ id: "h", hostSystem: "hgx-h200-reviewed", awsRepresentativeInstances: [] });
    expect(codes(rec, fullReq())).toContain("host-not-equivalent"); // no injected allowlist
    expect(evaluate(rec, fullReq(), { hostAllowlist: TEST_HOST }).evidenceStatus).toBe("proxy");
  });
});

describe("exact contract + latency + topology gates (never silent)", () => {
  const interactive = fullReq({ interactivity: { ttftSlaMs: 2000, ttftPercentile: "p99" } });
  it("missing/mismatched contract fields are denied", () => {
    expect(codes(mk({ id: "x" }), { ...fullReq(), parallelism: undefined as any })).toContain("incomplete-request");
    expect(codes(mk({ id: "a" }), fullReq({ checkpoint: "Other" }))).toContain("checkpoint-mismatch");
    expect(codes(mk({ id: "b", parallelism: { tp: 8, pp: 1, ep: 1, dp: 1 } }), fullReq({ parallelism: { tp: 8, pp: 2, ep: 1 } }))).toContain("pp-mismatch");
    expect(codes(mk({ id: "c", prefixCache: null }), fullReq())).toContain("prefix-cache-unknown");
    expect(codes(mk({ id: "d", specDecode: null }), fullReq())).toContain("spec-decode-unknown");
  });
  it("latencyQualified=false and mean-TTFT cannot satisfy P99", () => {
    expect(codes(mk({ id: "n", latencyQualified: false }), interactive)).toContain("latency-gate");
    expect(codes(mk({ id: "m", ttft: { value: 0.4, percentile: "mean" } }), interactive)).toContain("ttft-percentile-insufficient");
  });
  it("precision/model/engine/GPU/topology/concurrency mismatches each yield a reason", () => {
    expect(codes(mk({ id: "a", weightPrecision: "fp4" }), fullReq())).toContain("weight-precision-mismatch");
    expect(codes(mk({ id: "b", kvPrecision: null }), fullReq())).toContain("kv-precision-unknown");
    expect(codes(mk({ id: "c", framework: "vllm" }), fullReq())).toContain("engine-mismatch");
    expect(codes(mk({ id: "e", gpuSku: "B200", awsRepresentativeInstances: ["p6-b200.48xlarge"] }), fullReq({ gpuSku: "T4", awsInstance: "g4dn.xlarge" }))).toContain("gpu-not-equivalent");
    expect(codes(mk({ id: "g", concurrency: 16 }), fullReq({ concurrency: 20 }))).toContain("concurrency-not-measured");
  });
  it("out-of-bounds ISL → unbenchmarked; in-bounds scales with the real factor and drops TTFT", () => {
    expect(codes(mk({ id: "oob" }), fullReq({ isl: 102400 }))).toContain("isl-scale-out-of-bounds");
    const s = evaluate(mk({ id: "s", isl: 1024, inputTputPerGpu: 590 }), fullReq({ isl: 8192 }));
    expect(s.transformations![0].factor).toBe(8);
    expect(s.operatingPoint!.inputTputPerGpu).toBeCloseTo(590 * 8, 6);
    expect(s.operatingPoint!.ttftS).toBeNull();
  });
  it("unknown/inconsistent AWS instance denied", () => {
    expect(codes(mk({ id: "x" }), fullReq({ awsInstance: "made-up" }))).toContain("unknown-aws-instance");
    expect(codes(mk({ id: "x" }), fullReq({ gpuSku: "B200", awsInstance: "p5en.48xlarge" }))).toContain("instance-accelerator-inconsistent");
  });
});

describe("catalog / provenance / control (architecture-only slice)", () => {
  it("verified-only catalog; illustrative present only in loadAllSnapshots", () => {
    expect(loadCatalog().every((r) => r.provenance.snapshotKind === "verified")).toBe(true);
    expect(loadAllSnapshots().some((r) => r.provenance.snapshotKind === "illustrative-pending-ingestion")).toBe(true);
  });
  it("the pinned catalog yields ZERO measured-exact selections (honest fail-closed)", () => {
    // InferenceX lacks a reviewed AWS-host mapping AND prefix-cache metadata → unbenchmarked.
    const res = resolveOperatingPoint(dsv4Req({ concurrency: 8 }), { mode: "experimental" });
    expect(res.status).toBe("unbenchmarked");
    expect(codes(loadCatalog().find((r) => r.concurrency === 8)!, dsv4Req({ concurrency: 8 }))).toContain("host-not-equivalent");
  });
  it("measured-exact end-to-end is exercised with a fully-specified synthetic record", () => {
    const res = resolveOperatingPoint(fullReq(), { mode: "experimental", catalog: [mk({ id: "x" })] });
    expect(res.status).toBe("selected");
    expect(res.record!.provenance.rawChecksum).toBe(res.provenance!.full.rawChecksum);
    expect(res.operatingPoint!.tputPerGpu).toBe(600);
  });
  it("GB200 NVL72 total is never split into per-GPU", () => {
    const gb200 = loadAllSnapshots().find((r) => r.gpuSku === "GB200")!;
    expect(gb200.perGpuReported).toBe(false);
    expect(gb200.outputTputPerGpu).toBeNull();
  });
  it("unbenchmarked when no qualified measurement exists", () => {
    expect(resolveOperatingPoint(fullReq({ modelId: "nope" }), { mode: "experimental" }).status).toBe("unbenchmarked");
  });
  it("legacy control unchanged when experimental disabled", () => {
    const control = { inferencexKey: "dsv4", instanceType: "p6-b200.48xlarge", weightBits: 4, isl: 2910, osl: 500, interactivityTarget: 30 };
    const res = resolveOperatingPoint(dsv4Req({ isl: 2910, osl: 500 }), { mode: "control", control });
    const op = operatingPointAt(getBenchmarkCurve("dsv4", "p6-b200.48xlarge", 4, 2910, 500)!.points, 30);
    expect(res.operatingPoint!.tputPerGpu).toBe(op.tputPerGpu);
    expect(res.differsFromControl).toBe(false);
  });
  it("control-diff compares concurrency/interactivity", () => {
    const rec = mk({ id: "d", modelId: "dsv4", checkpoint: "DeepSeek-V4-Pro", gpuSku: "B200", awsRepresentativeInstances: ["p6-b200.48xlarge"], weightPrecision: "fp4", framework: "trt", concurrency: 16, outputTputPerGpu: 106.4, inputTputPerGpu: 107.5, intvty: 56.7, ttft: { value: 2.24, percentile: "p99" } });
    const control = { inferencexKey: "dsv4", instanceType: "p6-b200.48xlarge", weightBits: 4, isl: 1024, osl: 1024, interactivityTarget: 30 };
    const res = resolveOperatingPoint(dsv4Req({ concurrency: 16 }), { mode: "experimental", catalog: [rec], control });
    expect(res.status).toBe("selected");
    expect(res.differsFromControl).toBe(true);
  });
});

describe("determinism & checksums", () => {
  it("loadCatalog() byte-identical across calls", () => {
    expect(canonicalJson(loadCatalog())).toBe(canonicalJson(loadCatalog()));
  });
  it("InferenceX snapshot matches its manifest checksum; a mutation does not", () => {
    const entry = (manifest as any).sources.find((s: any) => s.sourceName === "InferenceX").rawFiles[0];
    expect(sha256(inxRaw)).toBe(entry.rawChecksum);
    const t = JSON.parse(JSON.stringify(inxRaw)); t.points[0].metrics.output_tput_per_gpu = 9999;
    expect(sha256(t)).not.toBe(entry.rawChecksum);
  });
});

describe("schema validation fails closed", () => {
  const bad = (o: Partial<BenchmarkRecord>) => () => validateRecord(mk({ id: "b", ...o }));
  it("rejects malformed numbers, enums, hashes, urls, dates, per-GPU, TBD-verified", () => {
    expect(bad({ gpuCount: -8 })).toThrow();
    expect(bad({ gpuMemGB: NaN })).toThrow();
    expect(bad({ parallelism: { tp: 0, pp: 1, ep: 1, dp: 1 } })).toThrow();
    expect(bad({ nodeCount: 9, gpuCount: 8 })).toThrow();
    expect(bad({ serving: "x" as any })).toThrow();
    expect(bad({ awsRepresentativeInstances: [1 as any] })).toThrow();
    expect(bad({ provenance: { ...prov("open-reproducible", "x"), sourceUrl: "https://" } })).toThrow();
    expect(bad({ provenance: { ...prov("open-reproducible", "x"), retrievedAt: "2026-99-99garbage" } })).toThrow();
    expect(bad({ perGpuReported: false, outputTputPerGpu: 123 })).toThrow();
    expect(bad({ provenance: { ...prov("open-reproducible", "x"), sourceCommit: "PINNED_COMMIT_TBD", runId: undefined } })).toThrow();
  });
  it("normalizeSafe rejects a record missing a required field", () => {
    const adapter = { sourceName: "x", sourceClass: "vendor-measured" as const, normalize: () => [{ ...mk({ id: "x" }), modelId: undefined as unknown as string }] };
    expect(() => normalizeSafe(adapter, {})).toThrow();
  });
});

describe("R5-P1-BENCH-006 — public resolver validates the request BEFORE catalog selection", () => {
  it("malformed input → invalid-request with reasons, NEVER unbenchmarked", () => {
    const r1 = resolveOperatingPoint(fullReq({ isl: 0 }), { mode: "experimental" });
    expect(r1.status).toBe("invalid-request");
    expect(r1.reasons.length).toBeGreaterThan(0);
    expect(r1.reasons.every((x) => x.code === "invalid-request")).toBe(true);
    const r2 = resolveOperatingPoint(fullReq({ interactivity: { ttftSlaMs: NaN, ttftPercentile: "bogus" as any } }), { mode: "experimental" });
    expect(r2.status).toBe("invalid-request");
  });
  it("validation precedes catalog access — invalid on an EMPTY catalog is still invalid-request", () => {
    expect(resolveOperatingPoint(fullReq({ isl: 0 }), { mode: "experimental", catalog: [] }).status).toBe("invalid-request");
  });
  it("a valid, complete request with no evidence → unbenchmarked (the reserved meaning)", () => {
    const res = resolveOperatingPoint(fullReq(), { mode: "experimental", catalog: [] });
    expect(res.status).toBe("unbenchmarked");
    expect(res.reasons.some((x) => x.code === "unbenchmarked")).toBe(true);
  });
});

describe("R5-P1-BENCH-007 — a non-identical sequence bucket is never measured-exact", () => {
  it("record ISL 1024 vs request ISL 4096 → measured-scaled (disclosed), not exact", () => {
    const rec = mk({ id: "s4x", isl: 1024, inputTputPerGpu: 590 });
    const m = evaluate(rec, fullReq({ isl: 4096 }));
    expect(m.eligible).toBe(true);
    expect(m.evidenceStatus).toBe("measured-scaled");
    expect(m.evidenceStatus).not.toBe("measured-exact");
    expect(m.transformations![0].factor).toBe(4);
    const res = resolveOperatingPoint(fullReq({ isl: 4096 }), { mode: "experimental", catalog: [rec] });
    expect(res.status).toBe("selected");
    expect(res.record!.id).toBe("s4x");
    expect(res.confidence).toBe("extrapolated"); // measured-scaled never carries a source-class exact confidence
  });
  it("a different OSL bucket is a hard mismatch (no OSL transform)", () => {
    expect(codes(mk({ id: "o", osl: 512 }), fullReq({ osl: 1024 }))).toContain("osl-mismatch");
  });
});

describe("R5-P1-BENCH-008 — every adapter strict-validates raw string identifiers", () => {
  const clone = (o: unknown) => JSON.parse(JSON.stringify(o));
  it("MLPerf rejects a numeric accelerator or a numeric system name", () => {
    const a = clone(mlpRaw); a.result.system.accelerator = 123;
    expect(() => mlperfAdapter.normalize(a)).toThrow();
    const b = clone(mlpRaw); b.result.system.name = 123;
    expect(() => mlperfAdapter.normalize(b)).toThrow();
  });
  it("TensorRT-LLM rejects a numeric GPU identifier", () => {
    const t = clone(trtRaw); t.rows[0].gpu = 123;
    expect(() => tensorrtllmAdapter.normalize(t)).toThrow();
  });
});

describe("R5-P1/P2-BENCH-009 — production trust policy is frozen and not publicly overridable", () => {
  it("all production policy registries are frozen (immutable)", () => {
    expect(Object.isFrozen(ACCELERATOR_ALLOWLIST)).toBe(true);
    expect(Object.isFrozen(AWS_INSTANCE_ACCELERATOR)).toBe(true);
    expect(Object.isFrozen(HOST_ALLOWLIST)).toBe(true);
  });
  it("a normal resolveOperatingPoint cannot inject an unreviewed host equivalence", () => {
    // Same-SKU, non-AWS-representative record: only an INJECTED (internal) allowlist could proxy it.
    // The public resolver exposes no such injection → the record stays unbenchmarked.
    const rec = mk({ id: "h", hostSystem: "hgx-h200-reviewed", awsRepresentativeInstances: [] });
    expect(resolveOperatingPoint(fullReq(), { mode: "experimental", catalog: [rec] }).status).toBe("unbenchmarked");
    // …while the internal evaluator CAN inject a reviewed fixture (tests only):
    expect(evaluate(rec, fullReq(), { hostAllowlist: TEST_HOST }).evidenceStatus).toBe("proxy");
  });
});
