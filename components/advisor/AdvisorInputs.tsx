"use client";

// Customer input journey (docs/ux-v2/01-journey-map.md Stages A-B). Simple mode = the discovery
// conversation (model, volume, priority); Expert mode adds the SLA + workload-shape fields the
// engine actually consumes. Every field feeds CalcInputs verbatim — no hidden defaults beyond the
// frozen defaultInputs() the calculator itself uses.
import type { ModelPrice } from "@/lib/types";
import type { OptimizeFor } from "@/lib/recommendation";

export interface AdvisorState {
  modelId: string;
  volume: number;
  optimizeFor: OptimizeFor;
  mode: "simple" | "expert";
  ttftTargetMs: number;
  interactivityTarget: number;
  outTokens: number;
  queryTokens: number;
  promptOverhead: number;
  chunkSize: number;
  topN: number;
  topK: number;
  uptimeHours: number;
  experimental: boolean;
}

const OPTIMIZE_LABELS: Record<OptimizeFor, string> = {
  cost: "Lowest cost",
  latency: "Lowest latency",
  confidence: "Strongest evidence",
  predictability: "Predictable spend",
};

function Num({ id, label, value, min, onChange }: { id: string; label: string; value: number; min?: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
      />
    </div>
  );
}

export function AdvisorInputs({ state, models, onChange }: { state: AdvisorState; models: ModelPrice[]; onChange: (next: AdvisorState) => void }) {
  const set = <K extends keyof AdvisorState>(k: K, v: AdvisorState[K]) => onChange({ ...state, [k]: v });
  const llms = models.filter((m) => m.kind === "llm");
  return (
    <form aria-label="Workload inputs" data-testid="advisor-inputs" className="space-y-3" onSubmit={(e) => e.preventDefault()}>
      <div>
        <label htmlFor="adv-model" className="block text-xs font-medium text-slate-600">Model</label>
        <select
          id="adv-model"
          value={state.modelId}
          onChange={(e) => set("modelId", e.target.value)}
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
        >
          {llms.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}{m.selfHostable ? "" : " — API only"}
            </option>
          ))}
        </select>
      </div>
      <Num id="adv-volume" label="Questions per month" value={state.volume} min={1} onChange={(v) => set("volume", v)} />
      <div>
        <label htmlFor="adv-optimize" className="block text-xs font-medium text-slate-600">Optimize for</label>
        <select
          id="adv-optimize"
          value={state.optimizeFor}
          onChange={(e) => set("optimizeFor", e.target.value as OptimizeFor)}
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
        >
          {(Object.keys(OPTIMIZE_LABELS) as OptimizeFor[]).map((k) => (
            <option key={k} value={k}>{OPTIMIZE_LABELS[k]}</option>
          ))}
        </select>
        <p className="mt-0.5 text-xs text-slate-500">Orders the self-host options; it never flips the API-vs-self-host decision.</p>
      </div>

      {state.mode === "expert" && (
        <fieldset className="space-y-3 rounded border border-slate-200 p-3" data-testid="expert-inputs">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Expert — SLA & workload shape</legend>
          <div className="grid grid-cols-2 gap-3">
            <Num id="adv-ttft" label="P99 TTFT target (ms)" value={state.ttftTargetMs} min={1} onChange={(v) => set("ttftTargetMs", v)} />
            <Num id="adv-intvty" label="Streaming target (tok/s/user)" value={state.interactivityTarget} min={1} onChange={(v) => set("interactivityTarget", v)} />
            <Num id="adv-query" label="User query tokens" value={state.queryTokens} min={0} onChange={(v) => set("queryTokens", v)} />
            <Num id="adv-prompt" label="Prompt overhead tokens" value={state.promptOverhead} min={0} onChange={(v) => set("promptOverhead", v)} />
            <Num id="adv-chunk" label="Chunk size (tokens)" value={state.chunkSize} min={1} onChange={(v) => set("chunkSize", v)} />
            <Num id="adv-topn" label="Context chunks sent (Top N)" value={state.topN} min={0} onChange={(v) => set("topN", v)} />
            <Num id="adv-topk" label="Chunks retrieved (Top K)" value={state.topK} min={1} onChange={(v) => set("topK", v)} />
            <Num id="adv-out" label="Output tokens per answer" value={state.outTokens} min={0} onChange={(v) => set("outTokens", v)} />
            <Num id="adv-uptime" label="GPU fleet uptime (h/mo)" value={state.uptimeHours} min={0} onChange={(v) => set("uptimeHours", v)} />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="adv-experimental"
              type="checkbox"
              checked={state.experimental}
              onChange={(e) => set("experimental", e.target.checked)}
            />
            <label htmlFor="adv-experimental" className="text-xs text-slate-600">
              Experimental cross-source evidence check (demote-only; may hold confidence at <em>unbenchmarked</em>)
            </label>
          </div>
        </fieldset>
      )}
    </form>
  );
}
