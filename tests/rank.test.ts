import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Board, ListingCard } from "../src/app/board";
import { resetListings } from "../src/core/listings";
import {
  getBoardListings,
  rankListings,
  type Listing,
} from "../src/core/rank";
import { currentWeekUtc } from "../src/core/week";

const WEEK = "2026-W34";
const WEEK_META = {
  weekId: WEEK,
  startsAt: "2026-08-17T00:00:00.000Z",
  endsAt: "2026-08-24T00:00:00.000Z",
};

const formSource = readFileSync(
  join(process.cwd(), "src", "app", "outbid-form.tsx"),
  "utf8",
);

const RATINGS_FORBIDDEN =
  /★|⭐|star rating|4\.8 stars|review score|top rated|hire rate|data-stars|data-rating/i;

afterEach(() => {
  resetListings();
});

function listing(
  partial: Partial<Listing> & Pick<Listing, "id" | "bidUsd" | "firstPaidAt">,
): Listing {
  return {
    weekId: WEEK,
    buyer: partial.buyer ?? `Buyer ${partial.id}`,
    budgetUsd: partial.budgetUsd ?? 2500,
    deadline: partial.deadline ?? "2026-09-01",
    winnerRule: partial.winnerRule ?? "First qualified portfolio",
    briefUrl: partial.briefUrl ?? `https://example.com/${partial.id}`,
    lastPaidAt: partial.lastPaidAt ?? partial.firstPaidAt,
    clicks: partial.clicks ?? 0,
    ...partial,
  };
}

test("empty week stays empty and the live loader invents no briefs", () => {
  assert.deepEqual(rankListings([]), []);
  assert.deepEqual(getBoardListings(WEEK), []);
});

test("higher bid is above; a bid below #1 still lists", () => {
  const ranked = rankListings([
    listing({
      id: "lst_five",
      buyer: "Acme",
      bidUsd: 5,
      firstPaidAt: "2026-08-17T09:00:00.000Z",
      clicks: 900,
    }),
    listing({
      id: "lst_twelve",
      buyer: "Beta",
      bidUsd: 12,
      firstPaidAt: "2026-08-18T09:00:00.000Z",
      clicks: 0,
    }),
  ]);
  assert.deepEqual(
    ranked.map((row) => ({ id: row.id, rank: row.rank, bidUsd: row.bidUsd })),
    [
      { id: "lst_twelve", rank: 1, bidUsd: 12 },
      { id: "lst_five", rank: 2, bidUsd: 5 },
    ],
  );
});

test("equal bids: older firstPaidAt keeps the higher rank", () => {
  const ranked = rankListings([
    listing({
      id: "lst_newer",
      buyer: "Newer Eight",
      bidUsd: 8,
      firstPaidAt: "2026-08-18T00:00:00.000Z",
      clicks: 40,
    }),
    listing({
      id: "lst_older",
      buyer: "Older Eight",
      bidUsd: 8,
      firstPaidAt: "2026-08-17T00:00:00.000Z",
      clicks: 0,
    }),
  ]);
  assert.equal(ranked[0]?.id, "lst_older");
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[1]?.id, "lst_newer");
  assert.equal(ranked[1]?.rank, 2);
});

test("equal firstPaidAt falls back to id ASC", () => {
  const ranked = rankListings([
    listing({ id: "b", bidUsd: 5, firstPaidAt: "2026-08-17T00:00:00.000Z" }),
    listing({ id: "a", bidUsd: 5, firstPaidAt: "2026-08-17T00:00:00.000Z" }),
  ]);
  assert.deepEqual(
    ranked.map((row) => row.id),
    ["a", "b"],
  );
});

test("budget, deadline, and clicks do not change order", () => {
  const ranked = rankListings([
    listing({
      id: "lst_rich",
      buyer: "Huge Budget",
      budgetUsd: 80_000,
      deadline: "2026-08-20",
      bidUsd: 5,
      firstPaidAt: "2026-08-17T00:00:00.000Z",
      clicks: 9_999,
    }),
    listing({
      id: "lst_paid",
      buyer: "Paid More",
      budgetUsd: 400,
      deadline: "2026-12-31",
      bidUsd: 9,
      firstPaidAt: "2026-08-19T00:00:00.000Z",
      clicks: 0,
    }),
  ]);
  assert.equal(ranked[0]?.id, "lst_paid");
  assert.equal(ranked[1]?.id, "lst_rich");
});

test("rankListings does not mutate the input", () => {
  const rows = [
    listing({ id: "b", bidUsd: 5, firstPaidAt: "2026-08-17T00:00:00.000Z" }),
    listing({ id: "a", bidUsd: 8, firstPaidAt: "2026-08-18T00:00:00.000Z" }),
  ];
  const before = rows.map((row) => row.id);
  rankListings(rows);
  assert.deepEqual(
    rows.map((row) => row.id),
    before,
  );
});

test("empty week markup shows the form and no #1 brief", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /board is empty/i);
  assert.match(html, /no paid brief/i);
  assert.match(html, /no sample gig/i);
  assert.match(html, /data-brief-desk=""/);
  assert.match(html, /data-bid-form=""/);
  assert.match(html, /name="buyer"/);
  assert.match(html, /name="budgetUsd"/);
  assert.match(html, /name="deadline"/);
  assert.match(html, /name="winnerRule"/);
  assert.match(html, /name="briefUrl"/);
  assert.match(html, /name="amountUsd"/);
  assert.match(html, />Outbid</);
  assert.match(html, /Claim #1 for/);
  assert.match(html, /2026-W34/);
  assert.doesNotMatch(html, /data-listing-card/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
  assert.match(formSource, /name="buyer"/);
  assert.match(formSource, /name="budgetUsd"/);
  assert.match(formSource, /name="deadline"/);
  assert.match(formSource, /name="winnerRule"/);
  assert.match(formSource, /name="briefUrl"/);
  assert.match(formSource, /name="amountUsd"/);
  assert.match(formSource, /Outbid/);
  assert.match(formSource, /Claim #1 for/);
  assert.match(formSource, /Who is buying/);
  assert.match(formSource, /What it pays/);
  assert.match(formSource, /When it’s due/);
  assert.match(formSource, /How a winner is chosen/);
  assert.doesNotMatch(formSource, RATINGS_FORBIDDEN);
});

test("cards show buyer, budget, deadline, $, clicks — not ratings", () => {
  const [card] = rankListings([
    listing({
      id: "lst_acme",
      buyer: "Acme Studio",
      budgetUsd: 3200,
      deadline: "2026-09-15",
      winnerRule: "Best portfolio by Friday",
      briefUrl: "https://example.com/acme",
      bidUsd: 5,
      firstPaidAt: "2026-08-17T00:00:00.000Z",
      clicks: 3,
    }),
  ]);
  assert.ok(card);
  const html = renderToStaticMarkup(createElement(ListingCard, { listing: card }));
  assert.match(html, /data-rank="1"/);
  assert.match(html, /#1/);
  assert.match(html, /Acme Studio/);
  assert.match(html, /Who is buying/);
  assert.match(html, /What it pays/);
  assert.match(html, /When it’s due/);
  assert.match(html, /How a winner is chosen/);
  assert.match(html, /Budget \$3,200/);
  assert.match(html, /Deadline 2026-09-15/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /\$5/);
  assert.match(html, /3 clicks/);
  assert.match(html, /Open brief/);
  assert.match(html, /https:\/\/example.com\/acme/);
  assert.match(html, /class="[^"]*ticket/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("ranked cards keep money order; older wins ties", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_new",
          buyer: "Newer Eight",
          bidUsd: 8,
          firstPaidAt: "2026-08-19T00:00:00.000Z",
        }),
        listing({
          id: "lst_five",
          buyer: "Five Dollar",
          bidUsd: 5,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_old",
          buyer: "Older Eight",
          bidUsd: 8,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const first = html.indexOf('data-listing-id="lst_old"');
  const second = html.indexOf('data-listing-id="lst_new"');
  const third = html.indexOf('data-listing-id="lst_five"');
  assert.ok(first >= 0 && second >= 0 && third >= 0);
  assert.ok(first < second && second < third);
  assert.match(html, /\$8/);
  assert.match(html, /\$5/);
  assert.match(html, /data-brief-desk=""/);
  assert.match(html, /Tickets on the desk/);
  assert.doesNotMatch(html, /data-empty-week/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week is no paid brief, never a sample gig", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /no paid brief/i);
  assert.match(html, /no sample gig/i);
  assert.match(html, /data-empty-week="true"/);
  assert.doesNotMatch(html, /data-listing-card/);
  assert.doesNotMatch(html, /data-buyer=/);
});

test("empty week yields the desk to Claim #1", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /desk-surface-empty/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /no paid brief/i);
  assert.match(html, /no invented #1 brief/i);
  assert.match(html, /no sample gig/i);
  assert.match(html, /id="claim"/);
  const emptyAt = html.indexOf('data-empty-week="true"');
  const claimAt = html.indexOf('id="claim"');
  assert.ok(emptyAt >= 0 && claimAt >= 0);
  assert.ok(emptyAt < claimAt);
  assert.doesNotMatch(html, /data-listing-card/);
  assert.doesNotMatch(html, /spike-pin/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week tells a freelancer no one has paid before Claim #1", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  const stampAt = html.indexOf("No paid brief");
  const emptyAt = html.indexOf('data-empty-week="true"');
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && emptyAt >= 0 && claimAt >= 0);
  assert.ok(emptyAt < claimAt);
  assert.ok(stampAt < claimAt);
  assert.match(html, /data-bid-form=""/);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-listing-card/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week keeps the paid ticket beside Claim #1", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.doesNotMatch(html, /desk-surface-empty/);
  assert.doesNotMatch(html, /data-empty-week/);
  assert.match(html, /ticket-featured/);
  assert.match(html, /id="claim"/);
  const ticketAt = html.indexOf('data-listing-id="lst_lead"');
  const claimAt = html.indexOf('id="claim"');
  assert.ok(ticketAt >= 0 && claimAt >= 0);
  assert.ok(ticketAt < claimAt);
});

test("current week header uses UTC ISO week", () => {
  const week = currentWeekUtc(new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(week.weekId, "2026-W34");
});
