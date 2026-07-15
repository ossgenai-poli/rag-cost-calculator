// Response-experience presets (docs/ux-v2/07-presets.md, family A — Stage C), revised per iteration-2
// HOLD: per-field ORIGIN is tracked explicitly (default | manual | preset:<id>) and stored with state —
// never inferred from values (P1-UI2-1). Only MANUAL-origin fields create conflicts; fields written by a
// previous preset switch normally. A manual edit after apply marks the active preset "Modified from …"
// and INVALIDATES Undo (Undo can never silently discard later edits). Batch is REMOVED until a
// structured non-interactive/throughput objective exists (P1-UI2-2 / owner position); Conversational is
// labeled a STRICT customer target, not a universal recommendation.
//
// Everything here is pure and unit-tested; PresetBar/page only wire these transitions.
import type { AdvisorState } from "./AdvisorInputs";

export interface PresetBundle {
  id: string;
  label: string;
  description: string;
  /** The AdvisorState fields this preset seeds (SLA inputs only — family A). */
  fields: Partial<Pick<AdvisorState, "ttftTargetMs" | "interactivityTarget">>;
}

// Bundle values are owner-confirmed planning inputs (iteration-2 review): Interactive RAG and
// Analyst/research retained; Conversational retained as an explicitly STRICT/aggressive customer
// target; Batch removed pending a throughput/non-interactive objective.
export const RESPONSE_PRESETS: PresetBundle[] = [
  { id: "strict-conversational", label: "Strict conversational target", description: "An aggressive customer target (~1 s to first word P99, snappy streaming) — a target to test against, not a universal recommendation.", fields: { ttftTargetMs: 1000, interactivityTarget: 50 } },
  { id: "interactive-rag", label: "Interactive RAG", description: "Knowledge assistants (default) — ~2 s to first word (P99).", fields: { ttftTargetMs: 2000, interactivityTarget: 30 } },
  { id: "analyst", label: "Analyst / research", description: "Long, thorough answers — ~5 s to first word (P99).", fields: { ttftTargetMs: 5000, interactivityTarget: 15 } },
];

export type PresetField = keyof PresetBundle["fields"];
export const PRESET_FIELDS: PresetField[] = ["ttftTargetMs", "interactivityTarget"];
export const PRESET_FIELD_LABELS: Record<PresetField, string> = {
  ttftTargetMs: "P99 TTFT target (ms)",
  interactivityTarget: "Streaming target (tok/s/user)",
};

/** Explicit per-field origin — stored WITH state, never inferred from values (P1-UI2-1). */
export type FieldOrigin = "default" | "manual" | `preset:${string}`;

export interface ActivePresetInfo {
  id: string;
  label: string;
  fieldsKept: number;
  /** True once the SA manually edits any preset field after applying — chip reads "Modified from …". */
  modified: boolean;
}

export interface UndoSnapshot {
  state: AdvisorState;
  origins: Record<PresetField, FieldOrigin>;
  label: string;
}

export interface PresetProvenance {
  origins: Record<PresetField, FieldOrigin>;
  active: ActivePresetInfo | null;
  /** Present only while Undo is SAFE (no manual edits since apply). */
  undo: UndoSnapshot | null;
}

export function initialProvenance(): PresetProvenance {
  return { origins: { ttftTargetMs: "default", interactivityTarget: "default" }, active: null, undo: null };
}

/** Which preset fields differ between two states (the page calls this on every committed input change). */
export function changedPresetFields(prev: AdvisorState, next: AdvisorState): PresetField[] {
  return PRESET_FIELDS.filter((f) => prev[f] !== next[f]);
}

/** Register a MANUAL edit of preset fields: origins → manual, active → "Modified from …", and Undo is
 *  INVALIDATED so it can never silently overwrite the later edit (P1-UI2-1). */
export function registerManualEdit(prov: PresetProvenance, fields: PresetField[]): PresetProvenance {
  if (fields.length === 0) return prov;
  const origins = { ...prov.origins };
  for (const f of fields) origins[f] = "manual";
  return {
    origins,
    active: prov.active ? { ...prov.active, modified: true } : null,
    undo: null,
  };
}

export interface PreviewRow {
  field: PresetField;
  label: string;
  current: number;
  proposed: number;
  /** "change" | "no-change" | "conflict" — conflict ONLY when the field's origin is MANUAL. */
  status: "change" | "no-change" | "conflict";
}

/** Pure input comparison. Conflicts come from EXPLICIT manual origin — a non-default value written by a
 *  previous preset switches normally to the new preset (P1-UI2-1 repro A). */
export function computePreview(current: AdvisorState, origins: Record<PresetField, FieldOrigin>, bundle: PresetBundle): PreviewRow[] {
  return (Object.keys(bundle.fields) as PresetField[]).map((field) => {
    const proposed = bundle.fields[field]!;
    const cur = current[field];
    const status: PreviewRow["status"] =
      cur === proposed ? "no-change" : origins[field] === "manual" ? "conflict" : "change";
    return { field, label: PRESET_FIELD_LABELS[field], current: cur, proposed, status };
  });
}

/** Accurate action wording (P2-UI2-1): how many differences the preset proposes, split into selected
 *  changes vs kept fields under the current per-conflict choices. */
export function previewCounts(rows: PreviewRow[], usePresetValue: Partial<Record<PresetField, boolean>>): { differences: number; selected: number; kept: number } {
  const diffs = rows.filter((r) => r.status !== "no-change");
  const selected = diffs.filter((r) => r.status === "change" || usePresetValue[r.field] === true).length;
  return { differences: diffs.length, selected, kept: diffs.length - selected };
}

/** Apply with per-field conflict choices. Taken fields get origin preset:<id>; kept conflicts stay
 *  manual. Returns the full next provenance including a SAFE undo snapshot of the pre-apply state. */
export function applyPresetWithProvenance(
  current: AdvisorState,
  prov: PresetProvenance,
  bundle: PresetBundle,
  rows: PreviewRow[],
  usePresetValue: Partial<Record<PresetField, boolean>>
): { next: AdvisorState; provenance: PresetProvenance } {
  const next = { ...current };
  const origins = { ...prov.origins };
  let fieldsKept = 0;
  for (const row of rows) {
    const take = row.status === "change" || (row.status === "conflict" && usePresetValue[row.field] === true);
    if (row.status !== "no-change" && !take) {
      fieldsKept++;
      continue; // kept → origin stays manual
    }
    if (row.status !== "no-change") (next as Record<PresetField, number>)[row.field] = row.proposed;
    origins[row.field] = `preset:${bundle.id}`; // no-change fields are also preset-consistent now
  }
  return {
    next,
    provenance: {
      origins,
      active: { id: bundle.id, label: bundle.label, fieldsKept, modified: false },
      undo: { state: current, origins: prov.origins, label: bundle.label },
    },
  };
}

/** Safe single Undo: available ONLY while no manual edit followed the apply (else `undo` is null). */
export function undoPreset(prov: PresetProvenance): { state: AdvisorState; provenance: PresetProvenance; revertedLabel: string } | null {
  if (!prov.undo) return null;
  return {
    state: prov.undo.state,
    provenance: { origins: prov.undo.origins, active: null, undo: null },
    revertedLabel: prov.undo.label,
  };
}
