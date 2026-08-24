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

function LaterRankTicket({ listing }: { listing: RankedListing }) {
  return (
    <article
      className="card ticket ticket-later"
      data-listing-card=""
      data-rank={listing.rank}
      data-listing-id={listing.id}
      data-buyer={listing.buyer}
      data-bid={listing.bidUsd}
      data-later-rank=""
    >
      <p className="later-rankline">
        <span className="rank">#{listing.rank}</span>
        <span className="bid" data-bid="">
          {formatUsd(listing.bidUsd)}
        </span>
        <span className="clicks" data-clicks="">
          {formatClicks(listing.clicks)}
        </span>
      </p>
      <div className="later-slip">
        <p className="later-buyer" data-buyer-name="">
          <span className="later-kicker">Who is buying</span>
          {listing.buyer}
        </p>
        <dl className="later-facts">
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
          <div className="later-rule" data-later-rule="">
            <dt>How a winner is chosen</dt>
            <dd className="winner-rule" data-winner-rule="">
              {listing.winnerRule}
            </dd>
          </div>
        </dl>
        <p className="later-open-wrap">
          <a
            className="brief-url later-open"
            href={briefClickPath(listing.id)}
            data-brief-url={listing.briefUrl}
            data-later-open=""
          >
            Open brief
          </a>
        </p>
      </div>
    </article>
  );
}

export function ListingCard({
  listing,
  featured = false,
}: {
  listing: RankedListing;
  featured?: boolean;
}) {
  if (!featured) {
    return <LaterRankTicket listing={listing} />;
  }

  return (
    <article
      className="card ticket ticket-featured"
      data-listing-card=""
      data-rank={listing.rank}
      data-listing-id={listing.id}
      data-buyer={listing.buyer}
      data-bid={listing.bidUsd}
      data-prize-before-price=""
      data-rank-is-bid=""
    >
      <div className="ticket-stub">
        <span className="rank">#{listing.rank}</span>
      </div>
      <div className="card-body ticket-face">
        <div className="card-top">
          <p className="ticket-kicker">Who is buying</p>
          <h3 className="buyer" data-buyer-name="">
            {listing.buyer}
          </h3>
        </div>
        <dl className="ticket-facts">
          <div className="ticket-read-budget">
            <dt>What it pays</dt>
            <dd
              className="budget read-this-budget"
              data-budget=""
              data-read-budget="lead"
              data-budget-later=""
            >
              <span className="budget-amount">
                {formatUsd(listing.budgetUsd)}
              </span>
              <span className="budget-not-bid">
                Project budget, not the bid
              </span>
            </dd>
          </div>
          <div className="ticket-read-deadline">
            <dt>When it’s due</dt>
            <dd
              className="deadline read-this-deadline"
              data-deadline=""
              data-read-deadline="lead"
            >
              <time className="deadline-date" dateTime={listing.deadline}>
                {formatDeadline(listing.deadline)}
              </time>
              <span className="deadline-not-score">Due date, not a score</span>
            </dd>
          </div>
          <div className="ticket-rule ticket-read-winner prize-before-price">
            <dt>How a winner is chosen</dt>
            <dd
              className="winner-rule read-this-winner"
              data-winner-rule=""
              data-read-winner="lead"
              data-prize=""
            >
              <span className="winner-rule-text">{listing.winnerRule}</span>
              <span className="winner-not-score">Winner rule, not a score</span>
            </dd>
          </div>
        </dl>
        <p className="ticket-bid-later">
          <span className="bid rank-is-bid" data-rank-bid="" data-bid="">
            {formatUsd(listing.bidUsd)}
          </span>
          <span className="clicks" data-clicks="">
            {formatClicks(listing.clicks)}
          </span>
        </p>
        <p className="ticket-open">
          <a
            className="brief-url open-this-brief"
            href={briefClickPath(listing.id)}
            data-brief-url={listing.briefUrl}
            data-open-brief="lead"
            data-first-click={featured ? "open" : undefined}
            data-open-after-write-first=""
            data-first-read="open"
            data-open-after-write-two=""
            data-open-after-write-three=""
            data-open-after-write-four=""
            data-open-after-write-five=""
          >
            Open this brief
          </a>
        </p>
        <footer className="ticket-write-later" data-write-later="">
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
              data-write-later-quiet=""
              aria-label="Write this ticket after the winner rule"
            >
              Write this ticket
            </a>{" "}
            after the winner rule. Paying less than #1 still lists.
          </p>
        </footer>
      </div>
    </article>
  );
}

export function Leaderboard({
  listings,
}: {
  listings: readonly RankedListing[];
}) {
  const later = listings.filter((listing) => listing.rank !== 1);
  if (later.length === 0) {
    return null;
  }

  return (
    <ol className="leaderboard later-pack" data-leaderboard="" data-later-pack="">
      {later.map((listing) => (
        <li key={listing.id}>
          <ListingCard listing={listing} />
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
      className={empty ? "board desk week-empty" : "board desk week-occupied"}
      data-board=""
      data-brief-desk=""
      data-week={week.weekId}
      data-week-empty={empty ? "true" : undefined}
      data-week-occupied={empty ? undefined : "true"}
      data-empty-ticket={empty ? "" : undefined}
      data-rolling-week="true"
    >
      <header className="desk-mast">
        <p className="kicker">This week’s #1 freelance brief</p>
        <h1>Brief desk</h1>
        <p className="period-meta" data-week-id={week.weekId}>
          Week {week.weekId}. Window since {week.startsAt}. Rank is the bid.
          Budget, deadline, and how a winner is chosen are public facts, not
          scores.
        </p>
        <p className="week-window" data-rolling-week="true">
          Rolling last 7 days. Not Monday 00:00 UTC.
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
        <section
          className="hopper later-pack"
          aria-labelledby="hopper-heading"
          data-later-pack=""
        >
          <h2 id="hopper-heading">Tickets on the desk</h2>
          <p className="hopper-note">
            Paying less than #1 still lists. Rank is the bid, not the project
            budget. These tickets are not this week’s #1 prize.
          </p>
          <Leaderboard listings={rest} />
        </section>
      ) : null}
    </main>
  );
}
