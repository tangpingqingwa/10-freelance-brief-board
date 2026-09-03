export const MIN_BID_USD = 5;

/**
 * Parse the canonical whole-dollar input grammar shared by the browser and
 * checkout boundary. String inputs are decimal digits only; JSON callers may
 * also send a non-negative safe integer.
 */
export function parseWholeUsd(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw) || raw < 0) return undefined;
    return raw;
  }
  if (typeof raw !== "string") return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}
