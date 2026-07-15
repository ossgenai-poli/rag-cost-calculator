// Trusted PriceBook integration boundary (P1-6). The recommendation layer consumes the SAME price book
// the calculator does. Default = the pinned committed reference book (public/prices.json). Production
// wires the live/fallback book here; tests module-mock this seam. The price book is a trusted price
// source (like the calculator's), NOT caller-supplied evidence — distinct from the candidate catalog.
import type { PriceBook } from "../types";
import pricesJson from "../../public/prices.json";

export function loadPriceBook(): PriceBook {
  return pricesJson as unknown as PriceBook;
}
