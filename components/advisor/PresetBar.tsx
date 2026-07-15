"use client";

// Preset interaction (docs/ux-v2/07-presets.md), revised per iteration-2 HOLD. CONTROLLED component:
// provenance (per-field origins, active preset, safe undo) lives in page state and every transition is
// a pure function from presets.ts. Wording is accurate under conflicts (P2-UI2-1): the header counts
// proposed differences split into selected-to-change vs kept, and the actions are "Apply selected
// changes" plus an explicit "Use all preset values" override. A manual edit after apply flips the chip
// to "Modified from …" and removes Undo (P1-UI2-1).
import { useState } from "react";
import type { AdvisorState } from "./AdvisorInputs";
import {
  RESPONSE_PRESETS, computePreview, previewCounts, applyPresetWithProvenance, undoPreset,
  type PresetBundle, type PresetField, type PresetProvenance, type PreviewRow,
} from "./presets";

export interface PresetBarProps {
  state: AdvisorState;
  provenance: PresetProvenance;
  onApply: (next: AdvisorState, provenance: PresetProvenance) => void;
  onUndo: (state: AdvisorState, provenance: PresetProvenance, revertedLabel: string) => void;
}

export function PresetBar({ state, provenance, onApply, onUndo }: PresetBarProps) {
  const [previewFor, setPreviewFor] = useState<PresetBundle | null>(null);
  const [useValue, setUseValue] = useState<Partial<Record<PresetField, boolean>>>({});
  const [undoneLabel, setUndoneLabel] = useState<string | null>(null);

  const rows: PreviewRow[] = previewFor ? computePreview(state, provenance.origins, previewFor) : [];
  const counts = previewCounts(rows, useValue);

  const openPreview = (bundle: PresetBundle) => {
    setPreviewFor(bundle);
    setUseValue({}); // conflicts default to KEEP the SA's value
    setUndoneLabel(null);
  };
  const apply = (overrideAll: boolean) => {
    if (!previewFor) return;
    const choices = overrideAll
      ? Object.fromEntries(rows.filter((r) => r.status === "conflict").map((r) => [r.field, true]))
      : useValue;
    const { next, provenance: nextProv } = applyPresetWithProvenance(state, provenance, previewFor, rows, choices);
    setPreviewFor(null);
    onApply(next, nextProv);
  };
  const undo = () => {
    const restored = undoPreset(provenance);
    if (!restored) return;
    setUndoneLabel(restored.revertedLabel);
    onUndo(restored.state, restored.provenance, restored.revertedLabel);
  };

  const active = provenance.active;
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
            {active.modified ? `Modified from ${active.label}` : active.label}
            {!active.modified && active.fieldsKept > 0 ? ` (${active.fieldsKept} field${active.fieldsKept > 1 ? "s" : ""} kept)` : ""}
          </span>
          {provenance.undo && (
            <button type="button" data-testid="preset-undo" onClick={undo} className="text-sky-700 underline">Undo</button>
          )}
        </p>
      )}
      {undoneLabel && (
        <p role="status" className="mt-2 text-xs text-slate-600" data-testid="preset-undone-toast">Reverted “{undoneLabel}”.</p>
      )}

      {previewFor && (
        <div role="dialog" aria-modal="false" aria-label={`Preview: ${previewFor.label}`} data-testid="preset-preview" className="mt-2 rounded border border-slate-300 bg-slate-50 p-3">
          {/* P2-UI2-1 — accurate, dynamic wording under conflicts. */}
          <p className="text-sm font-medium text-slate-800" data-testid="preview-header">
            “{previewFor.label}” proposes {counts.differences} difference{counts.differences === 1 ? "" : "s"}: {counts.selected} selected to change, {counts.kept} kept.
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
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" data-testid="preset-cancel" onClick={() => setPreviewFor(null)} className="rounded border border-slate-300 px-2 py-0.5 text-xs">Cancel</button>
            <button type="button" data-testid="preset-apply" onClick={() => apply(false)} className="rounded bg-slate-800 px-2 py-0.5 text-xs text-white">
              Apply selected changes
            </button>
            {rows.some((r) => r.status === "conflict") && (
              <button type="button" data-testid="preset-apply-all" onClick={() => apply(true)} className="rounded border border-slate-400 px-2 py-0.5 text-xs text-slate-700">
                Use all preset values
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
