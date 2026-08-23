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
  assert.doesNotMatch(html, /data-read-budget/);
  assert.doesNotMatch(html, /Project budget, not the bid/);
  assert.doesNotMatch(html, /data-read-deadline/);
  assert.doesNotMatch(html, /Due date, not a score/);
  assert.doesNotMatch(html, /data-read-winner/);
  assert.doesNotMatch(html, /Winner rule, not a score/);
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
  assert.doesNotMatch(html.slice(hopperStart), /Open this brief/);
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
  assert.ok(openLead < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(hopperStart > claimAt);
  assert.equal(html.includes("Write this ticket", hopperStart), false);
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
  assert.ok(bidStub > leadStart && bidStub < budgetAt);
  assert.equal(html.includes('data-read-budget="lead"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart), /Project budget, not the bid/);
  assert.match(html.slice(hopperStart), /Budget \$800/);
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
  assert.ok(bidStub > leadStart && bidStub < deadlineAt);
  assert.equal(html.includes('data-read-deadline="lead"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart), /Due date, not a score/);
  assert.doesNotMatch(html.slice(hopperStart), /15 September 2026/);
  assert.match(html.slice(hopperStart), /Deadline 2026-10-01/);
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
  assert.ok(bidStub > leadStart && bidStub < winnerAt);
  assert.equal(html.includes('data-read-winner="lead"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart), /Winner rule, not a score/);
  assert.doesNotMatch(html.slice(hopperStart), /Best portfolio by Friday/);
  assert.match(html.slice(hopperStart), /First qualified/);
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
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""/,
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
  assert.ok(writeAfterAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > leadStart && bidStub < writeAfterAt);
  assert.equal(html.includes('data-write-after-rule=""', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart), /Write this ticket/);
  assert.match(html.slice(hopperStart), /First qualified/);
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
  assert.doesNotMatch(html, /after the winner rule/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
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
  assert.ok(bidStub > leadStart && bidStub < firstClickAt);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart), /Write this ticket/);
  assert.match(html.slice(hopperStart), /First qualified/);
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
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""/,
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
  assert.ok(writeAfterOpenTwoAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > leadStart && bidStub < firstClickAt);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart), /Write this ticket/);
  assert.match(html.slice(hopperStart), /First qualified/);
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
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
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
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""/,
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
  assert.equal((html.match(/data-open-brief="lead"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/click\/lst_lead"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
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
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
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
  assert.ok(openAfterWriteTwoAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > leadStart && bidStub < firstClickAt);
  assert.ok(Math.abs(openAfterWriteAt - firstClickAt) < 160);
  assert.equal(html.includes('data-open-after-write-first=""', hopperStart), false);
  assert.equal(html.includes('data-first-read="open"', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart), /Write this ticket/);
  assert.match(html.slice(hopperStart), /First qualified/);
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
  assert.doesNotMatch(html, /data-open-brief/);
  assert.doesNotMatch(html, /Open this brief/);
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-open-two/);
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
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""/,
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
  assert.equal((html.match(/data-open-brief="lead"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/click\/lst_lead"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
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
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
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
  assert.ok(openAfterWriteTwoAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > leadStart && bidStub < firstClickAt);
  assert.ok(Math.abs(writeAfterOpenTwoAt - writeAfterOpenAt) < 120);
  assert.equal(html.includes('data-open-after-write-first=""', hopperStart), false);
  assert.equal(html.includes('data-first-read="open"', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart), /Write this ticket/);
  assert.match(html.slice(hopperStart), /First qualified/);
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
  assert.doesNotMatch(html, /data-write-after-open/);
  assert.doesNotMatch(html, /data-write-after-rule/);
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-after-write-two/);
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
  assert.match(html, /Open this brief/);
  assert.match(html, /href="\/click\/lst_lead"/);
  assert.match(
    html,
    /class="write-after-rule"[^>]*href="#claim"[^>]*data-write-after-rule=""[^>]*data-write-after-open=""[^>]*data-write-after-open-two=""/,
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
  assert.equal((html.match(/data-open-brief="lead"/g) ?? []).length, 1);
  assert.equal((html.match(/href="\/click\/lst_lead"/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-rule=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-write-after-open-two=""/g) ?? []).length, 1);
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
  const openLead = html.indexOf("Open this brief");
  const writeAfterAt = html.indexOf('data-write-after-rule=""');
  const writeAfterOpenAt = html.indexOf('data-write-after-open=""');
  const writeAfterOpenTwoAt = html.indexOf('data-write-after-open-two=""');
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
  assert.ok(openAfterWriteTwoAt < openLead);
  assert.ok(openLead < writeAfterAt);
  assert.ok(writeAfterAt < writeAfterOpenAt);
  assert.ok(writeAfterOpenAt < writeAfterOpenTwoAt);
  assert.ok(writeAfterOpenTwoAt < claimAt);
  assert.ok(writeStampAt > claimAt);
  assert.ok(bidStub > leadStart && bidStub < firstClickAt);
  assert.ok(Math.abs(openAfterWriteTwoAt - firstReadAt) < 120);
  assert.equal(html.includes('data-open-after-write-first=""', hopperStart), false);
  assert.equal(html.includes('data-first-read="open"', hopperStart), false);
  assert.equal(html.includes('data-open-after-write-two=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open=""', hopperStart), false);
  assert.equal(html.includes('data-write-after-open-two=""', hopperStart), false);
  assert.equal(html.includes('data-first-click="open"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart), /Open this brief/);
  assert.doesNotMatch(html.slice(hopperStart), /after the winner rule/);
  assert.doesNotMatch(html.slice(hopperStart), /Write this ticket/);
  assert.match(html.slice(hopperStart), /First qualified/);
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
  assert.doesNotMatch(html, /data-open-after-write-first/);
  assert.doesNotMatch(html, /data-first-read="open"/);
  assert.doesNotMatch(html, /data-first-click="open"/);
  assert.doesNotMatch(html, /data-open-brief/);
  assert.doesNotMatch(html, /Open this brief/);
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

test("current week header uses UTC ISO week", () => {
  const week = currentWeekUtc(new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(week.weekId, "2026-W34");
});
