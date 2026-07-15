// Phase-1 boundary guard (owner directive): production code outside the benchmark-registry package
// may consume it ONLY through its safe `index` API. Deep-importing an internal module
// (eligibility/select/equivalence/normalize/sources/…) would bypass the trust boundary the registry
// was hardened around (rounds 1–7), so this test fails closed if any app/components/non-registry lib
// file references a benchmark-registry internal path.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, sep } from "node:path";

const root = process.cwd(); // worktree root
const isProdSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === ".next" || name === "out") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (isProdSource(name)) out.push(p);
  }
  return out;
}

// Every production .ts/.tsx OUTSIDE the registry package itself.
const registryDir = join("lib", "benchmark-registry") + sep;
const prodFiles = ["lib", "components", "app"]
  .flatMap((d) => walk(join(root, d)))
  .filter((f) => !f.includes(registryDir));

// A deep import is `benchmark-registry/<segment>` where <segment> is anything but `index`.
const DEEP_IMPORT = /benchmark-registry\/(?!index['"])[A-Za-z0-9_.-]+/;

describe("Phase-1 boundary — registry consumed only via its safe index", () => {
  it("scanned real production files", () => {
    expect(prodFiles.length).toBeGreaterThan(0);
  });

  it("no production file outside the registry deep-imports a registry internal", () => {
    const offenders = prodFiles
      .filter((f) => DEEP_IMPORT.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(root.length + 1).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });
});
