import React from "react";
import { briefClickPath } from "../core/listing";
import type { RankedListing } from "../core/rank";
import { MIN_BID_USD } from "../core/rank";
import type { UtcWeek } from "../core/week";
import { OutbidForm } from "./outbid-form";

type BoardProps = {
  week: UtcWeek;
  listings: readonly RankedListing[];
};

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

export function formatClicks(clicks: number): string {
  return `${clicks} ${clicks === 1 ? "click" : "clicks"}`;
}

export function ListingCard({ listing }: { listing: RankedListing }) {
  return (
    <article
      className="card"
      data-listing-card=""
      data-rank={listing.rank}
      data-listing-id={listing.id}
      data-buyer={listing.buyer}
      data-bid={listing.bidUsd}
    >
      <span className="rank">#{listing.rank}</span>
      <div className="card-body">
        <div className="card-top">
          <h3 className="buyer" data-buyer-name="">
            {listing.buyer}
          </h3>
          <p className="bid" data-bid="">
            {formatUsd(listing.bidUsd)}
          </p>
        </div>
        <p className="budget" data-budget="">
          Budget {formatUsd(listing.budgetUsd)}
        </p>
        <p className="deadline" data-deadline="">
          Deadline {listing.deadline}
        </p>
        <p className="winner-rule" data-winner-rule="">
          {listing.winnerRule}
        </p>
        <p className="meta">
          <span className="clicks" data-clicks="">
            {formatClicks(listing.clicks)}
          </span>
          <a
            className="brief-url"
            href={briefClickPath(listing.id)}
            data-brief-url={listing.briefUrl}
          >
            Open brief
          </a>
        </p>
      </div>
    </article>
  );
}

export function Leaderboard({
  listings,
}: {
  listings: readonly RankedListing[];
}) {
  if (listings.length === 0) {
    return (
      <p className="empty-week" data-empty-week="true">
        This week’s board is empty. No buyer has paid to list a brief yet. There
        is no invented #1 brief and no invented ratings.
      </p>
    );
  }

  return (
    <ol className="leaderboard" data-leaderboard="">
      {listings.map((listing) => (
        <li key={listing.id}>
          <ListingCard listing={listing} />
        </li>
      ))}
    </ol>
  );
}

export function Board({ week, listings }: BoardProps) {
  const topBid = listings[0]?.bidUsd ?? 0;
  const defaultAmount = topBid > 0 ? topBid + 1 : MIN_BID_USD;

  return (
    <main className="board" data-board="" data-week={week.weekId}>
      <p className="kicker">This week’s #1 freelance brief</p>
      <p className="period-meta" data-week-id={week.weekId}>
        Week {week.weekId}. Next reset {week.endsAt}. Rank is the bid. Budget
        and deadline are public facts, not scores.
      </p>
      <OutbidForm defaultAmount={defaultAmount} />
      <Leaderboard listings={listings} />
    </main>
  );
}
