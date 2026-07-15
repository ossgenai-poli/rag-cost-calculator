"use client";

// Stage-F export controls. The report itself is the PURE buildReport() template (report.ts) — this
// component only hands the byte-deterministic Markdown to the clipboard or a client-side download
// (static-export friendly; no server, no network). A collapsed preview lets the customer read exactly
// what will be shared before copying.
import { useState } from "react";
import type { NarratedRecommendationResult } from "@/lib/recommendation";
import { buildReport } from "./report";

export function ExportPanel({ result }: { result: NarratedRecommendationResult }) {
  const [copied, setCopied] = useState(false);
  const report = buildReport(result);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([report], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "rag-advisor-report.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="export-heading" data-testid="export-panel" className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="export-heading" className="text-sm font-semibold text-slate-900">Share this result</h2>
        <div className="flex gap-2">
          <button type="button" data-testid="export-copy" onClick={copy} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50">
            {copied ? "Copied ✓" : "Copy report"}
          </button>
          <button type="button" data-testid="export-download" onClick={download} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50">
            Download (.md)
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        A deterministic Markdown report in the fixed hierarchy order (recommendation → why → cost → architecture → confidence → risks → evidence) — identical inputs produce an identical report.
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-slate-600">Preview the exact report</summary>
        <pre data-testid="export-preview" className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800">{report}</pre>
      </details>
    </section>
  );
}
