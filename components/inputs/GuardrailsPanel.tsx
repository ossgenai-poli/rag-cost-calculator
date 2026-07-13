"use client";

import type { GuardrailInputs } from "@/lib/types";
import { FieldRow, NumberField, Section, Toggle } from "./controls";

export function GuardrailsPanel(props: {
  guardrails: GuardrailInputs;
  onChange: (next: GuardrailInputs) => void;
  advanced?: boolean;
}) {
  const { guardrails, onChange, advanced = true } = props;

  return (
    <Section
      title="Guardrails"
      hint="Billed per text unit (a block of characters), scanned separately on the input prompt and the model response."
    >
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
      {advanced && (
        <>
          <FieldRow>
            <NumberField
              label="Input policy price"
              suffix="$/1K units"
              hint="Applied to the whole prompt (retrieved context + query)."
              value={guardrails.inputPricePer1KUnits}
              min={0}
              step={0.05}
              onChange={(v) => onChange({ ...guardrails, inputPricePer1KUnits: v })}
            />
            <NumberField
              label="Output policy price"
              suffix="$/1K units"
              hint="Applied to the generated response."
              value={guardrails.outputPricePer1KUnits}
              min={0}
              step={0.05}
              onChange={(v) => onChange({ ...guardrails, outputPricePer1KUnits: v })}
            />
          </FieldRow>
          <FieldRow>
            <NumberField
              label="Chars per text unit"
              hint="Bedrock unit size: 400 (content filters / denied topics / PII), 600 (contextual grounding)."
              value={guardrails.charsPerTextUnit}
              min={1}
              step={100}
              onChange={(v) => onChange({ ...guardrails, charsPerTextUnit: v })}
            />
            <NumberField
              label="Chars per token"
              hint="Token→character conversion for estimating text units (~4 for English)."
              value={guardrails.charsPerToken}
              min={0.1}
              step={0.5}
              onChange={(v) => onChange({ ...guardrails, charsPerToken: v })}
            />
          </FieldRow>
        </>
      )}
    </Section>
  );
}
