"use client";

// Preset interaction (docs/ux-v2/07-presets.md): applying a preset ALWAYS shows a preview of exactly
// which fields change (old → new, "no change" greyed), flags conflicts with SA-edited fields
// (default = KEEP the edit), requires an explicit Apply, and supports a single Undo that restores the
// pre-apply state. After apply, a chip shows the active preset and how many fields were kept.
import { useState } from "react";
import type { AdvisorState } from "./AdvisorInputs";
import { RESPONSE_PRESETS, computePreview, applyPreset, type PresetBundle, type PresetField, type PreviewRow } from "./presets";

interface ActivePreset {
  label: string;
  fieldsKept: number;
}

export function PresetBar({ state, defaults, onChange }: { state: AdvisorState; defaults: AdvisorState; onChange: (next: AdvisorState) => void }) {
  const [previewFor, setPreviewFor] = useState<PresetBundle | null>(null);
  const [useValue, setUseValue] = useState<Partial<Record<PresetField, boolean>>>({});
  const [active, setActive] = useState<ActivePreset | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<AdvisorState | null>(null);
  const [undoneLabel, setUndoneLabel] = useState<string | null>(null);

  const rows: PreviewRow[] = previewFor ? computePreview(state, defaults, previewFor) : [];

  const openPreview = (bundle: PresetBundle) => {
    setPreviewFor(bundle);
    setUseValue({}); // conflicts default to KEEP the SA's value
    setUndoneLabel(null);
  };
  const apply = () => {
    if (!previewFor) return;
    const { next, fieldsKept } = applyPreset(state, rows, useValue);
    setUndoSnapshot(state); // single undo restores the pre-apply state
    setActive({ label: previewFor.label, fieldsKept });
    setPreviewFor(null);
    onChange(next);
  };
  const undo = () => {
    if (!undoSnapshot || !active) return;
    onChange(undoSnapshot);
    setUndoneLabel(active.label);
    setActive(null);
    setUndoSnapshot(null);
  };

  return (
    <section aria-label="Response-experience presets" data-testid="preset-bar" className="rounded-lg border border-slate-200 bg-white p-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Response experience (Stage C)</h2>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {RESPONSE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid={`preset-${p.id}`}
            title={p.description}
            onClick={() => openPreview(p)}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            {p.label}
          </button>
        ))}
      </div>

      {active && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="active-preset-chip">
          <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-sky-900">
            {active.label}{active.fieldsKept > 0 ? ` (${active.fieldsKept} field${active.fieldsKept > 1 ? "s" : ""} kept)` : ""}
          </span>
          <button type="button" data-testid="preset-undo" onClick={undo} className="text-sky-700 underline">Undo</button>
        </p>
      )}
      {undoneLabel && (
        <p role="status" className="mt-2 text-xs text-slate-600" data-testid="preset-undone-toast">Reverted “{undoneLabel}”.</p>
      )}

      {previewFor && (
        <div role="dialog" aria-modal="false" aria-label={`Preview: ${previewFor.label}`} data-testid="preset-preview" className="mt-2 rounded border border-slate-300 bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-800">
            “{previewFor.label}” will change {rows.filter((r) => r.status !== "no-change").length} field(s):
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {rows.map((r) => (
              <li key={r.field} data-testid={`preview-row-${r.field}`} className={r.status === "no-change" ? "text-slate-400" : "text-slate-800"}>
                <span className="font-medium">{r.label}</span>{" "}
                <span className="font-mono">{r.current} → {r.proposed}</span>
                {r.status === "no-change" && <span className="ml-1">(no change)</span>}
                {r.status === "conflict" && (
                  <fieldset className="ml-4 mt-0.5" data-testid={`conflict-${r.field}`}>
                    <legend className="text-xs text-amber-800">⚠ conflicts with your edit — you set {r.current}</legend>
                    <label className="mr-3 text-xs">
                      <input
                        type="radio"
                        name={`conflict-${r.field}`}
                        checked={useValue[r.field] !== true}
                        onChange={() => setUseValue({ ...useValue, [r.field]: false })}
                      />{" "}
                      Keep my {r.current}
                    </label>
                    <label className="text-xs">
                      <input
                        type="radio"
                        name={`conflict-${r.field}`}
                        checked={useValue[r.field] === true}
                        onChange={() => setUseValue({ ...useValue, [r.field]: true })}
                      />{" "}
                      Use preset {r.proposed}
                    </label>
                  </fieldset>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button type="button" data-testid="preset-cancel" onClick={() => setPreviewFor(null)} className="rounded border border-slate-300 px-2 py-0.5 text-xs">Cancel</button>
            <button type="button" data-testid="preset-apply" onClick={apply} className="rounded bg-slate-800 px-2 py-0.5 text-xs text-white">Apply all</button>
          </div>
        </div>
      )}
    </section>
  );
}
