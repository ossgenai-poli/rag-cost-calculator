"use client";

import type { OpsInputs } from "@/lib/types";
import { NumberField, Section } from "./controls";

/**
 * Production operations & overhead the core model doesn't capture: fixed
 * networking + observability line items, plus a percentage markup on every other
 * cost (on-call, redundancy, misc). All default to 0 — opt-in.
 */
export function OpsPanel(props: {
  ops: OpsInputs;
  onChange: (next: OpsInputs) => void;
}) {
  const { ops, onChange } = props;
  return (
    <Section
      title="Operations & overhead"
      hint="Production costs beyond the core pipeline. All default to 0 — add what your deployment carries."
    >
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Networking"
          suffix="$/mo"
          hint="Data transfer, NAT gateways, load balancers."
          value={ops.networkingMonthly$}
          min={0}
          step={10}
          onChange={(v) => onChange({ ...ops, networkingMonthly$: v })}
        />
        <NumberField
          label="Logging & monitoring"
          suffix="$/mo"
          hint="CloudWatch logs/metrics, dashboards, tracing."
          value={ops.observabilityMonthly$}
          min={0}
          step={10}
          onChange={(v) => onChange({ ...ops, observabilityMonthly$: v })}
        />
      </div>
      <NumberField
        label="Production overhead"
        suffix="% of all other costs"
        hint="Markup for on-call, redundancy, dev/staging, and misc production reality — applied to every other line."
        value={ops.overheadPct}
        min={0}
        step={5}
        onChange={(v) => onChange({ ...ops, overheadPct: v })}
      />
    </Section>
  );
}
