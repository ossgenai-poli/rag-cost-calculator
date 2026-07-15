"use client";

// /advisor — the Phase-1 UI vertical slice (isolated; the existing calculator at "/" is untouched).
// Consumes the APPROVED headless layer ONLY through lib/recommendation/index.ts: recommend() →
// narrate() → render. Components never invent numbers, evidence, explanations or recommendations —
// every displayed value maps to a structured field (docs/ux-v2/ui/REVIEW.md). Default inputs are the
// R1 canonical reference workload, so the numbers shown are the approved reference-case output.
import { useMemo, useState } from "react";
import { defaultInputs } from "@/lib/calc-engine";
import { recommend, narrate } from "@/lib/recommendation";
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import type { CalcInputs, PriceBook } from "@/lib/types";
import pricesJson from "@/public/prices.json";
import { AdvisorInputs, type AdvisorState } from "@/components/advisor/AdvisorInputs";
import { DecisionSummary } from "@/components/advisor/DecisionSummary";
import { BestSelfHostCard } from "@/components/advisor/BestSelfHostCard";
import { RejectedOptions } from "@/components/advisor/RejectedOptions";
import { TrustPanel } from "@/components/advisor/TrustPanel";
import { AdjustmentsPanel } from "@/components/advisor/AdjustmentsPanel";

const priceBook = pricesJson as unknown as PriceBook;

// R1 canonical defaults (docs/ux-v2/18-reference-cases.md) — real approved reference output.
const DEFAULT_STATE: AdvisorState = {
  modelId: "deepseek-v4-pro-oss",
  volume: 200_000_000,
  optimizeFor: "cost",
  mode: "simple",
  ttftTargetMs: 2000,
  interactivityTarget: 30,
  outTokens: 500,
  queryTokens: 50,
  promptOverhead: 300,
  chunkSize: 512,
  topN: 5,
  topK: 20,
  uptimeHours: 730,
  experimental: false,
};

/** Build the engine workload from the journey state — the SAME defaultInputs() base the calculator
 *  uses, with only the journey fields overridden (no hidden extra assumptions). */
function buildWorkload(s: AdvisorState): CalcInputs {
  const w = defaultInputs(priceBook);
  w.generation.mode = "self-hosted";
  w.generation.llmModelId = s.modelId;
  w.generation.ttftTargetMs = s.ttftTargetMs;
  w.generation.interactivityTarget = s.interactivityTarget;
  w.generation.outTokens = s.outTokens;
  w.generation.promptOverhead = s.promptOverhead;
  w.generation.gpuUptimeHoursPerMonth = s.uptimeHours;
  w.chunking.chunkSize = s.chunkSize;
  w.retrieval.topN = s.topN;
  w.retrieval.topK = s.topK;
  w.traffic.queriesPerMonth = s.volume;
  w.traffic.peakFactor = 1;
  w.queryTokens = s.queryTokens;
  return w;
}

export default function AdvisorPage() {
  const [state, setState] = useState<AdvisorState>(DEFAULT_STATE);

  // Deterministic: recommend() + narrate() are pure; validation failures surface honestly as a banner
  // (the boundary validator's message, verbatim) — never a crash, never a silently "fixed" input.
  const { result, error } = useMemo<{ result: NarratedRecommendationResult | null; error: string | null }>(() => {
    try {
      const structured = recommend({
        workload: buildWorkload(state),
        optimizeFor: state.optimizeFor,
        experimentalProvenance: state.experimental,
      });
      return { result: narrate(structured), error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [state]);

  // Self-contained light surface: the calculator globals are dark-themed; the advisor slice pins its
  // own scheme so the Phase-0 light-mode wireframe rendering holds.
  return (
    <main className="min-h-screen bg-slate-100 text-slate-900 [color-scheme:light]">
      <div className="mx-auto max-w-5xl p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">RAG deployment advisor</h1>
          <p className="text-sm text-slate-600">API vs self-host, decided on evidence — experimental preview of the v2 experience.</p>
        </div>
        <div role="group" aria-label="Mode" className="flex rounded border border-slate-300 text-sm">
          {(["simple", "expert"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={state.mode === m}
              data-testid={`mode-${m}`}
              onClick={() => setState({ ...state, mode: m })}
              className={`px-3 py-1 capitalize ${state.mode === m ? "bg-slate-800 text-white" : "bg-white text-slate-700"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
        <aside aria-label="Inputs" className="rounded-lg border border-slate-200 bg-white p-4">
          <AdvisorInputs state={state} models={priceBook.models} onChange={setState} />
        </aside>

        <div className="space-y-4">
          {error && (
            <div role="alert" data-testid="input-error" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}
          {result && (
            <>
              <DecisionSummary result={result} />
              <AdjustmentsPanel result={result} />
              <BestSelfHostCard result={result} />
              {state.mode === "expert" && (
                <>
                  <RejectedOptions result={result} />
                  <TrustPanel result={result} />
                </>
              )}
            </>
          )}
        </div>
      </div>
      </div>
    </main>
  );
}
