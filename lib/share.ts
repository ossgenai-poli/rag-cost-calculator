// ============================================================================
// share — serialize/deserialize the full parameter set to a shareable URL and
// export helpers (CSV breakdown, JSON assumptions). A URL that round-trips
// every lever is the feature architecture reviews and customer calls actually
// want. Pure string helpers here; the DOM download trigger is guarded so this
// module stays importable in tests.
// ============================================================================

import type { CalcInputs, CalcResult, PriceBook } from "./types";
import { deriveDisplayMetrics } from "./derived";

const PARAM_KEY = "s";

// --- base64url (unicode-safe) ------------------------------------------------

function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = typeof btoa !== "undefined" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(param: string): string {
  const b64 = param.replace(/-/g, "+").replace(/_/g, "/");
  const binary = typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// --- inputs <-> URL ----------------------------------------------------------

export function encodeInputs(inputs: CalcInputs): string {
  return toBase64Url(JSON.stringify(inputs));
}

/** Parse an encoded param back to inputs. Returns null on any malformed data. */
export function decodeInputs(param: string | null | undefined): CalcInputs | null {
  if (!param) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(param));
    if (parsed && typeof parsed === "object" && "traffic" in parsed && "generation" in parsed) {
      return parsed as CalcInputs;
    }
    return null;
  } catch {
    return null;
  }
}

/** Read encoded inputs from the current window URL, if present. */
export function readInputsFromLocation(): CalcInputs | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return decodeInputs(params.get(PARAM_KEY));
}

/** Absolute shareable URL carrying the given inputs. */
export function buildShareUrl(inputs: CalcInputs): string {
  const base =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}`
      : "";
  return `${base}?${PARAM_KEY}=${encodeInputs(inputs)}`;
}

/** Replace the URL query (no navigation / history spam) with current inputs. */
export function syncLocation(inputs: CalcInputs): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const url = `${window.location.pathname}?${PARAM_KEY}=${encodeInputs(inputs)}`;
  window.history.replaceState(null, "", url);
}

// --- exports -----------------------------------------------------------------

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of the cost breakdown plus headline metrics for the active mode. */
export function inputsToCsv(result: CalcResult, inputs: CalcInputs): string {
  const m = deriveDisplayMetrics(result, inputs);
  const rows: (string | number)[][] = [
    ["Metric", "Value"],
    ["Estimated monthly cost (USD)", m.totalMonthly.toFixed(2)],
    ["Cost per query (USD)", m.costPerQuery.toFixed(6)],
    ["Cost per 1,000 queries (USD)", m.costPer1000.toFixed(2)],
    ["Annualized cost (USD)", m.annualized.toFixed(2)],
    ["Monthly LLM tokens", Math.round(m.monthlyLlmTokens)],
    ["Monthly input tokens", Math.round(m.monthlyInputTokens)],
    ["Monthly output tokens", Math.round(m.monthlyOutputTokens)],
    ["Queries per month", inputs.traffic.queriesPerMonth],
    [],
    ["Component", "Monthly cost (USD)", "Share (%)"],
    ...m.breakdown.map((r) => [r.label, r.monthly.toFixed(2), (r.share * 100).toFixed(2)]),
  ];
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

/** Full assumptions dump: inputs + a trimmed pricing provenance record. */
export function assumptionsToJson(
  inputs: CalcInputs,
  priceBook: PriceBook,
  asOf: string
): string {
  return JSON.stringify(
    {
      exportedFor: "AWS RAG Price Calculator",
      pricing: {
        asOf,
        region: priceBook.region,
        source: priceBook.source,
        updatedAt: priceBook.updatedAt,
        models: priceBook.models.map((mo) => ({
          id: mo.id,
          label: mo.label,
          kind: mo.kind,
          inPricePer1K: mo.inPricePer1K,
          outPricePer1K: mo.outPricePer1K,
          verifiedAt: mo.verifiedAt,
        })),
        opensearch: priceBook.opensearch,
        gpus: priceBook.gpus,
      },
      inputs,
    },
    null,
    2
  );
}

/** Browser-only: trigger a file download of a text blob. No-op server-side. */
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
