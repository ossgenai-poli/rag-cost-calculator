"use client";

import type { CorpusInputs, RefreshCadence } from "@/lib/types";
import { NumberField, SelectField, Section } from "./controls";

export function CorpusPanel(props: { corpus: CorpusInputs; onChange: (next: CorpusInputs) => void }) {
  const { corpus, onChange } = props;

  return (
    <Section title="Corpus" hint="Size of the document set being embedded and indexed.">
      <NumberField
        label="Number of documents"
        value={corpus.numDocs}
        min={0}
        step={1}
        onChange={(v) => onChange({ ...corpus, numDocs: v })}
      />
      <NumberField
        label="Avg tokens per document"
        suffix="tokens"
        value={corpus.avgTokensPerDoc}
        min={0}
        step={1}
        onChange={(v) => onChange({ ...corpus, avgTokensPerDoc: v })}
      />
      <SelectField<RefreshCadence>
        label="Refresh cadence"
        value={corpus.refreshCadence}
        hint="How often the corpus is re-embedded; drives monthly amortization of ingest cost."
        options={[
          { value: "one-time", label: "One-time" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ]}
        onChange={(v) => onChange({ ...corpus, refreshCadence: v })}
      />
    </Section>
  );
}
