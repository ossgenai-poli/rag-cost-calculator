"use client";

// Engineer-mode input panel: every cost lever, fully controlled. This
// component owns no state — every edit patches a slice of `inputs` and
// bubbles a brand-new CalcInputs object up via `onChange`.

import type { CalcInputs, PriceBook, RagMode } from "@/lib/types";
import { NumberField, SegmentedToggle, Section } from "./inputs/controls";
import { CorpusPanel } from "./inputs/CorpusPanel";
import { ChunkingPanel } from "./inputs/ChunkingPanel";
import { VectorStorePanel } from "./inputs/VectorStorePanel";
import { RetrievalPanel } from "./inputs/RetrievalPanel";
import { GuardrailsPanel } from "./inputs/GuardrailsPanel";
import { GenerationPanel } from "./inputs/GenerationPanel";
import { TrafficPanel } from "./inputs/TrafficPanel";

export function InputPanel(props: {
  inputs: CalcInputs;
  onChange: (next: CalcInputs) => void;
  priceBook: PriceBook;
}) {
  const { inputs, onChange, priceBook } = props;

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <SegmentedToggle<RagMode>
          label="RAG mode"
          value={inputs.ragMode}
          options={[
            { value: "A", label: "A — Self-built" },
            { value: "B", label: "B — Bedrock Knowledge Bases" },
          ]}
          onChange={(v) => onChange({ ...inputs, ragMode: v })}
        />
      </div>

      <Section title="Query" hint="Applies to every query regardless of RAG mode.">
        <NumberField
          label="User query length"
          suffix="tokens"
          value={inputs.queryTokens}
          min={0}
          step={1}
          onChange={(v) => onChange({ ...inputs, queryTokens: v })}
        />
      </Section>

      <CorpusPanel corpus={inputs.corpus} onChange={(next) => onChange({ ...inputs, corpus: next })} />

      <ChunkingPanel
        chunking={inputs.chunking}
        priceBook={priceBook}
        onChange={(next) => onChange({ ...inputs, chunking: next })}
      />

      <VectorStorePanel
        vectorStore={inputs.vectorStore}
        priceBook={priceBook}
        onChange={(next) => onChange({ ...inputs, vectorStore: next })}
      />

      <RetrievalPanel
        retrieval={inputs.retrieval}
        priceBook={priceBook}
        onChange={(next) => onChange({ ...inputs, retrieval: next })}
      />

      <GuardrailsPanel
        guardrails={inputs.guardrails}
        onChange={(next) => onChange({ ...inputs, guardrails: next })}
      />

      <GenerationPanel
        generation={inputs.generation}
        priceBook={priceBook}
        onChange={(next) => onChange({ ...inputs, generation: next })}
      />

      <TrafficPanel
        traffic={inputs.traffic}
        priceBook={priceBook}
        onChange={(next) => onChange({ ...inputs, traffic: next })}
      />
    </div>
  );
}
