import { listPaidRolling } from "./listings";
import { bidInRollingWeek } from "./week";

/** Rank is the bid. Budget and deadline are public facts; they do not sort. */

export const MIN_BID_USD = 5;

export type Listing = {
  id: string;
  weekId: string;
  buyer: string;
  budgetUsd: number;
  deadline: string;
  winnerRule: string;
  briefUrl: string;
  bidUsd: number;
  firstPaidAt: string;
  lastPaidAt: string;
  clicks: number;
};

export type RankedListing = Listing & {
  rank: number;
};

/**
 * Polar has reported a completed payment. Unpaid / abandoned checkout
 * is not a listing and must not paint #1 winner-rule chrome.
 */
export function isPolarPaidListing(
  listing: Pick<Listing, "firstPaidAt">,
): boolean {
  const paidAt = listing.firstPaidAt;
  if (typeof paidAt !== "string" || paidAt.trim() === "") return false;
  const ms = Date.parse(paidAt);
  return Number.isFinite(ms);
}

/**
 * Display order among Polar-paid rows only: bidUsd DESC, firstPaidAt ASC
 * (older wins ties), id ASC. When `now` is passed, only lastPaidAt inside
 * the rolling last-7-days window ranks. Does not read budget, deadline,
 * winner rule, or clicks. Unpaid drafts never rank.
 */
export function rankListings(
  listings: readonly Listing[],
  now?: Date,
): RankedListing[] {
  const live = listings.filter((row) => {
    if (!isPolarPaidListing(row)) return false;
    return now ? bidInRollingWeek(row.lastPaidAt, now) : true;
  });
  return live
    .slice()
    .sort((a, b) => {
      if (a.bidUsd !== b.bidUsd) return b.bidUsd - a.bidUsd;
      if (a.firstPaidAt !== b.firstPaidAt) {
        return a.firstPaidAt < b.firstPaidAt ? -1 : 1;
      }
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return 0;
    })
    .map((listing, index) => ({ ...listing, rank: index + 1 }));
}

/** Live board has no paid rows until Polar reports paid. Never invent a #1 brief. */
export function getBoardListings(now: Date = new Date()): Listing[] {
  return listPaidRolling(now).filter(isPolarPaidListing);
}
