// The browser sha256 shim must be BYTE-IDENTICAL to node:crypto — including over the real pinned raw
// snapshots the frozen registry checksum-verifies at catalog load — so the fail-closed checksum
// behavior is identical in the browser bundle.
import { describe, it, expect } from "vitest";
import { createHash as nodeCreateHash } from "node:crypto";
import { createHash as shimCreateHash } from "./node-crypto";
import { canonicalJson } from "../benchmark-registry/hash";
import manifest from "../benchmark-registry/raw/MANIFEST.json";
import inxRaw from "../benchmark-registry/raw/inferencex/dsv4-b200-fp4-1024.json";
import mlpRaw from "../benchmark-registry/raw/mlperf/llama3-1-70b-h200-server-v6.json";
import trtRaw from "../benchmark-registry/raw/tensorrtllm/llama3-1-70b-perf-overview.json";

const nodeHex = (s: string) => nodeCreateHash("sha256").update(s).digest("hex");
const shimHex = (s: string) => shimCreateHash("sha256").update(s).digest("hex");

describe("browser node:crypto shim — sha256 parity with node", () => {
  it("matches node:crypto across edge-case inputs (empty, block boundaries, unicode, long)", () => {
    const inputs = [
      "", "abc", "hello world",
      "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(65), // padding boundaries
      "héllo → 你好 · ✓ · 𝄞", // multi-byte UTF-8
      JSON.stringify({ nested: [1, 2, { x: null }] }),
      "x".repeat(10_000),
    ];
    for (const s of inputs) expect(shimHex(s), JSON.stringify(s.slice(0, 20))).toBe(nodeHex(s));
    // known FIPS vector
    expect(shimHex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("reproduces the REAL pinned-snapshot checksums (registry fail-closed verification works in-browser)", () => {
    for (const raw of [inxRaw, mlpRaw, trtRaw]) {
      const s = canonicalJson(raw);
      expect("sha256:" + shimHex(s)).toBe("sha256:" + nodeHex(s));
    }
    // and the shim reproduces the manifest's recorded InferenceX checksum exactly
    const entry = (manifest as { sources: Array<{ sourceName: string; rawFiles: Array<{ rawChecksum: string }> }> })
      .sources.find((x) => x.sourceName === "InferenceX")!.rawFiles[0];
    expect("sha256:" + shimHex(canonicalJson(inxRaw))).toBe(entry.rawChecksum);
  });

  it("incremental update() calls match a single-shot digest", () => {
    const h = shimCreateHash("sha256");
    h.update("hello ").update("world");
    expect(h.digest("hex")).toBe(nodeHex("hello world"));
  });

  it("fails closed on unsupported algorithms and encodings", () => {
    expect(() => shimCreateHash("md5")).toThrow(/sha256/);
    expect(() => shimCreateHash("sha256").update("x").digest("base64")).toThrow(/hex/);
  });
});
