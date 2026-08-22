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
 * Display order: bidUsd DESC, firstPaidAt ASC (older wins ties), id ASC.
 * Does not read budget, deadline, winner rule, or clicks.
 */
export function rankListings(listings: readonly Listing[]): RankedListing[] {
  return listings
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

/** Live board has no paid rows until checkout lands. Never invent a #1 brief. */
export function getBoardListings(_weekId: string): Listing[] {
  return [];
}
