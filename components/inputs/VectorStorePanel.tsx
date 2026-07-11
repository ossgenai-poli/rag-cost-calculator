"use client";

import type { IndexingAlgo, PriceBook, VectorStoreInputs } from "@/lib/types";
import { FieldRow, NumberField, SelectField, Section } from "./controls";

export function VectorStorePanel(props: {
  vectorStore: VectorStoreInputs;
  onChange: (next: VectorStoreInputs) => void;
  priceBook: PriceBook;
}) {
  const { vectorStore, onChange } = props;
  const isPq = vectorStore.indexingAlgo === "ivf_pq";

  return (
    <Section title="Vector Store" hint="OpenSearch Serverless (OCU-based) sizing and indexing.">
      <SelectField<IndexingAlgo>
        label="Indexing algorithm"
        value={vectorStore.indexingAlgo}
        options={[
          { value: "hnsw", label: "HNSW" },
          { value: "ivf_pq", label: "IVF + Product Quantization" },
          { value: "ivf_fp16", label: "IVF + FP16" },
        ]}
        onChange={(v) => onChange({ ...vectorStore, indexingAlgo: v })}
      />
      <FieldRow>
        <NumberField
          label="m (HNSW neighbors)"
          value={vectorStore.m}
          min={1}
          step={1}
          disabled={vectorStore.indexingAlgo !== "hnsw"}
          onChange={(v) => onChange({ ...vectorStore, m: v })}
        />
        <NumberField
          label="Replicas"
          value={vectorStore.replicas}
          min={1}
          step={1}
          onChange={(v) => onChange({ ...vectorStore, replicas: v })}
        />
      </FieldRow>
      <NumberField
        label="PQ compression"
        hint="Only relevant when algorithm is ivf_pq (e.g. 32)"
        value={vectorStore.pqCompression}
        min={1}
        step={1}
        disabled={!isPq}
        onChange={(v) => onChange({ ...vectorStore, pqCompression: v })}
      />
      <FieldRow>
        <NumberField
          label="Min OCU"
          value={vectorStore.minOCU}
          min={0}
          step={1}
          onChange={(v) => onChange({ ...vectorStore, minOCU: v })}
        />
        <NumberField
          label="OCU price"
          suffix="$/hr"
          value={vectorStore.ocuPricePerHr}
          min={0}
          step={0.001}
          onChange={(v) => onChange({ ...vectorStore, ocuPricePerHr: v })}
        />
      </FieldRow>
      <FieldRow>
        <NumberField
          label="Storage price"
          suffix="$/GB-mo"
          value={vectorStore.storagePricePerGBmo}
          min={0}
          step={0.001}
          onChange={(v) => onChange({ ...vectorStore, storagePricePerGBmo: v })}
        />
        <NumberField
          label="RAM per OCU"
          suffix="GB"
          value={vectorStore.gbRamPerOcu}
          min={0.1}
          step={0.1}
          onChange={(v) => onChange({ ...vectorStore, gbRamPerOcu: v })}
        />
      </FieldRow>
      <NumberField
        label="Indexing OCU-hours"
        hint="One-time / periodic indexing compute, in OCU-hours"
        value={vectorStore.indexingOCUhrs}
        min={0}
        step={0.5}
        onChange={(v) => onChange({ ...vectorStore, indexingOCUhrs: v })}
      />
    </Section>
  );
}
