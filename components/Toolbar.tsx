"use client";

import { useEffect, useRef, useState } from "react";
import type { PriceBook } from "@/lib/types";

interface ToolbarProps {
  shareUrl: string;
  onReset: () => void;
  onSaveScenario: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onExportReport: () => void;
  priceBook: PriceBook;
  asOf: string;
}

function Btn({
  onClick,
  children,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded-md border border-slate-700 bg-slate-900/60 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100"
    >
      {children}
    </button>
  );
}

export function Toolbar({
  shareUrl,
  onReset,
  onSaveScenario,
  onExportCsv,
  onExportJson,
  onExportReport,
  priceBook,
  asOf,
}: ToolbarProps) {
  const [copied, setCopied] = useState(false);
  const [modal, setModal] = useState<null | "formulas" | "sources">(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  // Escape closes the modal; move focus into it when it opens (basic a11y).
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [modal]);

  const copyLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        window.prompt("Copy this link:", shareUrl);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link:", shareUrl);
    }
  };

  const saveScenario = () => {
    onSaveScenario();
    flash("Scenario saved ✓");
  };
  const exportCsv = () => {
    onExportCsv();
    flash("CSV exported ✓");
  };
  const exportJson = () => {
    onExportJson();
    flash("JSON exported ✓");
  };
  const exportReport = () => {
    onExportReport();
    flash("Report exported ✓");
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={onReset} title="Reset all inputs to defaults">
          Reset
        </Btn>
        <Btn onClick={copyLink} title="Copy a shareable link with all current parameters">
          {copied ? "Copied ✓" : "Copy link"}
        </Btn>
        <Btn onClick={saveScenario} title="Save the current configuration as a scenario">
          Save scenario
        </Btn>
        <Btn onClick={exportCsv} title="Export the cost breakdown as CSV">
          Export CSV
        </Btn>
        <Btn onClick={exportJson} title="Export all assumptions as JSON">
          Export JSON
        </Btn>
        <Btn onClick={exportReport} title="Export a full Markdown cost report (breakdown, scenarios, assumptions)">
          Export report
        </Btn>
        <Btn onClick={() => setModal("formulas")}>Formulas</Btn>
        <Btn onClick={() => setModal("sources")}>Pricing sources</Btn>
      </div>

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setModal(null)}
          role="dialog"
          aria-modal="true"
          aria-label={modal === "formulas" ? "Calculation formulas" : "Pricing sources"}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-[#111a2e] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-100">
                {modal === "formulas" ? "Calculation formulas" : "Pricing sources"}
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setModal(null)}
                className="rounded text-slate-400 hover:text-slate-100 focus:outline-none focus:ring-1 focus:ring-accent"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            {modal === "formulas" ? <Formulas /> : <Sources priceBook={priceBook} asOf={asOf} />}
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  );
}

function Formulas() {
  const rows: Array<[string, string]> = [
    ["Corpus tokens", "documents × avg tokens/document"],
    ["Effective chunk", "chunk size × (1 − overlap)"],
    ["Vectors", "corpus tokens ÷ effective chunk"],
    ["Input tokens/query", "(chunks sent to LLM × chunk size) + prompt overhead + query length"],
    ["Generation $/query", "(input tokens ÷ 1K × in-price) + (output tokens ÷ 1K × out-price)"],
    ["OpenSearch $/mo", "(indexing OCU-hrs + search OCU × 730) × OCU $/hr + storage GB × $/GB-mo"],
    ["Search OCU", "max(min OCU, ceil(index RAM GB ÷ RAM-per-OCU))"],
    ["Total $/mo", "ingestion (amortized) + vector store + per-query cost × queries/mo"],
    ["Cost per 1K queries", "(total $/mo ÷ queries/mo) × 1000"],
    ["GPU $/mo", "boxes × GPU $/hr × 730, boxes = ceil(tokens ÷ (capacity × util target))"],
    ["Break-even tokens", "GPU $/mo (1 box) ÷ API blended $/token"],
  ];
  return (
    <div className="space-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 border-b border-slate-800 pb-1.5">
          <span className="font-medium text-slate-300">{k}</span>
          <span className="text-slate-400">{v}</span>
        </div>
      ))}
      <p className="pt-2 text-xs text-slate-500">
        All token prices are USD per 1K tokens. 730 hours/month convention.
      </p>
    </div>
  );
}

function SourceBadge({ kind }: { kind: "live" | "reference" | "config" | "estimate" }) {
  const map = {
    live: ["bg-emerald-500/15 text-emerald-300", "live"],
    reference: ["bg-amber-500/15 text-amber-300", "reference"],
    config: ["bg-sky-500/15 text-sky-300", "typed config"],
    estimate: ["bg-slate-600/40 text-slate-300", "estimate"],
  } as const;
  const [cls, label] = map[kind];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>;
}

function Sources({ priceBook, asOf }: { priceBook: PriceBook; asOf: string }) {
  // Live-fetched infra vs typed model config. GPU throughput is always an estimate.
  const infraKind = priceBook.source === "live" ? "live" : "reference";
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>Region {priceBook.region} · updated {asOf}</span>
      </div>
      {/* Badge legend */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        Provenance: <SourceBadge kind="live" /> live AWS Price List API ·{" "}
        <SourceBadge kind="reference" /> committed fallback ·{" "}
        <SourceBadge kind="config" /> typed model config ·{" "}
        <SourceBadge kind="estimate" /> rough estimate
      </div>
      {priceBook.source !== "live" && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200/90">
          Infra prices are committed reference values — the live AWS Price List API isn&apos;t
          reachable in this deployment (static build / no AWS credentials), so they may be stale.
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
          OpenSearch Serverless <SourceBadge kind={infraKind} />
        </div>
        <div className="text-slate-300">
          OCU ${priceBook.opensearch.ocuPricePerHr}/hr · storage ${priceBook.opensearch.storagePricePerGBmo}/GB-mo ·{" "}
          {priceBook.opensearch.gbRamPerOcu} GB RAM/OCU · min {priceBook.opensearch.minOCU} OCU
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
          Bedrock Managed Knowledge Bases <SourceBadge kind="config" />
        </div>
        <div className="text-slate-300">
          Storage ${priceBook.managedKb.indexStoragePerGBmo}/GB-mo · Retrieve ${priceBook.managedKb.retrievePer1k}/1K
          calls · Agentic ${priceBook.managedKb.agenticRetrievePer1k}/1K · parsing/embed/rerank included
        </div>
        <div className="mt-0.5 text-[11px] text-slate-500">
          Published on the AWS Bedrock pricing page · verified {priceBook.managedKb.verifiedAt}
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
          Models <SourceBadge kind="config" />
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-1 font-medium">Model</th>
              <th className="pb-1 font-medium">In $/1K</th>
              <th className="pb-1 font-medium">Out $/1K</th>
              <th className="pb-1 font-medium">Verified</th>
            </tr>
          </thead>
          <tbody>
            {priceBook.models.map((m) => (
              <tr key={m.id} className="border-t border-slate-800">
                <td className="py-1 text-slate-300">{m.label}</td>
                <td className="py-1 tabular-nums text-slate-400">{m.inPricePer1K}</td>
                <td className="py-1 tabular-nums text-slate-400">{m.outPricePer1K}</td>
                <td className="py-1 text-slate-500">{m.verifiedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-slate-500">
          Model / embedding / rerank / guardrail prices are typed config (not in the AWS Pricing
          API). Rerank is $/1K requests; guardrails $/1K text units; others $/1K tokens.
        </p>
      </div>
      <div>
        <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
          GPU instances <SourceBadge kind={infraKind} /> price · <SourceBadge kind="estimate" /> tok/s
        </div>
        <table className="w-full text-xs">
          <tbody>
            {priceBook.gpus.map((g) => (
              <tr key={g.instanceType} className="border-t border-slate-800">
                <td className="py-1 text-slate-300">{g.instanceType} ({g.gpu})</td>
                <td className="py-1 tabular-nums text-slate-400">${g.pricePerHr}/hr</td>
                <td className="py-1 tabular-nums text-slate-400">{g.sustainedTokPerSec} tok/s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
