/**
 * Shareable planet links. `?seed=` chooses a world; campaign cargo stays in
 * IndexedDB. Parsing is pure so boot and tests share one implementation.
 */

import { hexToSeed, seedToHex } from "./planet-save.ts";

/** Read `seed` from a query string (`?seed=DEADBEEF` or `seed=DEADBEEF`). */
export function parseSeedParam(search: string): number | null {
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (query === "") return null;
  const raw = new URLSearchParams(query).get("seed");
  if (raw === null) return null;
  return hexToSeed(raw);
}

/**
 * Set or replace `seed` on a query string. Other params are preserved.
 * Always returns a leading `?`.
 */
export function applySeedParam(search: string, seed: number): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  params.set("seed", seedToHex(seed));
  return `?${params.toString()}`;
}
