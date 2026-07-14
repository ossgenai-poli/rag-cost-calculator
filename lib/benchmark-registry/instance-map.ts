// Reviewed AWS instance → accelerator mapping (from the hardware registry,
// docs/ux-v2/14-hardware-registry.md). A request's awsInstance must resolve here;
// an unknown/made-up instance fails closed. This is the concrete host anchor a
// measured-exact claim is checked against.
// FROZEN (P1/P2-BENCH-009): a production policy registry must not be mutable by any caller.
export const AWS_INSTANCE_ACCELERATOR: Readonly<Record<string, string>> = Object.freeze({
  "p6-b200.48xlarge": "B200",
  "p6-b300.48xlarge": "B300",
  "p5en.48xlarge": "H200",
  "p5e.48xlarge": "H200",
  "p5.48xlarge": "H100",
  "g4dn.xlarge": "T4",
});

export function acceleratorForInstance(instance: string | undefined): string | null {
  if (!instance) return null;
  return AWS_INSTANCE_ACCELERATOR[instance] ?? null;
}
