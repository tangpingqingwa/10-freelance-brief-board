import { randomUUID } from "node:crypto";
import type { PaidEvent } from "../billing/port";
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

export function applyPaidEvent(event: PaidEvent): Listing | null {
  if (appliedSessions.has(event.sessionId)) {
    return listings.find((row) => matchingDraft(row, event)) ?? null;
  }

  const draft = event.listingDraft;
  const existing = listings.find((row) => matchingDraft(row, event));
  if (existing) {
    // Raise path lands in PR 4. Same brief this week is not a new listing.
    return { ...existing };
  }

  const listing: StoredListing = {
    id: `lst_${randomUUID()}`,
    weekId: draft.weekId,
    buyer: draft.buyer,
    budgetUsd: draft.budgetUsd,
    deadline: draft.deadline,
    winnerRule: draft.winnerRule,
    briefUrl: draft.briefUrl,
    bidUsd: draft.bidUsd,
    firstPaidAt: event.paidAt,
    lastPaidAt: event.paidAt,
    clicks: 0,
  };
  listings.push(listing);
  appliedSessions.add(event.sessionId);
  return { ...listing };
}

function matchingDraft(row: StoredListing, event: PaidEvent): boolean {
  return row.weekId === event.listingDraft.weekId && row.briefUrl === event.listingDraft.briefUrl;
}
