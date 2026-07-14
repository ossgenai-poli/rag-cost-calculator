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
  if (from === to) return null; // not a substitution; handled by host-equivalence logic
  const e = ACCELERATOR_ALLOWLIST.find((x) => x.from === from && x.to === to);
  if (!e) return null;
  const c = e.compatible;
  if (!c.architecture || !c.memory || !c.formFactor || !c.interconnect) return null; // incomplete → deny
  return e;
}

// Host equivalence — a SAME-accelerator, non-AWS-representative measurement (HGX/DGX)
// is only usable as a proxy for a specific AWS instance when EXPLICITLY reviewed.
// Deny by default: same GPU does not guarantee equal power/clocks/memory config/
// interconnect/serving topology. (One reviewed example entry included to exercise the
// mechanism; everything else fails closed to `unbenchmarked`.)
export interface HostEquivalenceEntry {
  recordHost: string; // the measurement's host system id
  awsInstance: string; // the AWS instance it may proxy for
  compatible: { power: boolean; memoryConfig: boolean; interconnect: boolean; servingTopology: boolean };
  materialDifferences: string;
  reviewedBy: string;
}

// PRODUCTION allowlist is EMPTY and FROZEN — no host equivalence has a real, traceable
// review yet, and the slice must not invent reviewed compatibility. Deny-by-default must not
// depend on callers refraining from mutating a global, so this is read-only; tests inject a
// fixture via the `allowlist` parameter of hostEquivalence()/evaluate(), never by mutation.
export const HOST_ALLOWLIST: readonly HostEquivalenceEntry[] = Object.freeze([]);

/** Reviewed host proxy for (recordHost → awsInstance), or null (→ deny → unbenchmarked).
 *  `allowlist` defaults to the frozen production allowlist; tests pass their own. */
export function hostEquivalence(recordHost: string, awsInstance: string | undefined, allowlist: readonly HostEquivalenceEntry[] = HOST_ALLOWLIST): HostEquivalenceEntry | null {
  if (!awsInstance) return null;
  const e = allowlist.find((x) => x.recordHost === recordHost && x.awsInstance === awsInstance);
  if (!e) return null;
  const c = e.compatible;
  if (!c.power || !c.memoryConfig || !c.interconnect || !c.servingTopology) return null;
  return e;
}
