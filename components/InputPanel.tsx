"use client";

// Engineer-mode input panel. Owns no cost state — every edit patches a slice of
// `inputs` and bubbles a fresh CalcInputs up via `onChange`. Fields are grouped
// by decision (Workload → Retrieval → Generation → Infrastructure) and low-level
// assumptions collapse under the Advanced view.

import { useState } from "react";
import type { CalcInputs, PriceBook } from "@/lib/types";
import { SegmentedToggle } from "./inputs/controls";
import { WorkloadPanel } from "./inputs/WorkloadPanel";
import { CorpusPanel } from "./inputs/CorpusPanel";
import { ChunkingPanel } from "./inputs/ChunkingPanel";
import { VectorStorePanel } from "./inputs/VectorStorePanel";
import { RetrievalPanel } from "./inputs/RetrievalPanel";
import { GuardrailsPanel } from "./inputs/GuardrailsPanel";
import { GenerationPanel } from "./inputs/GenerationPanel";
import { ManagedKbPanel } from "./inputs/ManagedKbPanel";
import { OpsPanel } from "./inputs/OpsPanel";

type View = "quick" | "advanced";

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </div>
  );
}

export function InputPanel(props: {
  inputs: CalcInputs;
  onChange: (next: CalcInputs) => void;
  priceBook: PriceBook;
}) {
  const { inputs, onChange, priceBook } = props;
  const [view, setView] = useState<View>("quick");
  const advanced = view === "advanced";

  return (
    <div className="space-y-4">
      <div className="panel flex items-center justify-between gap-3 p-3">
        <SegmentedToggle<View>
          label="View"
          value={view}
          options={[
            { value: "quick", label: "Quick estimate" },
            { value: "advanced", label: "Advanced assumptions" },
          ]}
          onChange={setView}
        />
        <span className="text-[11px] text-slate-500">
          {advanced ? "All levers shown" : "Low-level assumptions hidden"}
        </span>
      </div>

      <WorkloadPanel inputs={inputs} priceBook={priceBook} onChange={onChange} />
      <CorpusPanel corpus={inputs.corpus} onChange={(next) => onChange({ ...inputs, corpus: next })} />

      <ChunkingPanel
        chunking={inputs.chunking}
        priceBook={priceBook}
        advanced={advanced}
        onChange={(next) => onChange({ ...inputs, chunking: next })}
      />
      <RetrievalPanel
        retrieval={inputs.retrieval}
        priceBook={priceBook}
        onChange={(next) => onChange({ ...inputs, retrieval: next })}
      />

      <GenerationPanel
        generation={inputs.generation}
        priceBook={priceBook}
        advanced={advanced}
        onChange={(next) => onChange({ ...inputs, generation: next })}
      />

      <ManagedKbPanel
        managedKb={inputs.managedKb}
        priceBook={priceBook}
        onChange={(next) => onChange({ ...inputs, managedKb: next })}
      />

      <GroupLabel>Infrastructure assumptions</GroupLabel>
      <VectorStorePanel
        vectorStore={inputs.vectorStore}
        priceBook={priceBook}
        advanced={advanced}
        onChange={(next) => onChange({ ...inputs, vectorStore: next })}
      />
      <GuardrailsPanel
        guardrails={inputs.guardrails}
        advanced={advanced}
        onChange={(next) => onChange({ ...inputs, guardrails: next })}
      />
      <OpsPanel ops={inputs.ops} onChange={(next) => onChange({ ...inputs, ops: next })} />
    </div>
  );
}
