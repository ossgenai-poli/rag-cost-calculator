// P2-ARCH-1 acceptance — build-time pinned-artifact verification. The fail-closed core is tested
// directly (real pinned catalog passes; a throwing/empty loader fails — never a warning), and the
// REAL CLI is spawned to prove the prebuild path exits 0 with the verified count. The registry's own
// frozen suite already proves loadCatalog() throws on a tampered snapshot (manifest-checksum tests);
// this layer proves the BUILD consumes that verification.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { verifyPinnedArtifacts } from "./verify-artifacts";
import { loadCatalog } from "../lib/benchmark-registry";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// P1-ARCH-7-1: platform-neutral invocation — the CHECKED-IN local tsx CLI run by the current Node
// binary, no shell (no cmd.exe/sh assumption) and no npx network fallback. Works on Windows AND
// ubuntu-latest (main CI runs `npm test` before either build).
const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");

describe("P2-ARCH-1 — build-time artifact verification (fail-closed)", () => {
  it("the real pinned catalog verifies in Node (real node:crypto) and reports its record count", () => {
    expect(verifyPinnedArtifacts()).toBe(loadCatalog().length);
    expect(verifyPinnedArtifacts()).toBeGreaterThan(0);
  });
  it("a checksum failure or an empty catalog FAILS the verification — never a warning", () => {
    expect(() => verifyPinnedArtifacts(() => { throw new Error("ingest: checksum mismatch for x — tampered"); })).toThrow(/checksum mismatch/);
    expect(() => verifyPinnedArtifacts(() => [])).toThrow(/empty catalog/);
  });
  it("the CLI the prebuild hooks run exits 0 with the verified count (shell-free, local tsx)", () => {
    expect(existsSync(tsxCli)).toBe(true); // the checked-in local dependency, not an npx fetch
    const out = execFileSync(process.execPath, [tsxCli, "scripts/verify-artifacts.ts"], { cwd: root, encoding: "utf8" });
    expect(out).toContain("verify-artifacts: OK —");
    expect(out).toContain("checksum verified against MANIFEST.json (node:crypto, fail-closed)");
  });
  it("BOTH build entrypoints are gated: prebuild and prebuild:static run the verification", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.scripts.prebuild).toBe("npm run verify-artifacts");
    expect(pkg.scripts["prebuild:static"]).toBe("npm run verify-artifacts");
    expect(pkg.scripts["verify-artifacts"]).toBe("tsx scripts/verify-artifacts.ts");
  });
});
