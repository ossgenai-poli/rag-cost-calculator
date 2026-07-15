"use client";

// /advisor — the Phase-1 UI vertical slice (isolated; the existing calculator at "/" is untouched).
// Consumes the APPROVED headless layer ONLY through lib/recommendation/index.ts: recommend() →
// narrate() → render. Components never invent numbers, evidence, explanations or recommendations —
// every displayed value maps to a structured field (docs/ux-v2/ui/REVIEW.md). Default inputs are the
// R1 canonical reference workload, so the numbers shown are the approved reference-case output.
//
// UI HOLD-1 revisions: bounded hero + visible assumptions (P1-UI-1); API-only availability state,
// distinct from technical infeasibility (P1-UI-2); friendly field-level validation with blur-commit
// and last-valid-result preservation (P2-UI-1 / owner D6); "Evidence & assumptions" stays accessible
// (collapsed) in Simple mode while rejected candidates remain Expert-only (owner D1).
import { useEffect, useMemo, useRef, useState } from "react";
import { defaultInputs } from "@/lib/calc-engine";
import { recommend, narrate, diffRecommendations } from "@/lib/recommendation";
import type { NarratedRecommendationResult, RecommendationDiff, StructuredRecommendationResult } from "@/lib/recommendation";
import type { CalcInputs, PriceBook } from "@/lib/types";
import pricesJson from "@/public/prices.json";
import { AdvisorInputs, type AdvisorState } from "@/components/advisor/AdvisorInputs";
import { DecisionSummary } from "@/components/advisor/DecisionSummary";
import { BestSelfHostCard } from "@/components/advisor/BestSelfHostCard";
import { AlternativeCards } from "@/components/advisor/AlternativeCards";
import { RejectedOptions } from "@/components/advisor/RejectedOptions";
import { TrustPanel } from "@/components/advisor/TrustPanel";
import { AdjustmentsPanel } from "@/components/advisor/AdjustmentsPanel";
import { ChangesPanel } from "@/components/advisor/ChangesPanel";
import { RisksPanel } from "@/components/advisor/RisksPanel";
import { ExportPanel } from "@/components/advisor/ExportPanel";
import { RangeBandPanel } from "@/components/advisor/RangeBandPanel";
import { computeRanges, rangeTripletValid, rangeDisclosures, RANGE_FIELDS, RANGE_FIELD_LABELS, type RangeComputation } from "@/components/advisor/ranges";
import { resolveFocus } from "@/components/advisor/focus";
import { PresetBar } from "@/components/advisor/PresetBar";
import { advisorStatesEqual, changedPresetFields, initialProvenance, invalidateUndo, registerManualEdit, type PresetProvenance } from "@/components/advisor/presets";
import { friendlyFieldErrors, type FieldError } from "@/components/advisor/copy";

const priceBook = pricesJson as unknown as PriceBook;

// R1 canonical defaults (docs/ux-v2/18-reference-cases.md) — real approved reference output.
// Exported for tests so fixtures are byte-identical to the page's state (QA-014 discipline).
export const DEFAULT_STATE: AdvisorState = {
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
  utilTargetPct: 70, // matches the frozen defaultInputs utilTarget 0.7 → R1 numbers unchanged
  haEnabled: true,
  purchasingModel: "on-demand",
  experimental: false,
  peakFactor: 1, // UI5-D2: real engine input; default 1 (flat) preserves the R1 canonical output
  ranges: {}, // doc 08: no ranges by default — the base case IS the R1 canonical output
  selectedCandidateId: null, // doc 06: no selection → follow the engine's optimization-ranked best
};

/** Build the engine workload from the journey state — the SAME defaultInputs() base the calculator
 *  uses, with only the journey fields overridden (no hidden extra assumptions). The iteration-3
 *  operations fields map to REAL engine inputs: utilTarget (fraction), haEnabled (N+1),
 *  gpuPricingModel (indicative commitment discount). Exported for contract tests. */
export function buildWorkload(s: AdvisorState): CalcInputs {
  const w = defaultInputs(priceBook);
  w.generation.mode = "self-hosted";
  w.generation.llmModelId = s.modelId;
  w.generation.ttftTargetMs = s.ttftTargetMs;
  w.generation.interactivityTarget = s.interactivityTarget;
  w.generation.outTokens = s.outTokens;
  w.generation.promptOverhead = s.promptOverhead;
  w.generation.gpuUptimeHoursPerMonth = s.uptimeHours;
  w.generation.utilTarget = s.utilTargetPct / 100;
  w.generation.haEnabled = s.haEnabled;
  w.generation.gpuPricingModel = s.purchasingModel;
  w.chunking.chunkSize = s.chunkSize;
  w.retrieval.topN = s.topN;
  w.retrieval.topK = s.topK;
  w.traffic.queriesPerMonth = s.volume;
  w.traffic.peakFactor = s.peakFactor; // UI5-D2: journey-state field (default 1 = the prior pinned value)
  w.queryTokens = s.queryTokens;
  return w;
}

interface ComputeOutcome {
  structured: StructuredRecommendationResult | null;
  result: NarratedRecommendationResult | null;
  diff: RecommendationDiff | null;
  errorGeneric: string | null;
  fieldErrors: Record<string, FieldError>;
}

export default function AdvisorPage() {
  const [state, setState] = useState<AdvisorState>(DEFAULT_STATE);
  // P1-UI2-1: explicit per-field preset provenance (default | manual | preset:<id>) stored WITH state.
  const [presetProv, setPresetProv] = useState<PresetProvenance>(initialProvenance());

  // Committed input changes from the form: any change to a preset-managed field is a MANUAL edit —
  // origins flip to manual and an active chip becomes "Modified from …". P1-UI5-4: ANY real committed
  // change (including adding/changing/clearing a range or a non-preset field) makes the full-state
  // Undo snapshot unsafe — Undo may never discard a later edit. A no-op commit preserves Undo.
  const handleInputsChange = (next: AdvisorState) => {
    setPresetProv((prov) => {
      const p = registerManualEdit(prov, changedPresetFields(state, next));
      return advisorStatesEqual(state, next) ? p : invalidateUndo(p);
    });
    setState(next);
  };
  // P2-UI-1: the last VALID result stays on screen while the customer edits through an invalid state.
  // Refs are READ inside the memo and COMMITTED in an effect (StrictMode-safe: the memo may run twice).
  const lastGood = useRef<NarratedRecommendationResult | null>(null);
  const prevForDiff = useRef<StructuredRecommendationResult | null>(null);

  // Deterministic: recommend() + narrate() + diffRecommendations() are pure. Numeric inputs commit on
  // blur (AdvisorInputs), so this recomputes per committed change, not per keystroke. Validation
  // failures map to friendly field-level wording while the last valid result is preserved.
  const outcome = useMemo<ComputeOutcome>(() => {
    try {
      const structured = recommend({
        workload: buildWorkload(state),
        optimizeFor: state.optimizeFor,
        experimentalProvenance: state.experimental,
      });
      const narrated = narrate(structured);
      // Reason-coded change tracking vs the previously COMMITTED valid result (approved change-diff).
      const diff = prevForDiff.current ? diffRecommendations(prevForDiff.current, structured) : null;
      return { structured, result: narrated, diff, errorGeneric: null, fieldErrors: {} };
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const friendly = friendlyFieldErrors(raw);
      return {
        structured: null,
        result: lastGood.current, // preserve the last valid result while editing
        diff: null,
        errorGeneric: friendly.generic,
        fieldErrors: Object.fromEntries(friendly.fields.map((f) => [f.inputId, f])),
      };
    }
  }, [state]);
  const { result, diff, errorGeneric, fieldErrors } = outcome;

  // Doc 08 — range bands are REAL engine recomputes at the customer's bounds, derived from the same
  // committed state + the same buildWorkload as the headline. P1-UI5-1: only VALID TRIPLETS
  // (low ≤ base ≤ high, field minima, whole numbers for counts) reach the recompute — a committed
  // range whose base was later edited outside it is PRESERVED in state but gated out here (the control
  // shows the inline error). An unexpected recompute failure fails closed to "no band", never a guess.
  // doc 06 — the customer's selection resolved FAIL-CLOSED against the current structured result:
  // only the eligible card set is selectable; an invalidated selection suspends (preserved in state,
  // visibly flagged, ranked best shown) — never silently kept or silently dropped.
  const focus = outcome.structured ? resolveFocus(outcome.structured, state.selectedCandidateId) : null;
  const focusId = focus?.active ? focus.selectedId : null;
  const selectCandidate = (id: string | null) => handleInputsChange({ ...state, selectedCandidateId: id });

  const rangeComputation = useMemo<RangeComputation | null>(() => {
    if (!outcome.structured) return null;
    const valid: AdvisorState["ranges"] = {};
    for (const f of RANGE_FIELDS) {
      const b = state.ranges[f];
      if (b && rangeTripletValid(f, state[f], b)) valid[f] = b;
    }
    try {
      // The tracked candidate follows the ACTIVE selection (doc 06) — resolved fail-closed above.
      return computeRanges(state, valid, outcome.structured, buildWorkload, focusId);
    } catch {
      return null;
    }
  }, [outcome, state, focusId]);
  const rangeLabels = rangeComputation ? rangeComputation.fields.map((f) => RANGE_FIELD_LABELS[f]) : undefined;
  const rangeNotes = rangeComputation ? rangeDisclosures(rangeComputation) : undefined;

  useEffect(() => {
    if (outcome.structured && outcome.result) {
      prevForDiff.current = outcome.structured;
      lastGood.current = outcome.result;
    }
  }, [outcome]);

  const model = priceBook.models.find((m) => m.id === state.modelId);
  const selfHostAvailable = !!model && model.kind === "llm" && model.selfHostable === true;

  // Self-contained light surface: the calculator globals are dark-themed; the advisor slice pins its
  // own scheme so the Phase-0 light-mode wireframe rendering holds (owner D7: shared tokens later).
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
        <aside aria-label="Inputs" className="space-y-3">
          <PresetBar
            state={state}
            provenance={presetProv}
            selfHostAvailable={selfHostAvailable}
            onApply={(next, prov) => { setState(next); setPresetProv(prov); }}
            onUndo={(restored, prov) => { setState(restored); setPresetProv(prov); }}
          />
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <AdvisorInputs
              state={state}
              defaults={DEFAULT_STATE}
              models={priceBook.models}
              selfHostAvailable={selfHostAvailable}
              fieldErrors={fieldErrors}
              onChange={handleInputsChange}
            />
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          {errorGeneric && (
            <div role="alert" data-testid="input-error" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {/* P3-A11Y: distinct blocks so accessible text never concatenates sentences. */}
              <p>{errorGeneric}</p>
              {result && <p className="mt-1 text-red-600">Showing the last valid result below.</p>}
            </div>
          )}
          {result && (
            <>
              <DecisionSummary result={result} rangesActive={!!rangeComputation} focus={focus} />
              {/* Doc 08 — base + band, two separate confidence channels, largest modeled range effect. */}
              <RangeBandPanel result={result} computation={rangeComputation} />
              <ChangesPanel diff={diff} />
              <AdjustmentsPanel result={result} />
              <BestSelfHostCard result={result} focus={focus} onSelect={selectCandidate} />
              <AlternativeCards result={result} focus={focus} onSelect={selectCandidate} />
              {/* Level 6 (10-result-hierarchy §6): risks & exclusions BEFORE the advanced evidence,
                  visible in both modes. */}
              <RisksPanel result={result} riskOptions={{ rangeLabels, rangeNotes, focusId }} />
              {/* Owner D1: evidence & assumptions stay ACCESSIBLE (collapsed) in Simple mode;
                  rejected candidates remain Expert-only. */}
              {state.mode === "expert" && <RejectedOptions result={result} />}
              <TrustPanel result={result} />
              {/* Stage-F: the deterministic export reproduces the exact hierarchy order. */}
              <ExportPanel result={result} ranges={rangeComputation} focus={focus} />
            </>
          )}
        </div>
      </div>
      </div>
    </main>
  );
}
