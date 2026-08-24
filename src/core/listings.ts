import { randomUUID } from "node:crypto";
import type { PaidEvent } from "../billing/port";
import {
  ListingError,
  canonicalBriefUrl,
  quoteBid,
  sameListingIdentity,
} from "./listing";
import type { Listing } from "./rank";
import { bidInRollingWeek } from "./week";

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

/** Live board: paid rows whose last payment is still inside the rolling last 7 days. */
export function listPaidRolling(now: Date = new Date()): Listing[] {
  return listings
    .filter((row) => bidInRollingWeek(row.lastPaidAt, now))
    .map((row) => ({ ...row }));
}

export function findPaidByIdentity(
  briefUrl: string,
  now: Date = new Date(),
): Listing | undefined {
  const canonical = canonicalBriefUrl(briefUrl);
  const live = listings.find(
    (listing) =>
      listing.briefUrl === canonical &&
      bidInRollingWeek(listing.lastPaidAt, now),
  );
  return live ? { ...live } : undefined;
}

export function getListingById(id: string): Listing | undefined {
  const row = listings.find((listing) => listing.id === id);
  return row ? { ...row } : undefined;
}

/** Public brief-URL hops. Never a rating. */
export function incrementListingClicks(id: string): Listing | undefined {
  const row = listings.find((listing) => listing.id === id);
  if (!row) return undefined;
  row.clicks += 1;
  return { ...row };
}

export function applyPaidEvent(event: PaidEvent): Listing | null {
  if (appliedSessions.has(event.sessionId)) {
    return (
      listings.find((row) => matchingLive(row, event)) ??
      listings.find((row) => matchingDraft(row, event)) ??
      null
    );
  }

  const draft = event.listingDraft;
  const existing = listings.find((row) => matchingLive(row, event));
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

function matchingLive(row: StoredListing, event: PaidEvent): boolean {
  return (
    canonicalBriefUrl(row.briefUrl) ===
      canonicalBriefUrl(event.listingDraft.briefUrl) &&
    bidInRollingWeek(row.lastPaidAt, new Date(event.paidAt))
  );
}
