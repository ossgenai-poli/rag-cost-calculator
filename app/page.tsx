"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadPrices } from "@/lib/prices";
import { calculate, defaultInputs } from "@/lib/calc-engine";
import {
  assumptionsToJson,
  buildReport,
  buildShareUrl,
  coerceInputs,
  downloadText,
  inputsToCsv,
  readInputsFromLocation,
  syncLocation,
} from "@/lib/share";
import { InputPanel } from "@/components/InputPanel";
import { ResultsPanel } from "@/components/ResultsPanel";
import { Toolbar } from "@/components/Toolbar";
import type { SavedRow } from "@/components/ScenarioComparison";
import type { CalcInputs, LoadPricesResult } from "@/lib/types";

interface SavedScenario {
  id: string;
  name: string;
  inputs: CalcInputs;
}

const STORAGE_KEY = "rag-calc-saved-v1";
const MAX_SAVED = 12; // keep localStorage bounded; drops the oldest beyond this

/** Non-crypto id generator (Math.random is fine here — not security-sensitive). */
function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function Page() {
  const [prices, setPrices] = useState<LoadPricesResult | null>(null);
  const [inputs, setInputs] = useState<CalcInputs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedScenario[]>([]);

  // Load prices, seed inputs (from URL if present), and restore saved scenarios.
  useEffect(() => {
    let alive = true;
    loadPrices()
      .then((res) => {
        if (!alive) return;
        setPrices(res);
        setInputs(readInputsFromLocation() ?? defaultInputs(res.priceBook));
      })
      .catch((e) => alive && setError(String(e)));
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        // Upgrade each stored scenario through the schema so scenarios saved
        // before newer fields (e.g. managedKb) existed backfill defaults instead
        // of crashing the engine. Drop any that can't be coerced.
        const restored: SavedScenario[] = (JSON.parse(raw) as SavedScenario[])
          .map((s) => {
            const inputs = coerceInputs(s.inputs);
            return inputs ? { ...s, inputs } : null;
          })
          .filter((s): s is SavedScenario => s !== null);
        setSaved(restored);
      }
    } catch {
      /* ignore malformed storage */
    }
    return () => {
      alive = false;
    };
  }, []);

  // Debounced URL sync so a shareable link always reflects the current inputs.
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!inputs) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => syncLocation(inputs), 400);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [inputs]);

  const persistSaved = useCallback((next: SavedScenario[]) => {
    const capped = next.slice(-MAX_SAVED);
    setSaved(capped);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
    } catch {
      /* ignore quota errors */
    }
  }, []);

  const { resultA, resultB } = useMemo(() => {
    if (!prices || !inputs) return { resultA: null, resultB: null };
    return {
      resultA: calculate({ ...inputs, ragMode: "A" }, prices.priceBook),
      resultB: calculate({ ...inputs, ragMode: "B" }, prices.priceBook),
    };
  }, [prices, inputs]);

  // Computed display rows for the saved-scenario table.
  const savedRows: SavedRow[] = useMemo(() => {
    if (!prices) return [];
    return saved.map((s) => {
      const r = calculate({ ...s.inputs, ragMode: "A" }, prices.priceBook);
      const q = s.inputs.traffic.queriesPerMonth;
      return {
        id: s.id,
        name: s.name,
        monthly: r.totalMonthly$,
        per1000: q > 0 ? (r.totalMonthly$ / q) * 1000 : 0,
      };
    });
  }, [saved, prices]);

  // --- saved-scenario handlers ---
  const onSaveCurrent = useCallback(() => {
    if (!inputs) return;
    const name = `Scenario ${saved.length + 1}`;
    persistSaved([...saved, { id: makeId(), name, inputs }]);
  }, [inputs, saved, persistSaved]);

  const onRenameSaved = useCallback(
    (id: string, name: string) => persistSaved(saved.map((s) => (s.id === id ? { ...s, name } : s))),
    [saved, persistSaved]
  );
  const onDuplicateSaved = useCallback(
    (id: string) => {
      const src = saved.find((s) => s.id === id);
      if (!src) return;
      persistSaved([...saved, { id: makeId(), name: `${src.name} copy`, inputs: src.inputs }]);
    },
    [saved, persistSaved]
  );
  const onDeleteSaved = useCallback(
    (id: string) => persistSaved(saved.filter((s) => s.id !== id)),
    [saved, persistSaved]
  );
  const onLoadSaved = useCallback(
    (id: string) => {
      const src = saved.find((s) => s.id === id);
      if (src) setInputs(src.inputs);
    },
    [saved]
  );

  // --- toolbar actions ---
  const onReset = useCallback(() => {
    if (prices) setInputs(defaultInputs(prices.priceBook));
  }, [prices]);
  const shareUrl = inputs ? buildShareUrl(inputs) : "";
  const onExportCsv = useCallback(() => {
    if (resultA && inputs) downloadText("rag-cost-breakdown.csv", inputsToCsv(resultA, inputs), "text/csv");
  }, [resultA, inputs]);
  const onExportJson = useCallback(() => {
    if (inputs && prices)
      downloadText(
        "rag-assumptions.json",
        assumptionsToJson(inputs, prices.priceBook, prices.asOf, resultA ?? undefined),
        "application/json"
      );
  }, [inputs, prices, resultA]);
  const onExportReport = useCallback(() => {
    if (resultA && inputs && prices)
      downloadText("rag-cost-report.md", buildReport(inputs, resultA, prices.priceBook, prices.asOf), "text/markdown");
  }, [resultA, inputs, prices]);

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-6 pb-20 lg:pb-6">
      <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-100">RAG Cost Calculator</h1>
            <span
              className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[11px] font-medium text-slate-300"
              title="Only AWS pricing is implemented today. Azure and GCP are on the roadmap."
            >
              AWS · us-east-1
            </span>
          </div>
          <p className="max-w-3xl text-sm text-slate-400">
            Engineer-mode monthly cost estimator for Retrieval-Augmented-Generation pipelines.
            Compares self-built vs managed retrieval, with an API-vs-self-hosted-GPU crossover.
          </p>
        </div>
        {prices && inputs && (
          <Toolbar
            shareUrl={shareUrl}
            onReset={onReset}
            onSaveScenario={onSaveCurrent}
            onExportCsv={onExportCsv}
            onExportJson={onExportJson}
            onExportReport={onExportReport}
            priceBook={prices.priceBook}
            asOf={prices.asOf}
          />
        )}
      </header>

      {error && <div className="panel p-4 text-amber-300">Failed to initialize: {error}</div>}

      {!prices || !inputs || !resultA || !resultB ? (
        <div className="panel p-8 text-center text-slate-400">Loading prices…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(340px,38%)_1fr]">
            {/* Inputs scroll with the page; only the results panel is sticky. */}
            <div>
              <InputPanel inputs={inputs} onChange={setInputs} priceBook={prices.priceBook} />
            </div>
            <div
              id="results"
              className="self-start lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1"
            >
              <ResultsPanel
                resultA={resultA}
                resultB={resultB}
                inputs={inputs}
                priceBook={prices.priceBook}
                asOf={prices.asOf}
                stale={prices.stale}
                saved={savedRows}
                onSaveCurrent={onSaveCurrent}
                onRenameSaved={onRenameSaved}
                onDuplicateSaved={onDuplicateSaved}
                onDeleteSaved={onDeleteSaved}
                onLoadSaved={onLoadSaved}
              />
            </div>
          </div>

          {/* Mobile sticky footer summary */}
          <a
            href="#results"
            className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-slate-800 bg-[#0b1220]/95 px-4 py-3 text-sm backdrop-blur lg:hidden"
          >
            <span className="font-bold text-slate-100">
              {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
                resultA.totalMonthly$
              )}
              <span className="ml-1 text-xs font-normal text-slate-500">/month</span>
            </span>
            <span className="text-accent">View results ↓</span>
          </a>
        </>
      )}
    </main>
  );
}
