"use client";

import type { GenerationInputs, GenerationMode, PriceBook } from "@/lib/types";
import {
  NumberField,
  SegmentedToggle,
  SelectField,
  Section,
  SliderField,
} from "./controls";

export function GenerationPanel(props: {
  generation: GenerationInputs;
  onChange: (next: GenerationInputs) => void;
  priceBook: PriceBook;
  advanced?: boolean;
}) {
  const { generation, onChange, priceBook, advanced = true } = props;
  const llmModels = priceBook.models.filter((m) => m.kind === "llm");
  const bedrockModels = llmModels.filter((m) => m.bedrock);
  const nonBedrockModels = llmModels.filter((m) => !m.bedrock);
  const selectedModel = llmModels.find((m) => m.id === generation.llmModelId);
  const selfHosted = generation.mode === "self-hosted";

  function selectLlmModel(id: string) {
    const model = llmModels.find((m) => m.id === id);
    if (!model) return;
    onChange({
      ...generation,
      llmModelId: model.id,
      llmInPricePer1K: model.inPricePer1K,
      llmOutPricePer1K: model.outPricePer1K,
    });
  }

  function selectGpu(instanceType: string) {
    const gpu = priceBook.gpus.find((g) => g.instanceType === instanceType);
    if (!gpu) return;
    onChange({
      ...generation,
      gpuInstanceType: gpu.instanceType,
      gpuPricePerHr: gpu.pricePerHr,
      sustainedTokPerSec: gpu.sustainedTokPerSec,
    });
  }

  return (
    <Section title="Generation">
      <SegmentedToggle<GenerationMode>
        label="Mode"
        value={generation.mode}
        options={[
          { value: "api", label: "API" },
          { value: "self-hosted", label: "Self-hosted GPU" },
        ]}
        onChange={(v) => onChange({ ...generation, mode: v })}
      />

      <SelectField
        label="LLM"
        value={generation.llmModelId}
        groups={[
          { label: "Bedrock", options: bedrockModels.map((m) => ({ value: m.id, label: m.label })) },
          {
            label: "Non-Bedrock",
            options: nonBedrockModels.map((m) => ({ value: m.id, label: m.label })),
          },
        ]}
        onChange={selectLlmModel}
      />
      {selectedModel && !selectedModel.bedrock && (
        <p className="text-xs text-amber-400">
          ⚠ non-Bedrock: data egress / no VPC-private inference
        </p>
      )}

      <NumberField
        label="System prompt & formatting"
        hint="System prompt + formatting tokens added to every query (prompt overhead)"
        suffix="tokens/query"
        value={generation.promptOverhead}
        min={0}
        step={1}
        onChange={(v) => onChange({ ...generation, promptOverhead: v })}
      />

      <div className="pt-2 border-t border-slate-800 space-y-3">
        <span className="text-xs text-slate-500">
          Self-hosted GPU parameters {selfHosted ? "" : "(inactive — API mode selected)"}
        </span>
        <SelectField
          label="GPU instance"
          value={generation.gpuInstanceType}
          disabled={!selfHosted}
          options={priceBook.gpus.map((g) => ({
            value: g.instanceType,
            label: `${g.instanceType} (${g.gpu})`,
          }))}
          onChange={selectGpu}
        />
        <NumberField
          label="GPU price"
          suffix="$/hr"
          value={generation.gpuPricePerHr}
          min={0}
          step={0.01}
          disabled={!selfHosted}
          onChange={(v) => onChange({ ...generation, gpuPricePerHr: v })}
        />
        {advanced && (
          <>
            <NumberField
              label="Decode throughput"
              hint="Output (decode) tokens/sec per box. Capacity is sized conservatively against total tokens."
              suffix="output tok/s"
              value={generation.sustainedTokPerSec}
              min={1}
              step={1}
              disabled={!selfHosted}
              onChange={(v) => onChange({ ...generation, sustainedTokPerSec: v })}
            />
            <SliderField
              label="Utilization target"
              value={generation.utilTarget}
              min={0.05}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              disabled={!selfHosted}
              onChange={(v) => onChange({ ...generation, utilTarget: v })}
            />
          </>
        )}
      </div>
    </Section>
  );
}
