"use client";

import type { GenerationInputs, GenerationMode, ModelPrice, PriceBook } from "@/lib/types";
import { instancesToLoad, modelMemoryGB } from "@/lib/self-host";
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
  // API mode lists hosted/proprietary models; self-hosted lists only open-weight
  // models that can actually run on your own GPUs.
  const apiModels = llmModels.filter((m) => !m.selfHostable);
  const selfHostModels = llmModels.filter((m) => m.selfHostable);
  const bedrockModels = apiModels.filter((m) => m.bedrock);
  const nonBedrockModels = apiModels.filter((m) => !m.bedrock);

  const selectedModel = llmModels.find((m) => m.id === generation.llmModelId);
  const selfHosted = generation.mode === "self-hosted";
  const gpu = priceBook.gpus.find((g) => g.instanceType === generation.gpuInstanceType);

  function patchModel(model: ModelPrice | undefined, extra?: Partial<GenerationInputs>) {
    if (!model) {
      if (extra) onChange({ ...generation, ...extra });
      return;
    }
    onChange({
      ...generation,
      ...extra,
      llmModelId: model.id,
      llmInPricePer1K: model.inPricePer1K,
      llmOutPricePer1K: model.outPricePer1K,
    });
  }

  function selectLlmModel(id: string) {
    patchModel(llmModels.find((m) => m.id === id));
  }

  // Switching mode narrows the model list — auto-pick a valid model if the
  // current one isn't available in the new mode.
  function setMode(mode: GenerationMode) {
    const validList = mode === "self-hosted" ? selfHostModels : apiModels;
    const stillValid = validList.some((m) => m.id === generation.llmModelId);
    patchModel(stillValid ? undefined : validList[0], { mode });
  }

  function selectGpu(instanceType: string) {
    const g = priceBook.gpus.find((x) => x.instanceType === instanceType);
    if (!g) return;
    onChange({
      ...generation,
      gpuInstanceType: g.instanceType,
      gpuPricePerHr: g.pricePerHr,
      sustainedTokPerSec: g.sustainedTokPerSec,
    });
  }

  // Memory-based GPU count to load the selected open-weight model.
  const memInstances =
    selfHosted && selectedModel?.paramsB && gpu
      ? instancesToLoad(selectedModel.paramsB, gpu.totalMemGB)
      : null;
  const modelMem = selectedModel?.paramsB ? modelMemoryGB(selectedModel.paramsB) : 0;

  return (
    <Section title="Generation">
      <SegmentedToggle<GenerationMode>
        label="Mode"
        value={generation.mode}
        options={[
          { value: "api", label: "API" },
          { value: "self-hosted", label: "Self-hosted GPU" },
        ]}
        onChange={setMode}
      />

      {selfHosted ? (
        <SelectField
          label="LLM (open weights)"
          hint="Self-hosted runs open-weight models only — proprietary APIs (Claude, Gemini, GPT) can't be self-hosted."
          value={generation.llmModelId}
          options={selfHostModels.map((m) => ({ value: m.id, label: m.label }))}
          onChange={selectLlmModel}
        />
      ) : (
        <SelectField
          label="LLM"
          value={generation.llmModelId}
          groups={[
            { label: "Bedrock", options: bedrockModels.map((m) => ({ value: m.id, label: m.label })) },
            { label: "Non-Bedrock", options: nonBedrockModels.map((m) => ({ value: m.id, label: m.label })) },
          ]}
          onChange={selectLlmModel}
        />
      )}
      {!selfHosted && selectedModel && !selectedModel.bedrock && (
        <p className="text-xs text-amber-400">⚠ non-Bedrock: data egress / no VPC-private inference</p>
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

        {/* Memory-based instance count to load the model */}
        {selfHosted && memInstances && gpu && selectedModel && (
          <div className="rounded-md border border-accent/30 bg-accent/5 p-2.5 text-xs">
            <div className="font-medium text-slate-200">
              To load the weights: {memInstances} × {gpu.instanceType}
              <span className="ml-1 font-normal text-slate-400">
                = {memInstances * gpu.totalMemGB} GB HBM
              </span>
            </div>
            <div className="mt-0.5 text-slate-400">
              {selectedModel.paramsB}B params ≈ {Math.round(modelMem)} GB in FP16 (weights + overhead) vs{" "}
              {gpu.totalMemGB} GB per instance. Throughput may push this higher at high volume.
            </div>
          </div>
        )}

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
