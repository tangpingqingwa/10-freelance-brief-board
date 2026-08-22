import { randomUUID } from "node:crypto";
import type { PaidEvent } from "../billing/port";
import {
  ListingError,
  canonicalBriefUrl,
  listingIdentity,
  quoteBid,
  sameListingIdentity,
} from "./listing";
import type { Listing } from "./rank";

type StoredListing = Listing;

const listings: StoredListing[] = [];
const appliedSessions = new Set<string>();

export function resetListings(): void {
  listings.length = 0;
  appliedSessions.clear();
}

export function listPaid(weekId: string): Listing[] {
  return listings
    .filter((row) => row.weekId === weekId)
    .map((row) => ({ ...row }));
}

export function findPaidByIdentity(
  weekId: string,
  briefUrl: string,
): Listing | undefined {
  const key = listingIdentity({ weekId, briefUrl });
  const row = listings.find((listing) => sameListingIdentity(listing, key));
  return row ? { ...row } : undefined;
}

export function applyPaidEvent(event: PaidEvent): Listing | null {
  if (appliedSessions.has(event.sessionId)) {
    return listings.find((row) => matchingDraft(row, event)) ?? null;
  }

  const draft = event.listingDraft;
  const existing = listings.find((row) => matchingDraft(row, event));
  const quote = quoteBid(existing, draft.bidUsd);
  if (event.amountUsd !== quote.chargeUsd) {
    throw new ListingError(
      quote.kind === "raise" ? "bid_not_higher" : "bid_below_min",
      400,
    );
  }
  if (existing) {
    existing.buyer = draft.buyer;
    existing.budgetUsd = draft.budgetUsd;
    existing.deadline = draft.deadline;
    existing.winnerRule = draft.winnerRule;
    existing.bidUsd = quote.targetBidUsd;
    existing.lastPaidAt = event.paidAt;
    appliedSessions.add(event.sessionId);
    return { ...existing };
  }
  const listing: StoredListing = {
    id: `lst_${randomUUID()}`,
    weekId: draft.weekId,
    buyer: draft.buyer,
    budgetUsd: draft.budgetUsd,
    deadline: draft.deadline,
    winnerRule: draft.winnerRule,
    briefUrl: canonicalBriefUrl(draft.briefUrl),
    bidUsd: quote.targetBidUsd,
    firstPaidAt: event.paidAt,
    lastPaidAt: event.paidAt,
    clicks: 0,
  };
  listings.push(listing);
  appliedSessions.add(event.sessionId);
  return { ...listing };
}

function matchingDraft(row: StoredListing, event: PaidEvent): boolean {
  return sameListingIdentity(row, event.listingDraft);
}
