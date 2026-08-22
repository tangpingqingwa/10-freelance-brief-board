import { MIN_BID_USD, type Listing } from "./rank";

/** Identity for raise: canonical brief URL + UTC weekId. */

export class ListingError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(code);
    this.name = "ListingError";
  }
}

export type BidQuote = {
  kind: "create" | "raise";
  targetBidUsd: number;
  chargeUsd: number;
};

export type ListingIdentity = {
  weekId: string;
  briefUrl: string;
};

/**
 * Stable identity form of a brief URL.
 * Hostname is lowercased; default port and fragment are dropped.
 * Tracking-query strip lands with URL hygiene.
 */
export function canonicalBriefUrl(raw: string): string {
  const value = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ListingError("url_insecure", 400);
  }
  if (parsed.protocol !== "https:") {
    throw new ListingError("url_insecure", 400);
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.port === "443") parsed.port = "";
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}

export function listingIdentity(input: ListingIdentity): ListingIdentity {
  return {
    weekId: input.weekId,
    briefUrl: canonicalBriefUrl(input.briefUrl),
  };
}

export function sameListingIdentity(
  left: ListingIdentity,
  right: ListingIdentity,
): boolean {
  const a = listingIdentity(left);
  const b = listingIdentity(right);
  return a.weekId === b.weekId && a.briefUrl === b.briefUrl;
}

/**
 * First bid charges the full amount (≥ $5). Same identity raises by
 * target − current only. Raise must be a whole dollar ≥ current + $1.
 */
export function quoteBid(
  existing: Pick<Listing, "bidUsd"> | undefined,
  targetBidUsd: number,
): BidQuote {
  if (!Number.isInteger(targetBidUsd) || targetBidUsd < 0) {
    throw new ListingError("bid_not_whole", 400);
  }
  if (!existing) {
    if (targetBidUsd < MIN_BID_USD) {
      throw new ListingError("bid_below_min", 400);
    }
    return { kind: "create", targetBidUsd, chargeUsd: targetBidUsd };
  }
  if (targetBidUsd <= existing.bidUsd) {
    throw new ListingError("bid_not_higher", 400);
  }
  return {
    kind: "raise",
    targetBidUsd,
    chargeUsd: targetBidUsd - existing.bidUsd,
  };
}
