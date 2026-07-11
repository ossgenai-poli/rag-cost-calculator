"use client";

import type { ChunkingInputs, PriceBook } from "@/lib/types";
import { NumberField, SelectField, Section, SliderField } from "./controls";

export function ChunkingPanel(props: {
  chunking: ChunkingInputs;
  onChange: (next: ChunkingInputs) => void;
  priceBook: PriceBook;
  advanced?: boolean;
}) {
  const { chunking, onChange, priceBook, advanced = true } = props;
  const embedModels = priceBook.models.filter((m) => m.kind === "embedding");

  function selectEmbedModel(id: string) {
    const model = embedModels.find((m) => m.id === id);
    if (!model) return;
    onChange({
      ...chunking,
      embedModelId: model.id,
      embedDim: model.dim ?? chunking.embedDim,
      embedPricePer1K: model.inPricePer1K,
    });
  }

  return (
    <Section title="Chunking / Embedding">
      <NumberField
        label="Chunk size"
        suffix="tokens"
        value={chunking.chunkSize}
        min={1}
        step={1}
        onChange={(v) => onChange({ ...chunking, chunkSize: v })}
      />
      {advanced && (
        <SliderField
          label="Overlap"
          value={chunking.overlapFraction}
          min={0}
          max={0.9}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => onChange({ ...chunking, overlapFraction: v })}
        />
      )}
      <SelectField
        label="Embedding model"
        value={chunking.embedModelId}
        hint="Embeddings are API-only — no self-hosted embed option."
        options={embedModels.map((m) => ({ value: m.id, label: m.label }))}
        onChange={selectEmbedModel}
      />
      <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
        <div>
          Dim: <span className="text-slate-300">{chunking.embedDim}</span>
        </div>
        <div>
          Price: <span className="text-slate-300">${chunking.embedPricePer1K}/1K tok</span>
        </div>
      </div>
    </Section>
  );
}
