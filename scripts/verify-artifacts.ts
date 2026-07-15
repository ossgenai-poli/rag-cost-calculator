// P2-ARCH-1 — BUILD-TIME pinned-artifact verification (recorded at the first UI review: the browser
// sha256 shim must never become the permanent trust boundary). This runs in Node BEFORE every build
// (`prebuild` / `prebuild:static`), where `node:crypto` is the real platform implementation: it loads
// the pinned benchmark catalog through the registry's PUBLIC index, which verifies every raw snapshot
// checksum against MANIFEST.json fail-closed. Any tamper/mismatch throws → non-zero exit → the build
// fails BEFORE Next starts and before any NEW build output is emitted (existing .next/out artifacts
// from an earlier build are not deleted — the gate prevents a new build, P3-DOC-7-1). The client-side
// shim (test-verified byte parity) remains as runtime defense-in-depth; it is no longer the only
// verification point.
//
// The frozen registry is consumed via its public index only — this script adds no new surface.
import { loadCatalog } from "../lib/benchmark-registry";

/** The fail-closed verification core (exported for tests): returns the verified record count, throws
 *  on any checksum failure or an empty catalog — never a warning, never a partial pass. */
export function verifyPinnedArtifacts(load: () => unknown[] = loadCatalog): number {
  const catalog = load(); // the registry throws on any manifest-checksum mismatch (fail-closed)
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new Error("verify-artifacts: loadCatalog() returned an empty catalog — pinned artifacts missing");
  }
  return catalog.length;
}

// CLI runner — only when executed directly (tests import verifyPinnedArtifacts without side effects).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/verify-artifacts.ts")) {
  try {
    const count = verifyPinnedArtifacts();
    console.log(
      `verify-artifacts: OK — ${count} pinned benchmark records ingested with every raw-snapshot checksum verified against MANIFEST.json (node:crypto, fail-closed).`
    );
  } catch (e) {
    console.error("verify-artifacts: FAILED — the build must not proceed on unverified artifacts.");
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
