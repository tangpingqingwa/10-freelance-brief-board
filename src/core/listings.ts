import { randomUUID } from "node:crypto";
import type { ListingDraft, PaidEvent } from "../billing/port";
import {
  ListingError,
  canonicalBriefUrl,
  quoteBid,
  sameListingIdentity,
} from "./listing";
import { isPolarPaidListing, type Listing } from "./rank";
import { bidInRollingWeek } from "./week";

type StoredListing = Listing;

/** Open Polar checkout. Never a ranked ticket until Polar reports paid. */
export type UnpaidTicket = {
  sessionId: string;
  weekId: string;
  buyer: string;
  winnerRule: string;
  briefUrl: string;
  bidUsd: number;
};

const listings: StoredListing[] = [];
const unpaidTickets: UnpaidTicket[] = [];
const appliedSessions = new Set<string>();

export function resetListings(): void {
  listings.length = 0;
  unpaidTickets.length = 0;
  appliedSessions.clear();
}

export function listPaid(weekId: string): Listing[] {
  return listings
    .filter((row) => row.weekId === weekId && isPolarPaidListing(row))
    .map((row) => ({ ...row }));
}

/** Live board: Polar-paid rows whose last payment is still inside the rolling last 7 days. */
export function listPaidRolling(now: Date = new Date()): Listing[] {
  return listings
    .filter(
      (row) =>
        isPolarPaidListing(row) && bidInRollingWeek(row.lastPaidAt, now),
    )
    .map((row) => ({ ...row }));
}

/** Abandoned / open Polar checkout. Stays off the ticket desk. */
export function listUnpaid(weekId?: string): UnpaidTicket[] {
  return unpaidTickets
    .filter((row) => (weekId === undefined ? true : row.weekId === weekId))
    .map((row) => ({ ...row }));
}

export function rememberUnpaidCheckout(input: {
  sessionId: string;
  listingDraft: ListingDraft;
}): void {
  if (appliedSessions.has(input.sessionId)) return;
  const existing = unpaidTickets.findIndex(
    (row) => row.sessionId === input.sessionId,
  );
  const ticket: UnpaidTicket = {
    sessionId: input.sessionId,
    weekId: input.listingDraft.weekId,
    buyer: input.listingDraft.buyer,
    winnerRule: input.listingDraft.winnerRule,
    briefUrl: canonicalBriefUrl(input.listingDraft.briefUrl),
    bidUsd: input.listingDraft.bidUsd,
  };
  if (existing >= 0) {
    unpaidTickets[existing] = ticket;
    return;
  }
  unpaidTickets.push(ticket);
}

export function forgetUnpaidCheckout(sessionId: string): void {
  const index = unpaidTickets.findIndex((row) => row.sessionId === sessionId);
  if (index >= 0) unpaidTickets.splice(index, 1);
}

/** Raise identity: same canonical brief URL still inside last 7 days. Not weekId. */
export function findPaidByIdentity(
  briefUrl: string,
  now: Date = new Date(),
): Listing | undefined {
  const canonical = canonicalBriefUrl(briefUrl);
  const live = listings.find(
    (listing) =>
      isPolarPaidListing(listing) &&
      listing.briefUrl === canonical &&
      bidInRollingWeek(listing.lastPaidAt, now),
  );
  return live ? { ...live } : undefined;
}

export function getListingById(id: string): Listing | undefined {
  const row = listings.find(
    (listing) => listing.id === id && isPolarPaidListing(listing),
  );
  return row ? { ...row } : undefined;
}

/** Public brief-URL hops. Never a rating. */
export function incrementListingClicks(id: string): Listing | undefined {
  const row = listings.find(
    (listing) => listing.id === id && isPolarPaidListing(listing),
  );
  if (!row) return undefined;
  row.clicks += 1;
  return { ...row };
}

export function applyPaidEvent(event: PaidEvent): Listing | null {
  forgetUnpaidCheckout(event.sessionId);
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
    isPolarPaidListing(row) &&
    canonicalBriefUrl(row.briefUrl) ===
      canonicalBriefUrl(event.listingDraft.briefUrl) &&
    bidInRollingWeek(row.lastPaidAt, new Date(event.paidAt))
  );
}
