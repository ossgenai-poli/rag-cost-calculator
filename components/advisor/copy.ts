// Shared UI copy/presentation contract (owner decision D3): ONE module owns the customer-facing
// labels, field metadata and friendly validation wording the advisor components render. Raw field
// paths remain visible in structured/audit surfaces; this file is presentation copy only — it never
// contains numbers, evidence claims or recommendations.

/** Customer labels for structured inputAdjustments field paths (raw path stays shown alongside). */
export const ADJUSTMENT_FIELD_LABELS: Record<string, string> = {
  "retrieval.topN": "Context chunks sent to the model",
  gpuUptimeHoursPerMonth: "GPU fleet uptime hours/month",
  "queries/month": "Queries per month",
  documents: "Documents",
  "tokens/doc": "Tokens per document",
  "output tokens": "Output tokens",
  "prompt overhead": "Prompt overhead",
  "max context": "Max context",
  "max concurrency": "Max concurrency",
  "overhead %": "Overhead %",
  "query tokens": "Query tokens",
};

/** Decision-support metadata for expert inputs (P2-UI-3): units, recommended default, why it matters. */
export interface FieldHelp {
  unit: string;
  recommended: string;
  why: string;
}
export const EXPERT_FIELD_HELP: Record<string, FieldHelp> = {
  ttftTargetMs: { unit: "ms", recommended: "default 2,000", why: "P99 budget for the first token; a config that can't meet it is rejected on SLA." },
  interactivityTarget: { unit: "tok/s/user", recommended: "default 30", why: "Streaming speed each user sees; higher targets need more GPUs." },
  queryTokens: { unit: "tokens", recommended: "default 50", why: "Adds to every request's input length (prefill work)." },
  promptOverhead: { unit: "tokens", recommended: "default 300", why: "System/prompt template sent with every request." },
  chunkSize: { unit: "tokens", recommended: "default 512", why: "Multiplied by Top N to form the retrieved context." },
  topN: { unit: "chunks", recommended: "default 5 (≤ Top K)", why: "Context chunks the model reads; values above Top K are reconciled down." },
  topK: { unit: "chunks", recommended: "default 20", why: "Chunks retrieved from the vector store before reranking." },
  outTokens: { unit: "tokens", recommended: "default 500", why: "Answer length; drives decode throughput demand." },
  uptimeHours: { unit: "h/mo", recommended: "default 730 (always-on)", why: "Billing hours for the self-host fleet; capped at 730 and disclosed." },
  utilTargetPct: { unit: "%", recommended: "default 70 (balanced)", why: "Peak-load headroom the fleet is sized against; lower % = more GPUs, more headroom." },
};

/** Friendly, field-level validation wording (P2-UI-1). Keyed by the boundary validator's property
 *  path; maps to the input id and customer wording — internal paths never reach the banner. */
export interface FieldError {
  inputId: string;
  label: string;
  message: string;
}
export const FIELD_ERROR_COPY: Array<{ pathToken: string; error: FieldError }> = [
  { pathToken: "traffic.queriesPerMonth", error: { inputId: "adv-volume", label: "Questions per month", message: "Enter a number greater than 0." } },
  { pathToken: "generation.ttftTargetMs", error: { inputId: "adv-ttft", label: "P99 TTFT target", message: "Enter a target greater than 0 ms." } },
  { pathToken: "generation.interactivityTarget", error: { inputId: "adv-intvty", label: "Streaming target", message: "Enter a target greater than 0 tokens/s per user." } },
  { pathToken: "queryTokens", error: { inputId: "adv-query", label: "User query tokens", message: "Enter 0 or more tokens." } },
  { pathToken: "generation.promptOverhead", error: { inputId: "adv-prompt", label: "Prompt overhead", message: "Enter 0 or more tokens." } },
  { pathToken: "chunking.chunkSize", error: { inputId: "adv-chunk", label: "Chunk size", message: "Enter a chunk size greater than 0." } },
  { pathToken: "retrieval.topN", error: { inputId: "adv-topn", label: "Context chunks sent (Top N)", message: "Enter 0 or more chunks." } },
  { pathToken: "retrieval.topK", error: { inputId: "adv-topk", label: "Chunks retrieved (Top K)", message: "Enter at least 1 chunk." } },
  { pathToken: "generation.outTokens", error: { inputId: "adv-out", label: "Output tokens", message: "Enter 0 or more tokens." } },
  { pathToken: "gpuUptimeHoursPerMonth", error: { inputId: "adv-uptime", label: "GPU fleet uptime", message: "Enter 0 or more hours (0 uses the always-on default)." } },
  { pathToken: "generation.utilTarget", error: { inputId: "adv-util", label: "Utilization target", message: "Enter a percentage between 1 and 100." } },
  { pathToken: "generation.gpuPricingModel", error: { inputId: "adv-purchasing", label: "Purchasing model", message: "Choose one of the listed purchasing models." } },
];

/** Map a boundary-validator error message to friendly field errors (unknown → a generic message). */
export function friendlyFieldErrors(message: string): { fields: FieldError[]; generic: string } {
  const fields = FIELD_ERROR_COPY.filter((f) => message.includes(f.pathToken)).map((f) => f.error);
  return {
    fields,
    generic: fields.length
      ? `Please correct: ${fields.map((f) => f.label).join(", ")}.`
      : "Some inputs are out of range. Please review the highlighted values.",
  };
}
