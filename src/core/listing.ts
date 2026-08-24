import { MIN_BID_USD, type Listing } from "./rank";
import { canonicalizeBriefUrl, UrlError } from "./url";

/** Identity for raise: canonical brief URL still inside the rolling last-7-days window. `weekId` is a Polar/audit label. */

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
 * Tracking keys stripped; chat / NSFW / shorteners rejected.
 */
export function canonicalBriefUrl(raw: string): string {
  try {
    return canonicalizeBriefUrl(raw);
  } catch (error) {
    if (error instanceof UrlError) {
      throw new ListingError(error.code, error.httpStatus);
    }
    throw error;
  }
}

export function briefClickPath(id: string): string {
  return `/click/${id}`;
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
