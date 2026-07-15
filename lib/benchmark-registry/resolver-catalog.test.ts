// Full-resolver composition tests (provenance reconciliation, control-diff, and the empty-catalog
// ordering guarantees) exercised against the PUBLIC resolveOperatingPoint() with a module-mocked
// loadCatalog(). This is the reviewer-sanctioned way to drive a controlled catalog WITHOUT exposing
// any catalog-injection API from the production module (P1-BENCH-012): the mock lives only in this
// test file's module registry; production code has no importable path to inject records.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sources")>();
  return { ...actual, loadCatalog: vi.fn(() => actual.loadCatalog()) };
});

import { resolveOperatingPoint } from "./index";
import { loadCatalog } from "./sources";
import type { BenchmarkRecord, Provenance, RequestSpec } from "./schema";

const mockedLoad = vi.mocked(loadCatalog);
beforeEach(() => mockedLoad.mockReset());

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

describe("public resolver over a controlled pinned catalog (module-mocked loadCatalog)", () => {
  it("measured-exact end-to-end: provenance reconciles with the selected record", () => {
    mockedLoad.mockReturnValue([mk({ id: "x" })]);
    const res = resolveOperatingPoint(fullReq(), { mode: "experimental" });
    expect(res.status).toBe("selected");
    expect(res.record!.provenance.rawChecksum).toBe(res.provenance!.full.rawChecksum);
    expect(res.operatingPoint!.tputPerGpu).toBe(600);
  });

  it("control-diff compares concurrency/interactivity", () => {
    const rec = mk({ id: "d", modelId: "dsv4", checkpoint: "DeepSeek-V4-Pro", gpuSku: "B200", awsRepresentativeInstances: ["p6-b200.48xlarge"], weightPrecision: "fp4", framework: "trt", concurrency: 16, outputTputPerGpu: 106.4, inputTputPerGpu: 107.5, intvty: 56.7, ttft: { value: 2.24, percentile: "p99" } });
    mockedLoad.mockReturnValue([rec]);
    const control = { inferencexKey: "dsv4", instanceType: "p6-b200.48xlarge", weightBits: 4, isl: 1024, osl: 1024, interactivityTarget: 30 };
    const res = resolveOperatingPoint(dsv4Req({ concurrency: 16 }), { mode: "experimental", control });
    expect(res.status).toBe("selected");
    expect(res.differsFromControl).toBe(true);
  });

  it("validation precedes catalog access — an invalid request on an EMPTY catalog is still invalid-request", () => {
    mockedLoad.mockReturnValue([]);
    const res = resolveOperatingPoint(fullReq({ isl: 0 }), { mode: "experimental" });
    expect(res.status).toBe("invalid-request");
    expect(mockedLoad).not.toHaveBeenCalled(); // the catalog is never even consulted for a bad request
  });

  it("a valid, complete request with an empty catalog → unbenchmarked (the reserved meaning)", () => {
    mockedLoad.mockReturnValue([]);
    const res = resolveOperatingPoint(fullReq(), { mode: "experimental" });
    expect(res.status).toBe("unbenchmarked");
    expect(res.reasons.some((x) => x.code === "unbenchmarked")).toBe(true);
    expect(mockedLoad).toHaveBeenCalledTimes(1);
  });
});
