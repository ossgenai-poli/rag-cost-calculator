"use client";

import type { GenerationInputs, GenerationMode, GpuInstancePrice, ModelPrice, PriceBook } from "@/lib/types";
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
  // API mode = Bedrock-hosted models; self-hosted = open-weight models only.
  const apiModels = llmModels.filter((m) => !m.selfHostable);
  const selfHostModels = llmModels.filter((m) => m.selfHostable);

  const selectedModel = llmModels.find((m) => m.id === generation.llmModelId);
  const selfHosted = generation.mode === "self-hosted";
  const gpu = priceBook.gpus.find((g) => g.instanceType === generation.gpuInstanceType);

  // Minimum instances to hold the selected model's weights on the selected GPU
  // at the selected precision.
  const floorFor = (model: ModelPrice | undefined, g: GpuInstancePrice | undefined, bits: number) =>
    instancesToLoad(model?.paramsB, g?.totalMemGB ?? 0, bits);

  function patchModel(model: ModelPrice | undefined, g: GpuInstancePrice | undefined, extra?: Partial<GenerationInputs>) {
    const next: GenerationInputs = { ...generation, ...extra };
    if (model) {
      next.llmModelId = model.id;
      next.llmInPricePer1K = model.inPricePer1K;
      next.llmOutPricePer1K = model.outPricePer1K;
    }
    // Reset the fleet to the minimum needed to load the (new) model on the GPU.
    if ((extra?.mode ?? generation.mode) === "self-hosted") {
      next.numInstances = floorFor(model ?? selectedModel, g ?? gpu, next.weightBits);
    }
    onChange(next);
  }

  function selectLlmModel(id: string) {
    patchModel(llmModels.find((m) => m.id === id), gpu);
  }

  function setMode(mode: GenerationMode) {
    const validList = mode === "self-hosted" ? selfHostModels : apiModels;
    const stillValid = validList.some((m) => m.id === generation.llmModelId);
    patchModel(stillValid ? selectedModel : validList[0], gpu, { mode });
  }

  function selectGpu(instanceType: string) {
    const g = priceBook.gpus.find((x) => x.instanceType === instanceType);
    if (!g) return;
    patchModel(selectedModel, g, {
      gpuInstanceType: g.instanceType,
      gpuPricePerHr: g.pricePerHr,
      sustainedTokPerSec: g.sustainedTokPerSec,
    });
  }

  const memInstances =
    selfHosted && selectedModel?.paramsB && gpu ? floorFor(selectedModel, gpu, generation.weightBits) : null;
  const modelMem = selectedModel?.paramsB ? modelMemoryGB(selectedModel.paramsB, generation.weightBits) : 0;

  const precisionLabel = (bits: number) =>
    bits >= 16 ? "BF16 / FP16" : bits === 8 ? "FP8 / INT8" : "INT4";

  return (
    <Section title="Generation">
      <SegmentedToggle<GenerationMode>
        label="Mode"
        value={generation.mode}
        options={[
          { value: "api", label: "API (Bedrock)" },
          { value: "self-hosted", label: "Self-hosted GPU" },
        ]}
        onChange={setMode}
      />

      <SelectField
        label={selfHosted ? "LLM (open weights)" : "LLM (Bedrock)"}
        hint={
          selfHosted
            ? "Self-hosted runs open-weight models only — proprietary APIs can't be self-hosted."
            : undefined
        }
        value={generation.llmModelId}
        options={(selfHosted ? selfHostModels : apiModels).map((m) => ({ value: m.id, label: m.label }))}
        onChange={selectLlmModel}
      />

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

        <SelectField
          label="Weight precision"
          hint="Quantization lowers memory (fewer instances) and raises decode throughput (rough planning factors)."
          value={String(generation.weightBits)}
          disabled={!selfHosted}
          options={[
            { value: "16", label: "BF16 / FP16 (2 bytes)" },
            { value: "8", label: "FP8 / INT8 (1 byte)" },
            { value: "4", label: "INT4 (0.5 bytes)" },
          ]}
          onChange={(v) => {
            const bits = Number(v);
            const next: GenerationInputs = { ...generation, weightBits: bits };
            if (selfHosted) next.numInstances = floorFor(selectedModel, gpu, bits);
            onChange(next);
          }}
        />

        {selfHosted && memInstances && gpu && selectedModel && (
          <div className="rounded-md border border-accent/30 bg-accent/5 p-2.5 text-xs">
            <div className="font-medium text-slate-200">
              Minimum to load: {memInstances} × {gpu.instanceType}
              <span className="ml-1 font-normal text-slate-400">= {memInstances * gpu.totalMemGB} GB HBM</span>
            </div>
            <div className="mt-0.5 text-slate-400">
              {selectedModel.paramsB}B params ≈ {Math.round(modelMem)} GB at {precisionLabel(generation.weightBits)}{" "}
              (weights + overhead) vs {gpu.totalMemGB} GB per instance.
            </div>
          </div>
        )}

        <NumberField
          label="Number of instances"
          hint={
            memInstances
              ? `Defaults to ${memInstances} (minimum to load the model). Increase for more throughput headroom.`
              : "GPU instances provisioned for generation."
          }
          value={generation.numInstances}
          min={memInstances ?? 1}
          step={1}
          disabled={!selfHosted}
          onChange={(v) => onChange({ ...generation, numInstances: v })}
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
