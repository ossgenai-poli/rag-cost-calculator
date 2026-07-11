"use client";

import { useEffect, useMemo, useState } from "react";
import { loadPrices } from "@/lib/prices";
import { calculate, defaultInputs } from "@/lib/calc-engine";
import { InputPanel } from "@/components/InputPanel";
import { ResultsPanel } from "@/components/ResultsPanel";
import type { CalcInputs, LoadPricesResult } from "@/lib/types";

export default function Page() {
  const [prices, setPrices] = useState<LoadPricesResult | null>(null);
  const [inputs, setInputs] = useState<CalcInputs | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load prices (live -> fallback) once on mount; seed default inputs from them.
  useEffect(() => {
    let alive = true;
    loadPrices()
      .then((res) => {
        if (!alive) return;
        setPrices(res);
        setInputs(defaultInputs(res.priceBook));
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  // Always compute BOTH modes so results can render Mode A vs Mode B side by side.
  const { resultA, resultB } = useMemo(() => {
    if (!prices || !inputs) return { resultA: null, resultB: null };
    return {
      resultA: calculate({ ...inputs, ragMode: "A" }, prices.priceBook),
      resultB: calculate({ ...inputs, ragMode: "B" }, prices.priceBook),
    };
  }, [prices, inputs]);

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-100">
          AWS RAG Price Calculator
        </h1>
        <p className="text-sm text-slate-400">
          Engineer-mode monthly cost estimator for Retrieval-Augmented-Generation
          on AWS — OpenSearch Serverless MVP. Self-built (Mode A) vs Bedrock
          Knowledge Bases (Mode B), with an API-vs-self-hosted-GPU crossover.
        </p>
      </header>

      {error && (
        <div className="panel p-4 text-amber-300">
          Failed to initialize: {error}
        </div>
      )}

      {!prices || !inputs || !resultA || !resultB ? (
        <div className="panel p-8 text-center text-slate-400">Loading prices…</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(360px,440px)_1fr]">
          <div>
            <InputPanel
              inputs={inputs}
              onChange={setInputs}
              priceBook={prices.priceBook}
            />
          </div>
          <div>
            <ResultsPanel
              resultA={resultA}
              resultB={resultB}
              priceBook={prices.priceBook}
              asOf={prices.asOf}
              stale={prices.stale}
            />
          </div>
        </div>
      )}
    </main>
  );
}
