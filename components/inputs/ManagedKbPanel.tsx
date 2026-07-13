"use client";

import type { ManagedKbInputs, ManagedKbRetrievalMode, PriceBook } from "@/lib/types";
import { NumberField, Section, SegmentedToggle } from "./controls";

/**
 * Managed Bedrock Knowledge Bases inputs — drives the "Bedrock KB + API"
 * comparison scenario. Pricing is AWS-published (storage + retrieval; parsing,
 * embeddings, and reranking are included).
 */
export function ManagedKbPanel(props: {
  managedKb: ManagedKbInputs;
  onChange: (next: ManagedKbInputs) => void;
  priceBook: PriceBook;
}) {
  const { managedKb, onChange, priceBook } = props;
  const kb = priceBook.managedKb;

  return (
    <Section title="Managed retrieval (Bedrock KB)" hint="Comparison scenario — AWS-published rates.">
      <SegmentedToggle<ManagedKbRetrievalMode>
        label="Retrieval mode"
        value={managedKb.retrievalMode}
        options={[
          { value: "standard", label: `Standard ($${kb.retrievePer1k}/1K)` },
          { value: "agentic", label: `Agentic ($${kb.agenticRetrievePer1k}/1K)` },
        ]}
        onChange={(v) => onChange({ ...managedKb, retrievalMode: v })}
      />

      <NumberField
        label="Indexed raw data"
        suffix="GB"
        hint={`Storage billed at $${kb.indexStoragePerGBmo}/GB-mo. Raise for multimodal (PDFs/images).`}
        value={managedKb.indexedDataGB}
        min={0}
        step={1}
        onChange={(v) => onChange({ ...managedKb, indexedDataGB: v })}
      />

      {managedKb.retrievalMode === "agentic" && (
        <NumberField
          label="Underlying retrievals / agentic call"
          hint="Each Agentic Retrieve call makes this many underlying Retrieve calls (billed extra)."
          value={managedKb.underlyingRetrievalsPerCall}
          min={0}
          step={0.5}
          onChange={(v) => onChange({ ...managedKb, underlyingRetrievalsPerCall: v })}
        />
      )}
    </Section>
  );
}
