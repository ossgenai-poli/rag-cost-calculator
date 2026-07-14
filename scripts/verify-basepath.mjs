// Regression guard for #24: when the static export is built for a project
// subpath (NEXT_PUBLIC_BASE_PATH set, e.g. GitHub Pages at /rag-cost-calculator/),
// every /_next asset reference in out/index.html MUST carry that prefix. If it
// doesn't, the deployed page 404s its JS/CSS and hangs on "Loading prices…".
//
// Run AFTER `npm run build:static` (with NEXT_PUBLIC_BASE_PATH set for subpath
// hosting).  Exit 0 = ok, 1 = bare /_next refs found (or index.html missing).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, "..", "out", "index.html");
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

async function main() {
  let html;
  try {
    html = await readFile(indexPath, "utf8");
  } catch {
    console.error(`FAIL: ${indexPath} not found — run \`npm run build:static\` first.`);
    return 1;
  }

  const refs = [...html.matchAll(/(?:src|href)="([^"]*\/_next\/[^"]*)"/g)].map((m) => m[1]);
  if (refs.length === 0) {
    console.error("FAIL: no /_next asset references found in index.html — unexpected build output.");
    return 1;
  }

  if (!basePath) {
    console.log(`NEXT_PUBLIC_BASE_PATH unset → root deploy; ${refs.length} asset refs, base-path check skipped (OK).`);
    return 0;
  }

  const bare = refs.filter((r) => !r.startsWith(`${basePath}/_next/`));
  if (bare.length > 0) {
    console.error(`FAIL: ${bare.length}/${refs.length} asset refs missing base path "${basePath}" (would 404 on the subpath). e.g.:`);
    bare.slice(0, 3).forEach((r) => console.error("   " + r));
    return 1;
  }

  console.log(`PASS: all ${refs.length} /_next asset refs carry "${basePath}" — subpath deploy is safe (#24).`);
  return 0;
}

process.exitCode = await main();
