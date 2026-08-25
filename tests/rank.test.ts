import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Board, ListingCard, formatDeadline } from "../src/app/board";
import { resetListings } from "../src/core/listings";
import {
  getBoardListings,
  isPolarPaidListing,
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

const boardSource = readFileSync(
  join(process.cwd(), "src", "app", "board.tsx"),
  "utf8",
);

const layoutSource = readFileSync(
  join(process.cwd(), "src", "app", "layout.tsx"),
  "utf8",
);

const cssSource = readFileSync(
  join(process.cwd(), "src", "app", "board.css"),
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
  assert.deepEqual(getBoardListings(new Date("2026-08-17T12:00:00.000Z")), []);
});

test("unpaid Polar checkout never ranks as #1", () => {
  const unpaid = listing({
    id: "lst_unpaid",
    buyer: "Ghost Studio",
    winnerRule: "Best portfolio by Friday",
    bidUsd: 99,
    firstPaidAt: "",
  });
  assert.equal(isPolarPaidListing(unpaid), false);
  assert.deepEqual(rankListings([unpaid]), []);
  assert.equal(
    isPolarPaidListing(
      listing({
        id: "lst_paid",
        bidUsd: 5,
        firstPaidAt: "2026-08-17T00:00:00.000Z",
      }),
    ),
    true,
  );
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
  assert.doesNotMatch(html, /data-read-budget/);
  assert.doesNotMatch(html, /Project budget, not the bid/);
  assert.doesNotMatch(html, /data-read-deadline/);
  assert.doesNotMatch(html, /Due date, not a score/);
  assert.doesNotMatch(html, /data-read-winner/);
  assert.doesNotMatch(html, /Winner rule, not a score/);
  assert.doesNotMatch(html, /data-prize-before-price/);
  assert.doesNotMatch(html, /data-prize=/);
  assert.doesNotMatch(html, /data-rank-is-bid/);
  assert.doesNotMatch(html, /data-rank-bid/);
  assert.doesNotMatch(html, /data-budget-later/);
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

test("occupied week makes opening the paid #1 brief the freelancer move", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.doesNotMatch(html, /data-empty-week/);
  assert.doesNotMatch(html, /no paid brief/i);
  assert.match(html, /ticket-featured/);
  assert.match(html, /data-open-brief="lead"/);
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(html, /data-brief-url="https:\/\/example.com\/lead"/);
  assert.match(html, /Budget \$/);
  assert.match(html, /\$12/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const openLead = html.indexOf("Open this brief");
  const openHop = html.indexOf(">Open brief<");
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(openLead > leadStart && openLead < hopperStart);
  assert.ok(openLead < claimAt);
  assert.ok(openHop > hopperStart);
  assert.equal(html.includes('data-open-brief="lead"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Open this brief/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week makes writing a new ticket the buyer move", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-write-ticket="buyer"/);
  assert.match(html, /data-write-ticket-stamp=""/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /Open this brief/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /\$12/);
  assert.match(html, /Budget \$/);
  assert.match(html, /Rank is the bid, not the project/);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const openLead = html.indexOf("Open this brief");
  const claimAt = html.indexOf('id="claim"');
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  assert.ok(leadStart >= 0 && openLead > leadStart);
  assert.ok(openLead < hopperStart);
  assert.ok(hopperStart < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.equal(html.includes("Write this ticket", hopperStart) === false || writeStampAt > hopperStart, true);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week makes reading the paid #1 budget the freelancer fact", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-read-budget="lead"/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /\$3,200/);
  assert.match(html, /\$12/);
  assert.match(html, /Open this brief/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /15 September 2026/);
  assert.match(html, /Due date, not a score/);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const openLead = html.indexOf("Open this brief");
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(budgetAt > leadStart && budgetAt < hopperStart);
  assert.ok(budgetAt < openLead);
  assert.ok(openLead < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > budgetAt && bidStub < openLead);
  assert.equal(html.includes('data-read-budget="lead"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Project budget, not the bid/);
  assert.match(html.slice(hopperStart, claimAt), /Budget \$800/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not stamp a project budget over No paid brief", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-read-budget/);
  assert.doesNotMatch(html, /Project budget, not the bid/);
  assert.doesNotMatch(html, /data-read-deadline/);
  assert.doesNotMatch(html, /Due date, not a score/);
  assert.doesNotMatch(html, /data-read-winner/);
  assert.doesNotMatch(html, /Winner rule, not a score/);
  assert.doesNotMatch(html, /data-listing-card/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week makes reading the paid #1 deadline the freelancer fact", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-read-deadline="lead"/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /15 September 2026/);
  assert.match(html, /dateTime="2026-09-15"/);
  assert.match(html, /\$3,200/);
  assert.match(html, /\$12/);
  assert.match(html, /Open this brief/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Project budget, not the bid/);
  assert.equal(formatDeadline("2026-09-15"), "15 September 2026");

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const openLead = html.indexOf("Open this brief");
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(deadlineAt > leadStart && deadlineAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt < openLead);
  assert.ok(openLead < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > deadlineAt && bidStub < openLead);
  assert.equal(html.includes('data-read-deadline="lead"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Due date, not a score/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /15 September 2026/);
  assert.match(html.slice(hopperStart, claimAt), /Deadline 2026-10-01/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not stamp a due date over No paid brief", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-read-deadline/);
  assert.doesNotMatch(html, /Due date, not a score/);
  assert.doesNotMatch(html, /15 September 2026/);
  assert.doesNotMatch(html, /data-listing-card/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week makes reading the paid #1 winner rule the freelancer fact", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-read-winner="lead"/);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /\$3,200/);
  assert.match(html, /\$12/);
  assert.match(html, /Open this brief/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /15 September 2026/);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const openLead = html.indexOf("Open this brief");
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(winnerAt > leadStart && winnerAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < openLead);
  assert.ok(openLead < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < openLead);
  assert.equal(html.includes('data-read-winner="lead"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Winner rule, not a score/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Best portfolio by Friday/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week makes writing a new ticket after the winner rule the buyer hop", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-write-after-rule=""/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""[^>]*data-write-after-open-three=""[^>]*data-write-after-open-four=""[^>]*data-write-after-open-five=""[^>]*data-write-after-open-six=""[^>]*data-write-later-quiet=""/,
  );
  assert.match(html, /after the winner rule/);
  assert.match(html, /Paying less than #1 still lists/);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /Open this brief/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /data-write-ticket="buyer"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /\$12/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const openLead = html.indexOf("Open this brief");
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(writeAfterAt > leadStart && writeAfterAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < hopperStart);
  assert.ok(hopperStart < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < writeAfterAt);
  assert.equal(html.includes('data-write-after-rule=""', hopperStart) === false || writeStampAt > hopperStart, true);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Write this ticket/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not stamp a winner rule over No paid brief", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-read-winner/);
  assert.doesNotMatch(html, /Winner rule, not a score/);
  assert.doesNotMatch(html, /Best portfolio by Friday/);
  assert.doesNotMatch(html, /data-prize-before-price/);
  assert.doesNotMatch(html, /data-prize=/);
  assert.doesNotMatch(html, /data-listing-card/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not stamp Write this ticket over No paid brief", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-write-ticket="buyer"/);
  assert.doesNotMatch(html, /data-write-ticket-stamp/);
  assert.doesNotMatch(html, /Write this ticket/);
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-open-two/);
  assert.doesNotMatch(html, /data-write-after-open-three/);
  assert.doesNotMatch(html, /data-write-after-open-four/);
  assert.doesNotMatch(html, /data-write-after-open-five/);
  assert.doesNotMatch(html, /data-write-after-open-six/);
  assert.doesNotMatch(html, /after the winner rule/);
  assert.doesNotMatch(html, /data-write-later-quiet/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
  assert.doesNotMatch(html, /data-open-after-write-three/);
  assert.doesNotMatch(html, /data-open-after-write-four/);
  assert.doesNotMatch(html, /data-open-after-write-five/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week lets opening the paid #1 brief win the first click after Write follows the winner rule", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-first-click="open"/);
  assert.match(html, /data-open-brief="lead"/);
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(html, /data-write-after-rule=""/);
  assert.match(html, /after the winner rule/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /\$12/);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const firstClickAt = html.indexOf('data-first-click="open"');
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(firstClickAt > leadStart && firstClickAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < firstClickAt);
  assert.ok(firstClickAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < firstClickAt);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Write this ticket/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week concentrates writing a new ticket after Open this brief wins the first click", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-first-click="open"/);
  assert.match(html, /data-open-brief="lead"/);
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""[^>]*data-write-after-open-three=""[^>]*data-write-after-open-four=""[^>]*data-write-after-open-five=""[^>]*data-write-after-open-six=""[^>]*data-write-later-quiet=""/,
  );
  assert.match(html, /after the winner rule/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /data-write-ticket="buyer"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /\$12/);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-six=""/g) ?? []).length, 1);
  assert.equal((html.match(/href="#claim"/g) ?? []).length, 1);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const firstClickAt = html.indexOf('data-first-click="open"');
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
  const writeAfterOpenThreeAt = html.indexOf('data-write-after-open-three=""');
  const writeAfterOpenFourAt = html.indexOf('data-write-after-open-four=""');
  const writeAfterOpenFiveAt = html.indexOf('data-write-after-open-five=""');
  const writeAfterOpenSixAt = html.indexOf('data-write-after-open-six=""');
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(writeAfterOpenAt > leadStart && writeAfterOpenAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < firstClickAt);
  assert.ok(firstClickAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < writeAfterOpenThreeAt);
  assert.ok(writeAfterOpenThreeAt < writeAfterOpenFourAt);
  assert.ok(writeAfterOpenFourAt < writeAfterOpenFiveAt);
  assert.ok(writeAfterOpenFiveAt < writeAfterOpenSixAt);
  assert.ok(writeAfterOpenSixAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < firstClickAt);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-three=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-four=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-six=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Write this ticket/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not concentrate Write this ticket after Open this brief", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-open-two/);
  assert.doesNotMatch(html, /data-write-after-open-three/);
  assert.doesNotMatch(html, /data-write-after-open-four/);
  assert.doesNotMatch(html, /data-write-after-open-five/);
  assert.doesNotMatch(html, /data-write-after-open-six/);
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
  assert.doesNotMatch(html, /data-open-after-write-three/);
  assert.doesNotMatch(html, /data-open-after-write-four/);
  assert.doesNotMatch(html, /data-open-after-write-five/);
  assert.doesNotMatch(html, /Write this ticket/);
  assert.doesNotMatch(html, /after the winner rule/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week concentrates opening the paid #1 brief after Write this ticket is concentrated", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-first-click="open"/);
  assert.match(html, /data-open-brief="lead"/);
  assert.match(html, /data-open-after-write-first=""/);
  assert.match(html, /data-first-read="open"/);
  assert.match(html, /data-open-after-write-two=""/);
  assert.match(html, /data-open-after-write-three=""/);
  assert.match(html, /data-open-after-write-four=""/);
  assert.match(html, /data-open-after-write-five=""/);
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""[^>]*data-write-after-open-three=""[^>]*data-write-after-open-four=""[^>]*data-write-after-open-five=""[^>]*data-write-after-open-six=""[^>]*data-write-later-quiet=""/,
  );
  assert.match(html, /after the winner rule/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /data-write-ticket="buyer"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /\$12/);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-first=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-brief="lead"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/click\/lst_lead"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-six=""/g) ?? []).length, 1);
  assert.equal((html.match(/href="#claim"/g) ?? []).length, 1);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const firstClickAt = html.indexOf('data-first-click="open"');
  const openAfterWriteAt = html.indexOf('data-open-after-write-first=""');
  const firstReadAt = html.indexOf('data-first-read="open"');
  const openAfterWriteTwoAt = html.indexOf('data-open-after-write-two=""');
  const openAfterWriteThreeAt = html.indexOf('data-open-after-write-three=""');
  const openAfterWriteFourAt = html.indexOf('data-open-after-write-four=""');
  const openAfterWriteFiveAt = html.indexOf('data-open-after-write-five=""');
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
  const writeAfterOpenThreeAt = html.indexOf('data-write-after-open-three=""');
  const writeAfterOpenFourAt = html.indexOf('data-write-after-open-four=""');
  const writeAfterOpenFiveAt = html.indexOf('data-write-after-open-five=""');
  const writeAfterOpenSixAt = html.indexOf('data-write-after-open-six=""');
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(openAfterWriteAt > leadStart && openAfterWriteAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < firstClickAt);
  assert.ok(firstClickAt < openAfterWriteAt);
  assert.ok(openAfterWriteAt < firstReadAt);
  assert.ok(firstReadAt < openAfterWriteTwoAt);
  assert.ok(openAfterWriteTwoAt < openAfterWriteThreeAt);
  assert.ok(openAfterWriteThreeAt < openAfterWriteFourAt);
  assert.ok(openAfterWriteFourAt < openAfterWriteFiveAt);
  assert.ok(openAfterWriteFiveAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < writeAfterOpenThreeAt);
  assert.ok(writeAfterOpenThreeAt < writeAfterOpenFourAt);
  assert.ok(writeAfterOpenFourAt < writeAfterOpenFiveAt);
  assert.ok(writeAfterOpenFiveAt < writeAfterOpenSixAt);
  assert.ok(writeAfterOpenSixAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < firstClickAt);
  assert.ok(Math.abs(openAfterWriteAt - firstClickAt) < 160);
  assert.equal(html.includes('data-open-after-write-first=""', hopperStart), false);
  assert.equal(html.includes('data-first-read="open"', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-two=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-three=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-four=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-three=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-four=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-six=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Write this ticket/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not concentrate Open this brief after Write this ticket", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
  assert.doesNotMatch(html, /data-open-after-write-three/);
  assert.doesNotMatch(html, /data-open-after-write-four/);
  assert.doesNotMatch(html, /data-open-after-write-five/);
  assert.doesNotMatch(html, /data-open-brief/);
  assert.doesNotMatch(html, /Open this brief/);
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-open-two/);
  assert.doesNotMatch(html, /data-write-after-open-three/);
  assert.doesNotMatch(html, /data-write-after-open-four/);
  assert.doesNotMatch(html, /data-write-after-open-five/);
  assert.doesNotMatch(html, /data-write-after-open-six/);
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /Write this ticket/);
  assert.doesNotMatch(html, /after the winner rule/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week concentrates writing a new ticket after Open this brief is re-concentrated", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-first-click="open"/);
  assert.match(html, /data-open-brief="lead"/);
  assert.match(html, /data-open-after-write-first=""/);
  assert.match(html, /data-first-read="open"/);
  assert.match(html, /data-open-after-write-two=""/);
  assert.match(html, /data-open-after-write-three=""/);
  assert.match(html, /data-open-after-write-four=""/);
  assert.match(html, /data-open-after-write-five=""/);
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""[^>]*data-write-after-open-three=""[^>]*data-write-after-open-four=""[^>]*data-write-after-open-five=""[^>]*data-write-after-open-six=""[^>]*data-write-later-quiet=""/,
  );
  assert.match(html, /after the winner rule/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /data-write-ticket="buyer"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /\$12/);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-first=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-brief="lead"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/click\/lst_lead"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-six=""/g) ?? []).length, 1);
  assert.equal((html.match(/href="#claim"/g) ?? []).length, 1);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const firstClickAt = html.indexOf('data-first-click="open"');
  const openAfterWriteAt = html.indexOf('data-open-after-write-first=""');
  const firstReadAt = html.indexOf('data-first-read="open"');
  const openAfterWriteTwoAt = html.indexOf('data-open-after-write-two=""');
  const openAfterWriteThreeAt = html.indexOf('data-open-after-write-three=""');
  const openAfterWriteFourAt = html.indexOf('data-open-after-write-four=""');
  const openAfterWriteFiveAt = html.indexOf('data-open-after-write-five=""');
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
  const writeAfterOpenThreeAt = html.indexOf('data-write-after-open-three=""');
  const writeAfterOpenFourAt = html.indexOf('data-write-after-open-four=""');
  const writeAfterOpenFiveAt = html.indexOf('data-write-after-open-five=""');
  const writeAfterOpenSixAt = html.indexOf('data-write-after-open-six=""');
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(writeAfterOpenTwoAt > leadStart && writeAfterOpenTwoAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < firstClickAt);
  assert.ok(firstClickAt < openAfterWriteAt);
  assert.ok(openAfterWriteAt < firstReadAt);
  assert.ok(firstReadAt < openAfterWriteTwoAt);
  assert.ok(openAfterWriteTwoAt < openAfterWriteThreeAt);
  assert.ok(openAfterWriteThreeAt < openAfterWriteFourAt);
  assert.ok(openAfterWriteFourAt < openAfterWriteFiveAt);
  assert.ok(openAfterWriteFiveAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < writeAfterOpenThreeAt);
  assert.ok(writeAfterOpenThreeAt < writeAfterOpenFourAt);
  assert.ok(writeAfterOpenFourAt < writeAfterOpenFiveAt);
  assert.ok(writeAfterOpenFiveAt < writeAfterOpenSixAt);
  assert.ok(writeAfterOpenSixAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < firstClickAt);
  assert.ok(Math.abs(writeAfterOpenTwoAt - writeAfterOpenAt) < 120);
  assert.equal(html.includes('data-open-after-write-first=""', hopperStart), false);
  assert.equal(html.includes('data-first-read="open"', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-two=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-three=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-four=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-three=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-four=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-six=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Write this ticket/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not concentrate Write this ticket after Open this brief is re-concentrated", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-write-after-open-two/);
  assert.doesNotMatch(html, /data-write-after-open-three/);
  assert.doesNotMatch(html, /data-write-after-open-four/);
  assert.doesNotMatch(html, /data-write-after-open-five/);
  assert.doesNotMatch(html, /data-write-after-open-six/);
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
  assert.doesNotMatch(html, /data-open-after-write-three/);
  assert.doesNotMatch(html, /data-open-after-write-four/);
  assert.doesNotMatch(html, /data-open-after-write-five/);
  assert.doesNotMatch(html, /data-open-brief/);
  assert.doesNotMatch(html, /Open this brief/);
  assert.doesNotMatch(html, /Write this ticket/);
  assert.doesNotMatch(html, /after the winner rule/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week concentrates opening the paid #1 brief after Write this ticket is re-concentrated", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-first-click="open"/);
  assert.match(html, /data-open-brief="lead"/);
  assert.match(html, /data-open-after-write-first=""/);
  assert.match(html, /data-first-read="open"/);
  assert.match(html, /data-open-after-write-two=""/);
  assert.match(html, /data-open-after-write-three=""/);
  assert.match(html, /data-open-after-write-four=""/);
  assert.match(html, /data-open-after-write-five=""/);
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""[^>]*data-write-after-open-three=""[^>]*data-write-after-open-four=""[^>]*data-write-after-open-five=""[^>]*data-write-after-open-six=""[^>]*data-write-later-quiet=""/,
  );
  assert.match(html, /after the winner rule/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /data-write-ticket="buyer"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /\$12/);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-first=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-brief="lead"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/click\/lst_lead"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-six=""/g) ?? []).length, 1);
  assert.equal((html.match(/href="#claim"/g) ?? []).length, 1);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const firstClickAt = html.indexOf('data-first-click="open"');
  const openAfterWriteAt = html.indexOf('data-open-after-write-first=""');
  const firstReadAt = html.indexOf('data-first-read="open"');
  const openAfterWriteTwoAt = html.indexOf('data-open-after-write-two=""');
  const openAfterWriteThreeAt = html.indexOf('data-open-after-write-three=""');
  const openAfterWriteFourAt = html.indexOf('data-open-after-write-four=""');
  const openAfterWriteFiveAt = html.indexOf('data-open-after-write-five=""');
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
  const writeAfterOpenThreeAt = html.indexOf('data-write-after-open-three=""');
  const writeAfterOpenFourAt = html.indexOf('data-write-after-open-four=""');
  const writeAfterOpenFiveAt = html.indexOf('data-write-after-open-five=""');
  const writeAfterOpenSixAt = html.indexOf('data-write-after-open-six=""');
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(openAfterWriteTwoAt > leadStart && openAfterWriteTwoAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < firstClickAt);
  assert.ok(firstClickAt < openAfterWriteAt);
  assert.ok(openAfterWriteAt < firstReadAt);
  assert.ok(firstReadAt < openAfterWriteTwoAt);
  assert.ok(openAfterWriteTwoAt < openAfterWriteThreeAt);
  assert.ok(openAfterWriteThreeAt < openAfterWriteFourAt);
  assert.ok(openAfterWriteFourAt < openAfterWriteFiveAt);
  assert.ok(openAfterWriteFiveAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < writeAfterOpenThreeAt);
  assert.ok(writeAfterOpenThreeAt < writeAfterOpenFourAt);
  assert.ok(writeAfterOpenFourAt < writeAfterOpenFiveAt);
  assert.ok(writeAfterOpenFiveAt < writeAfterOpenSixAt);
  assert.ok(writeAfterOpenSixAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < firstClickAt);
  assert.ok(Math.abs(openAfterWriteTwoAt - firstReadAt) < 120);
  assert.equal(html.includes('data-open-after-write-first=""', hopperStart), false);
  assert.equal(html.includes('data-first-read="open"', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-two=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-three=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-four=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-three=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-four=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-six=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Write this ticket/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not concentrate Open this brief after Write this ticket is re-concentrated", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
  assert.doesNotMatch(html, /data-open-after-write-three/);
  assert.doesNotMatch(html, /data-open-after-write-four/);
  assert.doesNotMatch(html, /data-open-after-write-five/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-brief/);
  assert.doesNotMatch(html, /Open this brief/);
  assert.doesNotMatch(html, /data-write-after-open-two/);
  assert.doesNotMatch(html, /data-write-after-open-three/);
  assert.doesNotMatch(html, /data-write-after-open-four/);
  assert.doesNotMatch(html, /data-write-after-open-five/);
  assert.doesNotMatch(html, /data-write-after-open-six/);
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /Write this ticket/);
  assert.doesNotMatch(html, /after the winner rule/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week concentrates writing a new ticket after Open this brief is re-concentrated again", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-first-click="open"/);
  assert.match(html, /data-open-brief="lead"/);
  assert.match(html, /data-open-after-write-first=""/);
  assert.match(html, /data-first-read="open"/);
  assert.match(html, /data-open-after-write-two=""/);
  assert.match(html, /data-open-after-write-three=""/);
  assert.match(html, /data-open-after-write-four=""/);
  assert.match(html, /data-open-after-write-five=""/);
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""[^>]*data-write-after-open-three=""[^>]*data-write-after-open-four=""[^>]*data-write-after-open-five=""[^>]*data-write-after-open-six=""[^>]*data-write-later-quiet=""/,
  );
  assert.match(html, /after the winner rule/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /data-write-ticket="buyer"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /\$12/);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-first=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-brief="lead"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/click\/lst_lead"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-six=""/g) ?? []).length, 1);
  assert.equal((html.match(/href="#claim"/g) ?? []).length, 1);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const firstClickAt = html.indexOf('data-first-click="open"');
  const openAfterWriteAt = html.indexOf('data-open-after-write-first=""');
  const firstReadAt = html.indexOf('data-first-read="open"');
  const openAfterWriteTwoAt = html.indexOf('data-open-after-write-two=""');
  const openAfterWriteThreeAt = html.indexOf('data-open-after-write-three=""');
  const openAfterWriteFourAt = html.indexOf('data-open-after-write-four=""');
  const openAfterWriteFiveAt = html.indexOf('data-open-after-write-five=""');
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
  const writeAfterOpenThreeAt = html.indexOf('data-write-after-open-three=""');
  const writeAfterOpenFourAt = html.indexOf('data-write-after-open-four=""');
  const writeAfterOpenFiveAt = html.indexOf('data-write-after-open-five=""');
  const writeAfterOpenSixAt = html.indexOf('data-write-after-open-six=""');
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(writeAfterOpenThreeAt > leadStart && writeAfterOpenThreeAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < firstClickAt);
  assert.ok(firstClickAt < openAfterWriteAt);
  assert.ok(openAfterWriteAt < firstReadAt);
  assert.ok(firstReadAt < openAfterWriteTwoAt);
  assert.ok(openAfterWriteTwoAt < openAfterWriteThreeAt);
  assert.ok(openAfterWriteThreeAt < openAfterWriteFourAt);
  assert.ok(openAfterWriteFourAt < openAfterWriteFiveAt);
  assert.ok(openAfterWriteFiveAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < writeAfterOpenThreeAt);
  assert.ok(writeAfterOpenThreeAt < writeAfterOpenFourAt);
  assert.ok(writeAfterOpenFourAt < writeAfterOpenFiveAt);
  assert.ok(writeAfterOpenFiveAt < writeAfterOpenSixAt);
  assert.ok(writeAfterOpenSixAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < firstClickAt);
  assert.ok(Math.abs(writeAfterOpenThreeAt - writeAfterOpenTwoAt) < 120);
  assert.equal(html.includes('data-open-after-write-first=""', hopperStart), false);
  assert.equal(html.includes('data-first-read="open"', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-two=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-three=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-four=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-three=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-four=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-six=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Write this ticket/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not concentrate Write this ticket after Open this brief is re-concentrated again", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-write-after-open-three/);
  assert.doesNotMatch(html, /data-write-after-open-four/);
  assert.doesNotMatch(html, /data-write-after-open-five/);
  assert.doesNotMatch(html, /data-write-after-open-six/);
  assert.doesNotMatch(html, /data-write-after-open-two/);
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
  assert.doesNotMatch(html, /data-open-after-write-three/);
  assert.doesNotMatch(html, /data-open-after-write-four/);
  assert.doesNotMatch(html, /data-open-after-write-five/);
  assert.doesNotMatch(html, /data-open-brief/);
  assert.doesNotMatch(html, /Open this brief/);
  assert.doesNotMatch(html, /Write this ticket/);
  assert.doesNotMatch(html, /after the winner rule/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week concentrates opening the paid #1 brief after Write this ticket is re-concentrated again", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-first-click="open"/);
  assert.match(html, /data-open-brief="lead"/);
  assert.match(html, /data-open-after-write-first=""/);
  assert.match(html, /data-first-read="open"/);
  assert.match(html, /data-open-after-write-two=""/);
  assert.match(html, /data-open-after-write-three=""/);
  assert.match(html, /data-open-after-write-four=""/);
  assert.match(html, /data-open-after-write-five=""/);
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""[^>]*data-write-after-open-three=""[^>]*data-write-after-open-four=""[^>]*data-write-after-open-five=""[^>]*data-write-after-open-six=""[^>]*data-write-later-quiet=""/,
  );
  assert.match(html, /after the winner rule/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /data-write-ticket="buyer"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /\$12/);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-first=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-brief="lead"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/click\/lst_lead"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-six=""/g) ?? []).length, 1);
  assert.equal((html.match(/href="#claim"/g) ?? []).length, 1);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const firstClickAt = html.indexOf('data-first-click="open"');
  const openAfterWriteAt = html.indexOf('data-open-after-write-first=""');
  const firstReadAt = html.indexOf('data-first-read="open"');
  const openAfterWriteTwoAt = html.indexOf('data-open-after-write-two=""');
  const openAfterWriteThreeAt = html.indexOf('data-open-after-write-three=""');
  const openAfterWriteFourAt = html.indexOf('data-open-after-write-four=""');
  const openAfterWriteFiveAt = html.indexOf('data-open-after-write-five=""');
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
  const writeAfterOpenThreeAt = html.indexOf('data-write-after-open-three=""');
  const writeAfterOpenFourAt = html.indexOf('data-write-after-open-four=""');
  const writeAfterOpenFiveAt = html.indexOf('data-write-after-open-five=""');
  const writeAfterOpenSixAt = html.indexOf('data-write-after-open-six=""');
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(openAfterWriteThreeAt > leadStart && openAfterWriteThreeAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < firstClickAt);
  assert.ok(firstClickAt < openAfterWriteAt);
  assert.ok(openAfterWriteAt < firstReadAt);
  assert.ok(firstReadAt < openAfterWriteTwoAt);
  assert.ok(openAfterWriteTwoAt < openAfterWriteThreeAt);
  assert.ok(openAfterWriteThreeAt < openAfterWriteFourAt);
  assert.ok(openAfterWriteFourAt < openAfterWriteFiveAt);
  assert.ok(openAfterWriteFiveAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < writeAfterOpenThreeAt);
  assert.ok(writeAfterOpenThreeAt < writeAfterOpenFourAt);
  assert.ok(writeAfterOpenFourAt < writeAfterOpenFiveAt);
  assert.ok(writeAfterOpenFiveAt < writeAfterOpenSixAt);
  assert.ok(writeAfterOpenSixAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < firstClickAt);
  assert.ok(Math.abs(openAfterWriteThreeAt - openAfterWriteTwoAt) < 120);
  assert.equal(html.includes('data-open-after-write-first=""', hopperStart), false);
  assert.equal(html.includes('data-first-read="open"', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-two=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-three=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-four=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-three=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-four=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-six=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Write this ticket/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not concentrate Open this brief after Write this ticket is re-concentrated again", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-open-after-write-three/);
  assert.doesNotMatch(html, /data-open-after-write-four/);
  assert.doesNotMatch(html, /data-open-after-write-five/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-brief/);
  assert.doesNotMatch(html, /Open this brief/);
  assert.doesNotMatch(html, /data-write-after-open-three/);
  assert.doesNotMatch(html, /data-write-after-open-four/);
  assert.doesNotMatch(html, /data-write-after-open-five/);
  assert.doesNotMatch(html, /data-write-after-open-six/);
  assert.doesNotMatch(html, /data-write-after-open-two/);
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /Write this ticket/);
  assert.doesNotMatch(html, /after the winner rule/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week concentrates writing a new ticket after Open this brief is re-concentrated a fourth time", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-first-click="open"/);
  assert.match(html, /data-open-brief="lead"/);
  assert.match(html, /data-open-after-write-first=""/);
  assert.match(html, /data-first-read="open"/);
  assert.match(html, /data-open-after-write-two=""/);
  assert.match(html, /data-open-after-write-three=""/);
  assert.match(html, /data-open-after-write-four=""/);
  assert.match(html, /data-open-after-write-five=""/);
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""[^>]*data-write-after-open-three=""[^>]*data-write-after-open-four=""[^>]*data-write-after-open-five=""[^>]*data-write-after-open-six=""[^>]*data-write-later-quiet=""/,
  );
  assert.match(html, /after the winner rule/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /data-write-ticket="buyer"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /\$12/);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-first=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-brief="lead"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/click\/lst_lead"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-six=""/g) ?? []).length, 1);
  assert.equal((html.match(/href="#claim"/g) ?? []).length, 1);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const firstClickAt = html.indexOf('data-first-click="open"');
  const openAfterWriteAt = html.indexOf('data-open-after-write-first=""');
  const firstReadAt = html.indexOf('data-first-read="open"');
  const openAfterWriteTwoAt = html.indexOf('data-open-after-write-two=""');
  const openAfterWriteThreeAt = html.indexOf('data-open-after-write-three=""');
  const openAfterWriteFourAt = html.indexOf('data-open-after-write-four=""');
  const openAfterWriteFiveAt = html.indexOf('data-open-after-write-five=""');
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
  const writeAfterOpenThreeAt = html.indexOf('data-write-after-open-three=""');
  const writeAfterOpenFourAt = html.indexOf('data-write-after-open-four=""');
  const writeAfterOpenFiveAt = html.indexOf('data-write-after-open-five=""');
  const writeAfterOpenSixAt = html.indexOf('data-write-after-open-six=""');
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(writeAfterOpenFourAt > leadStart && writeAfterOpenFourAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < firstClickAt);
  assert.ok(firstClickAt < openAfterWriteAt);
  assert.ok(openAfterWriteAt < firstReadAt);
  assert.ok(firstReadAt < openAfterWriteTwoAt);
  assert.ok(openAfterWriteTwoAt < openAfterWriteThreeAt);
  assert.ok(openAfterWriteThreeAt < openAfterWriteFourAt);
  assert.ok(openAfterWriteFourAt < openAfterWriteFiveAt);
  assert.ok(openAfterWriteFiveAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < writeAfterOpenThreeAt);
  assert.ok(writeAfterOpenThreeAt < writeAfterOpenFourAt);
  assert.ok(writeAfterOpenFourAt < writeAfterOpenFiveAt);
  assert.ok(writeAfterOpenFiveAt < writeAfterOpenSixAt);
  assert.ok(writeAfterOpenSixAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < firstClickAt);
  assert.ok(Math.abs(writeAfterOpenFourAt - writeAfterOpenThreeAt) < 120);
  assert.equal(html.includes('data-open-after-write-first=""', hopperStart), false);
  assert.equal(html.includes('data-first-read="open"', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-two=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-three=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-four=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-three=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-four=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-six=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Write this ticket/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not concentrate Write this ticket after Open this brief is re-concentrated a fourth time", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-write-after-open-four/);
  assert.doesNotMatch(html, /data-write-after-open-five/);
  assert.doesNotMatch(html, /data-write-after-open-six/);
  assert.doesNotMatch(html, /data-write-after-open-three/);
  assert.doesNotMatch(html, /data-write-after-open-two/);
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
  assert.doesNotMatch(html, /data-open-after-write-three/);
  assert.doesNotMatch(html, /data-open-after-write-four/);
  assert.doesNotMatch(html, /data-open-after-write-five/);
  assert.doesNotMatch(html, /data-open-brief/);
  assert.doesNotMatch(html, /Open this brief/);
  assert.doesNotMatch(html, /Write this ticket/);
  assert.doesNotMatch(html, /after the winner rule/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week concentrates opening the paid #1 brief after Write this ticket is re-concentrated a fourth time", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-first-click="open"/);
  assert.match(html, /data-open-brief="lead"/);
  assert.match(html, /data-open-after-write-first=""/);
  assert.match(html, /data-first-read="open"/);
  assert.match(html, /data-open-after-write-two=""/);
  assert.match(html, /data-open-after-write-three=""/);
  assert.match(html, /data-open-after-write-four=""/);
  assert.match(html, /data-open-after-write-five=""/);
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""[^>]*data-write-after-open-three=""[^>]*data-write-after-open-four=""[^>]*data-write-after-open-five=""[^>]*data-write-after-open-six=""[^>]*data-write-later-quiet=""/,
  );
  assert.match(html, /after the winner rule/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /data-write-ticket="buyer"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /\$12/);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-first=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-brief="lead"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/click\/lst_lead"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-six=""/g) ?? []).length, 1);
  assert.equal((html.match(/href="#claim"/g) ?? []).length, 1);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const firstClickAt = html.indexOf('data-first-click="open"');
  const openAfterWriteAt = html.indexOf('data-open-after-write-first=""');
  const firstReadAt = html.indexOf('data-first-read="open"');
  const openAfterWriteTwoAt = html.indexOf('data-open-after-write-two=""');
  const openAfterWriteThreeAt = html.indexOf('data-open-after-write-three=""');
  const openAfterWriteFourAt = html.indexOf('data-open-after-write-four=""');
  const openAfterWriteFiveAt = html.indexOf('data-open-after-write-five=""');
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
  const writeAfterOpenThreeAt = html.indexOf('data-write-after-open-three=""');
  const writeAfterOpenFourAt = html.indexOf('data-write-after-open-four=""');
  const writeAfterOpenFiveAt = html.indexOf('data-write-after-open-five=""');
  const writeAfterOpenSixAt = html.indexOf('data-write-after-open-six=""');
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(openAfterWriteFourAt > leadStart && openAfterWriteFourAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < firstClickAt);
  assert.ok(firstClickAt < openAfterWriteAt);
  assert.ok(openAfterWriteAt < firstReadAt);
  assert.ok(firstReadAt < openAfterWriteTwoAt);
  assert.ok(openAfterWriteTwoAt < openAfterWriteThreeAt);
  assert.ok(openAfterWriteThreeAt < openAfterWriteFourAt);
  assert.ok(openAfterWriteFourAt < openAfterWriteFiveAt);
  assert.ok(openAfterWriteFiveAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < writeAfterOpenThreeAt);
  assert.ok(writeAfterOpenThreeAt < writeAfterOpenFourAt);
  assert.ok(writeAfterOpenFourAt < writeAfterOpenFiveAt);
  assert.ok(writeAfterOpenFiveAt < writeAfterOpenSixAt);
  assert.ok(writeAfterOpenSixAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < firstClickAt);
  assert.ok(Math.abs(openAfterWriteFourAt - openAfterWriteThreeAt) < 120);
  assert.equal(html.includes('data-open-after-write-first=""', hopperStart), false);
  assert.equal(html.includes('data-first-read="open"', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-two=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-three=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-four=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-three=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-four=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-six=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Write this ticket/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not concentrate Open this brief after Write this ticket is re-concentrated a fourth time", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-open-after-write-four/);
  assert.doesNotMatch(html, /data-open-after-write-five/);
  assert.doesNotMatch(html, /data-open-after-write-three/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-brief/);
  assert.doesNotMatch(html, /Open this brief/);
  assert.doesNotMatch(html, /data-write-after-open-four/);
  assert.doesNotMatch(html, /data-write-after-open-five/);
  assert.doesNotMatch(html, /data-write-after-open-six/);
  assert.doesNotMatch(html, /data-write-after-open-three/);
  assert.doesNotMatch(html, /data-write-after-open-two/);
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /Write this ticket/);
  assert.doesNotMatch(html, /after the winner rule/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week concentrates writing a new ticket after Open this brief is re-concentrated a fifth time", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-first-click="open"/);
  assert.match(html, /data-open-brief="lead"/);
  assert.match(html, /data-open-after-write-first=""/);
  assert.match(html, /data-first-read="open"/);
  assert.match(html, /data-open-after-write-two=""/);
  assert.match(html, /data-open-after-write-three=""/);
  assert.match(html, /data-open-after-write-four=""/);
  assert.match(html, /data-open-after-write-five=""/);
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""[^>]*data-write-after-open-three=""[^>]*data-write-after-open-four=""[^>]*data-write-after-open-five=""[^>]*data-write-after-open-six=""[^>]*data-write-later-quiet=""/,
  );
  assert.match(html, /after the winner rule/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /data-write-ticket="buyer"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /\$12/);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-first=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-brief="lead"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/click\/lst_lead"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-six=""/g) ?? []).length, 1);
  assert.equal((html.match(/href="#claim"/g) ?? []).length, 1);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const firstClickAt = html.indexOf('data-first-click="open"');
  const openAfterWriteAt = html.indexOf('data-open-after-write-first=""');
  const firstReadAt = html.indexOf('data-first-read="open"');
  const openAfterWriteTwoAt = html.indexOf('data-open-after-write-two=""');
  const openAfterWriteThreeAt = html.indexOf('data-open-after-write-three=""');
  const openAfterWriteFourAt = html.indexOf('data-open-after-write-four=""');
  const openAfterWriteFiveAt = html.indexOf('data-open-after-write-five=""');
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
  const writeAfterOpenThreeAt = html.indexOf('data-write-after-open-three=""');
  const writeAfterOpenFourAt = html.indexOf('data-write-after-open-four=""');
  const writeAfterOpenFiveAt = html.indexOf('data-write-after-open-five=""');
  const writeAfterOpenSixAt = html.indexOf('data-write-after-open-six=""');
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(writeAfterOpenFiveAt > leadStart && writeAfterOpenFiveAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < firstClickAt);
  assert.ok(firstClickAt < openAfterWriteAt);
  assert.ok(openAfterWriteAt < firstReadAt);
  assert.ok(firstReadAt < openAfterWriteTwoAt);
  assert.ok(openAfterWriteTwoAt < openAfterWriteThreeAt);
  assert.ok(openAfterWriteThreeAt < openAfterWriteFourAt);
  assert.ok(openAfterWriteFourAt < openAfterWriteFiveAt);
  assert.ok(openAfterWriteFiveAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < writeAfterOpenThreeAt);
  assert.ok(writeAfterOpenThreeAt < writeAfterOpenFourAt);
  assert.ok(writeAfterOpenFourAt < writeAfterOpenFiveAt);
  assert.ok(writeAfterOpenFiveAt < writeAfterOpenSixAt);
  assert.ok(writeAfterOpenSixAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < firstClickAt);
  assert.ok(Math.abs(writeAfterOpenFiveAt - writeAfterOpenFourAt) < 120);
  assert.equal(html.includes('data-open-after-write-first=""', hopperStart), false);
  assert.equal(html.includes('data-first-read="open"', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-two=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-three=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-four=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-three=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-four=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-six=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Write this ticket/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not concentrate Write this ticket after Open this brief is re-concentrated a fifth time", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-write-after-open-five/);
  assert.doesNotMatch(html, /data-write-after-open-six/);
  assert.doesNotMatch(html, /data-write-after-open-four/);
  assert.doesNotMatch(html, /data-write-after-open-three/);
  assert.doesNotMatch(html, /data-write-after-open-two/);
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
  assert.doesNotMatch(html, /data-open-after-write-three/);
  assert.doesNotMatch(html, /data-open-after-write-four/);
  assert.doesNotMatch(html, /data-open-after-write-five/);
  assert.doesNotMatch(html, /data-open-brief/);
  assert.doesNotMatch(html, /Open this brief/);
  assert.doesNotMatch(html, /Write this ticket/);
  assert.doesNotMatch(html, /after the winner rule/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week concentrates opening the paid #1 brief after Write this ticket is re-concentrated a fifth time", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-first-click="open"/);
  assert.match(html, /data-open-brief="lead"/);
  assert.match(html, /data-open-after-write-first=""/);
  assert.match(html, /data-first-read="open"/);
  assert.match(html, /data-open-after-write-two=""/);
  assert.match(html, /data-open-after-write-three=""/);
  assert.match(html, /data-open-after-write-four=""/);
  assert.match(html, /data-open-after-write-five=""/);
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""[^>]*data-write-after-open-three=""[^>]*data-write-after-open-four=""[^>]*data-write-after-open-five=""[^>]*data-write-after-open-six=""[^>]*data-write-later-quiet=""/,
  );
  assert.match(html, /after the winner rule/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /data-write-ticket="buyer"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /\$12/);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-first=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-brief="lead"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/click\/lst_lead"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-six=""/g) ?? []).length, 1);
  assert.equal((html.match(/href="#claim"/g) ?? []).length, 1);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const firstClickAt = html.indexOf('data-first-click="open"');
  const openAfterWriteAt = html.indexOf('data-open-after-write-first=""');
  const firstReadAt = html.indexOf('data-first-read="open"');
  const openAfterWriteTwoAt = html.indexOf('data-open-after-write-two=""');
  const openAfterWriteThreeAt = html.indexOf('data-open-after-write-three=""');
  const openAfterWriteFourAt = html.indexOf('data-open-after-write-four=""');
  const openAfterWriteFiveAt = html.indexOf('data-open-after-write-five=""');
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
  const writeAfterOpenThreeAt = html.indexOf('data-write-after-open-three=""');
  const writeAfterOpenFourAt = html.indexOf('data-write-after-open-four=""');
  const writeAfterOpenFiveAt = html.indexOf('data-write-after-open-five=""');
  const writeAfterOpenSixAt = html.indexOf('data-write-after-open-six=""');
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(openAfterWriteFiveAt > leadStart && openAfterWriteFiveAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < firstClickAt);
  assert.ok(firstClickAt < openAfterWriteAt);
  assert.ok(openAfterWriteAt < firstReadAt);
  assert.ok(firstReadAt < openAfterWriteTwoAt);
  assert.ok(openAfterWriteTwoAt < openAfterWriteThreeAt);
  assert.ok(openAfterWriteThreeAt < openAfterWriteFourAt);
  assert.ok(openAfterWriteFourAt < openAfterWriteFiveAt);
  assert.ok(openAfterWriteFiveAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < writeAfterOpenThreeAt);
  assert.ok(writeAfterOpenThreeAt < writeAfterOpenFourAt);
  assert.ok(writeAfterOpenFourAt < writeAfterOpenFiveAt);
  assert.ok(writeAfterOpenFiveAt < writeAfterOpenSixAt);
  assert.ok(writeAfterOpenSixAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < firstClickAt);
  assert.ok(Math.abs(openAfterWriteFiveAt - openAfterWriteFourAt) < 120);
  assert.equal(html.includes('data-open-after-write-first=""', hopperStart), false);
  assert.equal(html.includes('data-first-read="open"', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-two=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-three=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-four=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-three=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-four=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-six=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Write this ticket/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not concentrate Open this brief after Write this ticket is re-concentrated a fifth time", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-open-after-write-five/);
  assert.doesNotMatch(html, /data-open-after-write-four/);
  assert.doesNotMatch(html, /data-open-after-write-three/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-brief/);
  assert.doesNotMatch(html, /Open this brief/);
  assert.doesNotMatch(html, /data-write-after-open-five/);
  assert.doesNotMatch(html, /data-write-after-open-six/);
  assert.doesNotMatch(html, /data-write-after-open-four/);
  assert.doesNotMatch(html, /data-write-after-open-three/);
  assert.doesNotMatch(html, /data-write-after-open-two/);
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /Write this ticket/);
  assert.doesNotMatch(html, /after the winner rule/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied week concentrates writing a new ticket after Open this brief is re-concentrated a sixth time", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(html, /data-desk-surface="occupied"/);
  assert.match(html, /data-first-click="open"/);
  assert.match(html, /data-open-brief="lead"/);
  assert.match(html, /data-open-after-write-first=""/);
  assert.match(html, /data-first-read="open"/);
  assert.match(html, /data-open-after-write-two=""/);
  assert.match(html, /data-open-after-write-three=""/);
  assert.match(html, /data-open-after-write-four=""/);
  assert.match(html, /data-open-after-write-five=""/);
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""[^>]*data-write-after-open-three=""[^>]*data-write-after-open-four=""[^>]*data-write-after-open-five=""[^>]*data-write-after-open-six=""[^>]*data-write-later-quiet=""/,
  );
  assert.match(html, /after the winner rule/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /data-write-ticket="buyer"/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Outbid</);
  assert.match(html, /Winner rule, not a score/);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /Project budget, not the bid/);
  assert.match(html, /Due date, not a score/);
  assert.match(html, /\$12/);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-first=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-after-write-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-open-brief="lead"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/click\/lst_lead"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-three=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-four=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-five=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-six=""/g) ?? []).length, 1);
  assert.equal((html.match(/href="#claim"/g) ?? []).length, 1);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const winnerAt = html.indexOf('data-read-winner="lead"');
  const firstClickAt = html.indexOf('data-first-click="open"');
  const openAfterWriteAt = html.indexOf('data-open-after-write-first=""');
  const firstReadAt = html.indexOf('data-first-read="open"');
  const openAfterWriteTwoAt = html.indexOf('data-open-after-write-two=""');
  const openAfterWriteThreeAt = html.indexOf('data-open-after-write-three=""');
  const openAfterWriteFourAt = html.indexOf('data-open-after-write-four=""');
  const openAfterWriteFiveAt = html.indexOf('data-open-after-write-five=""');
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
  const writeAfterOpenThreeAt = html.indexOf('data-write-after-open-three=""');
  const writeAfterOpenFourAt = html.indexOf('data-write-after-open-four=""');
  const writeAfterOpenFiveAt = html.indexOf('data-write-after-open-five=""');
  const writeAfterOpenSixAt = html.indexOf('data-write-after-open-six=""');
  const writeStampAt = html.indexOf("data-write-ticket-stamp");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(writeAfterOpenSixAt > leadStart && writeAfterOpenSixAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < firstClickAt);
  assert.ok(firstClickAt < openAfterWriteAt);
  assert.ok(openAfterWriteAt < firstReadAt);
  assert.ok(firstReadAt < openAfterWriteTwoAt);
  assert.ok(openAfterWriteTwoAt < openAfterWriteThreeAt);
  assert.ok(openAfterWriteThreeAt < openAfterWriteFourAt);
  assert.ok(openAfterWriteFourAt < openAfterWriteFiveAt);
  assert.ok(openAfterWriteFiveAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < writeAfterOpenThreeAt);
  assert.ok(writeAfterOpenThreeAt < writeAfterOpenFourAt);
  assert.ok(writeAfterOpenFourAt < writeAfterOpenFiveAt);
  assert.ok(writeAfterOpenFiveAt < writeAfterOpenSixAt);
  assert.ok(writeAfterOpenSixAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > winnerAt && bidStub < firstClickAt);
  assert.ok(Math.abs(writeAfterOpenSixAt - writeAfterOpenFiveAt) < 120);
  assert.equal(html.includes('data-open-after-write-first=""', hopperStart), false);
  assert.equal(html.includes('data-first-read="open"', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-two=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-three=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-four=""', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-three=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-four=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-five=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-six=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart, claimAt), /Write this ticket/);
  assert.match(html.slice(hopperStart, claimAt), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week does not concentrate Write this ticket after Open this brief is re-concentrated a sixth time", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /data-empty-week="true"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /no sample gig/i);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /data-write-after-open-six/);
  assert.doesNotMatch(html, /data-write-after-open-five/);
  assert.doesNotMatch(html, /data-write-after-open-four/);
  assert.doesNotMatch(html, /data-write-after-open-three/);
  assert.doesNotMatch(html, /data-write-after-open-two/);
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
  assert.doesNotMatch(html, /data-open-after-write-three/);
  assert.doesNotMatch(html, /data-open-after-write-four/);
  assert.doesNotMatch(html, /data-open-after-write-five/);
  assert.doesNotMatch(html, /data-open-brief/);
  assert.doesNotMatch(html, /Open this brief/);
  assert.doesNotMatch(html, /Write this ticket/);
  assert.doesNotMatch(html, /after the winner rule/);
  const stampAt = html.indexOf("No paid brief");
  const claimAt = html.indexOf('id="claim"');
  assert.ok(stampAt >= 0 && claimAt > stampAt);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("empty week stays Claim #1 + No paid brief without prize / Write / Open", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
      ]),
    }),
  );

  const boardStamp = empty.indexOf('data-empty-ticket=""');
  const claimStamp = empty.indexOf('data-empty-ticket=""', boardStamp + 1);
  const claimAt = empty.indexOf('id="claim"');
  const paidStamp = empty.indexOf("No paid brief");
  const claimCopy = empty.indexOf("Claim #1 for");
  assert.ok(boardStamp >= 0 && claimStamp > boardStamp);
  assert.ok(paidStamp > boardStamp && paidStamp < claimAt);
  assert.ok(claimAt <= claimStamp);
  assert.ok(claimCopy > claimAt);
  assert.equal((empty.match(/data-empty-ticket=""/g) ?? []).length, 2);
  assert.match(empty, /data-desk-surface="empty"/);
  assert.match(empty, /data-empty-week="true"/);
  assert.match(empty, /No paid brief/);
  assert.match(empty, /no sample gig/i);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, />Outbid</);
  assert.match(empty, /Rank is the bid, not the project/);
  assert.doesNotMatch(empty, /data-listing-card/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /data-prize-before-price/);
  assert.doesNotMatch(empty, /prize-before-price/);
  assert.doesNotMatch(empty, /data-rank-is-bid/);
  assert.doesNotMatch(empty, /data-rank-bid/);
  assert.doesNotMatch(empty, /data-budget-later/);
  assert.doesNotMatch(empty, /ticket-featured/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-write-ticket="buyer"/);
  assert.doesNotMatch(empty, /data-write-after-rule/);
  assert.doesNotMatch(empty, /data-write-after-open/);
  assert.doesNotMatch(empty, /data-open-after-write-first/);
  assert.doesNotMatch(empty, /data-write-after-open-seven/);
  assert.doesNotMatch(empty, /data-open-after-write-six/);
  assert.doesNotMatch(empty, /data-write-later-quiet/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);

  assert.doesNotMatch(occupied, /data-empty-ticket/);
  assert.doesNotMatch(occupied, /data-empty-week/);
  assert.match(occupied, /data-prize-before-price=""/);
  assert.match(occupied, /data-prize=""/);
  assert.match(occupied, /data-rank-is-bid=""/);
  assert.match(occupied, /data-rank-bid=""/);
  assert.match(occupied, /data-budget-later=""/);
  assert.match(occupied, /Open this brief/);
  assert.match(occupied, /Write this ticket/);
  assert.match(occupied, /data-write-later-quiet=""/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, /\$12/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);

  assert.match(boardSource, /data-empty-ticket=\{empty \? "" : undefined\}/);
  assert.match(formSource, /data-empty-ticket=\{occupied \? undefined : ""\}/);
  assert.match(cssSource, /\.board\[data-empty-ticket\] \.ticket-featured/);
  assert.match(cssSource, /\.board\[data-empty-ticket\] \.prize-before-price/);
  assert.match(cssSource, /\.board\[data-empty-ticket\] \.open-this-brief/);
  assert.match(cssSource, /\.board\[data-empty-ticket\] p\.write-this-ticket/);
  assert.match(cssSource, /\.board\[data-empty-ticket\] \.write-after-rule/);
  assert.match(cssSource, /\.board\[data-empty-ticket\] \[data-prize\]/);
  assert.match(
    cssSource,
    /\.board\[data-empty-ticket\] \[data-prize-before-price\]/,
  );
  assert.match(cssSource, /\.board\[data-empty-ticket\] \[data-rank-is-bid\]/);
  assert.match(cssSource, /\.board\[data-empty-ticket\] \[data-rank-bid\]/);
  assert.match(cssSource, /\.board\[data-empty-ticket\] \[data-budget-later\]/);
  assert.match(cssSource, /\.board\[data-empty-ticket\] \[data-open-brief\]/);
  assert.match(
    cssSource,
    /\.board\[data-empty-ticket\] \[data-write-after-rule\]/,
  );
  assert.match(
    cssSource,
    /\.board\[data-empty-ticket\] \[data-first-click="open"\]/,
  );
  assert.match(
    cssSource,
    /\.board\[data-empty-ticket\] \[data-write-later-quiet\]/,
  );
  const emptyRule =
    cssSource.match(/\.board\[data-empty-ticket\][\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(emptyRule, /display:\s*none/);
  assert.doesNotMatch(emptyRule, /background:/);
  assert.doesNotMatch(emptyRule, /data-write-after-open-seven/);
  assert.doesNotMatch(emptyRule, /data-open-after-write-six/);
});

test("occupied #1 winner rule is the prize before $bid + clicks", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const prizeSize = css.match(
    /\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const bidSize = css.match(
    /\.ticket-featured\[data-prize-before-price\] \.ticket-bid-later \.bid\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const clickSize = css.match(
    /\.ticket-featured\[data-prize-before-price\] \.ticket-bid-later \.clicks\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(prizeSize);
  assert.ok(bidSize);
  assert.ok(clickSize);
  assert.ok(Number(prizeSize[1]) > Number(bidSize[1]));
  assert.ok(Number(prizeSize[1]) > Number(clickSize[1]));

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /data-prize-before-price/);
  assert.doesNotMatch(empty, /prize-before-price/);
  assert.doesNotMatch(empty, /ticket-bid-later/);
  assert.doesNotMatch(empty, /data-listing-card/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
          clicks: 4,
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
          clicks: 2,
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-listing-id="lst_lead"');
  const hopperStart = occupied.indexOf('data-listing-id="lst_hopper"');
  const lead = occupied.slice(leadStart, hopperStart);
  const hopper = occupied.slice(hopperStart, occupied.indexOf('id="claim"'));
  const prize = lead.indexOf('data-prize=""');
  const prizeStamp = lead.indexOf('data-prize-before-price=""');
  const winnerText = lead.indexOf("Best portfolio by Friday");
  const bid = lead.indexOf('data-bid="">$12<');
  const clicks = lead.indexOf("4 clicks");
  const openLead = lead.indexOf("Open this brief");
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(prizeStamp >= 0 && prize > prizeStamp);
  assert.ok(winnerText > prize);
  assert.ok(bid > winnerText && clicks > bid);
  assert.ok(openLead > clicks);
  assert.match(lead, /class="ticket-rule ticket-read-winner prize-before-price"/);
  assert.match(lead, /data-prize=""/);
  assert.match(lead, /data-prize-before-price=""/);
  assert.match(lead, /ticket-bid-later/);
  assert.match(lead, /\$12/);
  assert.match(lead, /4 clicks/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, />Outbid</);
  assert.doesNotMatch(hopper, /data-prize=/);
  assert.doesNotMatch(hopper, /data-prize-before-price/);
  assert.doesNotMatch(hopper, /prize-before-price/);
  assert.doesNotMatch(hopper, /ticket-bid-later/);
  assert.match(hopper, /\$6/);
  assert.match(hopper, /2 clicks/);
  assert.equal((occupied.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-prize-before-price=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
});

test("occupied #1 rank is the bid; project budget stays a later fact", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const prizeSize = css.match(
    /\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const rankSize = css.match(
    /\.ticket-featured\[data-rank-is-bid\] \.ticket-bid-later \.rank-is-bid\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const budgetSize = css.match(
    /\.ticket-featured\[data-rank-is-bid\] \[data-budget-later\] \.budget-amount\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(prizeSize);
  assert.ok(rankSize);
  assert.ok(budgetSize);
  assert.ok(Number(prizeSize[1]) > Number(rankSize[1]));
  assert.ok(Number(rankSize[1]) > Number(budgetSize[1]));

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.doesNotMatch(empty, /data-rank-is-bid/);
  assert.doesNotMatch(empty, /data-rank-bid/);
  assert.doesNotMatch(empty, /data-budget-later/);
  assert.doesNotMatch(empty, /data-listing-card/);
  assert.doesNotMatch(empty, /data-write-after-open-seven/);
  assert.doesNotMatch(empty, /data-open-after-write-six/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
          clicks: 4,
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
          clicks: 2,
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-listing-id="lst_lead"');
  const hopperStart = occupied.indexOf('data-listing-id="lst_hopper"');
  const lead = occupied.slice(leadStart, hopperStart);
  const hopper = occupied.slice(hopperStart, occupied.indexOf('id="claim"'));
  const rankStamp = lead.indexOf('data-rank-is-bid=""');
  const prize = lead.indexOf('data-prize=""');
  const winnerText = lead.indexOf("Best portfolio by Friday");
  const budgetLater = lead.indexOf('data-budget-later=""');
  const budgetCopy = lead.indexOf("Project budget, not the bid");
  const rankBid = lead.indexOf('data-rank-bid=""');
  const laterBid = lead.indexOf('data-bid="">$12<');
  const openLead = lead.indexOf("Open this brief");
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(rankStamp >= 0 && prize > rankStamp);
  assert.ok(budgetLater > rankStamp && budgetLater < prize);
  assert.ok(budgetCopy > budgetLater && budgetCopy < prize);
  assert.ok(winnerText > prize);
  assert.ok(rankBid > winnerText);
  assert.ok(laterBid > winnerText);
  assert.ok(Math.abs(laterBid - rankBid) < 80);
  assert.ok(openLead > laterBid && openLead > rankBid);
  assert.match(lead, /data-rank-is-bid=""/);
  assert.match(lead, /data-rank-bid=""/);
  assert.match(lead, /data-budget-later=""/);
  assert.match(lead, /Project budget, not the bid/);
  assert.match(lead, /\$12/);
  assert.match(lead, /\$3,200/);
  assert.match(lead, /4 clicks/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, />Outbid</);
  assert.match(occupied, /Rank is the bid, not the project/);
  assert.doesNotMatch(hopper, /data-rank-is-bid/);
  assert.doesNotMatch(hopper, /data-rank-bid/);
  assert.doesNotMatch(hopper, /data-budget-later/);
  assert.doesNotMatch(hopper, /Project budget, not the bid/);
  assert.match(hopper, /Budget \$800/);
  assert.match(hopper, /\$6/);
  assert.equal((occupied.match(/data-rank-is-bid=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-rank-bid=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-budget-later=""/g) ?? []).length, 1);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
});

test("occupied Open this brief stays the first freelancer click; Write this ticket recedes", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const openSize = css.match(
    /\.ticket-featured \.open-this-brief\[data-open-after-write-five\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const writeSize = css.match(
    /\.ticket-featured a\.write-after-rule\[data-write-later-quiet\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const bidSize = css.match(
    /\.ticket-featured\[data-rank-is-bid\] \.ticket-bid-later \.rank-is-bid\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const budgetSize = css.match(
    /\.ticket-featured\[data-rank-is-bid\] \[data-budget-later\] \.budget-amount\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const prizeSize = css.match(
    /\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(openSize);
  assert.ok(writeSize);
  assert.ok(bidSize);
  assert.ok(budgetSize);
  assert.ok(prizeSize);
  assert.ok(Number(openSize[1]) > Number(writeSize[1]));
  assert.ok(Number(openSize[1]) > Number(bidSize[1]));
  assert.ok(Number(openSize[1]) > Number(budgetSize[1]));
  assert.ok(Number(prizeSize[1]) > Number(bidSize[1]));
  assert.match(
    css,
    /\.ticket-featured a\.write-after-rule\[data-write-later-quiet\]\s*\{[^}]*color:\s*var\(--muted\)/,
  );
  assert.doesNotMatch(
    css,
    /\.ticket-featured a\.write-after-rule\[data-write-later-quiet\]\s*\{[^}]*color:\s*var\(--stamp\)/,
  );
  assert.match(css, /\.write-this-ticket\[data-write-later-quiet\]/);
  assert.match(css, /\.board\[data-empty-ticket\] \[data-write-later-quiet\]/);

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.doesNotMatch(empty, /data-write-later-quiet/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-write-after-open-seven/);
  assert.doesNotMatch(empty, /data-open-after-write-six/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
          clicks: 4,
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
          clicks: 2,
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-listing-id="lst_lead"');
  const hopperStart = occupied.indexOf('data-listing-id="lst_hopper"');
  const claimAt = occupied.indexOf('id="claim"');
  const lead = occupied.slice(leadStart, hopperStart);
  const hopper = occupied.slice(hopperStart, claimAt);
  const prize = lead.indexOf('data-prize=""');
  const winnerText = lead.indexOf("Best portfolio by Friday");
  const budgetLater = lead.indexOf('data-budget-later=""');
  const rankBid = lead.indexOf('data-rank-bid=""');
  const firstClick = lead.indexOf('data-first-click="open"');
  const openLead = lead.indexOf("Open this brief");
  const writeQuiet = lead.indexOf('data-write-later-quiet=""');
  const writeLabel = lead.indexOf("Write this ticket");
  const formQuiet = occupied.indexOf('data-write-later-quiet=""', claimAt);
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(prize >= 0 && winnerText > prize);
  assert.ok(budgetLater >= 0 && budgetLater < prize);
  assert.ok(rankBid > winnerText && rankBid < firstClick);
  assert.ok(firstClick >= 0 && openLead > firstClick);
  assert.ok(writeQuiet > openLead);
  assert.ok(writeLabel > writeQuiet);
  assert.ok(writeQuiet < hopperStart);
  assert.ok(formQuiet > claimAt);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /Open this brief/);
  assert.match(lead, /data-write-later-quiet=""/);
  assert.match(lead, /href="#claim"/);
  assert.match(lead, /data-prize=""/);
  assert.match(lead, /data-rank-is-bid=""/);
  assert.match(lead, /data-budget-later=""/);
  assert.match(lead, /Project budget, not the bid/);
  assert.match(lead, /\$12/);
  assert.match(lead, /4 clicks/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, />Outbid</);
  assert.match(occupied, /Write this ticket/);
  assert.doesNotMatch(hopper, /data-write-later-quiet/);
  assert.doesNotMatch(hopper, /Open this brief/);
  assert.doesNotMatch(hopper, /data-first-click="open"/);
  assert.doesNotMatch(hopper, /Write this ticket/);
  assert.match(hopper, /Open brief/);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-write-later-quiet=""/g) ?? []).length, 2);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
});

test("occupied later Write this ticket stays quieter than Open this brief", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "board.css"), "utf8");
  const openSize = css.match(
    /\.ticket-featured \.open-this-brief\[data-open-after-write-five\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const writeSize = css.match(
    /\.ticket-featured a\.write-after-rule\[data-write-later-quiet\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const prizeSize = css.match(
    /\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const bidSize = css.match(
    /\.ticket-featured\[data-rank-is-bid\] \.ticket-bid-later \.rank-is-bid\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(openSize);
  assert.ok(writeSize);
  assert.ok(prizeSize);
  assert.ok(bidSize);
  assert.ok(Number(openSize[1]) > Number(writeSize[1]));
  assert.ok(Number(prizeSize[1]) > Number(writeSize[1]));
  assert.ok(Number(openSize[1]) > Number(bidSize[1]));
  assert.match(css, /\.week-occupied \.desk-surface \{/);
  assert.match(css, /\.week-occupied \.ticket-featured \.ticket-write-later/);
  assert.match(
    css,
    /\.week-occupied \.claim-after-ticket\[data-claim-after-ticket\] \.claim\.write-later\[data-write-later\]/,
  );
  assert.match(
    css,
    /\.week-occupied \.ticket-featured \.ticket-write-later a\.write-after-rule\[data-write-later-quiet\]/,
  );
  const laterFoot =
    css.match(
      /\.week-occupied \.ticket-featured \.ticket-write-later\s*\{[^}]*\}/,
    )?.[0] ?? "";
  assert.match(laterFoot, /border-top:\s*1px dashed var\(--rule\)/);
  assert.doesNotMatch(laterFoot, /min-width:\s*1[0-9]/);
  const laterHop =
    css.match(
      /\.week-occupied \.ticket-featured \.ticket-write-later a\.write-after-rule\[data-write-later-quiet\]\s*\{[^}]*\}/,
    )?.[0] ?? "";
  assert.match(laterHop, /display:\s*inline/);
  assert.match(laterHop, /border-bottom:\s*1px dashed var\(--rule\)/);
  assert.match(laterHop, /color:\s*var\(--muted\)/);
  assert.doesNotMatch(laterHop, /min-height:\s*[2-9]/);
  assert.doesNotMatch(laterHop, /var\(--stamp\)/);
  assert.doesNotMatch(css, /data-write-after-open-seven|data-open-after-write-six/);

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(empty, /class="board desk week-empty"/);
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.doesNotMatch(empty, /ticket-write-later/);
  assert.doesNotMatch(empty, /data-write-later/);
  assert.doesNotMatch(empty, /class="claim ticket-blank write-later"/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-write-later-quiet/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-write-after-open-seven/);
  assert.doesNotMatch(empty, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
          clicks: 4,
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
          clicks: 2,
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-listing-id="lst_lead"');
  const hopperStart = occupied.indexOf('data-listing-id="lst_hopper"');
  const claimAt = occupied.indexOf('id="claim"');
  const lead = occupied.slice(leadStart, hopperStart);
  const hopper = occupied.slice(hopperStart, claimAt);
  const prize = lead.indexOf('data-prize=""');
  const winnerText = lead.indexOf("Best portfolio by Friday");
  const firstClick = lead.indexOf('data-first-click="open"');
  const openLead = lead.indexOf("Open this brief");
  const foot = lead.indexOf('class="ticket-write-later"');
  const writeQuiet = lead.indexOf('data-write-later-quiet=""');
  const writeLabel = lead.indexOf("Write this ticket");
  const formLater = occupied.indexOf('data-write-later=""', claimAt);
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(prize >= 0 && winnerText > prize);
  assert.ok(firstClick >= 0 && openLead > firstClick);
  assert.ok(foot > openLead);
  assert.ok(writeQuiet > foot);
  assert.ok(writeLabel > writeQuiet);
  assert.ok(writeQuiet < hopperStart);
  assert.ok(claimAt > hopperStart);
  assert.ok(formLater > claimAt);
  assert.match(lead, /class="ticket-write-later"/);
  assert.match(lead, /data-write-later=""/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /Open this brief/);
  assert.match(lead, /Write this ticket/);
  assert.match(lead, /data-prize=""/);
  assert.match(lead, /data-rank-is-bid=""/);
  assert.match(lead, /\$12/);
  assert.match(lead, /4 clicks/);
  assert.match(occupied, /class="claim ticket-blank write-later"/);
  assert.match(occupied, /data-write-later=""/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, />Outbid</);
  assert.match(occupied, /class="amount-field"/);
  assert.doesNotMatch(hopper, /ticket-write-later/);
  assert.doesNotMatch(hopper, /data-write-later/);
  assert.doesNotMatch(hopper, /Write this ticket/);
  assert.doesNotMatch(hopper, /Open this brief/);
  assert.match(hopper, /Open brief/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(boardSource, /data-write-after-open-seven/);
  assert.doesNotMatch(boardSource, /data-open-after-write-six/);
  assert.match(boardSource, /ticket-write-later/);
  assert.match(boardSource, /data-write-later/);
  assert.match(formSource, /claim ticket-blank write-later/);
  assert.match(formSource, /data-write-later=\{occupied \? "" : undefined\}/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
});

test("empty week stays Claim #1 — Open / Write cannot leak", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
          clicks: 4,
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
          clicks: 2,
        }),
      ]),
    }),
  );

  const weekAt = empty.indexOf('class="board desk week-empty"');
  const emptyWeekStamp = empty.indexOf('data-week-empty="true"');
  const emptyTicket = empty.indexOf('data-empty-ticket=""');
  const paidStamp = empty.indexOf("No paid brief");
  const emptyDeck = empty.indexOf('data-empty-week="true"');
  const claimAt = empty.indexOf('id="claim"');
  const claimCopy = empty.indexOf("Claim #1 for");
  assert.ok(weekAt >= 0);
  assert.ok(emptyWeekStamp >= 0);
  assert.ok(emptyTicket >= 0);
  assert.ok(paidStamp >= 0);
  assert.ok(emptyDeck >= 0);
  assert.ok(claimAt >= 0);
  assert.ok(claimCopy > claimAt);
  assert.ok(weekAt < emptyWeekStamp || emptyWeekStamp - weekAt < 80);
  assert.ok(weekAt < paidStamp && paidStamp < claimAt);
  assert.ok(emptyDeck < claimAt);
  assert.match(empty, /class="board desk week-empty"/);
  assert.match(empty, /data-week-empty="true"/);
  assert.match(empty, /data-empty-ticket=""/);
  assert.match(empty, /data-desk-surface="empty"/);
  assert.match(empty, /data-empty-week="true"/);
  assert.match(empty, /No paid brief/);
  assert.match(empty, /no sample gig/i);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, />Outbid</);
  assert.match(empty, /Rank is the bid, not the project/);
  assert.doesNotMatch(empty, /class="board desk week-occupied"/);
  assert.doesNotMatch(empty, /data-week-occupied/);
  assert.doesNotMatch(empty, /data-listing-card/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-open-brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-write-ticket="buyer"/);
  assert.doesNotMatch(empty, /data-write-later-quiet/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /data-prize-before-price/);
  assert.doesNotMatch(empty, /data-rank-is-bid/);
  assert.doesNotMatch(empty, /data-budget-later/);
  assert.doesNotMatch(empty, /ticket-featured/);
  assert.doesNotMatch(empty, /data-write-after-open-seven/);
  assert.doesNotMatch(empty, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);

  assert.match(cssSource, /\.week-empty\[data-empty-ticket\] \.open-this-brief/);
  assert.match(cssSource, /\.week-empty\[data-empty-ticket\] p\.write-this-ticket/);
  assert.match(cssSource, /\.week-empty\[data-empty-ticket\] \[data-prize\]/);
  assert.match(cssSource, /\.week-empty\[data-empty-ticket\] \[data-write-later-quiet\]/);
  assert.match(cssSource, /\.week-empty \.open-this-brief/);
  assert.match(cssSource, /\.week-empty \.write-after-rule/);
  assert.match(cssSource, /\.week-occupied \.empty-week/);
  assert.match(cssSource, /\.week-occupied \.ticket-featured \.open-this-brief \{/);
  assert.match(
    cssSource,
    /\.week-occupied \.ticket-featured a\.write-after-rule\[data-write-later-quiet\]/,
  );
  assert.match(
    cssSource,
    /\.week-occupied \.ticket-featured \.prize-before-price \.winner-rule-text/,
  );
  assert.match(
    cssSource,
    /\.week-occupied \.ticket-featured\[data-rank-is-bid\] \.ticket-bid-later \.rank-is-bid/,
  );
  const emptyHide =
    cssSource.match(
      /\.board\[data-empty-ticket\] \.ticket-featured,[\s\S]*?display: none;/,
    )?.[0] ?? "";
  assert.match(emptyHide, /display: none/);
  assert.match(emptyHide, /\.week-empty\[data-empty-ticket\] \.open-this-brief/);
  assert.match(emptyHide, /\.week-empty \.write-after-rule/);
  assert.doesNotMatch(emptyHide, /background:/);
  assert.doesNotMatch(cssSource, /^\.ticket-featured/m);
  assert.doesNotMatch(cssSource, /^\.write-this-ticket/m);
  assert.doesNotMatch(boardSource, /data-write-after-open-seven/);
  assert.doesNotMatch(boardSource, /data-open-after-write-six/);

  const leadStart = occupied.indexOf('data-listing-id="lst_lead"');
  const hopperStart = occupied.indexOf('data-listing-id="lst_hopper"');
  const occupiedClaim = occupied.indexOf('id="claim"');
  const lead = occupied.slice(leadStart, hopperStart);
  const hopper = occupied.slice(hopperStart, occupiedClaim);
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.match(occupied, /class="board desk week-occupied"/);
  assert.match(occupied, /data-week-occupied="true"/);
  assert.match(occupied, /Open this brief/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /Write this ticket/);
  assert.match(occupied, /data-write-later-quiet=""/);
  assert.match(occupied, /data-prize-before-price=""/);
  assert.match(occupied, /data-rank-is-bid=""/);
  assert.match(occupied, /data-budget-later=""/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, />Outbid</);
  assert.match(lead, /Open this brief/);
  assert.match(lead, /data-write-later-quiet=""/);
  assert.ok(leadStart < hopperStart && hopperStart < occupiedClaim);
  assert.doesNotMatch(occupied, /class="board desk week-empty"/);
  assert.doesNotMatch(occupied, /data-week-empty/);
  assert.doesNotMatch(occupied, /data-empty-ticket/);
  assert.doesNotMatch(occupied, /data-empty-week/);
  assert.doesNotMatch(hopper, /Open this brief/);
  assert.doesNotMatch(hopper, /Write this ticket/);
  assert.doesNotMatch(hopper, /data-write-later-quiet/);
  assert.match(hopper, /Open brief/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);

  assert.match(boardSource, /board desk week-empty/);
  assert.match(boardSource, /board desk week-occupied/);
  assert.match(boardSource, /data-week-empty=\{empty \? "true" : undefined\}/);
  assert.match(boardSource, /data-week-occupied=\{empty \? undefined : "true"\}/);
  assert.match(boardSource, /data-empty-ticket=\{empty \? "" : undefined\}/);
  assert.match(formSource, /data-empty-ticket=\{occupied \? undefined : ""\}/);
  assert.match(formSource, /Claim #1 for/);
  assert.match(formSource, /className="amount-field"/);
  assert.match(formSource, /Outbid/);
});

test("empty week Claim #1 is the first click — brief URL is a later write", () => {
  assert.match(cssSource, /Empty week: Brief URL is a later write after Claim #1 \/ Outbid/);
  assert.match(
    cssSource,
    /\.week-empty \.claim\.empty-claim-first\[data-empty-claim-first\] \.ticket-identity\[data-later-write\]/,
  );
  assert.match(
    cssSource,
    /\.week-empty \.claim\.empty-claim-first\[data-empty-claim-first\] \.later-write-label/,
  );
  assert.match(
    cssSource,
    /\.week-empty \.claim\.empty-claim-first\[data-empty-claim-first\] \.outbid\[data-first-click="claim"\]/,
  );
  const later =
    (cssSource.split(
      "Empty week: Brief URL is a later write after Claim #1 / Outbid",
      2,
    )[1] ?? "").split("End empty-week later-write")[0] ?? "";
  assert.match(later, /border-top:\s*1px dashed var\(--rule\)/);
  assert.match(later, /color:\s*var\(--muted\)/);
  assert.doesNotMatch(later, /background:/);
  assert.doesNotMatch(later, /var\(--stamp\)/);
  assert.doesNotMatch(later, /data-write-after-open-seven|data-open-after-write-six/);
  assert.match(cssSource, /\.week-occupied \.claim \.ticket-identity\[data-later-write\]/);
  assert.match(cssSource, /\.week-occupied \.claim \[data-first-click="claim"\]/);

  const emptyFn =
    formSource.split("function EmptyClaimFirstWrite")[1]?.split(
      "export function OutbidForm",
    )[0] ?? "";
  const occupiedFn =
    formSource.split("function OccupiedTicketWrite")[1]?.split(
      "function EmptyClaimFirstWrite",
    )[0] ?? "";
  const emptyOutbid = emptyFn.indexOf("Outbid");
  const emptyLater = emptyFn.indexOf("data-later-write");
  const emptyUrl = emptyFn.indexOf("TicketIdentityFields");
  const occupiedFields = occupiedFn.indexOf("ticket-fields");
  const occupiedOutbid = occupiedFn.indexOf("Outbid");
  assert.ok(emptyOutbid >= 0 && emptyLater > emptyOutbid);
  assert.ok(emptyUrl > emptyLater);
  assert.ok(occupiedFields >= 0 && occupiedOutbid > occupiedFields);
  assert.match(emptyFn, /data-first-click="claim"/);
  assert.match(emptyFn, /Then the brief URL/);
  assert.doesNotMatch(occupiedFn, /data-first-click="claim"/);
  assert.doesNotMatch(occupiedFn, /Then the brief URL/);
  assert.doesNotMatch(occupiedFn, /data-later-write/);
  assert.doesNotMatch(formSource, /data-write-after-open-seven|data-open-after-write-six/);

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  const claimAt = empty.indexOf('id="claim"');
  const emptyClaimAt = empty.indexOf('data-empty-claim-first=""');
  const firstClickAt = empty.indexOf('data-first-click="claim"');
  const claimCopyAt = empty.indexOf("Claim #1 for");
  const outbidAt = empty.indexOf(">Outbid<");
  const laterWriteAt = empty.indexOf('data-later-write=""');
  const laterLabelAt = empty.indexOf("Then the brief URL");
  const identityAt = empty.indexOf('data-ticket-identity=""');
  const buyerAt = empty.indexOf('name="buyer"');
  const budgetAt = empty.indexOf('name="budgetUsd"');
  const deadlineAt = empty.indexOf('name="deadline"');
  const winnerAt = empty.indexOf('name="winnerRule"');
  const briefAt = empty.indexOf('name="briefUrl"');
  const paidStamp = empty.indexOf("No paid brief");
  assert.ok(claimAt >= 0 && emptyClaimAt > claimAt);
  assert.ok(claimCopyAt > emptyClaimAt && firstClickAt > claimCopyAt);
  assert.ok(outbidAt > firstClickAt);
  assert.ok(laterWriteAt > outbidAt && laterLabelAt > laterWriteAt);
  assert.ok(identityAt > outbidAt && identityAt <= laterWriteAt);
  assert.ok(buyerAt > laterLabelAt && budgetAt > buyerAt);
  assert.ok(deadlineAt > budgetAt && winnerAt > deadlineAt);
  assert.ok(briefAt > winnerAt);
  assert.ok(paidStamp >= 0 && paidStamp < claimAt);
  assert.match(empty, /class="claim ticket-blank empty-claim-first"/);
  assert.match(empty, /data-empty-claim-first=""/);
  assert.match(empty, /aria-label="Claim #1"/);
  assert.match(empty, /data-first-click="claim"/);
  assert.match(empty, /data-ticket-identity=""/);
  assert.match(empty, /data-later-write=""/);
  assert.match(empty, /Then the brief URL/);
  assert.match(empty, /name="buyer"/);
  assert.match(empty, /name="budgetUsd"/);
  assert.match(empty, /name="deadline"/);
  assert.match(empty, /name="winnerRule"/);
  assert.match(empty, /name="briefUrl"/);
  assert.match(empty, /name="amountUsd"/);
  assert.match(empty, />Outbid</);
  assert.match(empty, /No paid brief/);
  assert.match(empty, /no sample gig/i);
  assert.match(empty, /class="amount-field"/);
  assert.match(empty, /class="step"/);
  assert.doesNotMatch(empty, /class="claim ticket-blank write-later"/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-write-ticket="buyer"/);
  assert.doesNotMatch(empty, /data-write-later-quiet/);
  assert.doesNotMatch(empty, /ticket-write-later/);
  assert.doesNotMatch(empty, /data-write-after-open-seven/);
  assert.doesNotMatch(empty, /data-open-after-write-six/);
  assert.equal((empty.match(/data-first-click="claim"/g) ?? []).length, 1);
  assert.equal((empty.match(/data-later-write=""/g) ?? []).length, 1);
  assert.equal((empty.match(/data-ticket-identity=""/g) ?? []).length, 1);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
          clicks: 4,
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
          clicks: 2,
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-listing-id="lst_lead"');
  const hopperStart = occupied.indexOf('data-listing-id="lst_hopper"');
  const occupiedClaim = occupied.indexOf('id="claim"');
  const occupiedBuyer = occupied.indexOf('name="buyer"');
  const occupiedBrief = occupied.indexOf('name="briefUrl"');
  const occupiedSubmit = occupied.indexOf(">Outbid<");
  const occupiedOpen = occupied.indexOf("Open this brief");
  const occupiedWrite = occupied.indexOf("Write this ticket");
  const lead = occupied.slice(leadStart, hopperStart);
  const hopper = occupied.slice(hopperStart, occupiedClaim);
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(occupiedOpen > leadStart && occupiedOpen < occupiedClaim);
  assert.ok(occupiedBuyer > occupiedClaim && occupiedBrief > occupiedBuyer);
  assert.ok(occupiedSubmit > occupiedBrief);
  assert.ok(occupiedWrite > occupiedOpen);
  assert.match(occupied, /class="claim ticket-blank write-later"/);
  assert.match(occupied, /data-write-later=""/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /Open this brief/);
  assert.match(occupied, /Write this ticket/);
  assert.match(occupied, /data-prize=/);
  assert.match(occupied, /data-rank-is-bid/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, />Outbid</);
  assert.match(occupied, /name="buyer"/);
  assert.match(occupied, /name="briefUrl"/);
  assert.match(lead, /Open this brief/);
  assert.match(lead, /data-first-click="open"/);
  assert.doesNotMatch(occupied, /empty-claim-first/);
  assert.doesNotMatch(occupied, /data-empty-claim-first/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /data-later-write=/);
  assert.doesNotMatch(occupied, /data-ticket-identity=/);
  assert.doesNotMatch(occupied, /Then the brief URL/);
  assert.doesNotMatch(occupied, /data-empty-ticket/);
  assert.doesNotMatch(hopper, /Open this brief/);
  assert.doesNotMatch(hopper, /Write this ticket/);
  assert.match(hopper, /Open brief/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
  assert.match(formSource, /empty-claim-first/);
  assert.match(formSource, /data-empty-claim-first=\{occupied \? undefined : ""\}/);
  assert.match(formSource, /data-first-click="claim"/);
  assert.match(formSource, /Then the brief URL/);
  assert.match(formSource, /OccupiedTicketWrite/);
  assert.match(formSource, /EmptyClaimFirstWrite/);
});

test("occupied later-rank tickets stay quieter than #1 — winner rule stays the prize", () => {
  const prizeSize = cssSource.match(
    /\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterRuleSize = cssSource.match(
    /\.hopper \.ticket-later\[data-later-rank\] \.later-rule \.winner-rule\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterBuyerSize = cssSource.match(
    /\.hopper \.ticket-later\[data-later-rank\] \.later-buyer\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterOpenSize = cssSource.match(
    /\.hopper \.ticket-later\[data-later-rank\] a\.later-open\[data-later-open\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const openSize = cssSource.match(
    /\.ticket-featured \.open-this-brief\[data-open-after-write-five\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterPackRule =
    cssSource.match(
      /\.week-occupied \.hopper\.later-pack\[data-later-pack\]\s*\{[^}]*\}/,
    )?.[0] ?? "";
  const laterTicketRule =
    cssSource.match(
      /\.week-occupied \.hopper \.ticket-later\[data-later-rank\]\s*\{[^}]*\}/,
    )?.[0] ?? "";
  const laterOpenRule =
    cssSource.match(
      /\.week-occupied \.hopper \.ticket-later\[data-later-rank\] a\.later-open\[data-later-open\]\s*\{[^}]*\}/,
    )?.[0] ?? "";
  const laterRuleRule =
    cssSource.match(
      /\.week-occupied \.hopper \.ticket-later\[data-later-rank\] \.later-rule \.winner-rule\s*\{[^}]*\}/,
    )?.[0] ?? "";
  assert.ok(prizeSize);
  assert.ok(laterRuleSize);
  assert.ok(laterBuyerSize);
  assert.ok(laterOpenSize);
  assert.ok(openSize);
  assert.ok(Number(prizeSize[1]) > Number(laterRuleSize[1]));
  assert.ok(Number(prizeSize[1]) > Number(laterBuyerSize[1]));
  assert.ok(Number(openSize[1]) > Number(laterOpenSize[1]));
  assert.match(laterPackRule, /border-top:\s*1px dashed/);
  assert.match(laterTicketRule, /grid-template-columns:\s*5\.4rem minmax\(0, 1fr\)/);
  assert.match(laterTicketRule, /box-shadow:\s*none/);
  assert.match(laterTicketRule, /border:\s*1px dashed var\(--rule\)/);
  assert.doesNotMatch(laterTicketRule, /background:\s*var\(--stamp\)/);
  assert.match(laterOpenRule, /display:\s*inline/);
  assert.match(laterOpenRule, /color:\s*var\(--muted\)/);
  assert.match(laterOpenRule, /border-bottom:\s*1px dashed var\(--rule\)/);
  assert.doesNotMatch(laterOpenRule, /min-height:\s*[2-9]/);
  assert.doesNotMatch(laterOpenRule, /var\(--stamp\)/);
  assert.doesNotMatch(laterOpenRule, /background:/);
  assert.match(laterRuleRule, /color:\s*var\(--muted\)/);
  assert.match(laterRuleRule, /font-size:\s*0\.78rem/);
  assert.match(cssSource, /\.board\[data-empty-ticket\] \.later-pack/);
  assert.match(cssSource, /\.week-empty\[data-empty-ticket\] \[data-later-rank\]/);
  assert.match(cssSource, /\.week-empty \.ticket-later/);
  assert.match(cssSource, /\.week-occupied \.hopper\.later-pack\[data-later-pack\]/);
  assert.match(
    cssSource,
    /\.week-occupied \.hopper \.ticket-later\[data-later-rank\] a\.later-open\[data-later-open\]/,
  );
  assert.doesNotMatch(cssSource, /data-write-after-open-seven|data-open-after-write-six/);
  assert.doesNotMatch(boardSource, /data-write-after-open-seven|data-open-after-write-six/);
  assert.match(boardSource, /function LaterRankTicket/);
  assert.match(boardSource, /className="card ticket ticket-later"/);
  assert.match(boardSource, /data-later-rank=""/);
  assert.match(boardSource, /data-later-pack=""/);
  assert.match(boardSource, /These tickets are not the last 7 days’ #1 prize/);
  assert.match(boardSource, /data-first-click=\{featured \? "open" : undefined\}/);
  assert.match(boardSource, /data-prize=/);
  assert.match(boardSource, /data-rank-is-bid/);
  assert.match(boardSource, /ticket-write-later/);

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-first-click="claim"/);
  assert.doesNotMatch(empty, /data-later-rank/);
  assert.doesNotMatch(empty, /data-later-pack/);
  assert.doesNotMatch(empty, /ticket-later/);
  assert.doesNotMatch(empty, /later-open/);
  assert.doesNotMatch(empty, /Tickets on the desk/);
  assert.doesNotMatch(empty, /These tickets are not the last 7 days’ #1 prize/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /data-write-after-open-seven/);
  assert.doesNotMatch(empty, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);

  const onlyOne = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
          clicks: 4,
        }),
      ]),
    }),
  );
  assert.match(onlyOne, /data-prize=""/);
  assert.match(onlyOne, /Open this brief/);
  assert.match(onlyOne, /data-first-click="open"/);
  assert.match(onlyOne, /ticket-write-later/);
  assert.match(onlyOne, /Write this ticket/);
  assert.doesNotMatch(onlyOne, /data-later-rank/);
  assert.doesNotMatch(onlyOne, /data-later-pack/);
  assert.doesNotMatch(onlyOne, /Tickets on the desk/);
  assert.doesNotMatch(onlyOne, /These tickets are not the last 7 days’ #1 prize/);
  assert.doesNotMatch(onlyOne, /data-later-open/);

  const laterCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          winnerRule: "Best portfolio by Friday",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
          clicks: 2,
        }),
      ])[1]!,
    }),
  );
  assert.match(laterCard, /class="card ticket ticket-later"/);
  assert.match(laterCard, /data-later-rank=""/);
  assert.match(laterCard, /data-rank="2"/);
  assert.match(laterCard, /Hopper Studio/);
  assert.match(laterCard, /Budget \$800/);
  assert.match(laterCard, /Deadline 2026-10-01/);
  assert.match(laterCard, /First qualified/);
  assert.match(laterCard, /\$6/);
  assert.match(laterCard, /2 clicks/);
  assert.match(laterCard, /Open brief/);
  assert.match(laterCard, /data-later-open=""/);
  assert.match(laterCard, /How a winner is chosen/);
  assert.doesNotMatch(laterCard, /ticket-featured/);
  assert.doesNotMatch(laterCard, /ticket-stub/);
  assert.doesNotMatch(laterCard, /ticket-facts/);
  assert.doesNotMatch(laterCard, /data-prize=/);
  assert.doesNotMatch(laterCard, /prize-before-price/);
  assert.doesNotMatch(laterCard, /data-rank-is-bid/);
  assert.doesNotMatch(laterCard, /Open this brief/);
  assert.doesNotMatch(laterCard, /Write this ticket/);
  assert.doesNotMatch(laterCard, /data-first-click="open"/);
  assert.doesNotMatch(laterCard, /data-write-later/);
  assert.doesNotMatch(laterCard, /Winner rule, not a score/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
          clicks: 4,
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
          clicks: 2,
        }),
        listing({
          id: "lst_third",
          buyer: "Third Studio",
          budgetUsd: 400,
          deadline: "2026-11-01",
          winnerRule: "Fixed price",
          briefUrl: "https://example.com/third",
          bidUsd: 5,
          firstPaidAt: "2026-08-19T00:00:00.000Z",
          clicks: 1,
        }),
      ]),
    }),
  );
  const prizeAt = occupied.indexOf('data-prize=""');
  const openAt = occupied.indexOf("Open this brief");
  const firstClickAt = occupied.indexOf('data-first-click="open"');
  const writeFootAt = occupied.indexOf('class="ticket-write-later"');
  const claimAt = occupied.indexOf('id="claim"');
  const packAt = occupied.indexOf('data-later-pack=""');
  const hopperStart = occupied.indexOf('data-listing-id="lst_hopper"');
  const thirdStart = occupied.indexOf('data-listing-id="lst_third"');
  const hopper = occupied.slice(hopperStart, thirdStart);
  const third = occupied.slice(thirdStart, claimAt);
  const lead = occupied.slice(
    occupied.indexOf('data-listing-id="lst_lead"'),
    packAt,
  );
  assert.ok(prizeAt >= 0 && openAt > prizeAt && firstClickAt > prizeAt);
  assert.ok(writeFootAt > openAt && packAt > writeFootAt);
  assert.ok(hopperStart > packAt && claimAt > hopperStart);
  assert.ok(thirdStart > hopperStart);
  assert.match(lead, /data-prize=""/);
  assert.match(lead, /Open this brief/);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /ticket-write-later/);
  assert.match(lead, /data-rank-is-bid=""/);
  assert.doesNotMatch(lead, /data-later-rank/);
  assert.doesNotMatch(lead, /ticket-later/);
  assert.match(occupied, /class="hopper later-pack"/);
  assert.match(occupied, /These tickets are not the last 7 days’ #1 prize/);
  assert.match(occupied, /Tickets on the desk/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, />Outbid</);
  assert.match(hopper, /class="card ticket ticket-later"/);
  assert.match(hopper, /data-later-rank=""/);
  assert.match(hopper, /data-later-open=""/);
  assert.match(hopper, /Open brief/);
  assert.match(hopper, /First qualified/);
  assert.match(hopper, /\$6/);
  assert.match(third, /data-later-rank=""/);
  assert.match(third, /Fixed price/);
  assert.match(third, /Open brief/);
  assert.doesNotMatch(hopper, /data-prize=/);
  assert.doesNotMatch(hopper, /prize-before-price/);
  assert.doesNotMatch(hopper, /ticket-featured/);
  assert.doesNotMatch(hopper, /ticket-facts/);
  assert.doesNotMatch(hopper, /Open this brief/);
  assert.doesNotMatch(hopper, /Write this ticket/);
  assert.doesNotMatch(hopper, /data-first-click="open"/);
  assert.doesNotMatch(hopper, /data-rank-is-bid/);
  assert.doesNotMatch(third, /data-prize=/);
  assert.doesNotMatch(third, /Open this brief/);
  assert.equal((occupied.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-later-rank=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/data-later-open=""/g) ?? []).length, 2);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/Open this brief/g) ?? []).length, 1);
  assert.doesNotMatch(occupied.slice(0, packAt), /data-later-rank/);
  assert.doesNotMatch(occupied.slice(hopperStart, claimAt), /data-prize=/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
  assert.match(formSource, /claim ticket-blank write-later/);
  assert.match(formSource, /Claim #1 for/);
  assert.match(formSource, /className="amount-field"/);
  assert.match(formSource, /className="step"/);
  assert.match(formSource, /Outbid/);
});

test("unpaid stays off the ticket desk — No paid brief until Polar reports paid", () => {
  assert.match(boardSource, /isPolarPaidListing/);
  assert.match(boardSource, /data-unpaid-off=\{empty && leftoverUnpaid \? "" : undefined\}/);
  assert.match(boardSource, /An unpaid Polar checkout stays off this desk until Polar reports paid/);
  assert.match(formSource, /data-unpaid-off=\{unpaidOff \? "" : undefined\}/);
  assert.match(formSource, /Unpaid Polar checkout stays off this desk until Polar reports paid/);
  assert.match(formSource, /An abandoned ticket is not #1/);
  assert.match(cssSource, /\.claim-note\[data-unpaid-off\]/);
  assert.match(cssSource, /\.board\[data-unpaid-off\] \.ticket-featured/);
  assert.match(cssSource, /\.board\[data-unpaid-off\] \[data-prize\]/);
  assert.match(cssSource, /\.board\[data-unpaid-off\] \.open-this-brief/);
  assert.match(cssSource, /\.week-empty\[data-unpaid-off\] \[data-prize\]/);
  assert.match(cssSource, /\.week-empty\[data-unpaid-off\] \.later-pack/);
  const unpaidHide =
    cssSource.match(/\.board\[data-unpaid-off\] \.ticket-featured,[\s\S]*?display: none;/)?.[0] ??
    "";
  assert.match(unpaidHide, /display:\s*none/);
  assert.doesNotMatch(unpaidHide, /background:/);
  assert.doesNotMatch(cssSource, /data-write-after-open-seven|data-open-after-write-six/);
  assert.doesNotMatch(boardSource, /data-write-after-open-seven|data-open-after-write-six/);
  assert.doesNotMatch(formSource, /data-write-after-open-seven|data-open-after-write-six/);
  assert.match(boardSource, /data-prize=/);
  assert.match(boardSource, /Open this brief/);
  assert.match(formSource, /Write this ticket/);
  assert.match(formSource, /Claim #1 for/);
  assert.match(formSource, /empty-claim-first/);
  assert.match(boardSource, /function LaterRankTicket/);
  assert.match(boardSource, /desk-surface-empty/);
  assert.match(formSource, /className="amount-field"/);
  assert.match(formSource, /className="step"/);
  assert.match(formSource, /Outbid/);

  const unpaidDraft = listing({
    id: "lst_ghost",
    buyer: "Ghost Studio",
    winnerRule: "Best portfolio by Friday",
    briefUrl: "https://example.com/ghost",
    bidUsd: 99,
    firstPaidAt: "",
  });
  const rankedUnpaid = rankListings([unpaidDraft]);
  assert.deepEqual(rankedUnpaid, []);
  const unpaidCard = renderToStaticMarkup(
    createElement(ListingCard, {
      listing: { ...unpaidDraft, rank: 1 },
      featured: true,
    }),
  );
  assert.equal(unpaidCard, "");

  const leftover = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankedUnpaid,
      unpaid: [
        {
          sessionId: "fix_abandoned",
          weekId: WEEK,
          buyer: "Ghost Studio",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/ghost",
          bidUsd: 99,
        },
      ],
    }),
  );
  const paidStamp = leftover.indexOf("No paid brief");
  const claimAt = leftover.indexOf('id="claim"');
  const unpaidNote = leftover.indexOf("Unpaid Polar checkout stays off this desk");
  const abandonedNote = leftover.indexOf("An abandoned ticket is not #1");
  const firstClickClaim = leftover.indexOf('data-first-click="claim"');
  const laterUrl = leftover.indexOf("Then the brief URL");
  const outbidAt = leftover.indexOf(">Outbid<");
  assert.ok(paidStamp >= 0 && claimAt > paidStamp);
  assert.ok(unpaidNote > claimAt && abandonedNote > unpaidNote);
  assert.ok(firstClickClaim > claimAt && firstClickClaim < laterUrl);
  assert.ok(outbidAt > firstClickClaim && laterUrl > outbidAt);
  assert.match(leftover, /class="board desk week-empty"/);
  assert.match(leftover, /data-empty-ticket=""/);
  assert.match(leftover, /data-unpaid-off=""/);
  assert.match(leftover, /data-empty-week="true"/);
  assert.match(leftover, /data-desk-surface="empty"/);
  assert.match(leftover, /desk-surface-empty/);
  assert.match(leftover, /No paid brief/);
  assert.match(leftover, /until Polar reports paid/);
  assert.match(leftover, /Claim #1 for/);
  assert.match(leftover, /data-first-click="claim"/);
  assert.match(leftover, /Then the brief URL/);
  assert.match(leftover, />Outbid</);
  assert.match(leftover, /class="amount-field"/);
  assert.match(leftover, /class="step"/);
  assert.doesNotMatch(leftover, /data-listing-card/);
  assert.doesNotMatch(leftover, /Ghost Studio/);
  assert.doesNotMatch(leftover, /Best portfolio by Friday/);
  assert.doesNotMatch(leftover, /\$99/);
  assert.doesNotMatch(leftover, /ticket-featured/);
  assert.doesNotMatch(leftover, /data-prize=/);
  assert.doesNotMatch(leftover, /prize-before-price/);
  assert.doesNotMatch(leftover, /Open this brief/);
  assert.doesNotMatch(leftover, /Write this ticket/);
  assert.doesNotMatch(leftover, /data-first-click="open"/);
  assert.doesNotMatch(leftover, /data-later-rank/);
  assert.doesNotMatch(leftover, /data-later-pack/);
  assert.doesNotMatch(leftover, /These tickets are not the last 7 days’ #1 prize/);
  assert.doesNotMatch(leftover, /data-write-after-open-seven/);
  assert.doesNotMatch(leftover, /data-open-after-write-six/);
  assert.doesNotMatch(leftover, RATINGS_FORBIDDEN);

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-first-click="claim"/);
  assert.match(empty, /Then the brief URL/);
  assert.doesNotMatch(empty, /data-unpaid-off=/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /data-later-pack/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
          clicks: 4,
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
          clicks: 2,
        }),
      ]),
    }),
  );
  const leadStart = occupied.indexOf('data-listing-id="lst_lead"');
  const hopperStart = occupied.indexOf('data-listing-id="lst_hopper"');
  const occupiedClaim = occupied.indexOf('id="claim"');
  const occupiedOpen = occupied.indexOf("Open this brief");
  const occupiedPrize = occupied.indexOf('data-prize=""');
  const occupiedUnpaid = occupied.indexOf("Unpaid Polar checkout stays off this desk");
  const lead = occupied.slice(leadStart, hopperStart);
  const hopper = occupied.slice(hopperStart, occupiedClaim);
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(occupiedPrize > leadStart && occupiedOpen > occupiedPrize);
  assert.ok(occupiedOpen < occupiedClaim);
  assert.ok(occupiedUnpaid > occupiedClaim);
  assert.match(occupied, /class="board desk week-occupied"/);
  assert.match(occupied, /data-prize=""/);
  assert.match(occupied, /Open this brief/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /data-rank-is-bid/);
  assert.match(occupied, /Write this ticket/);
  assert.match(occupied, /ticket-write-later/);
  assert.match(occupied, /data-later-rank=""/);
  assert.match(occupied, /These tickets are not the last 7 days’ #1 prize/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, />Outbid</);
  assert.match(occupied, /Unpaid Polar checkout stays off this desk/);
  assert.match(occupied, /data-unpaid-off=""/);
  assert.match(lead, /Best portfolio by Friday/);
  assert.match(lead, /Open this brief/);
  assert.doesNotMatch(occupied, /data-empty-week/);
  assert.doesNotMatch(occupied, /data-empty-ticket/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /Then the brief URL/);
  assert.doesNotMatch(hopper, /Open this brief/);
  assert.doesNotMatch(hopper, /data-prize=/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-prize=""/g) ?? []).length, 1);
});

test("current week header uses UTC ISO week", () => {
  const week = currentWeekUtc(new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(week.weekId, "2026-W34");
  assert.equal(week.startsAt, "2026-08-10T00:00:00.000Z");
  assert.equal(week.endsAt, "2026-08-17T00:00:00.000Z");
});

test("rankListings uses only the rolling last-7-days lastPaidAt window", () => {
  const now = new Date("2026-08-24T00:00:00.000Z");
  const ranked = rankListings(
    [
      listing({
        id: "lst_then",
        weekId: "2026-W33",
        bidUsd: 99,
        firstPaidAt: "2026-08-16T23:59:59.000Z",
        lastPaidAt: "2026-08-16T23:59:59.000Z",
      }),
      listing({
        id: "lst_now",
        weekId: "2026-W34",
        bidUsd: 5,
        firstPaidAt: "2026-08-17T00:00:00.000Z",
        lastPaidAt: "2026-08-17T00:00:00.000Z",
      }),
    ],
    now,
  );
  assert.deepEqual(
    ranked.map((row) => ({ id: row.id, rank: row.rank, bidUsd: row.bidUsd })),
    [{ id: "lst_now", rank: 1, bidUsd: 5 }],
  );
});

test("occupied week window is rolling last-7-days — not Monday 00:00 UTC", () => {
  const sundayPay = listing({
    id: "lst_lead",
    buyer: "Lead Studio",
    weekId: "2026-W33",
    bidUsd: 12,
    firstPaidAt: "2026-08-16T12:00:00.000Z",
    lastPaidAt: "2026-08-16T12:00:00.000Z",
    winnerRule: "Best portfolio by Friday",
    briefUrl: "https://example.com/lead",
  });
  const hopper = listing({
    id: "lst_hopper",
    buyer: "Hopper Studio",
    weekId: "2026-W33",
    bidUsd: 6,
    firstPaidAt: "2026-08-16T13:00:00.000Z",
    lastPaidAt: "2026-08-16T13:00:00.000Z",
    winnerRule: "First qualified",
    briefUrl: "https://example.com/hopper",
  });
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const week = currentWeekUtc(monday);
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week,
      listings: rankListings([sundayPay, hopper], monday),
    }),
  );
  assert.match(occupied, /data-desk-surface="occupied"/);
  assert.match(occupied, /data-rolling-week="true"/);
  assert.match(occupied, /Rolling last 7 days\. Not Monday 00:00 UTC\./);
  assert.match(occupied, /Window last 7 days/);
  assert.doesNotMatch(occupied, /Window since 2026-08-10T00:00:00.000Z/);
  assert.match(occupied, /data-listing-id="lst_lead"/);
  assert.match(occupied, /data-listing-id="lst_hopper"/);
  assert.match(occupied, /Open this brief/);
  assert.match(occupied, /Winner rule, not a score/);
  assert.match(occupied, /Best portfolio by Friday/);
  assert.match(occupied, /\$12/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /data-prize=""/);
  assert.doesNotMatch(occupied, /data-empty-week/);
  assert.doesNotMatch(occupied, /24h lock/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);

  const expired = new Date("2026-08-23T13:00:01.000Z");
  const empty = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(expired),
      listings: rankListings([sundayPay, hopper], expired),
    }),
  );
  assert.match(empty, /data-desk-surface="empty"/);
  assert.match(empty, /data-empty-week="true"/);
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-rolling-week="true"/);
  assert.match(empty, /Rolling last 7 days\. Not Monday 00:00 UTC\./);
  assert.doesNotMatch(empty, /data-listing-card/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
});

test("occupied ticket desk keeps one first click — Open this brief, Claim stays after", () => {
  assert.match(boardSource, /className="claim-after-ticket"/);
  assert.match(boardSource, /data-claim-after-ticket=""/);
  assert.match(
    boardSource,
    /Occupied: Open this brief is the first click|claim-after-ticket/,
  );
  assert.match(
    cssSource,
    /\.week-occupied \.claim-after-ticket\[data-claim-after-ticket\]/,
  );
  assert.match(
    cssSource,
    /\.week-occupied \.claim-after-ticket\[data-claim-after-ticket\] \.outbid/,
  );
  assert.match(cssSource, /\.board\[data-empty-ticket\] \.claim-after-ticket/);
  assert.match(cssSource, /\.week-empty \.claim-after-ticket/);
  assert.doesNotMatch(cssSource, /^\.claim-after-ticket/m);
  assert.doesNotMatch(
    cssSource,
    /data-write-after-open-seven|data-open-after-write-six|data-write-after-open-N/,
  );
  assert.doesNotMatch(boardSource, /data-write-after-open-seven|data-open-after-write-six/);

  const laterClaim =
    (cssSource.split(
      "Occupied: Open this brief is the only first click. Claim #1 / Outbid stay after the ticket.",
      2,
    )[1] ?? "").split("End occupied Claim-after-ticket")[0] ?? "";
  assert.match(laterClaim, /border-top:\s*1px dashed/);
  assert.match(
    laterClaim,
    /\.claim-after-ticket\[data-claim-after-ticket\] \.outbid\s*\{[^}]*height:\s*1\.35rem/,
  );
  assert.doesNotMatch(laterClaim, /background:/);
  assert.doesNotMatch(laterClaim, /data-write-after-open-seven|data-open-after-write-six/);
  assert.doesNotMatch(laterClaim, /empty-claim-first|data-later-write|data-unpaid-off/);

  const openSize = cssSource.match(
    /\.ticket-featured \.open-this-brief\[data-open-after-write-five\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const outbidHeight = laterClaim.match(
    /\.claim-after-ticket\[data-claim-after-ticket\] \.outbid\s*\{[^}]*height:\s*([\d.]+)rem/,
  );
  const prizeSize = cssSource.match(
    /\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const emptyOutbid = cssSource.match(
    /\.week-empty \.claim\.empty-claim-first\[data-empty-claim-first\] \.outbid\[data-first-click="claim"\]\s*\{[^}]*min-height:\s*([\d.]+)rem/,
  );
  assert.ok(openSize && outbidHeight && prizeSize && emptyOutbid);
  assert.ok(Number(outbidHeight[1]) < Number(openSize[1]));
  assert.ok(Number(outbidHeight[1]) < Number(emptyOutbid[1]));
  assert.ok(Number(prizeSize[1]) > Number(outbidHeight[1]));

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  const emptyClaim = empty.indexOf('id="claim"');
  const emptyFirst = empty.indexOf('data-first-click="claim"');
  const emptyOutbidAt = empty.indexOf(">Outbid<");
  const emptyUrl = empty.indexOf("Then the brief URL");
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-first-click="claim"/);
  assert.match(empty, /class="claim ticket-blank empty-claim-first"/);
  assert.doesNotMatch(empty, /data-claim-after-ticket/);
  assert.doesNotMatch(empty, /class="claim-after-ticket"/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-first-click="open"/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.ok(emptyFirst > emptyClaim && emptyOutbidAt > emptyFirst);
  assert.ok(emptyUrl > emptyOutbidAt);

  const leftover = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: [],
      unpaid: [
        {
          sessionId: "fix_abandoned",
          weekId: WEEK,
          buyer: "Ghost Studio",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/ghost",
          bidUsd: 99,
        },
      ],
    }),
  );
  assert.match(leftover, /No paid brief/);
  assert.match(leftover, /data-unpaid-off=""/);
  assert.match(leftover, /Claim #1 for/);
  assert.doesNotMatch(leftover, /data-claim-after-ticket/);
  assert.doesNotMatch(leftover, /Open this brief/);
  assert.doesNotMatch(leftover, /Ghost Studio/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          deadline: "2026-09-15",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
          clicks: 4,
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          deadline: "2026-10-01",
          winnerRule: "First qualified",
          briefUrl: "https://example.com/hopper",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
          clicks: 2,
        }),
      ]),
    }),
  );
  const prizeAt = occupied.indexOf('data-prize=""');
  const openAt = occupied.indexOf("Open this brief");
  const firstClickAt = occupied.indexOf('data-first-click="open"');
  const writeFootAt = occupied.indexOf('class="ticket-write-later"');
  const packAt = occupied.indexOf('data-later-pack=""');
  const hopperStart = occupied.indexOf('data-listing-id="lst_hopper"');
  const wrapAt = occupied.indexOf('data-claim-after-ticket=""');
  const claimAt = occupied.indexOf('id="claim"');
  const outbidAt = occupied.indexOf(">Outbid<");
  const lead = occupied.slice(
    occupied.indexOf('data-listing-id="lst_lead"'),
    packAt,
  );
  const hopper = occupied.slice(hopperStart, wrapAt);
  assert.ok(prizeAt >= 0 && firstClickAt > prizeAt && openAt > firstClickAt);
  assert.ok(writeFootAt > openAt && packAt > writeFootAt);
  assert.ok(hopperStart > packAt && wrapAt > hopperStart);
  assert.ok(claimAt > wrapAt && outbidAt > claimAt);
  assert.match(occupied, /class="claim-after-ticket"/);
  assert.match(occupied, /data-claim-after-ticket=""/);
  assert.match(occupied, /class="claim ticket-blank write-later"/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, />Outbid</);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /data-prize=""/);
  assert.match(occupied, /data-rank-is-bid=""/);
  assert.match(occupied, /ticket-write-later/);
  assert.match(occupied, /These tickets are not the last 7 days’ #1 prize/);
  assert.match(occupied, /Rolling last 7 days\. Not Monday 00:00 UTC\./);
  assert.match(lead, /Open this brief/);
  assert.match(lead, /Best portfolio by Friday/);
  assert.doesNotMatch(lead, /id="claim"/);
  assert.doesNotMatch(lead, />Outbid</);
  assert.doesNotMatch(hopper, /Open this brief/);
  assert.doesNotMatch(hopper, /id="claim"/);
  assert.doesNotMatch(hopper, /data-claim-after-ticket/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /empty-claim-first/);
  assert.doesNotMatch(occupied, /Then the brief URL/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.equal((occupied.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((occupied.match(/data-claim-after-ticket=""/g) ?? []).length, 1);
  assert.equal((occupied.match(/id="claim"/g) ?? []).length, 1);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
});

test("occupied raise identity is last-7-days, not this week", () => {
  assert.match(formSource, /Already on the last 7 days\?/);
  assert.doesNotMatch(formSource, /Already on this week\?/);
  assert.match(formSource, /Enter the same brief URL and raise/);

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-first-click="claim"/);
  assert.doesNotMatch(empty, /Already on this week/);
  assert.doesNotMatch(empty, /Already on the last 7 days/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          winnerRule: "Best portfolio by Friday",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T10:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.match(occupied, /Already on the last 7 days\?/);
  assert.match(occupied, /Enter the same brief URL and raise/);
  assert.match(occupied, /Raise pays the difference only after checkout lands/);
  assert.doesNotMatch(occupied, /Already on this week/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /Open this brief/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, /data-claim-after-ticket=""/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
});

test("occupied desk chrome names last-7-days, not this week", () => {
  assert.match(boardSource, /The last 7 days’ #1 freelance brief/);
  assert.match(boardSource, /The last 7 days’ #1/);
  assert.match(boardSource, /These tickets are not the last 7 days’ #1 prize/);
  assert.match(boardSource, /The last 7 days’ board is empty/);
  assert.doesNotMatch(boardSource, /This week’s #1 freelance brief/);
  assert.doesNotMatch(boardSource, /This week’s board is empty/);
  assert.doesNotMatch(boardSource, /These tickets are not this week’s #1 prize/);
  assert.doesNotMatch(
    boardSource,
    /data-write-after-open-seven|data-open-after-write-six|data-write-after-open-N/,
  );

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(empty, /The last 7 days’ #1 freelance brief/);
  assert.match(empty, /The last 7 days’ #1/);
  assert.match(empty, /The last 7 days’ board is empty/);
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-first-click="claim"/);
  assert.doesNotMatch(empty, /This week’s #1/);
  assert.doesNotMatch(empty, /This week’s board is empty/);
  assert.doesNotMatch(empty, /These tickets are not the last 7 days’ #1 prize/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-prize=/);

  const sundayPay = listing({
    id: "lst_lead",
    buyer: "Lead Studio",
    weekId: "2026-W33",
    bidUsd: 12,
    firstPaidAt: "2026-08-16T12:00:00.000Z",
    lastPaidAt: "2026-08-16T12:00:00.000Z",
    winnerRule: "Best portfolio by Friday",
    briefUrl: "https://example.com/lead",
  });
  const hopper = listing({
    id: "lst_hopper",
    buyer: "Hopper Studio",
    weekId: "2026-W33",
    bidUsd: 6,
    firstPaidAt: "2026-08-16T13:00:00.000Z",
    lastPaidAt: "2026-08-16T13:00:00.000Z",
    winnerRule: "First qualified",
    briefUrl: "https://example.com/hopper",
  });
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(monday),
      listings: rankListings([sundayPay, hopper], monday),
    }),
  );
  assert.match(occupied, /The last 7 days’ #1 freelance brief/);
  assert.match(occupied, /The last 7 days’ #1/);
  assert.match(occupied, /These tickets are not the last 7 days’ #1 prize/);
  assert.doesNotMatch(occupied, /This week’s #1/);
  assert.doesNotMatch(occupied, /this week’s #1 prize/i);
  assert.match(occupied, /data-desk-surface="occupied"/);
  assert.match(occupied, /data-listing-id="lst_lead"/);
  assert.match(occupied, /Open this brief/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /data-prize=""/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, /Already on the last 7 days\?/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
});

test("occupied mast week label follows last-7-days, not ISO weekId", () => {
  assert.match(boardSource, /data-occupied-window=""/);
  assert.match(boardSource, /Last 7 days\./);
  assert.match(
    cssSource,
    /\.week-occupied \.period-meta\[data-occupied-window\]/,
  );
  assert.doesNotMatch(
    boardSource,
    /data-write-after-open-seven|data-open-after-write-six|data-write-after-open-N/,
  );
  const occupiedMeta =
    boardSource.split('data-occupied-window=""', 2)[1]?.slice(0, 420) ?? "";
  assert.match(occupiedMeta, /Last 7 days\./);
  assert.doesNotMatch(occupiedMeta, /Week \{week\.weekId\}/);

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(empty, /class="period-meta"/);
  assert.match(empty, /The last 7 days’ #1 freelance brief/);
  assert.match(empty, /The last 7 days’ board is empty/);
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-first-click="claim"/);
  assert.doesNotMatch(empty, /data-occupied-window/);
  assert.doesNotMatch(empty, /Last 7 days\. Window since/);
  assert.doesNotMatch(empty, /This week’s #1/);
  assert.doesNotMatch(empty, /This week’s board is empty/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-prize=/);

  const sundayPay = listing({
    id: "lst_lead",
    buyer: "Lead Studio",
    weekId: "2026-W33",
    bidUsd: 12,
    firstPaidAt: "2026-08-16T12:00:00.000Z",
    lastPaidAt: "2026-08-16T12:00:00.000Z",
    winnerRule: "Best portfolio by Friday",
    briefUrl: "https://example.com/lead",
  });
  const hopper = listing({
    id: "lst_hopper",
    buyer: "Hopper Studio",
    weekId: "2026-W33",
    bidUsd: 6,
    firstPaidAt: "2026-08-16T13:00:00.000Z",
    lastPaidAt: "2026-08-16T13:00:00.000Z",
    winnerRule: "First qualified",
    briefUrl: "https://example.com/hopper",
  });
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(monday),
      listings: rankListings([sundayPay, hopper], monday),
    }),
  );
  const mast = occupied.slice(0, occupied.indexOf("data-desk-surface"));
  assert.match(mast, /data-occupied-window=""/);
  assert.match(mast, /Last 7 days\./);
  assert.doesNotMatch(mast, /Week 2026-W34/);
  assert.doesNotMatch(mast, /Week 2026-W33/);
  assert.match(occupied, /The last 7 days’ #1 freelance brief/);
  assert.match(occupied, /The last 7 days’ #1/);
  assert.match(occupied, /These tickets are not the last 7 days’ #1 prize/);
  assert.match(occupied, /data-desk-surface="occupied"/);
  assert.match(occupied, /data-listing-id="lst_lead"/);
  assert.match(occupied, /Open this brief/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /data-prize=""/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, /Already on the last 7 days\?/);
  assert.doesNotMatch(occupied, /This week’s #1/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
});

test("occupied mast window since is last-7-days, not an ISO timestamp", () => {
  assert.match(boardSource, /data-occupied-since=""/);
  assert.match(boardSource, /Window last 7 days/);
  assert.match(boardSource, /Last 7 days\./);
  assert.match(
    cssSource,
    /\.week-occupied \.period-meta\[data-occupied-window\] \[data-occupied-since\]/,
  );
  assert.doesNotMatch(
    boardSource,
    /data-write-after-open-seven|data-open-after-write-six|data-write-after-open-N/,
  );
  const occupiedMeta =
    boardSource.split('data-occupied-window=""', 2)[1]?.slice(0, 520) ?? "";
  assert.match(occupiedMeta, /Last 7 days\./);
  assert.match(occupiedMeta, /data-occupied-since=""/);
  assert.match(occupiedMeta, /Window last 7 days/);
  assert.doesNotMatch(occupiedMeta, /Window since \{week\.startsAt\}/);
  assert.doesNotMatch(occupiedMeta, /week\.startsAt/);
  assert.doesNotMatch(occupiedMeta, /Week \{week\.weekId\}/);
  assert.doesNotMatch(occupiedMeta, /data-empty-since/);

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(empty, /class="period-meta"/);
  assert.match(empty, /The last 7 days’ #1 freelance brief/);
  assert.match(empty, /The last 7 days’ board is empty/);
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-first-click="claim"/);
  assert.doesNotMatch(empty, /data-occupied-window/);
  assert.doesNotMatch(empty, /data-occupied-since/);
  assert.doesNotMatch(empty, /This week’s #1/);
  assert.doesNotMatch(empty, /This week’s board is empty/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-prize=/);

  const sundayPay = listing({
    id: "lst_lead",
    buyer: "Lead Studio",
    weekId: "2026-W33",
    bidUsd: 12,
    firstPaidAt: "2026-08-16T12:00:00.000Z",
    lastPaidAt: "2026-08-16T12:00:00.000Z",
    winnerRule: "Best portfolio by Friday",
    briefUrl: "https://example.com/lead",
  });
  const hopper = listing({
    id: "lst_hopper",
    buyer: "Hopper Studio",
    weekId: "2026-W33",
    bidUsd: 6,
    firstPaidAt: "2026-08-16T13:00:00.000Z",
    lastPaidAt: "2026-08-16T13:00:00.000Z",
    winnerRule: "First qualified",
    briefUrl: "https://example.com/hopper",
  });
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(monday),
      listings: rankListings([sundayPay, hopper], monday),
    }),
  );
  const mast = occupied.slice(0, occupied.indexOf("data-desk-surface"));
  assert.match(mast, /data-occupied-window=""/);
  assert.match(mast, /data-occupied-since=""/);
  assert.match(mast, /Last 7 days/);
  assert.match(mast, /Window last 7 days/);
  assert.doesNotMatch(mast, /Window since 2026-08-10T00:00:00.000Z/);
  assert.doesNotMatch(mast, /2026-08-10T00:00:00.000Z/);
  assert.doesNotMatch(mast, /Week 2026-W34/);
  assert.doesNotMatch(mast, /Week 2026-W33/);
  assert.match(occupied, /The last 7 days’ #1 freelance brief/);
  assert.match(occupied, /The last 7 days’ #1/);
  assert.match(occupied, /These tickets are not the last 7 days’ #1 prize/);
  assert.match(occupied, /data-desk-surface="occupied"/);
  assert.match(occupied, /data-listing-id="lst_lead"/);
  assert.match(occupied, /Open this brief/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /data-prize=""/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, /Already on the last 7 days\?/);
  assert.doesNotMatch(occupied, /This week’s #1/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
});

test("empty mast window since is last-7-days, not an ISO timestamp", () => {
  assert.match(boardSource, /data-empty-since=""/);
  assert.match(boardSource, /Window last 7 days/);
  assert.match(boardSource, /data-occupied-since=""/);
  assert.match(cssSource, /\.week-empty \.period-meta \[data-empty-since\]/);
  assert.doesNotMatch(boardSource, /Window since \{week\.startsAt\}/);
  assert.doesNotMatch(
    boardSource,
    /data-write-after-open-seven|data-open-after-write-six|data-write-after-open-N/,
  );
  const emptySinceAt = boardSource.indexOf('data-empty-since=""');
  const emptyMeta = boardSource.slice(
    Math.max(0, emptySinceAt - 180),
    emptySinceAt + 160,
  );
  assert.ok(emptySinceAt > 0);
  assert.match(emptyMeta, /data-empty-since=""/);
  assert.match(emptyMeta, /Window last 7 days/);
  assert.doesNotMatch(emptyMeta, /Window since \{week\.startsAt\}/);
  assert.doesNotMatch(emptyMeta, /week\.startsAt/);
  assert.doesNotMatch(emptyMeta, /data-occupied-window/);
  assert.doesNotMatch(emptyMeta, /data-occupied-since/);

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  const emptyMast = empty.slice(0, empty.indexOf("data-desk-surface"));
  assert.match(emptyMast, /class="period-meta"/);
  assert.match(emptyMast, /data-empty-since=""/);
  assert.match(emptyMast, /Window last 7 days/);
  assert.doesNotMatch(emptyMast, /Window since 2026-08-17T00:00:00.000Z/);
  assert.doesNotMatch(emptyMast, /2026-08-17T00:00:00.000Z/);
  assert.doesNotMatch(emptyMast, /data-occupied-window/);
  assert.doesNotMatch(emptyMast, /data-occupied-since/);
  assert.match(empty, /The last 7 days’ #1 freelance brief/);
  assert.match(empty, /The last 7 days’ board is empty/);
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-first-click="claim"/);
  assert.doesNotMatch(empty, /This week’s #1/);
  assert.doesNotMatch(empty, /This week’s board is empty/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-prize=/);

  const monday = new Date("2026-08-17T00:00:00.000Z");
  const emptyMonday = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(monday),
      listings: [],
    }),
  );
  const mondayMast = emptyMonday.slice(
    0,
    emptyMonday.indexOf("data-desk-surface"),
  );
  assert.match(mondayMast, /data-empty-since=""/);
  assert.match(mondayMast, /Window last 7 days/);
  assert.doesNotMatch(mondayMast, /Window since 2026-08-10T00:00:00.000Z/);
  assert.doesNotMatch(mondayMast, /2026-08-10T00:00:00.000Z/);
  assert.match(emptyMonday, /No paid brief/);
  assert.match(emptyMonday, /Claim #1 for/);
  assert.match(emptyMonday, /data-first-click="claim"/);
  assert.doesNotMatch(emptyMonday, /Open this brief/);
  assert.doesNotMatch(emptyMonday, /data-prize=/);

  const sundayPay = listing({
    id: "lst_lead",
    buyer: "Lead Studio",
    weekId: "2026-W33",
    bidUsd: 12,
    firstPaidAt: "2026-08-16T12:00:00.000Z",
    lastPaidAt: "2026-08-16T12:00:00.000Z",
    winnerRule: "Best portfolio by Friday",
    briefUrl: "https://example.com/lead",
  });
  const hopper = listing({
    id: "lst_hopper",
    buyer: "Hopper Studio",
    weekId: "2026-W33",
    bidUsd: 6,
    firstPaidAt: "2026-08-16T13:00:00.000Z",
    lastPaidAt: "2026-08-16T13:00:00.000Z",
    winnerRule: "First qualified",
    briefUrl: "https://example.com/hopper",
  });
  const occupiedEmptyCut = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(monday),
      listings: rankListings([sundayPay, hopper], monday),
    }),
  );
  const occupiedMast = occupiedEmptyCut.slice(
    0,
    occupiedEmptyCut.indexOf("data-desk-surface"),
  );
  assert.match(occupiedMast, /data-occupied-window=""/);
  assert.match(occupiedMast, /data-occupied-since=""/);
  assert.match(occupiedMast, /Last 7 days/);
  assert.match(occupiedMast, /Window last 7 days/);
  assert.doesNotMatch(occupiedMast, /data-empty-since/);
  assert.doesNotMatch(occupiedMast, /Week 2026-W34/);
  assert.doesNotMatch(occupiedMast, /Week 2026-W33/);
  assert.doesNotMatch(occupiedMast, /Window since 2026-08-10T00:00:00.000Z/);
  assert.match(occupiedEmptyCut, /The last 7 days’ #1 freelance brief/);
  assert.match(occupiedEmptyCut, /The last 7 days’ #1/);
  assert.match(occupiedEmptyCut, /These tickets are not the last 7 days’ #1 prize/);
  assert.match(occupiedEmptyCut, /data-desk-surface="occupied"/);
  assert.match(occupiedEmptyCut, /data-listing-id="lst_lead"/);
  assert.match(occupiedEmptyCut, /Open this brief/);
  assert.match(occupiedEmptyCut, /data-first-click="open"/);
  assert.match(occupiedEmptyCut, /data-prize=""/);
  assert.match(occupiedEmptyCut, /Claim #1 for/);
  assert.match(occupiedEmptyCut, /Already on the last 7 days\?/);
  assert.doesNotMatch(occupiedEmptyCut, /This week’s #1/);
  assert.doesNotMatch(occupiedEmptyCut, /data-first-click="claim"/);
  assert.doesNotMatch(occupiedEmptyCut, /data-write-after-open-seven/);
  assert.doesNotMatch(occupiedEmptyCut, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
  assert.doesNotMatch(emptyMonday, RATINGS_FORBIDDEN);
  assert.doesNotMatch(occupiedEmptyCut, RATINGS_FORBIDDEN);
});

test("empty mast week label follows last-7-days, not ISO weekId", () => {
  assert.match(boardSource, /data-empty-window=""/);
  assert.match(boardSource, /Last 7 days\./);
  assert.doesNotMatch(boardSource, /Week \{week\.weekId\}/);
  assert.match(cssSource, /\.week-empty \.period-meta\[data-empty-window\]/);
  assert.doesNotMatch(
    boardSource,
    /data-write-after-open-seven|data-open-after-write-six|data-write-after-open-N/,
  );
  const emptyWindowAt = boardSource.indexOf('data-empty-window=""');
  const emptyMeta =
    emptyWindowAt >= 0
      ? boardSource.slice(emptyWindowAt, emptyWindowAt + 220)
      : "";
  assert.ok(emptyWindowAt > 0);
  assert.match(emptyMeta, /Last 7 days\./);
  assert.doesNotMatch(emptyMeta, /Week \{week\.weekId\}/);
  assert.match(emptyMeta, /data-empty-since=""/);
  assert.match(emptyMeta, /Window last 7 days/);
  assert.doesNotMatch(emptyMeta, /data-occupied-window/);
  assert.doesNotMatch(emptyMeta, /data-occupied-since/);

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  const emptyMast = empty.slice(0, empty.indexOf("data-desk-surface"));
  assert.match(emptyMast, /class="period-meta"/);
  assert.match(emptyMast, /data-empty-window=""/);
  assert.match(emptyMast, /Last 7 days\./);
  assert.doesNotMatch(emptyMast, /Week 2026-W34/);
  assert.doesNotMatch(emptyMast, /Week 2026-W33/);
  assert.match(emptyMast, /data-empty-since=""/);
  assert.match(emptyMast, /Window last 7 days/);
  assert.doesNotMatch(emptyMast, /data-occupied-window/);
  assert.doesNotMatch(emptyMast, /data-occupied-since/);
  assert.match(empty, /The last 7 days’ #1 freelance brief/);
  assert.match(empty, /The last 7 days’ board is empty/);
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-first-click="claim"/);
  assert.doesNotMatch(empty, /This week’s #1/);
  assert.doesNotMatch(empty, /This week’s board is empty/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-prize=/);

  const monday = new Date("2026-08-17T00:00:00.000Z");
  const emptyMonday = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(monday),
      listings: [],
    }),
  );
  const mondayMast = emptyMonday.slice(
    0,
    emptyMonday.indexOf("data-desk-surface"),
  );
  assert.match(mondayMast, /data-empty-window=""/);
  assert.match(mondayMast, /Last 7 days\./);
  assert.doesNotMatch(mondayMast, /Week 2026-W34/);
  assert.doesNotMatch(mondayMast, /Week 2026-W33/);
  assert.match(mondayMast, /data-empty-since=""/);
  assert.match(mondayMast, /Window last 7 days/);
  assert.match(emptyMonday, /The last 7 days’ board is empty/);
  assert.doesNotMatch(emptyMonday, /This week’s board is empty/);
  assert.match(emptyMonday, /No paid brief/);
  assert.match(emptyMonday, /Claim #1 for/);
  assert.match(emptyMonday, /data-first-click="claim"/);
  assert.doesNotMatch(emptyMonday, /Open this brief/);
  assert.doesNotMatch(emptyMonday, /data-prize=/);

  const sundayPay = listing({
    id: "lst_lead",
    buyer: "Lead Studio",
    weekId: "2026-W33",
    bidUsd: 12,
    firstPaidAt: "2026-08-16T12:00:00.000Z",
    lastPaidAt: "2026-08-16T12:00:00.000Z",
    winnerRule: "Best portfolio by Friday",
    briefUrl: "https://example.com/lead",
  });
  const hopper = listing({
    id: "lst_hopper",
    buyer: "Hopper Studio",
    weekId: "2026-W33",
    bidUsd: 6,
    firstPaidAt: "2026-08-16T13:00:00.000Z",
    lastPaidAt: "2026-08-16T13:00:00.000Z",
    winnerRule: "First qualified",
    briefUrl: "https://example.com/hopper",
  });
  const occupiedEmptyCut = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(monday),
      listings: rankListings([sundayPay, hopper], monday),
    }),
  );
  const occupiedMast = occupiedEmptyCut.slice(
    0,
    occupiedEmptyCut.indexOf("data-desk-surface"),
  );
  assert.match(occupiedMast, /data-occupied-window=""/);
  assert.match(occupiedMast, /Last 7 days\./);
  assert.doesNotMatch(occupiedMast, /data-empty-window/);
  assert.doesNotMatch(occupiedMast, /data-empty-since/);
  assert.doesNotMatch(occupiedMast, /Week 2026-W34/);
  assert.doesNotMatch(occupiedMast, /Week 2026-W33/);
  assert.match(occupiedEmptyCut, /The last 7 days’ #1 freelance brief/);
  assert.match(occupiedEmptyCut, /The last 7 days’ #1/);
  assert.match(occupiedEmptyCut, /These tickets are not the last 7 days’ #1 prize/);
  assert.match(occupiedEmptyCut, /data-desk-surface="occupied"/);
  assert.match(occupiedEmptyCut, /data-listing-id="lst_lead"/);
  assert.match(occupiedEmptyCut, /Open this brief/);
  assert.match(occupiedEmptyCut, /data-first-click="open"/);
  assert.match(occupiedEmptyCut, /data-prize=""/);
  assert.match(occupiedEmptyCut, /Claim #1 for/);
  assert.match(occupiedEmptyCut, /Already on the last 7 days\?/);
  assert.doesNotMatch(occupiedEmptyCut, /This week’s #1/);
  assert.doesNotMatch(occupiedEmptyCut, /data-first-click="claim"/);
  assert.doesNotMatch(occupiedEmptyCut, /data-write-after-open-seven/);
  assert.doesNotMatch(occupiedEmptyCut, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
  assert.doesNotMatch(emptyMonday, RATINGS_FORBIDDEN);
  assert.doesNotMatch(occupiedEmptyCut, RATINGS_FORBIDDEN);
});

test("empty desk chrome names last-7-days, not this week", () => {
  assert.match(boardSource, /The last 7 days’ #1 freelance brief/);
  assert.match(boardSource, /The last 7 days’ #1/);
  assert.match(boardSource, /The last 7 days’ board is empty/);
  assert.doesNotMatch(boardSource, /This week’s #1 freelance brief/);
  assert.doesNotMatch(boardSource, /This week’s board is empty/);
  assert.doesNotMatch(boardSource, />This week’s #1</);
  assert.doesNotMatch(
    boardSource,
    /data-write-after-open-seven|data-open-after-write-six|data-write-after-open-N/,
  );

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(empty, /The last 7 days’ #1 freelance brief/);
  assert.match(empty, /The last 7 days’ #1/);
  assert.match(empty, /The last 7 days’ board is empty/);
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-first-click="claim"/);
  assert.match(empty, /data-empty-week="true"/);
  assert.doesNotMatch(empty, /This week’s #1/);
  assert.doesNotMatch(empty, /This week’s board is empty/);
  assert.doesNotMatch(empty, /These tickets are not the last 7 days’ #1 prize/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /Write this ticket/);
  assert.doesNotMatch(empty, /data-prize=/);
  assert.doesNotMatch(empty, /data-first-click="open"/);

  const monday = new Date("2026-08-17T00:00:00.000Z");
  const emptyMonday = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(monday),
      listings: [],
    }),
  );
  assert.match(emptyMonday, /The last 7 days’ #1 freelance brief/);
  assert.match(emptyMonday, /The last 7 days’ #1/);
  assert.match(emptyMonday, /The last 7 days’ board is empty/);
  assert.match(emptyMonday, /No paid brief/);
  assert.match(emptyMonday, /Claim #1 for/);
  assert.match(emptyMonday, /data-first-click="claim"/);
  assert.doesNotMatch(emptyMonday, /This week’s #1/);
  assert.doesNotMatch(emptyMonday, /This week’s board is empty/);
  assert.doesNotMatch(emptyMonday, /Week 2026-W34/);
  assert.doesNotMatch(emptyMonday, /Open this brief/);
  assert.doesNotMatch(emptyMonday, /data-prize=/);

  const sundayPay = listing({
    id: "lst_lead",
    buyer: "Lead Studio",
    weekId: "2026-W33",
    bidUsd: 12,
    firstPaidAt: "2026-08-16T12:00:00.000Z",
    lastPaidAt: "2026-08-16T12:00:00.000Z",
    winnerRule: "Best portfolio by Friday",
    briefUrl: "https://example.com/lead",
  });
  const hopper = listing({
    id: "lst_hopper",
    buyer: "Hopper Studio",
    weekId: "2026-W33",
    bidUsd: 6,
    firstPaidAt: "2026-08-16T13:00:00.000Z",
    lastPaidAt: "2026-08-16T13:00:00.000Z",
    winnerRule: "First qualified",
    briefUrl: "https://example.com/hopper",
  });
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(monday),
      listings: rankListings([sundayPay, hopper], monday),
    }),
  );
  assert.match(occupied, /The last 7 days’ #1 freelance brief/);
  assert.match(occupied, /The last 7 days’ #1/);
  assert.match(occupied, /These tickets are not the last 7 days’ #1 prize/);
  assert.doesNotMatch(occupied, /The last 7 days’ board is empty/);
  assert.doesNotMatch(occupied, /This week’s #1/);
  assert.match(occupied, /data-desk-surface="occupied"/);
  assert.match(occupied, /data-listing-id="lst_lead"/);
  assert.match(occupied, /Open this brief/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /data-prize=""/);
  assert.match(occupied, /Claim #1 for/);
  assert.match(occupied, /Already on the last 7 days\?/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
  assert.doesNotMatch(emptyMonday, RATINGS_FORBIDDEN);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
});

test("document chrome names last-7-days, not this week", () => {
  assert.match(layoutSource, /Brief desk — the last 7 days’ #1 freelance brief/);
  assert.match(layoutSource, /Pin the last 7 days’ #1 job ticket/);
  assert.match(boardSource, /The last 7 days’ #1 freelance brief/);
  assert.match(boardSource, /The last 7 days’ board is empty/);
  assert.doesNotMatch(layoutSource, /this week’s #1 freelance brief/);
  assert.doesNotMatch(layoutSource, /this week’s #1 job ticket/);
  assert.doesNotMatch(layoutSource, /This week’s/);
  assert.doesNotMatch(
    layoutSource,
    /data-write-after-open-seven|data-open-after-write-six|data-write-after-open-N/,
  );
  assert.doesNotMatch(
    cssSource,
    /occupied-rolling-chrome|occupied-mast-window|occupied-mast-since|empty-mast-since|empty-mast-window|empty-desk-chrome|raise-rolling-identity/,
  );

  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(empty, /The last 7 days’ #1 freelance brief/);
  assert.match(empty, /The last 7 days’ board is empty/);
  assert.match(empty, /No paid brief/);
  assert.match(empty, /Claim #1 for/);
  assert.match(empty, /data-first-click="claim"/);
  assert.doesNotMatch(empty, /This week’s #1/);
  assert.doesNotMatch(empty, /Open this brief/);
  assert.doesNotMatch(empty, /data-prize=/);

  const monday = new Date("2026-08-17T00:00:00.000Z");
  const emptyMonday = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(monday),
      listings: [],
    }),
  );
  assert.match(emptyMonday, /The last 7 days’ #1 freelance brief/);
  assert.match(emptyMonday, /No paid brief/);
  assert.match(emptyMonday, /Claim #1 for/);
  assert.doesNotMatch(emptyMonday, /This week’s #1/);
  assert.doesNotMatch(emptyMonday, /Week 2026-W34/);
  assert.doesNotMatch(emptyMonday, /Open this brief/);

  const sundayPay = listing({
    id: "lst_lead",
    buyer: "Lead Studio",
    weekId: "2026-W33",
    bidUsd: 12,
    firstPaidAt: "2026-08-16T12:00:00.000Z",
    lastPaidAt: "2026-08-16T12:00:00.000Z",
    winnerRule: "Best portfolio by Friday",
    briefUrl: "https://example.com/lead",
  });
  const hopper = listing({
    id: "lst_hopper",
    buyer: "Hopper Studio",
    weekId: "2026-W33",
    bidUsd: 6,
    firstPaidAt: "2026-08-16T13:00:00.000Z",
    lastPaidAt: "2026-08-16T13:00:00.000Z",
    winnerRule: "First qualified",
    briefUrl: "https://example.com/hopper",
  });
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(monday),
      listings: rankListings([sundayPay, hopper], monday),
    }),
  );
  assert.match(occupied, /The last 7 days’ #1 freelance brief/);
  assert.match(occupied, /Open this brief/);
  assert.match(occupied, /data-first-click="open"/);
  assert.match(occupied, /data-prize=""/);
  assert.match(occupied, /Claim #1 for/);
  assert.doesNotMatch(occupied, /This week’s #1/);
  assert.doesNotMatch(occupied, /data-first-click="claim"/);
  assert.doesNotMatch(occupied, /data-write-after-open-seven/);
  assert.doesNotMatch(occupied, /data-open-after-write-six/);
  assert.doesNotMatch(empty, RATINGS_FORBIDDEN);
  assert.doesNotMatch(emptyMonday, RATINGS_FORBIDDEN);
  assert.doesNotMatch(occupied, RATINGS_FORBIDDEN);
});

