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

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Submitted YYYY-MM-DD as a calendar date. Never invents a day. */
export function formatDeadline(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const monthName = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (!monthName || day < 1 || day > 31) return isoDate;
  return `${day} ${monthName} ${match[1]}`;
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
      data-prize-before-price={featured ? "" : undefined}
    >
      <div className="ticket-stub">
        <span className="rank">#{listing.rank}</span>
        {featured ? null : (
          <>
            <p className="bid" data-bid="">
              {formatUsd(listing.bidUsd)}
            </p>
            <span className="clicks" data-clicks="">
              {formatClicks(listing.clicks)}
            </span>
          </>
        )}
      </div>
      <div className="card-body ticket-face">
        <div className="card-top">
          <p className="ticket-kicker">Who is buying</p>
          <h3 className="buyer" data-buyer-name="">
            {listing.buyer}
          </h3>
        </div>
        <dl className="ticket-facts">
          <div className={featured ? "ticket-read-budget" : undefined}>
            <dt>What it pays</dt>
            <dd
              className={featured ? "budget read-this-budget" : "budget"}
              data-budget=""
              data-read-budget={featured ? "lead" : undefined}
            >
              {featured ? (
                <>
                  <span className="budget-amount">
                    {formatUsd(listing.budgetUsd)}
                  </span>
                  <span className="budget-not-bid">
                    Project budget, not the bid
                  </span>
                </>
              ) : (
                <>Budget {formatUsd(listing.budgetUsd)}</>
              )}
            </dd>
          </div>
          <div className={featured ? "ticket-read-deadline" : undefined}>
            <dt>When it’s due</dt>
            <dd
              className={featured ? "deadline read-this-deadline" : "deadline"}
              data-deadline=""
              data-read-deadline={featured ? "lead" : undefined}
            >
              {featured ? (
                <>
                  <time className="deadline-date" dateTime={listing.deadline}>
                    {formatDeadline(listing.deadline)}
                  </time>
                  <span className="deadline-not-score">
                    Due date, not a score
                  </span>
                </>
              ) : (
                <>Deadline {listing.deadline}</>
              )}
            </dd>
          </div>
          <div
            className={
              featured
                ? "ticket-rule ticket-read-winner prize-before-price"
                : "ticket-rule"
            }
          >
            <dt>How a winner is chosen</dt>
            <dd
              className={featured ? "winner-rule read-this-winner" : "winner-rule"}
              data-winner-rule=""
              data-read-winner={featured ? "lead" : undefined}
              data-prize={featured ? "" : undefined}
            >
              {featured ? (
                <>
                  <span className="winner-rule-text">{listing.winnerRule}</span>
                  <span className="winner-not-score">
                    Winner rule, not a score
                  </span>
                </>
              ) : (
                listing.winnerRule
              )}
            </dd>
          </div>
        </dl>
        {featured ? (
          <p className="ticket-bid-later">
            <span className="bid" data-bid="">
              {formatUsd(listing.bidUsd)}
            </span>
            <span className="clicks" data-clicks="">
              {formatClicks(listing.clicks)}
            </span>
          </p>
        ) : null}
        <p className={featured ? "ticket-open" : "meta"}>
          <a
            className={featured ? "brief-url open-this-brief" : "brief-url"}
            href={briefClickPath(listing.id)}
            data-brief-url={listing.briefUrl}
            data-open-brief={featured ? "lead" : undefined}
            data-first-click={featured ? "open" : undefined}
            data-open-after-write-first={featured ? "" : undefined}
            data-first-read={featured ? "open" : undefined}
            data-open-after-write-two={featured ? "" : undefined}
            data-open-after-write-three={featured ? "" : undefined}
            data-open-after-write-four={featured ? "" : undefined}
            data-open-after-write-five={featured ? "" : undefined}
          >
            {featured ? "Open this brief" : "Open brief"}
          </a>
        </p>
        {featured ? (
          <p className="write-after-rule-wrap">
            <a
              className="write-after-rule"
              href="#claim"
              data-write-after-rule=""
              data-write-after-open=""
              data-write-after-open-two=""
              data-write-after-open-three=""
              data-write-after-open-four=""
              data-write-after-open-five=""
              data-write-after-open-six=""
              aria-label="Write this ticket after the winner rule"
            >
              Write this ticket
            </a>{" "}
            after the winner rule. Paying less than #1 still lists.
          </p>
        ) : null}
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
          Week {week.weekId}. Next reset {week.endsAt}. Rank is the bid. Budget,
          deadline, and how a winner is chosen are public facts, not scores.
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
            <OutbidForm defaultAmount={defaultAmount} occupied />
          </>
        ) : (
          <>
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
            <OutbidForm defaultAmount={defaultAmount} />
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
