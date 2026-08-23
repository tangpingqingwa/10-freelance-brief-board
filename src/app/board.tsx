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

export function ListingCard({
  listing,
  featured = false,
}: {
  listing: RankedListing;
  featured?: boolean;
}) {
  const ticketClass = featured ? "card ticket ticket-featured" : "card ticket";
  return (
    <article
      className={ticketClass}
      data-listing-card=""
      data-rank={listing.rank}
      data-listing-id={listing.id}
      data-buyer={listing.buyer}
      data-bid={listing.bidUsd}
    >
      <div className="ticket-stub">
        <span className="rank">#{listing.rank}</span>
        <p className="bid" data-bid="">
          {formatUsd(listing.bidUsd)}
        </p>
        <span className="clicks" data-clicks="">
          {formatClicks(listing.clicks)}
        </span>
      </div>
      <div className="card-body ticket-face">
        <div className="card-top">
          <p className="ticket-kicker">Who is buying</p>
          <h3 className="buyer" data-buyer-name="">
            {listing.buyer}
          </h3>
        </div>
        <dl className="ticket-facts">
          <div>
            <dt>What it pays</dt>
            <dd className="budget" data-budget="">
              Budget {formatUsd(listing.budgetUsd)}
            </dd>
          </div>
          <div>
            <dt>When it’s due</dt>
            <dd className="deadline" data-deadline="">
              Deadline {listing.deadline}
            </dd>
          </div>
          <div className="ticket-rule">
            <dt>How a winner is chosen</dt>
            <dd className="winner-rule" data-winner-rule="">
              {listing.winnerRule}
            </dd>
          </div>
        </dl>
        <p className="meta">
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
    return null;
  }

  return (
    <ol className="leaderboard" data-leaderboard="">
      {listings.map((listing) => (
        <li key={listing.id}>
          <ListingCard listing={listing} featured={listing.rank === 1} />
        </li>
      ))}
    </ol>
  );
}

export function Board({ week, listings }: BoardProps) {
  const featured = listings[0];
  const rest = listings.slice(1);
  const topBid = featured?.bidUsd ?? 0;
  const defaultAmount = topBid > 0 ? topBid + 1 : MIN_BID_USD;

  const empty = featured === undefined;

  return (
    <main
      className="board desk"
      data-board=""
      data-brief-desk=""
      data-week={week.weekId}
    >
      <header className="desk-mast">
        <p className="kicker">This week’s #1 freelance brief</p>
        <h1>Brief desk</h1>
        <p className="period-meta" data-week-id={week.weekId}>
          Week {week.weekId}. Next reset {week.endsAt}. Rank is the bid. Budget
          and deadline are public facts, not scores.
        </p>
      </header>

      <div
        className={empty ? "desk-surface desk-surface-empty" : "desk-surface"}
        data-desk-surface={empty ? "empty" : "occupied"}
      >
        {featured ? (
          <>
            <section className="spike" aria-labelledby="spike-heading">
              <h2 id="spike-heading">This week’s #1</h2>
              <ListingCard listing={featured} featured />
            </section>
            <OutbidForm defaultAmount={defaultAmount} />
          </>
        ) : (
          <>
            <OutbidForm defaultAmount={defaultAmount} />
            <section className="spike spike-quiet" aria-labelledby="spike-heading">
              <h2 id="spike-heading">This week’s #1</h2>
              <div className="empty-week" data-empty-week="true">
                <div className="empty-ticket">
                  <p className="empty-stamp">No paid brief</p>
                  <p>
                    This week’s board is empty. No buyer has paid to pin a
                    ticket. There is no invented #1 brief and no invented
                    ratings. There is no sample gig.
                  </p>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {rest.length > 0 ? (
        <section className="hopper" aria-labelledby="hopper-heading">
          <h2 id="hopper-heading">Tickets on the desk</h2>
          <p className="hopper-note">
            Paying less than #1 still lists. Rank is the bid, not the project
            budget.
          </p>
          <Leaderboard listings={rest} />
        </section>
      ) : null}
    </main>
  );
}
