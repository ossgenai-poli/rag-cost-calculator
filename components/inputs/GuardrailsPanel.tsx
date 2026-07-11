"use client";

import type { GuardrailInputs } from "@/lib/types";
import { FieldRow, NumberField, Section, Toggle } from "./controls";

export function GuardrailsPanel(props: {
  guardrails: GuardrailInputs;
  onChange: (next: GuardrailInputs) => void;
}) {
  const { guardrails, onChange } = props;

  return (
    <Section title="Guardrails">
      <FieldRow>
        <Toggle
          label="Input guardrail"
          checked={guardrails.inputEnabled}
          onChange={(v) => onChange({ ...guardrails, inputEnabled: v })}
        />
        <Toggle
          label="Output guardrail"
          checked={guardrails.outputEnabled}
          onChange={(v) => onChange({ ...guardrails, outputEnabled: v })}
        />
      </FieldRow>
      <FieldRow>
        <NumberField
          label="Unit price"
          suffix="$/1K units"
          value={guardrails.unitPricePer1K}
          min={0}
          step={0.00001}
          onChange={(v) => onChange({ ...guardrails, unitPricePer1K: v })}
        />
        <NumberField
          label="Units per query"
          hint="Approx. guardrail units charged per query text"
          value={guardrails.unitsPerQuery}
          min={0}
          step={1}
          onChange={(v) => onChange({ ...guardrails, unitsPerQuery: v })}
        />
      </FieldRow>
    </Section>
  );
}
