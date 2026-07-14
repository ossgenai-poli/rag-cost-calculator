// Accelerator equivalence — DENY BY DEFAULT (P1-2). A GPU-SKU mismatch is NOT a
// generic proxy. Only an explicit, reviewed allowlist entry — asserting compatible
// architecture, memory, form factor and interconnect — permits a proxy; everything
// else is `unbenchmarked`. Equivalence is never inferred from GPU-family naming.

export interface EquivalenceEntry {
  from: string; // measured accelerator SKU
  to: string; // requested accelerator SKU
  compatible: { architecture: boolean; memory: boolean; formFactor: boolean; interconnect: boolean };
  materialDifferences: string; // surfaced on every use
  reviewedBy: string;
}

// Reviewed allowlist. Intentionally EMPTY for the vertical slice — no cross-accelerator
// substitution is approved yet, so every SKU mismatch fails closed to `unbenchmarked`.
// (A future entry must set every `compatible` flag true and record the differences.)
export const ACCELERATOR_ALLOWLIST: EquivalenceEntry[] = [];

/** Returns the reviewed equivalence entry, or null (→ deny → unbenchmarked). */
export function acceleratorEquivalence(from: string, to: string): EquivalenceEntry | null {
  if (from === to) return null; // not a substitution; handled by host-proxy logic
  const e = ACCELERATOR_ALLOWLIST.find((x) => x.from === from && x.to === to);
  if (!e) return null;
  const c = e.compatible;
  if (!c.architecture || !c.memory || !c.formFactor || !c.interconnect) return null; // incomplete → deny
  return e;
}
