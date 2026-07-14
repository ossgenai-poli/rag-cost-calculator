// Verify a RUNTIME deployment actually reports genuinely-live AWS pricing.
// Operationalizes QA_HANDOFF §5.0 #3: `source:"live"` alone is not enough —
// the GPU $/hr must actually differ from the committed fallback, else it's the
// "partial-live" case (newest instance types missing from the Price List API).
//
// Usage:
//   node scripts/verify-live.mjs https://<your-app>.vercel.app
//   APP_URL=https://<your-app>.vercel.app node scripts/verify-live.mjs
//
// Exit 0 = live and GPU prices moved. Exit 1 = fallback, partial-live, or error.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fallbackPath = path.join(__dirname, "..", "public", "prices.json");

async function main() {
  const url = (process.argv[2] || process.env.APP_URL || "").replace(/\/+$/, "");
  if (!url) {
    console.error("usage: node scripts/verify-live.mjs <runtime-base-url>");
    return 1;
  }

  let live;
  try {
    const res = await fetch(`${url}/api/prices`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    live = await res.json();
  } catch (e) {
    console.error("FAIL: could not fetch /api/prices —", e.message);
    return 1;
  }

  const fallback = JSON.parse(await readFile(fallbackPath, "utf8"));

  console.log(`\nRuntime:  ${url}/api/prices`);
  console.log(`source:   ${live.source}   (updatedAt ${live.updatedAt})`);
  console.log(`region:   ${live.region}\n`);

  let failed = false;
  if (live.source !== "live") {
    console.error(`FAIL: source is "${live.source}", expected "live" (creds present at BUILD time? redeploy after adding them).`);
    failed = true;
  }

  // Per-GPU: did the live $/hr actually move off the committed fallback?
  const fb = new Map((fallback.gpus ?? []).map((g) => [g.instanceType, g.pricePerHr]));
  let moved = 0;
  console.log("GPU $/hr   instanceType            live        fallback    moved?");
  for (const g of live.gpus ?? []) {
    const f = fb.get(g.instanceType);
    const changed = f == null ? "n/a" : (Math.abs(g.pricePerHr - f) > 1e-9 ? "YES" : "no  <- still fallback");
    if (changed === "YES") moved++;
    console.log(`           ${g.instanceType.padEnd(22)} ${String(g.pricePerHr).padEnd(11)} ${String(f ?? "?").padEnd(11)} ${changed}`);
  }
  if (moved === 0) {
    console.error("FAIL: no GPU price differs from the committed fallback — partial-live (likely newest instance types absent from the Price List API). File it.");
    failed = true;
  }

  console.log(`\n=== LIVE VERIFY: ${failed ? "FAIL" : "PASS"} (${moved}/${(live.gpus ?? []).length} GPU prices live) ===`);
  return failed ? 1 : 0;
}

// Set exitCode and let the event loop drain naturally — avoids the Windows
// libuv teardown assertion that process.exit() triggers with open sockets.
process.exitCode = await main();
