"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { UnpaidTicket } from "../core/listings";
import type { RankedListing } from "../core/rank";
import { MIN_BID_USD } from "../core/money";
import type { UtcWeek } from "../core/week";
import { OutbidForm } from "./outbid-form";

type BoardProps = {
  week: UtcWeek;
  listings: readonly RankedListing[];
  unpaid?: readonly UnpaidTicket[];
};

type BoardPeriod = "rolling" | "today";

const TODAY_WINDOW_MS = 24 * 60 * 60 * 1000;

function briefClickPath(id: string): string {
  return `/click/${id}`;
}

function isPaidListing(
  listing: Pick<RankedListing, "firstPaidAt">,
): boolean {
  const paidAt = listing.firstPaidAt;
  if (typeof paidAt !== "string" || paidAt.trim() === "") return false;
  return Number.isFinite(Date.parse(paidAt));
}

export function periodFromSearch(search: string): BoardPeriod {
  return new URLSearchParams(search).get("period") === "today"
    ? "today"
    : "rolling";
}

function paidInTodayWindow(
  listing: Pick<RankedListing, "lastPaidAt">,
  nowMs: number,
): boolean {
  const paidAtMs = Date.parse(listing.lastPaidAt);
  if (!Number.isFinite(paidAtMs) || paidAtMs > nowMs) return false;
  return nowMs - paidAtMs <= TODAY_WINDOW_MS;
}

export function filterTodayListings(
  listings: readonly RankedListing[],
  nowMs: number,
): RankedListing[] {
  return listings
    .filter(isPaidListing)
    .filter((listing) => paidInTodayWindow(listing, nowMs))
    .map((listing, index) => ({ ...listing, rank: index + 1 }));
}

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

export function formatClicks(clicks: number): string {
  return `${clicks} ${clicks === 1 ? "click" : "clicks"}`;
}

function formatBriefHost(briefUrl: string): string {
  try {
    return new URL(briefUrl).host;
  } catch {
    return briefUrl;
  }
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

function PeriodTabs({
  period,
  onChange,
}: {
  period: BoardPeriod;
  onChange: (next: BoardPeriod) => void;
}) {
  const tabs = ["rolling", "today"] as const;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveTab(
    index: number,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    onChange(next);
    window.requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  }

  return (
    <div
      className="period-tabs"
      role="tablist"
      aria-label="Brief board period"
      aria-orientation="horizontal"
      data-period-tabs=""
      data-slot="period-tabs"
      data-selected-period={period}
    >
      {tabs.map((tab, index) => (
        <button
          type="button"
          className={`period-tab${period === tab ? " is-active" : ""}`}
          role="tab"
          aria-selected={period === tab}
          aria-controls="board"
          tabIndex={period === tab ? 0 : -1}
          data-period={tab}
          key={tab}
          ref={(element) => {
            tabRefs.current[index] = element;
          }}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => moveTab(index, event)}
        >
          {tab === "rolling" ? "Rolling" : "Today"}
        </button>
      ))}
    </div>
  );
}

function LaterRankTicket({ listing }: { listing: RankedListing }) {
  return (
    <li
      className="card ticket ticket-later"
      data-listing-card=""
      data-slot={listing.rank <= 3 ? "paid-card" : "later-row"}
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
        {listing.rank <= 3 ? (
          <p className="later-facts-preview" data-ticket-preview="">
            <span className="ticket-summary-line">
              Budget {formatUsd(listing.budgetUsd)}
            </span>
            <span className="ticket-summary-line">
              Due {formatDeadline(listing.deadline)}
            </span>
            <span className="ticket-summary-line ticket-summary-rule">
              Rule {listing.winnerRule}
            </span>
          </p>
        ) : null}
        <p className="later-meta" data-ticket-meta="">
          <span data-paid-at="">Paid {formatActivityDay(listing.lastPaidAt)}</span>
          <span data-brief-host="">{formatBriefHost(listing.briefUrl)}</span>
          {listing.rank <= 3 ? (
            <span data-clicks="">{formatClicks(listing.clicks)}</span>
          ) : null}
        </p>
        <div className="later-actions" data-ticket-actions="">
          <details
            className="later-facts-details"
            data-later-facts=""
            open={listing.rank > 3 ? true : undefined}
          >
            <summary className="later-facts-summary">
              <span className="later-facts-summary-action">See details</span>
            </summary>
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
          </details>
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
      </div>
    </li>
  );
}

export function ListingCard({
  listing,
  featured = false,
}: {
  listing: RankedListing;
  featured?: boolean;
}) {
  if (!isPaidListing(listing)) {
    return null;
  }
  if (!featured) {
    return <LaterRankTicket listing={listing} />;
  }

  return (
    <li
      className="card ticket ticket-featured"
      data-listing-card=""
      data-slot="paid-card"
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
        <p className="ticket-facts-preview" data-ticket-preview="">
          <span className="ticket-summary-line">
            Budget {formatUsd(listing.budgetUsd)}
          </span>
          <span className="ticket-summary-line">
            Due {formatDeadline(listing.deadline)}
          </span>
          <span className="ticket-summary-line ticket-summary-rule">
            Rule {listing.winnerRule}
          </span>
        </p>
        <div className="ticket-actions" data-ticket-actions="">
          <details className="ticket-facts-details" data-ticket-facts="">
            <summary className="ticket-facts-summary">
              <span className="ticket-facts-summary-action">See details</span>
            </summary>
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
          </details>
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
              data-first-read="open"
            >
              Open this brief
            </a>
          </p>
        </div>
        <p className="ticket-meta" data-ticket-meta="">
          <span data-paid-at="">Paid {formatActivityDay(listing.lastPaidAt)}</span>
          <span data-brief-host="">{formatBriefHost(listing.briefUrl)}</span>
          <span data-clicks="">{formatClicks(listing.clicks)}</span>
        </p>
        <footer className="ticket-claim-anchor" data-claim-anchor="">
          <p className="claim-anchor-wrap">
            <a
              className="claim-anchor"
              href="#claim"
              aria-label="Open the Claim #1 form"
            >
              Write this ticket
            </a>{" "}
            Paying less than #1 still lists.
          </p>
        </footer>
      </div>
    </li>
  );
}

function formatActivityDay(timestamp: string): string {
  const day = timestamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : timestamp;
}

function BoardSummaries({
  listings,
  period,
}: {
  listings: readonly RankedListing[];
  period: BoardPeriod;
}) {
  const ranking = listings.slice(0, 3);
  const activity = listings.slice(0, 5);
  const today = period === "today";

  return (
    <div className="board-summaries" data-board-summaries="">
      <section
        className="summary-section summary-ranking"
        aria-labelledby="todays-ranking-heading"
        data-todays-ranking=""
        data-slot="today-strip"
        data-summary-window={today ? "today-24-hours" : "rolling-7-days"}
      >
        <div className="summary-section-heading">
          <h2 id="todays-ranking-heading">Bid order</h2>
          <span className="summary-window">
            {today ? "Today view" : "Rolling window"}
          </span>
        </div>
        <ol className="summary-ranking-list">
          {ranking.map((listing) => (
            <li
              className="summary-ranking-item"
              key={listing.id}
              data-ranking-item=""
              data-listing-id={listing.id}
              data-rank={listing.rank}
            >
              <a
                className="summary-ranking-link"
                href={briefClickPath(listing.id)}
                data-brief-url={listing.briefUrl}
                aria-label={`Open ${listing.buyer} brief`}
              >
                <span className="summary-ranking-rank">#{listing.rank}</span>
                <span
                  className="summary-ranking-title"
                  data-ranking-title="buyer"
                >
                  {listing.buyer}
                </span>
                <span className="summary-ranking-bid" data-ranking-bid="">
                  {formatUsd(listing.bidUsd)}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="summary-section latest-activity"
        aria-labelledby="latest-activity-heading"
        data-latest-activity=""
        data-slot="activity-strip"
        data-activity-window={today ? "today-24-hours" : "rolling-7-days"}
      >
        <div className="summary-section-heading">
          <h2 id="latest-activity-heading">Paid ticket log</h2>
        </div>
        <ul className="latest-activity-list">
          {activity.map((listing) => (
            <li
              className="latest-activity-item"
              key={listing.id}
              data-activity-item=""
              data-listing-id={listing.id}
              data-placement={listing.rank}
            >
              <span className="activity-title" data-activity-title="buyer">
                {listing.buyer}
              </span>
              <span className="activity-facts">
                <time
                  className="activity-paid"
                  dateTime={listing.lastPaidAt}
                  data-activity-fact="last-paid"
                >
                  Paid {formatActivityDay(listing.lastPaidAt)}
                </time>
                <span data-activity-fact="placement">
                  Placement #{listing.rank}
                </span>
                <span data-activity-fact="clicks">
                  {formatClicks(listing.clicks)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function Leaderboard({
  listings,
}: {
  listings: readonly RankedListing[];
}) {
  const later = listings.filter(
    (listing) => listing.rank !== 1 && isPaidListing(listing),
  );
  if (later.length === 0) {
    return null;
  }

  return (
    <ol className="leaderboard later-pack" data-leaderboard="" data-later-pack="">
      {later.map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </ol>
  );
}

export function Board({ week, listings, unpaid = [] }: BoardProps) {
  const [period, setPeriod] = useState<BoardPeriod>("rolling");
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    function syncFromUrl() {
      setPeriod(periodFromSearch(window.location.search));
      setNowMs(Date.now());
    }

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    if (period !== "today") return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [period]);

  function changePeriod(next: BoardPeriod) {
    if (next === period) return;
    setPeriod(next);
    setNowMs(Date.now());

    const url = new URL(window.location.href);
    if (next === "today") {
      url.searchParams.set("period", "today");
    } else {
      url.searchParams.delete("period");
    }
    window.history.pushState(
      { period: next },
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  const paid = useMemo(() => {
    const live = listings.filter(isPaidListing);
    if (period !== "today" || nowMs === null) return live;
    return filterTodayListings(live, nowMs);
  }, [listings, nowMs, period]);
  const featured = paid[0];
  const rest = paid.slice(1);
  const topThree = rest.slice(0, 2);
  const lower = rest.slice(2);
  const topBid = featured?.bidUsd ?? 0;
  const defaultAmount = topBid > 0 ? topBid + 1 : MIN_BID_USD;

  const empty = featured === undefined;
  const leftoverUnpaid = unpaid.length > 0;
  const today = period === "today";
  const contextLabel = today ? "Today, last 24 hours" : "Rolling last 7 days";
  const leadLabel = today ? "Today’s #1" : "The last 7 days’ #1";
  const prizeLabel = today ? "Today’s #1 prize" : "the last 7 days’ #1 prize";

  return (
    <main
      className={empty ? "board desk week-empty" : "board desk week-occupied"}
      data-board=""
      data-brief-desk=""
      data-slot="home-shell"
      data-week={week.weekId}
      data-week-empty={empty ? "true" : undefined}
      data-week-occupied={empty ? undefined : "true"}
      data-empty-ticket={empty ? "" : undefined}
      data-unpaid-off={empty && leftoverUnpaid ? "" : undefined}
      data-rolling-week="true"
      data-selected-period={period}
    >
      <div
        className="desk-context"
        data-context-window={today ? "today-24-hours" : "rolling-7-days"}
        data-selected-period={period}
      >
        <span className="context-pill" data-slot="stats-pill">
          <span className="context-dot" aria-hidden="true" />
          {contextLabel}
        </span>
      </div>
      <PeriodTabs period={period} onChange={changePeriod} />
      <section className="claim-first" data-claim-first="" data-slot="claim-hero">
        <OutbidForm
          defaultAmount={defaultAmount}
          occupied={Boolean(featured)}
          unpaidOff={leftoverUnpaid}
        />
      </section>

      <nav
        className="desk-rail"
        aria-label="Brief desk navigation"
        data-slot="desk-navigation"
      >
        <a href="#board">Board</a>
        <a href="#claim">Claim a ticket</a>
        <a href="/rules">Rules</a>
        <a href="/about">About</a>
      </nav>

      <div
        className={empty ? "desk-surface desk-surface-empty" : "desk-surface"}
        data-desk-surface={empty ? "empty" : "occupied"}
      >
        {featured ? (
          <section
            className="top-three"
            id="board"
            aria-label="Top three briefs"
            data-top-three=""
          >
            <h2 className="top-three-heading">Tickets on the desk</h2>
            <p className="top-three-note">
              Paying less than #1 still lists. Rank is the bid, not the project
              budget. These tickets are not {prizeLabel}.
            </p>
            <ol
              className="leaderboard top-three-list"
              data-slot="top-three"
              data-leaderboard=""
              data-later-pack=""
            >
              <ListingCard listing={featured} featured />
              {topThree.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </ol>
          </section>
        ) : (
          <>
            <section
              className="spike spike-quiet"
              id="board"
              aria-labelledby="spike-heading"
            >
              <h2 id="spike-heading">{leadLabel}</h2>
              <div className="empty-week" data-empty-week="true">
                <div className="empty-ticket">
                  <p className="empty-stamp">No paid brief</p>
                  <p>
                    {today
                      ? "Today’s board is empty."
                      : "The last 7 days’ board is empty."} No buyer has paid
                    to pin a ticket. There is no invented #1 brief and no
                    invented ratings. There is no sample gig.
                    {leftoverUnpaid
                      ? " An unpaid checkout stays off this desk until payment is confirmed."
                      : null}
                  </p>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {featured ? <BoardSummaries listings={paid} period={period} /> : null}

      {lower.length > 0 ? (
        <section
          className="hopper later-pack"
          aria-labelledby="hopper-heading"
          data-later-pack=""
          data-slot="later-rows"
        >
          <h2 id="hopper-heading">Tickets on the desk</h2>
          <p className="hopper-note">
            Paying less than #1 still lists. Rank is the bid, not the project
            budget. These tickets are not {prizeLabel}.
          </p>
          <Leaderboard listings={lower} />
        </section>
      ) : null}

      {featured ? (
        <p className="raise-hint desk-raise-hint" data-raise-hint="">
          Already on the last 7 days? Enter the same brief URL and raise. Raise
          pays the difference only after checkout lands.
        </p>
      ) : null}

      <p className="board-contract-note" data-board-contract-note="">
        Paid briefs only · rank is the bid
      </p>

      <header className="desk-mast" data-slot="board-copy">
        <p className="kicker">{leadLabel} freelance brief</p>
        <h1>Brief desk</h1>
        {empty ? (
          <p
            className="period-meta"
            data-week-id={week.weekId}
            data-empty-window=""
          >
            {today ? "Today. " : "Last 7 days. "}
            <span data-empty-since="">
              {today ? "Window last 24 hours." : "Window last 7 days."}
            </span>{" "}
            Rank is the bid. Budget, deadline, and how a winner is chosen are
            public facts, not scores.
          </p>
        ) : (
          <p
            className="period-meta"
            data-week-id={week.weekId}
            data-occupied-window=""
          >
            {today ? "Today. " : "Last 7 days. "}
            <span data-occupied-since="">
              {today ? "Window last 24 hours." : "Window last 7 days."}
            </span>{" "}
            Rank is the bid. Budget, deadline, and how a winner is chosen are
            public facts, not scores.
          </p>
        )}
        <p className="week-window" data-rolling-week="true">
          {today
            ? "Today, last 24 hours. Same desk, no separate route."
            : "Rolling last 7 days. Not Monday 00:00 UTC."}
        </p>
      </header>

    </main>
  );
}
