"use client";

import type { PriceBook, RetrievalInputs } from "@/lib/types";
import { FieldRow, NumberField, SelectField, Section, Toggle } from "./controls";

export function RetrievalPanel(props: {
  retrieval: RetrievalInputs;
  onChange: (next: RetrievalInputs) => void;
  priceBook: PriceBook;
}) {
  const { retrieval, onChange, priceBook } = props;
  const rerankModels = priceBook.models.filter((m) => m.kind === "rerank");

  function selectRerankModel(id: string) {
    const model = rerankModels.find((m) => m.id === id);
    if (!model) return;
    onChange({ ...retrieval, rerankModelId: model.id, rerankPricePer1K: model.inPricePer1K });
  }

  return (
    <Section title="Retrieval">
      <FieldRow>
        <NumberField
          label="Top K"
          hint="Chunks retrieved from the vector store"
          value={retrieval.topK}
          min={1}
          step={1}
          onChange={(v) => onChange({ ...retrieval, topK: v })}
        />
        <NumberField
          label="Top N"
          hint="Chunks kept after rerank, into LLM context"
          value={retrieval.topN}
          min={1}
          step={1}
          onChange={(v) => onChange({ ...retrieval, topN: v })}
        />
      </FieldRow>
      <Toggle
        label="Rerank enabled"
        checked={retrieval.rerankEnabled}
        onChange={(v) => onChange({ ...retrieval, rerankEnabled: v })}
      />
      <SelectField
        label="Rerank model"
        value={retrieval.rerankModelId}
        disabled={!retrieval.rerankEnabled}
        options={rerankModels.map((m) => ({ value: m.id, label: m.label }))}
        onChange={selectRerankModel}
      />
    </Section>
  );
}
