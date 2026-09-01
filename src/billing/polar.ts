/**
 * Compatibility tombstone. Polar was superseded by the authorized Waffo
 * Pancake provider and is intentionally not selectable or imported by routes.
 */
export function polarProviderRemoved(): never {
  throw new Error("Polar provider removed; configure WAFFO_MODE explicitly");
}
