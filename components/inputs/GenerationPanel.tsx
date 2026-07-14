"use client";

import type { GenerationInputs, GenerationMode, GpuInstancePrice, GpuPricingModel, ModelPrice, PriceBook } from "@/lib/types";
import { effectiveGpuHourly, GPU_COMMITMENT_DISCOUNT, instancesToLoad, modelWeightsGB, kvCacheGB } from "@/lib/self-host";
import { applyGpuSelection, applyModelSelection } from "@/lib/ui-logic";
import {
  NumberField,
  SegmentedToggle,
  SelectField,
  Section,
  SliderField,
  Toggle,
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

  // Minimum instances to load + serve the model on the GPU: weights (precision)
  // + KV cache (attention arch × context × concurrency) + runtime reserve.
  const floorFor = (model: ModelPrice | undefined, g: GpuInstancePrice | undefined, bits: number) =>
    instancesToLoad(
      model?.paramsB,
      g?.totalMemGB ?? 0,
      bits,
      model?.kvBytesPerToken,
      generation.maxContextLen,
      generation.maxConcurrentSeqs,
      generation.kvBits
    );

  function patchModel(model: ModelPrice | undefined, g: GpuInstancePrice | undefined, extra?: Partial<GenerationInputs>) {
    // Use the SHARED selectors (lib/ui-logic) so coupled fields always move
    // together — the same transforms tests build fixtures with (QA-014).
    let next: GenerationInputs = { ...generation, ...extra };
    if (model) next = applyModelSelection(next, model);
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
    // GPU change must NOT reset the comparison model — apply the shared GPU
    // selector (instance type + price + throughput move together).
    const patched = applyGpuSelection(generation, g);
    patchModel(undefined, g, {
      gpuInstanceType: patched.gpuInstanceType,
      gpuPricePerHr: patched.gpuPricePerHr,
      sustainedTokPerSec: patched.sustainedTokPerSec,
    });
  }

  function selectApiComparison(id: string) {
    const m = llmModels.find((x) => x.id === id);
    if (!m) return;
    onChange({
      ...generation,
      apiComparisonModelId: m.id,
      apiComparisonInPricePer1K: m.inPricePer1K,
      apiComparisonOutPricePer1K: m.outPricePer1K,
    });
  }

  const memInstances =
    selfHosted && selectedModel?.paramsB && gpu ? floorFor(selectedModel, gpu, generation.weightBits) : null;
  const weightsGB = selectedModel?.paramsB ? modelWeightsGB(selectedModel.paramsB, generation.weightBits) : 0;
  const kvGB = kvCacheGB(
    selectedModel?.kvBytesPerToken,
    generation.kvBits,
    generation.maxContextLen,
    generation.maxConcurrentSeqs
  );

  const precisionLabel = (bits: number) =>
    bits >= 16 ? "BF16 / FP16" : bits === 8 ? "FP8 / INT8" : "INT4";

  // KV-affecting change: patch + re-default the fleet to the new minimum.
  function patchServing(patch: Partial<GenerationInputs>) {
    const next: GenerationInputs = { ...generation, ...patch };
    if (selfHosted) {
      next.numInstances = instancesToLoad(
        selectedModel?.paramsB,
        gpu?.totalMemGB ?? 0,
        next.weightBits,
        selectedModel?.kvBytesPerToken,
        next.maxContextLen,
        next.maxConcurrentSeqs,
        next.kvBits
      );
    }
    onChange(next);
  }

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

      {selfHosted && (
        <>
          <SelectField
            label="API comparison model"
            hint="Model priced in the API-vs-self-hosted comparison. Defaults to the same model (apples-to-apples)."
            value={generation.apiComparisonModelId || generation.llmModelId}
            options={llmModels.map((m) => ({ value: m.id, label: m.label }))}
            onChange={selectApiComparison}
          />
          {generation.apiComparisonModelId && generation.apiComparisonModelId !== generation.llmModelId && (
            <p className="text-xs text-amber-400">
              ⚠ Proxy comparison — API uses a different model than the self-hosted one. Quality,
              context length, and throughput may differ.
            </p>
          )}
        </>
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
          onChange={(v) => patchServing({ weightBits: Number(v) })}
        />

        <SelectField
          label="KV-cache precision"
          hint="INDEPENDENT of weight precision. BF16 is the conservative default; FP8 halves KV memory where the runtime/model supports it. INT4 KV is not offered by default."
          value={String(generation.kvBits)}
          disabled={!selfHosted}
          options={[
            { value: "16", label: "BF16 / FP16 (2 bytes)" },
            { value: "8", label: "FP8 (1 byte)" },
          ]}
          onChange={(v) => patchServing({ kvBits: Number(v) })}
        />

        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Max context length"
            hint="Longest sequence held in KV cache — drives KV memory (and instances)."
            suffix="tokens"
            value={generation.maxContextLen}
            min={128}
            step={512}
            disabled={!selfHosted}
            onChange={(v) => patchServing({ maxContextLen: v })}
          />
          <NumberField
            label="Max concurrent seqs"
            hint="Concurrent sequences (batch) held in KV cache."
            value={generation.maxConcurrentSeqs}
            min={1}
            step={1}
            disabled={!selfHosted}
            onChange={(v) => patchServing({ maxConcurrentSeqs: v })}
          />
        </div>

        {selfHosted && memInstances && gpu && selectedModel && (
          <div className="rounded-md border border-accent/30 bg-accent/5 p-2.5 text-xs">
            <div className="font-medium text-slate-200">
              Minimum to load: {memInstances} × {gpu.instanceType}
              <span className="ml-1 font-normal text-slate-400">= {memInstances * gpu.totalMemGB} GB HBM</span>
            </div>
            <div className="mt-0.5 text-slate-400">
              Weights {Math.round(weightsGB)} GB ({precisionLabel(generation.weightBits)}) + KV cache{" "}
              {Math.round(kvGB)} GB ({precisionLabel(generation.kvBits)})
              {selectedModel.attentionType && (
                <span className="text-slate-500"> ({selectedModel.attentionType})</span>
              )}{" "}
              + ~15% reserve, vs {gpu.totalMemGB} GB/instance.
            </div>
            {kvGB > weightsGB && (
              <div className="mt-0.5 text-amber-400">
                ⚠ KV cache now exceeds weights — driven by context length × concurrency.
              </div>
            )}
          </div>
        )}

        <NumberField
          label="Number of instances"
          hint={
            memInstances
              ? `Defaults to ${memInstances} (minimum to load + serve the model). Increase for more throughput headroom.`
              : "GPU instances provisioned for generation."
          }
          value={generation.numInstances}
          min={memInstances ?? 1}
          step={1}
          disabled={!selfHosted}
          onChange={(v) =>
            onChange({ ...generation, numInstances: Math.max(1, Math.floor(v || 1)) })
          }
        />

        <Toggle
          label="Auto-size fleet to workload"
          hint="On (default): the fleet grows to serve the load and the cost reflects the required count. Off: bill exactly the instances above — if that can't serve the load, the GPU option is marked infeasible and its savings are suppressed."
          checked={generation.autoSizeFleet !== false}
          disabled={!selfHosted}
          onChange={(v) => onChange({ ...generation, autoSizeFleet: v })}
        />

        <Toggle
          label="Serving redundancy (N+1 replicas)"
          hint="On (default): provision one extra serving replica (minimum two) so a replica loss still serves peak load — real extra fleet and cost. Off: single replica; the UI states HA is excluded."
          checked={generation.haEnabled !== false}
          disabled={!selfHosted}
          onChange={(v) => onChange({ ...generation, haEnabled: v })}
        />

        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Interactivity target"
            suffix="tok/s/user"
            hint="Per-user streaming speed you must deliver (SLA). Higher = snappier UX = fewer concurrent requests per GPU = more GPUs. Grounds fleet sizing in real InferenceX benchmarks."
            value={generation.interactivityTarget}
            min={1}
            step={5}
            disabled={!selfHosted}
            onChange={(v) => onChange({ ...generation, interactivityTarget: v })}
          />
          <NumberField
            label="Max TTFT"
            suffix="ms"
            hint="Time-to-first-token SLA. The chosen benchmark point must meet BOTH this and the interactivity target, or the config is infeasible (no positive self-host verdict)."
            value={generation.ttftTargetMs}
            min={100}
            step={250}
            disabled={!selfHosted}
            onChange={(v) => onChange({ ...generation, ttftTargetMs: v })}
          />
        </div>

        <NumberField
          label="On-demand GPU price"
          suffix="$/hr"
          hint={
            gpu
              ? `Catalog ${gpu.priceSource === "live" ? "live" : "reference"} price for ${gpu.instanceType}: $${gpu.pricePerHr}/hr. Editing this is a user override.`
              : undefined
          }
          value={generation.gpuPricePerHr}
          min={0}
          step={0.01}
          disabled={!selfHosted}
          onChange={(v) => onChange({ ...generation, gpuPricePerHr: v })}
        />
        {selfHosted && gpu && Math.abs(gpu.pricePerHr - generation.gpuPricePerHr) > 1e-6 && (
          <p className="text-xs text-sky-300">
            ⓘ User override — ${generation.gpuPricePerHr}/hr is NOT the {gpu.priceSource === "live" ? "live" : "catalog"}{" "}
            ${gpu.pricePerHr}/hr. Any positive self-host verdict on this price is qualified. Re-select
            the GPU to restore its catalog price.
          </p>
        )}

        <SegmentedToggle<GpuPricingModel>
          label="Purchasing model"
          value={generation.gpuPricingModel}
          disabled={!selfHosted}
          options={[
            { value: "on-demand", label: "On-demand" },
            { value: "reserved-1yr", label: "RI 1yr" },
            { value: "reserved-3yr", label: "RI 3yr" },
            { value: "savings-1yr", label: "Savings" },
            { value: "spot", label: "Spot" },
          ]}
          onChange={(v) => onChange({ ...generation, gpuPricingModel: v })}
        />
        {selfHosted && (
          <div className="rounded-md border border-slate-800 bg-slate-900/40 p-2 text-xs text-slate-400">
            Effective rate{" "}
            <span className="tabular-nums text-slate-200">
              ${effectiveGpuHourly(generation.gpuPricePerHr, generation.gpuPricingModel).toFixed(2)}/hr
            </span>{" "}
            {generation.gpuPricingModel !== "on-demand" && (
              <span className="text-emerald-400">
                (−{Math.round(GPU_COMMITMENT_DISCOUNT[generation.gpuPricingModel] * 100)}% vs on-demand)
              </span>
            )}
            <div className="mt-0.5 text-[11px] text-slate-500">
              Commitment discounts are planning estimates; Spot is interruptible and its price
              fluctuates. Edit the on-demand rate to use a real quote.
            </div>
          </div>
        )}

        <NumberField
          label="Fleet uptime"
          suffix="hrs/mo"
          hint="Hours per month the fleet runs — 730 is always-on (a month's max). Fewer hours lowers cost and decode capacity proportionally (e.g. business-hours or batch)."
          value={generation.gpuUptimeHoursPerMonth}
          min={1}
          max={730}
          step={10}
          disabled={!selfHosted}
          onChange={(v) =>
            onChange({ ...generation, gpuUptimeHoursPerMonth: Math.min(730, Math.max(1, v || 730)) })
          }
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
