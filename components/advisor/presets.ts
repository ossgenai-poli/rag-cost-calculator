// Preset interaction (docs/ux-v2/07-presets.md), iteration 3: the APPROVED provenance semantics
// (explicit default | manual | preset:<id> origins stored with state; conflicts ONLY from manual;
// manual-after-apply → "Modified from …" + Undo invalidated; safe single Undo restores state AND
// origins) are UNCHANGED — generalized to mixed-type fields and TWO preset families:
//   A. Response experience (Stage C) — ttftTargetMs + interactivityTarget.
//   B. Operational profiles (Stage A/C) — utilization %, N+1, uptime, purchasing mode. These target the
//      iteration-3 STRUCTURED journey-state fields (real engine inputs), never presentation-only state.
// Presets remain declarative INPUT bundles: the engine still derives fleet/confidence from them.
import type { AdvisorState } from "./AdvisorInputs";

export type PresetFamily = "A" | "B";
export type PresetField = "ttftTargetMs" | "interactivityTarget" | "utilTargetPct" | "haEnabled" | "uptimeHours" | "purchasingModel";
export type PresetValue = number | boolean | string;

export interface PresetBundle {
  id: string;
  family: PresetFamily;
  label: string;
  description: string;
  fields: Partial<Record<PresetField, PresetValue>>;
  /** Persistent banner shown while this preset is active (e.g. the HA-posture non-compliance caveat). */
  banner?: string;
}

export const PRESET_FIELDS: PresetField[] = ["ttftTargetMs", "interactivityTarget", "utilTargetPct", "haEnabled", "uptimeHours", "purchasingModel"];
export const PRESET_FIELD_LABELS: Record<PresetField, string> = {
  ttftTargetMs: "P99 TTFT target (ms)",
  interactivityTarget: "Streaming target (tok/s/user)",
  utilTargetPct: "Utilization target (%)",
  haEnabled: "Spare replica (N+1)",
  uptimeHours: "Operating hours (h/mo)",
  purchasingModel: "Purchasing model",
};
const FIELD_FAMILY: Record<PresetField, PresetFamily> = {
  ttftTargetMs: "A",
  interactivityTarget: "A",
  utilTargetPct: "B",
  haEnabled: "B",
  uptimeHours: "B",
  purchasingModel: "B",
};

// "Business hours" as a number: 220 h/mo (10 h × 22 business days) — a proposed planning input for
// owner review (UI3-D1), not an evidence claim.
export const BUSINESS_HOURS_PER_MONTH = 220;

/** Family A — response experience (owner-confirmed set; Batch removed pending a throughput objective). */
export const RESPONSE_PRESETS: PresetBundle[] = [
  { id: "strict-conversational", family: "A", label: "Strict conversational target", description: "An aggressive customer target (~1 s to first word P99, snappy streaming) — a target to test against, not a universal recommendation.", fields: { ttftTargetMs: 1000, interactivityTarget: 50 } },
  { id: "interactive-rag", family: "A", label: "Interactive RAG", description: "Knowledge assistants (default) — ~2 s to first word (P99).", fields: { ttftTargetMs: 2000, interactivityTarget: 30 } },
  { id: "analyst", family: "A", label: "Analyst / research", description: "Long, thorough answers — ~5 s to first word (P99).", fields: { ttftTargetMs: 5000, interactivityTarget: 15 } },
];

/** Family B — operational profiles (07-presets §B) over the structured journey-state contract. */
export const OPERATIONAL_PRESETS: PresetBundle[] = [
  { id: "prototype", family: "B", label: "Prototype", description: "Aggressive 85% utilization, no spare replica, business hours, on-demand.", fields: { utilTargetPct: 85, haEnabled: false, uptimeHours: BUSINESS_HOURS_PER_MONTH, purchasingModel: "on-demand" } },
  { id: "production-balanced", family: "B", label: "Production — balanced", description: "Balanced 70% utilization, N+1 on, 24×7, on-demand.", fields: { utilTargetPct: 70, haEnabled: true, uptimeHours: 730, purchasingModel: "on-demand" } },
  { id: "latency-sensitive", family: "B", label: "Latency-sensitive production", description: "Conservative 50% utilization for headroom, N+1 on, 24×7, on-demand.", fields: { utilTargetPct: 50, haEnabled: true, uptimeHours: 730, purchasingModel: "on-demand" } },
  { id: "cost-optimized", family: "B", label: "Cost-optimized production", description: "Aggressive 85% utilization, N+1 on, 24×7, indicative Savings-Plan pricing.", fields: { utilTargetPct: 85, haEnabled: true, uptimeHours: 730, purchasingModel: "savings-1yr" } },
  { id: "business-hours", family: "B", label: "Business-hours deployment", description: "Balanced 70% utilization, N+1 on, business hours, on-demand.", fields: { utilTargetPct: 70, haEnabled: true, uptimeHours: BUSINESS_HOURS_PER_MONTH, purchasingModel: "on-demand" } },
  {
    id: "ha-posture", family: "B", label: "24×7 · high-availability posture",
    description: "Conservative 50% utilization, N+1 on, 24×7, on-demand. Sets PLANNING INPUTS only.",
    fields: { utilTargetPct: 50, haEnabled: true, uptimeHours: 730, purchasingModel: "on-demand" },
    banner: "Architecture, security, quota and compliance review are still required — this preset does not deliver them.",
  },
];

export const ALL_PRESETS: PresetBundle[] = [...RESPONSE_PRESETS, ...OPERATIONAL_PRESETS];

/** Explicit per-field origin — stored WITH state, never inferred from values (approved P1-UI2-1). */
export type FieldOrigin = "default" | "manual" | `preset:${string}`;

export interface ActivePresetInfo {
  id: string;
  label: string;
  fieldsKept: number;
  modified: boolean;
  banner?: string;
}

export interface UndoSnapshot {
  state: AdvisorState;
  origins: Record<PresetField, FieldOrigin>;
  active: Record<PresetFamily, ActivePresetInfo | null>;
  label: string;
}

export interface PresetProvenance {
  origins: Record<PresetField, FieldOrigin>;
  /** One active preset PER FAMILY (07: stackable, order-explicit; the chip updates per family). */
  active: Record<PresetFamily, ActivePresetInfo | null>;
  /** Present only while Undo is SAFE (restores the LAST apply; no manual edits since). */
  undo: UndoSnapshot | null;
}

export function initialProvenance(): PresetProvenance {
  return {
    origins: { ttftTargetMs: "default", interactivityTarget: "default", utilTargetPct: "default", haEnabled: "default", uptimeHours: "default", purchasingModel: "default" },
    active: { A: null, B: null },
    undo: null,
  };
}

/** Which preset fields differ between two states (the page calls this on every committed input change). */
export function changedPresetFields(prev: AdvisorState, next: AdvisorState): PresetField[] {
  return PRESET_FIELDS.filter((f) => prev[f] !== next[f]);
}

/** Register a MANUAL edit: origins → manual, the OWNING family's chip → "Modified from …", and Undo is
 *  INVALIDATED (approved semantics, per-family). */
export function registerManualEdit(prov: PresetProvenance, fields: PresetField[]): PresetProvenance {
  if (fields.length === 0) return prov;
  const origins = { ...prov.origins };
  const active = { ...prov.active };
  for (const f of fields) {
    origins[f] = "manual";
    const fam = FIELD_FAMILY[f];
    if (active[fam]) active[fam] = { ...active[fam]!, modified: true };
  }
  return { origins, active, undo: null };
}

export interface PreviewRow {
  field: PresetField;
  label: string;
  current: PresetValue;
  proposed: PresetValue;
  status: "change" | "no-change" | "conflict";
}

/** Human formatting for mixed-type preview values (booleans read as on/off). */
export function fmtPresetValue(v: PresetValue): string {
  return typeof v === "boolean" ? (v ? "on" : "off") : String(v);
}

/** Pure input comparison. Conflicts come ONLY from explicit manual origin (approved semantics). */
export function computePreview(current: AdvisorState, origins: Record<PresetField, FieldOrigin>, bundle: PresetBundle): PreviewRow[] {
  return (Object.keys(bundle.fields) as PresetField[]).map((field) => {
    const proposed = bundle.fields[field]!;
    const cur = current[field] as PresetValue;
    const status: PreviewRow["status"] =
      cur === proposed ? "no-change" : origins[field] === "manual" ? "conflict" : "change";
    return { field, label: PRESET_FIELD_LABELS[field], current: cur, proposed, status };
  });
}

/** Accurate action wording (approved P2-UI2-1): differences split into selected vs kept. */
export function previewCounts(rows: PreviewRow[], usePresetValue: Partial<Record<PresetField, boolean>>): { differences: number; selected: number; kept: number } {
  const diffs = rows.filter((r) => r.status !== "no-change");
  const selected = diffs.filter((r) => r.status === "change" || usePresetValue[r.field] === true).length;
  return { differences: diffs.length, selected, kept: diffs.length - selected };
}

/** Apply with per-field conflict choices (approved semantics; per-family active chip). */
export function applyPresetWithProvenance(
  current: AdvisorState,
  prov: PresetProvenance,
  bundle: PresetBundle,
  rows: PreviewRow[],
  usePresetValue: Partial<Record<PresetField, boolean>>
): { next: AdvisorState; provenance: PresetProvenance } {
  const next = { ...current } as AdvisorState;
  const origins = { ...prov.origins };
  let fieldsKept = 0;
  for (const row of rows) {
    const take = row.status === "change" || (row.status === "conflict" && usePresetValue[row.field] === true);
    if (row.status !== "no-change" && !take) {
      fieldsKept++;
      continue; // kept → origin stays manual
    }
    if (row.status !== "no-change") (next as Record<PresetField, PresetValue>)[row.field] = row.proposed;
    origins[row.field] = `preset:${bundle.id}`;
  }
  return {
    next,
    provenance: {
      origins,
      active: { ...prov.active, [bundle.family]: { id: bundle.id, label: bundle.label, fieldsKept, modified: false, banner: bundle.banner } },
      undo: { state: current, origins: prov.origins, active: prov.active, label: bundle.label },
    },
  };
}

/** Safe single Undo of the LAST apply (available only while no manual edit followed it). */
export function undoPreset(prov: PresetProvenance): { state: AdvisorState; provenance: PresetProvenance; revertedLabel: string } | null {
  if (!prov.undo) return null;
  return {
    state: prov.undo.state,
    provenance: { origins: prov.undo.origins, active: prov.undo.active, undo: null },
    revertedLabel: prov.undo.label,
  };
}
