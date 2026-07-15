"use client";

// Preset interaction (docs/ux-v2/07-presets.md), iteration 3: two families (Response experience ·
// Operational profile) over the SAME approved provenance machinery — accurate selected/kept wording,
// manual-only conflicts, "Modified from …" chips, safe single Undo of the last apply. The HA-posture
// profile shows its persistent non-compliance banner while active (07 P2-6). All transitions are the
// pure functions in presets.ts; this component only renders them.
import { useState } from "react";
import type { AdvisorState } from "./AdvisorInputs";
import {
  RESPONSE_PRESETS, OPERATIONAL_PRESETS, computePreview, previewCounts, applyPresetWithProvenance,
  undoPreset, fmtPresetValue, type PresetBundle, type PresetField, type PresetProvenance, type PreviewRow,
} from "./presets";

export interface PresetBarProps {
  state: AdvisorState;
  provenance: PresetProvenance;
  /** Family-B profiles set self-host inputs — disabled for API-only models. */
  selfHostAvailable: boolean;
  onApply: (next: AdvisorState, provenance: PresetProvenance) => void;
  onUndo: (state: AdvisorState, provenance: PresetProvenance, revertedLabel: string) => void;
}

export function PresetBar({ state, provenance, selfHostAvailable, onApply, onUndo }: PresetBarProps) {
  const [previewFor, setPreviewFor] = useState<PresetBundle | null>(null);
  const [useValue, setUseValue] = useState<Partial<Record<PresetField, boolean>>>({});
  const [undoneLabel, setUndoneLabel] = useState<string | null>(null);

  const rows: PreviewRow[] = previewFor ? computePreview(state, provenance.origins, previewFor) : [];
  const counts = previewCounts(rows, useValue);

  const openPreview = (bundle: PresetBundle) => {
    setPreviewFor(bundle);
    setUseValue({});
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

  const chip = (family: "A" | "B") => {
    const active = provenance.active[family];
    if (!active) return null;
    // P1-UI3-2 — a family-B profile is SUSPENDED (not applied) while the model is API-only: the chip
    // says so explicitly, so the UI never claims "not applicable" and "active" at the same time. The
    // settings are preserved; switching back to a self-hostable model restores the applied state.
    if (family === "B" && !selfHostAvailable) {
      return (
        <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-slate-500" data-testid={`active-preset-${family}`}>
          {active.label} — inactive for API-only model
        </span>
      );
    }
    return (
      <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-sky-900" data-testid={`active-preset-${family}`}>
        {active.modified ? `Modified from ${active.label}` : active.label}
        {!active.modified && active.fieldsKept > 0 ? ` (${active.fieldsKept} field${active.fieldsKept > 1 ? "s" : ""} kept)` : ""}
      </span>
    );
  };

  const buttons = (bundles: PresetBundle[], disabled: boolean) =>
    bundles.map((p) => (
      <button
        key={p.id}
        type="button"
        data-testid={`preset-${p.id}`}
        title={p.description}
        disabled={disabled}
        onClick={() => openPreview(p)}
        className={`rounded border border-slate-300 px-2 py-0.5 text-xs ${disabled ? "bg-slate-100 text-slate-400" : "bg-white text-slate-700 hover:bg-slate-50"}`}
      >
        {p.label}
      </button>
    ));

  // Persistent banner(s) for active profiles that carry one (e.g. the HA posture caveat) — shown while
  // the profile is active, including after later manual edits. A SUSPENDED family-B profile's banner is
  // suppressed (the profile is not currently applied — P1-UI3-2).
  const banners = (["A", "B"] as const)
    .filter((f) => f === "A" || selfHostAvailable)
    .map((f) => provenance.active[f])
    .filter((a): a is NonNullable<typeof a> => !!a && !!a.banner);
  // P1-UI3-2 — a family-B Undo is suspended with its profile while the model is API-only.
  const undoVisible = !!provenance.undo && (provenance.undo.family === "A" || selfHostAvailable);

  return (
    <section aria-label="Presets" data-testid="preset-bar" className="rounded-lg border border-slate-200 bg-white p-3">
      {/* P2-UI3-3 — customer-facing labels; internal stage identifiers stay in the documentation. */}
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Response experience</h2>
      <div className="mt-1 flex flex-wrap gap-1.5">{buttons(RESPONSE_PRESETS, false)}</div>

      <h2 className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Operational profile</h2>
      <div className="mt-1 flex flex-wrap gap-1.5">{buttons(OPERATIONAL_PRESETS, !selfHostAvailable)}</div>
      {!selfHostAvailable && (
        <p className="mt-1 text-xs text-slate-400" data-testid="profiles-disabled-note">
          Operational profiles set self-host inputs — not applicable for an API-only model. Your profile settings are preserved and re-apply when you switch back to a self-hostable model.
        </p>
      )}

      {(provenance.active.A || provenance.active.B) && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="active-preset-chips">
          {chip("A")}
          {chip("B")}
          {undoVisible && (
            <button type="button" data-testid="preset-undo" onClick={undo} className="text-sky-700 underline">Undo</button>
          )}
        </p>
      )}
      {banners.map((a) => (
        <p key={a.id} role="note" data-testid={`preset-banner-${a.id}`} className="mt-2 rounded border border-amber-400 bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
          {a.banner}
        </p>
      ))}
      {undoneLabel && (
        <p role="status" className="mt-2 text-xs text-slate-600" data-testid="preset-undone-toast">Reverted “{undoneLabel}”.</p>
      )}

      {previewFor && (
        <div role="dialog" aria-modal="false" aria-label={`Preview: ${previewFor.label}`} data-testid="preset-preview" className="mt-2 rounded border border-slate-300 bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-800" data-testid="preview-header">
            “{previewFor.label}” proposes {counts.differences} difference{counts.differences === 1 ? "" : "s"}: {counts.selected} selected to change, {counts.kept} kept.
          </p>
          {/* P2-UI3-3 — the description is rendered IN the preview (the title attribute alone is poor
              on touch devices). */}
          <p className="mt-1 text-xs text-slate-600" data-testid="preview-description">{previewFor.description}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {rows.map((r) => (
              <li key={r.field} data-testid={`preview-row-${r.field}`} className={r.status === "no-change" ? "text-slate-400" : "text-slate-800"}>
                <span className="font-medium">{r.label}</span>{" "}
                <span className="font-mono">{fmtPresetValue(r.current)} → {fmtPresetValue(r.proposed)}</span>
                {r.status === "no-change" && <span className="ml-1">(no change)</span>}
                {r.status === "conflict" && (
                  <fieldset className="ml-4 mt-0.5" data-testid={`conflict-${r.field}`}>
                    <legend className="text-xs text-amber-800">⚠ conflicts with your edit — you set {fmtPresetValue(r.current)}</legend>
                    <label className="mr-3 text-xs">
                      <input
                        type="radio"
                        name={`conflict-${r.field}`}
                        checked={useValue[r.field] !== true}
                        onChange={() => setUseValue({ ...useValue, [r.field]: false })}
                      />{" "}
                      Keep my {fmtPresetValue(r.current)}
                    </label>
                    <label className="text-xs">
                      <input
                        type="radio"
                        name={`conflict-${r.field}`}
                        checked={useValue[r.field] === true}
                        onChange={() => setUseValue({ ...useValue, [r.field]: true })}
                      />{" "}
                      Use preset {fmtPresetValue(r.proposed)}
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
