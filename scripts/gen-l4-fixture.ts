// Generates the L4 test fixture: a saved scenario shaped like one persisted
// BEFORE newer schema fields (managedKb, ops, guardrail split, interactivity
// SLA, GPU commitment…) existed. Greedily strips candidate newer fields, keeping
// a strip only if coerceInputs() still succeeds — so the emitted fixture is
// guaranteed to load and backfill defaults (L4), never crash.
//
//   npx tsx scripts/gen-l4-fixture.ts
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defaultInputs } from "../lib/calc-engine";
import { coerceInputs } from "../lib/share";
import { MODEL_PRICES, GPU_DEFAULTS, OPENSEARCH_DEFAULTS, MANAGED_KB_PRICING } from "../lib/model-prices";
import type { PriceBook } from "../lib/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const priceBook: PriceBook = {
  updatedAt: "2026-01-01T00:00:00.000Z",
  source: "fallback",
  region: "us-east-1",
  gpus: GPU_DEFAULTS,
  opensearch: OPENSEARCH_DEFAULTS,
  managedKb: MANAGED_KB_PRICING,
  models: MODEL_PRICES,
};

// Dotted paths of fields introduced after early versions of the saved schema.
const NEWER_FIELDS = [
  "managedKb",
  "ops",
  "generation.interactivityTarget",
  "generation.gpuPricingModel",
  "generation.gpuUptimeHoursPerMonth",
  "generation.weightBits",
  "guardrails.inputEnabled",
  "guardrails.outputEnabled",
  "guardrails.charsPerTextUnit",
  "guardrails.charsPerToken",
];

function del(obj: any, dotted: string): void {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur == null) return;
    cur = cur[parts[i]];
  }
  if (cur) delete cur[parts[parts.length - 1]];
}

async function main() {
  const legacy: any = JSON.parse(JSON.stringify(defaultInputs(priceBook)));
  const stripped: string[] = [];
  for (const field of NEWER_FIELDS) {
    const trial = JSON.parse(JSON.stringify(legacy));
    del(trial, field);
    if (coerceInputs(trial)) {
      del(legacy, field); // keep the strip — still coercible
      stripped.push(field);
    }
  }

  const coerced = coerceInputs(legacy);
  if (!coerced) throw new Error("legacy fixture is not coercible — should never happen");

  const fixture = [
    { id: "l4-legacy-fixture", name: "Legacy scenario (pre-schema)", inputs: legacy },
  ];
  const outPath = path.join(__dirname, "..", "docs", "fixtures", "legacy-saved-scenario.json");
  await writeFile(outPath, JSON.stringify(fixture, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(`Stripped ${stripped.length} newer fields (all still coerce): ${stripped.join(", ")}`);
}

main();
