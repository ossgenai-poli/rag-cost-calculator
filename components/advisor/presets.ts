// Response-experience presets (docs/ux-v2/07-presets.md, family A — Stage C). Presets are DECLARATIVE
// INPUT BUNDLES: they seed SLA inputs only; the engine still derives fleet/confidence from them — a
// preset never hardcodes an output. The apply flow is the documented contract: preview of exactly which
// fields change (old → new, "no change" greyed), conflicts with SA-edited fields default to KEEP the
// edit, explicit Apply, single Undo. Pure functions here; the PresetBar renders them.
//
// Bundle values are planning-input defaults proposed for owner review (REVIEW.md UI2-D1) — they are
// customer inputs, not evidence claims.
import type { AdvisorState } from "./AdvisorInputs";

export interface PresetBundle {
  id: string;
  label: string;
  description: string;
  /** The AdvisorState fields this preset seeds (SLA inputs only — family A). */
  fields: Partial<Pick<AdvisorState, "ttftTargetMs" | "interactivityTarget">>;
}

export const RESPONSE_PRESETS: PresetBundle[] = [
  { id: "conversational", label: "Conversational", description: "Chat / support agents — snappy streaming, ~1 s to first word (P99).", fields: { ttftTargetMs: 1000, interactivityTarget: 50 } },
  { id: "interactive-rag", label: "Interactive RAG", description: "Knowledge assistants (default) — ~2 s to first word (P99).", fields: { ttftTargetMs: 2000, interactivityTarget: 30 } },
  { id: "analyst", label: "Analyst / research", description: "Long, thorough answers — ~5 s to first word (P99).", fields: { ttftTargetMs: 5000, interactivityTarget: 15 } },
  { id: "batch", label: "Batch", description: "Offline extraction/summarization — throughput-first, relaxed latency.", fields: { ttftTargetMs: 30000, interactivityTarget: 5 } },
];

export type PresetField = keyof PresetBundle["fields"];
export const PRESET_FIELD_LABELS: Record<PresetField, string> = {
  ttftTargetMs: "P99 TTFT target (ms)",
  interactivityTarget: "Streaming target (tok/s/user)",
};

export interface PreviewRow {
  field: PresetField;
  label: string;
  current: number;
  proposed: number;
  /** "change" | "no-change" | "conflict" (the SA edited this field away from the default). */
  status: "change" | "no-change" | "conflict";
}

/** Pure input comparison (current vs bundle vs defaults) — NOT an engine re-run. A field the SA edited
 *  (current ≠ default) that the preset would change is a CONFLICT; the default resolution is KEEP. */
export function computePreview(current: AdvisorState, defaults: AdvisorState, bundle: PresetBundle): PreviewRow[] {
  return (Object.keys(bundle.fields) as PresetField[]).map((field) => {
    const proposed = bundle.fields[field]!;
    const cur = current[field];
    const status: PreviewRow["status"] =
      cur === proposed ? "no-change" : cur !== defaults[field] ? "conflict" : "change";
    return { field, label: PRESET_FIELD_LABELS[field], current: cur, proposed, status };
  });
}

/** Apply the bundle with per-field conflict choices (true = use the preset value; conflicts default to
 *  keeping the SA's value — no silent overwrite). Returns the next state and how many fields were kept. */
export function applyPreset(
  current: AdvisorState,
  preview: PreviewRow[],
  usePresetValue: Partial<Record<PresetField, boolean>>
): { next: AdvisorState; fieldsKept: number; fieldsChanged: number } {
  const next = { ...current };
  let fieldsKept = 0;
  let fieldsChanged = 0;
  for (const row of preview) {
    if (row.status === "no-change") continue;
    const take = row.status === "conflict" ? usePresetValue[row.field] === true : true;
    if (take) {
      (next as Record<PresetField, number>)[row.field] = row.proposed;
      fieldsChanged++;
    } else {
      fieldsKept++;
    }
  }
  return { next, fieldsKept, fieldsChanged };
}
