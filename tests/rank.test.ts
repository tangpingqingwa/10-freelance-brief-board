import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AboutPage from "../src/app/about/page";
import {
  Board,
  filterTodayListings,
  ListingCard,
  formatDeadline,
  periodFromSearch,
} from "../src/app/board";
import { FindPopover } from "../src/app/theme-toggle";
import { resetListings } from "../src/core/listings";
import {
  getBoardListings,
  isPaidListing,
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

const aboutSource = readFileSync(
  join(process.cwd(), "src", "app", "about", "page.tsx"),
  "utf8",
);

const readmeSource = readFileSync(
  join(process.cwd(), "README.md"),
  "utf8",
);

const specSource = readFileSync(join(process.cwd(), "SPEC.md"), "utf8");

const buildSource = readFileSync(join(process.cwd(), "BUILD.md"), "utf8");

const cssSource = readFileSync(
  join(process.cwd(), "src", "app", "board.css"),
  "utf8",
);

const nextConfigSource = readFileSync(
  join(process.cwd(), "next.config.ts"),
  "utf8",
);

const themeSource = readFileSync(
  join(process.cwd(), "src", "app", "theme-toggle.tsx"),
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

test("unpaid checkout never ranks as #1", () => {
  const unpaid = listing({
    id: "lst_unpaid",
    buyer: "Ghost Studio",
    winnerRule: "Best portfolio by Friday",
    bidUsd: 99,
    firstPaidAt: "",
  });
  assert.equal(isPaidListing(unpaid), false);
  assert.deepEqual(rankListings([unpaid]), []);
  assert.equal(
    isPaidListing(
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
  assert.match(html, /<input form="brief-outbid-form"[^>]*name="amountUsd"/);
  assert.match(html, /<form id="brief-outbid-form"/);
  assert.match(html, />Claim rank</);
  assert.match(html, /aria-label="Claim rank"/);
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
  assert.match(formSource, /Claim rank/);
  assert.match(formSource, /Claim #1 for/);
  assert.match(formSource, /Who is buying/);
  assert.match(formSource, /What it pays/);
  assert.match(formSource, /When it’s due/);
  assert.match(formSource, /How a winner is chosen/);
  assert.doesNotMatch(formSource, RATINGS_FORBIDDEN);
});

test("mobile period context keeps the rolling window truthful", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  const contextAt = html.indexOf('data-context-window="rolling-7-days"');
  const tabsAt = html.indexOf('data-period-tabs=""');
  const surfaceAt = html.indexOf('data-desk-surface="empty"');
  const contractAt = html.indexOf('data-board-contract-note=""');

  assert.ok(contextAt >= 0, "the live rolling context remains explicit");
  assert.ok(tabsAt > contextAt, "period tabs follow the live context");
  assert.ok(contractAt > surfaceAt, "the paid-only contract sits after the board");
  assert.equal(
    (html.match(/data-context-window="rolling-7-days"/g) ?? []).length,
    1,
  );
  assert.match(html, /data-period="rolling"/);
  assert.match(html, /data-period="today"/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /aria-selected="false"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /tabindex="-1"/);
  assert.doesNotMatch(html, /data-period="today"[^>]*aria-disabled="true"/);
  assert.match(boardSource, /history\.pushState/);
  assert.match(boardSource, /popstate/);
  assert.match(boardSource, /filterTodayListings/);
  assert.match(cssSource, /\.period-tabs\s*\{[\s\S]*?display:\s*flex/);
  assert.match(cssSource, /\.period-tabs\s*\{[\s\S]*?width:\s*10\.805rem/);
  assert.match(
    cssSource,
    /@media\s*\(max-width:\s*390px\)[\s\S]*?\.desk-rail\s*\{\s*margin-top:\s*2rem/,
  );
  assert.doesNotMatch(html, /class="context-note"/);
  const r73Css = cssSource.slice(cssSource.lastIndexOf("r7.3 mobile baseline"));
  assert.match(r73Css, /\.context-pill\s*\{[\s\S]*?height:\s*2rem/);
  assert.match(
    r73Css,
    /\.period-tabs\s*\{[\s\S]*?margin:\s*1\.375rem auto 1\.875rem/,
  );
});

test("r28 mobile claim ticket promotes the write rail and keeps controls in one column", () => {
  const r28Css = cssSource.slice(
    cssSource.lastIndexOf("r28 own identity: dispatch desk"),
  );
  const mobileCss = r28Css.slice(
    r28Css.lastIndexOf("@media (max-width: 760px)"),
  );

  assert.match(
    mobileCss,
    /\.claim h2[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?white-space:\s*nowrap;/,
  );
  assert.match(
    mobileCss,
    /\.outbid-form\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/,
  );
  assert.match(
    mobileCss,
    /\.ticket-write-stub\s*\{[\s\S]*?min-height:\s*2\.25rem;[\s\S]*?border-right:\s*0;[\s\S]*?border-bottom:\s*1px dashed[\s\S]*?writing-mode:\s*horizontal-tb;/,
  );
  assert.match(
    mobileCss,
    /\.ticket-write-face\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/,
  );
  assert.match(
    mobileCss,
    /\.claim-controls\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/,
  );
  assert.match(
    mobileCss,
    /\.claim-controls \.ticket-fields > \.ticket-primary-field,[\s\S]*?\.claim-controls > \.bid-row\s*\{\s*grid-column:\s*1;/,
  );
  assert.match(
    mobileCss,
    /\.bid-row\s*\{\s*grid-column:\s*1;[\s\S]*?width:\s*100%;/,
  );
});

test("r30 desktop claim ticket gives the writing face a readable track", () => {
  const r28Css = cssSource.slice(
    cssSource.lastIndexOf("r28 own identity: dispatch desk"),
  );
  const desktopCss = r28Css.slice(
    0,
    r28Css.lastIndexOf("@media (max-width: 760px)"),
  );

  assert.match(
    desktopCss,
    /@media\s*\(min-width:\s*761px\)[\s\S]*?\.board\s*\{[\s\S]*?grid-template-columns:\s*minmax\(20rem, 0\.86fr\)\s+minmax\(0, 1\.14fr\);/,
  );
  assert.match(
    desktopCss,
    /@media\s*\(min-width:\s*761px\)[\s\S]*?\.outbid-form,[\s\S]*?\.ticket-write-face\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/,
  );
  assert.match(
    desktopCss,
    /@media\s*\(min-width:\s*761px\)[\s\S]*?\.ticket-write-stub\s*\{[\s\S]*?display:\s*flex;[\s\S]*?grid-column:\s*1;[\s\S]*?\.ticket-write-face\s*\{[\s\S]*?grid-column:\s*2;/,
  );
  assert.match(
    desktopCss,
    /@media\s*\(min-width:\s*761px\)[\s\S]*?\.claim-note,[\s\S]*?\.raise-hint\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/,
  );
  assert.match(
    desktopCss,
    /@media\s*\(min-width:\s*761px\)[\s\S]*?\.claim-controls\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?\.claim-controls > \.ticket-fields,[\s\S]*?\.claim-controls > \.bid-row\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?width:\s*100%;/,
  );
});

test("r28 paid ticket log keeps paper metadata dark and rank clicks intact", () => {
  const r28Css = cssSource.slice(
    cssSource.lastIndexOf("r28 own identity: dispatch desk"),
  );
  const mobileCss = r28Css.slice(
    r28Css.lastIndexOf("@media (max-width: 760px)"),
  );

  assert.match(
    r28Css,
    /\.latest-activity-item\s*\{\s*color:\s*var\(--carbon\);\s*\}/,
  );
  assert.match(
    r28Css,
    /\.activity-facts\s*\{[\s\S]*?color:\s*var\(--carbon\);/,
  );
  assert.match(
    mobileCss,
    /\.week-occupied \.top-three \.ticket-later\[data-later-rank\]\s*\.later-rankline \.clicks,[\s\S]*?\.week-occupied \.hopper \.ticket-later\[data-later-rank\]\s*\.later-rankline \.clicks\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow:\s*hidden;[\s\S]*?white-space:\s*nowrap;[\s\S]*?font-family:\s*"Briefdesk Sans"/,
  );
});

test("Today filters paid rows by the real rolling 24-hour paid time", () => {
  const nowMs = Date.parse("2026-08-28T12:00:00.000Z");
  const recent = listing({
    id: "lst_today_recent",
    bidUsd: 12,
    firstPaidAt: "2026-08-27T00:00:00.000Z",
    lastPaidAt: "2026-08-28T04:00:00.000Z",
  });
  const old = listing({
    id: "lst_today_old",
    bidUsd: 14,
    firstPaidAt: "2026-08-26T00:00:00.000Z",
    lastPaidAt: "2026-08-27T11:59:59.000Z",
  });
  const future = listing({
    id: "lst_today_future",
    bidUsd: 16,
    firstPaidAt: "2026-08-28T13:00:00.000Z",
    lastPaidAt: "2026-08-28T13:00:00.000Z",
  });

  assert.deepEqual(
    filterTodayListings(
      [
        { ...recent, rank: 3 },
        { ...old, rank: 1 },
        { ...future, rank: 2 },
      ],
      nowMs,
    ).map((row) => ({ id: row.id, rank: row.rank })),
    [{ id: "lst_today_recent", rank: 1 }],
  );
});

test("period query parsing keeps only the supported same-page modes", () => {
  assert.equal(periodFromSearch("?period=today"), "today");
  assert.equal(periodFromSearch("?period=rolling"), "rolling");
  assert.equal(periodFromSearch("?period=all-time"), "rolling");
  assert.equal(periodFromSearch(""), "rolling");
});

test("Find is a closed accessible paid-brief search island", () => {
  const html = renderToStaticMarkup(createElement(FindPopover));
  assert.match(html, /class="header-search"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(layoutSource, /<FindPopover\s*\/>/);
  assert.match(layoutSource, />\s*Desk\s*</);
  assert.match(
    cssSource,
    /\.site-header\s*\{[\s\S]*?height:\s*76px[\s\S]*?\n\}/,
  );
  assert.match(
    cssSource,
    /\.site-nav\s*\{[\s\S]*?width:\s*max-content[\s\S]*?min-width:\s*max-content[\s\S]*?overflow:\s*visible[\s\S]*?\n\}/,
  );
  assert.doesNotMatch(layoutSource, /href="#claim"/);
  assert.match(themeSource, /role="search"/);
  assert.match(themeSource, /aria-controls="find-popover"/);
  assert.match(themeSource, /MutationObserver/);
  assert.match(themeSource, /pointerdown/);
  assert.match(themeSource, /event\.key !== "Escape"/);
  assert.match(themeSource, /triggerRef\.current\?\.focus/);
  assert.match(themeSource, /briefUrl|host/);
  assert.match(themeSource, /No matching paid brief/);
  assert.doesNotMatch(html, /id="find-popover"/);
});

test("local preview disables only the Next development indicator", () => {
  assert.match(nextConfigSource, /import type \{ NextConfig \} from "next"/);
  assert.match(nextConfigSource, /devIndicators:\s*false/);
  assert.match(nextConfigSource, /export default nextConfig/);
  assert.doesNotMatch(nextConfigSource, /rewrites|redirects|headers|env|webpack/);
});

test("r14.1 calibrates the Claim rank shell fill through existing opacity", () => {
  const disabledRule = cssSource.match(
    /\.outbid:disabled,\s*\.outbid\[aria-disabled="true"\]\s*\{([\s\S]*?)\n\}/,
  );
  assert.ok(disabledRule);
  const disabledDeclarations = disabledRule[1] ?? "";
  assert.match(disabledDeclarations, /background:\s*#de927c;/);
  assert.match(disabledDeclarations, /opacity:\s*0\.62/);
  assert.match(disabledDeclarations, /pointer-events:\s*none/);
  assert.equal((cssSource.match(/#de927c/gi) ?? []).length, 1);

  const finalButtonRules = cssSource.slice(cssSource.lastIndexOf("\n.outbid {"));
  assert.match(finalButtonRules, /height:\s*2\.75rem/);
  assert.match(finalButtonRules, /border-radius:\s*999px/);
  assert.match(
    cssSource,
    /\.outbid:hover:not\(:disabled\)[\s\S]*?background:\s*color-mix\(in srgb, var\(--stamp\) 88%, var\(--ink\)\);/,
  );
});

test("r15 keeps Budget and Due previews as two normal-flow summary rows", () => {
  const componentCss = cssSource.slice(
    cssSource.lastIndexOf("Shared board components"),
  );
  assert.match(
    componentCss,
    /\.ticket-facts-preview \.ticket-summary-line,\s*\.week-occupied \.top-three \.ticket-later\[data-later-rank\] \.later-facts-preview \.ticket-summary-line\s*\{\s*display:\s*block;/,
  );
  assert.match(
    componentCss,
    /ticket-facts-preview[\s\S]*?font-size:\s*0\.64rem[\s\S]*?line-height:\s*1\.25/,
  );
  assert.match(
    componentCss,
    /ticket-actions[\s\S]*?grid-column:\s*2[\s\S]*?grid-row:\s*3/,
  );
});

test("r17 previews the real winner rule in the top-three body rhythm", () => {
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_r17_lead",
          buyer: "Northwind Studio",
          winnerRule: "Best portfolio by Friday",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_r17_signal",
          buyer: "Signal Works",
          winnerRule: "Strongest launch plan",
          bidUsd: 8,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
        listing({
          id: "lst_r17_field",
          buyer: "Field Notes Co",
          winnerRule: "Clear editorial fit",
          bidUsd: 6,
          firstPaidAt: "2026-08-19T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.equal(
    (occupied.match(/class="ticket-summary-line ticket-summary-rule"/g) ?? [])
      .length,
    3,
  );
  assert.match(occupied, /Rule Best portfolio by Friday/);
  assert.match(occupied, /Rule Strongest launch plan/);
  assert.match(occupied, /Rule Clear editorial fit/);
  assert.equal(
    (occupied.match(/class="ticket-summary-line">Budget \$2,500/g) ?? [])
      .length,
    3,
  );
  assert.equal((occupied.match(/Due 1 September 2026/g) ?? []).length, 3);
  assert.equal((occupied.match(/data-ticket-actions=""/g) ?? []).length, 3);
  assert.match(
    cssSource,
    /ticket-summary-rule\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/,
  );
});

test("r9 keeps the full desktop nav label and shared mobile card tracks", () => {
  assert.match(
    layoutSource,
    /<a href="\/" aria-current="page">\s*Desk\s*<\/a>/,
  );

  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Northwind Studio",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_signal",
          buyer: "Signal Works",
          bidUsd: 8,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
        listing({
          id: "lst_field",
          buyer: "Field Notes Co",
          bidUsd: 6,
          firstPaidAt: "2026-08-19T00:00:00.000Z",
        }),
      ]),
    }),
  );
  assert.equal((occupied.match(/data-slot="paid-card"/g) ?? []).length, 3);
  for (const rank of [1, 2, 3]) {
    assert.match(occupied, new RegExp(`data-rank="${rank}"`));
  }

  const r9Css = cssSource.slice(
    cssSource.lastIndexOf("r9 nav/rank-token/card-inner pass"),
  );
  assert.match(
    r9Css,
    /\.site-header-inner\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(max-content, 1fr\) auto auto;/,
  );
  assert.match(
    r9Css,
    /\.site-nav\s*\{[\s\S]*?display:\s*block[\s\S]*?justify-self:\s*end[\s\S]*?overflow:\s*visible/,
  );
  assert.match(
    r9Css,
    /\.site-nav ul\s*\{[\s\S]*?width:\s*max-content[\s\S]*?min-width:\s*max-content/,
  );
  assert.match(
    r9Css,
    /\.site-nav a\s*\{[\s\S]*?display:\s*inline-block[\s\S]*?min-width:\s*max-content[\s\S]*?white-space:\s*nowrap/,
  );
  assert.match(
    r9Css,
    /ticket-featured \.ticket-stub \.rank\s*\{[\s\S]*?background:\s*color-mix\(in srgb, var\(--stamp\) 34%, var\(--surface\)\)[\s\S]*?border:\s*1px solid var\(--accent-line\)/,
  );
  assert.match(
    r9Css,
    /ticket-later\[data-rank="2"\][\s\S]*?background:\s*color-mix\(in srgb, var\(--stamp\) 22%, var\(--surface\)\)[\s\S]*?border:/,
  );
  assert.match(
    r9Css,
    /ticket-later\[data-rank="3"\][\s\S]*?background:\s*color-mix\(in srgb, var\(--stamp\) 12%, var\(--accent-wash-soft\)\)[\s\S]*?border:/,
  );
  assert.match(
    r9Css,
    /ticket-face,[\s\S]*?later-slip\s*\{[\s\S]*?grid-template-rows:\s*1\.25rem minmax\(0, 1fr\) 1\.6rem/,
  );
  assert.match(
    r9Css,
    /ticket-meta,[\s\S]*?grid-column:\s*1[\s\S]*?grid-row:\s*3/,
  );
  assert.match(
    r9Css,
    /ticket-actions,[\s\S]*?grid-column:\s*2[\s\S]*?grid-row:\s*3/,
  );
});

test("r9.1 mobile badges are filled and footer content shares the +86px track", () => {
  const r91Css = cssSource.slice(
    cssSource.lastIndexOf("r9.1 mobile footer/rank surface calibration"),
  );
  assert.match(
    r91Css,
    /ticket-featured \.ticket-stub \.rank\s*\{[\s\S]*?background:\s*color-mix\(in srgb, var\(--stamp\) 34%, var\(--surface\)\)[\s\S]*?color:\s*var\(--stamp\)[\s\S]*?border-radius:\s*999px/,
  );
  assert.match(
    r91Css,
    /ticket-later\[data-rank="2"\][\s\S]*?background:\s*color-mix\(in srgb, var\(--stamp\) 22%, var\(--surface\)\)[\s\S]*?color:\s*var\(--stamp\)/,
  );
  assert.match(
    r91Css,
    /ticket-later\[data-rank="3"\][\s\S]*?background:\s*color-mix\(in srgb, var\(--stamp\) 12%, var\(--accent-wash-soft\)\)[\s\S]*?color:\s*var\(--stamp\)/,
  );
  assert.match(
    r91Css,
    /ticket-meta,[\s\S]*?grid-row:\s*3[\s\S]*?align-self:\s*start[\s\S]*?min-height:\s*1\.6rem/,
  );
  assert.match(
    r91Css,
    /ticket-actions,[\s\S]*?grid-row:\s*3[\s\S]*?align-self:\s*start[\s\S]*?min-height:\s*1\.6rem/,
  );
  assert.match(
    r91Css,
    /ticket-facts-details:not\(\[open\]\) > :not\(summary\)[\s\S]*?display:\s*none/,
  );
  assert.match(
    r91Css,
    /later-facts-details:not\(\[open\]\) > :not\(summary\)[\s\S]*?display:\s*none/,
  );
});

test("r9.2 mobile summary and Open actions start in the shared footer row", () => {
  const r92Css = cssSource.slice(
    cssSource.lastIndexOf("r9.2 action correction"),
  );
  assert.match(
    r92Css,
    /ticket-actions,[\s\S]*?align-items:\s*flex-start[\s\S]*?min-width:\s*0/,
  );
  assert.match(
    r92Css,
    /> details,[\s\S]*?align-self:\s*flex-start[\s\S]*?flex:\s*0 1 auto[\s\S]*?min-width:\s*0/,
  );
  assert.match(
    r92Css,
    /ticket-open,[\s\S]*?later-open-wrap[\s\S]*?align-self:\s*flex-start[\s\S]*?min-width:\s*0/,
  );
  assert.match(
    r92Css,
    /open-this-brief,[\s\S]*?later-open\[data-later-open\][\s\S]*?display:\s*inline-block[\s\S]*?max-width:\s*100%[\s\S]*?text-overflow:\s*ellipsis/,
  );
  assert.match(
    r92Css,
    /ticket-facts-summary,[\s\S]*?later-facts-summary\s*\{[\s\S]*?display:\s*flex[\s\S]*?align-items:\s*flex-start/,
  );
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
  assert.ok(claimAt < emptyAt);
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
  assert.ok(claimAt < emptyAt);
  assert.ok(claimAt < stampAt);
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
  assert.ok(claimAt < ticketAt);
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
  assert.match(html, />Claim rank</);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const openLead = html.indexOf("Open this brief");
  const openHop = html.indexOf(">Open brief<");
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(claimAt < leadStart);
  assert.ok(openLead > claimAt && openLead > leadStart && openLead < hopperStart);
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
  assert.match(html, /data-claim-anchor=""/);
  assert.match(html, /Write this ticket/);
  assert.match(html, /Open this brief/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, />Claim rank</);
  assert.match(html, /\$12/);
  assert.match(html, /Budget \$/);
  assert.match(html, /Rank is the bid, not the project/);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const openLead = html.indexOf("Open this brief");
  const claimAt = html.indexOf('id="claim"');
  const claimAnchorAt = html.indexOf("data-claim-anchor");
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  assert.ok(leadStart >= 0 && openLead > leadStart);
  assert.ok(openLead < hopperStart);
  assert.ok(claimAt < leadStart && claimAt < hopperStart);
  assert.ok(claimAnchorAt > openLead && claimAnchorAt < hopperStart);
  assert.match(html.slice(claimAt), /Write this ticket/);
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
  assert.match(html, />Claim rank</);
  assert.match(html, /Best portfolio by Friday/);
  assert.match(html, /15 September 2026/);
  assert.match(html, /Due date, not a score/);

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const openLead = html.indexOf("Open this brief");
  const claimAnchorAt = html.indexOf("data-claim-anchor");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(budgetAt > leadStart && budgetAt < hopperStart);
  assert.ok(budgetAt < openLead);
  assert.ok(claimAt < leadStart && claimAt < openLead);
  assert.ok(claimAnchorAt > openLead && claimAnchorAt < hopperStart);
  assert.ok(bidStub > budgetAt && bidStub < openLead);
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
  assert.ok(stampAt >= 0 && claimAt < stampAt);
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
  assert.match(html, />Claim rank</);
  assert.match(html, /Project budget, not the bid/);
  assert.equal(formatDeadline("2026-09-15"), "15 September 2026");

  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const budgetAt = html.indexOf('data-read-budget="lead"');
  const deadlineAt = html.indexOf('data-read-deadline="lead"');
  const openLead = html.indexOf("Open this brief");
  const claimAnchorAt = html.indexOf("data-claim-anchor");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(deadlineAt > leadStart && deadlineAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt < openLead);
  assert.ok(claimAt < leadStart && claimAt < openLead);
  assert.ok(claimAnchorAt > openLead && claimAnchorAt < hopperStart);
  assert.ok(bidStub > deadlineAt && bidStub < openLead);
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
  assert.ok(stampAt >= 0 && claimAt < stampAt);
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
  assert.match(html, />Claim rank</);
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
  const claimAnchorAt = html.indexOf("data-claim-anchor");
  const bidStub = html.indexOf('data-bid="">$12<');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(winnerAt > leadStart && winnerAt < hopperStart);
  assert.ok(budgetAt > leadStart && budgetAt < deadlineAt);
  assert.ok(deadlineAt > budgetAt && deadlineAt < winnerAt);
  assert.ok(winnerAt < openLead);
  assert.ok(claimAt < leadStart && claimAt < openLead);
  assert.ok(claimAnchorAt > openLead && claimAnchorAt < hopperStart);
  assert.ok(bidStub > winnerAt && bidStub < openLead);
  assert.equal(html.includes('data-read-winner="lead"', hopperStart), false);
  assert.doesNotMatch(html.slice(hopperStart), /Winner rule, not a score/);
  assert.doesNotMatch(html.slice(hopperStart), /Best portfolio by Friday/);
  assert.match(html.slice(hopperStart), /First qualified/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

const ACTION_RESIDUE = new RegExp(
  [
    "data-",
    "(?:open|write)-after-",
    "|data-first-click=",
    '"claim"',
    "|Then",
    "\\s+the\\s+brief\\s+URL",
  ].join(""),
);

function assertDirectClaimPath(html: string): void {
  const claimAt = html.indexOf('id="claim"');
  const submitAt = html.indexOf(">Claim rank<");
  assert.ok(claimAt >= 0);
  assert.ok(submitAt > claimAt);
  for (const field of ["buyer", "budgetUsd", "deadline", "winnerRule", "briefUrl"]) {
    const fieldAt = html.indexOf(`name="${field}"`);
    assert.ok(fieldAt > claimAt && fieldAt < submitAt, field);
  }
  assert.ok(html.indexOf('name="amountUsd"') > claimAt);
  assert.equal((html.match(/type="submit"/g) ?? []).length, 1);
  assert.equal((html.match(/>Claim rank</g) ?? []).length, 1);
  assert.doesNotMatch(html, ACTION_RESIDUE);
}

test("empty desk exposes every identity field before one direct Claim rank", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /No paid brief/);
  assert.match(html, /Claim #1 for/);
  assertDirectClaimPath(html);
  assert.doesNotMatch(html, /Open this brief/);
  assert.doesNotMatch(html, /Write this ticket/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
  assert.doesNotMatch(formSource, /useEffect|useRef/);
  assert.doesNotMatch(boardSource, ACTION_RESIDUE);
  assert.doesNotMatch(cssSource, ACTION_RESIDUE);
  assert.match(
    cssSource,
    /\.amount-field input:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--stamp\)/s,
  );
});

test("occupied desk keeps one Open action, one quiet claim anchor, and one form submit", () => {
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
          briefUrl: "https://example.com/third",
          bidUsd: 5,
          firstPaidAt: "2026-08-19T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const lead = html.slice(leadStart, hopperStart);
  const later = html.slice(hopperStart);
  const openAt = lead.indexOf("Open this brief");
  const anchorAt = lead.indexOf('data-claim-anchor=""');
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(openAt >= 0 && anchorAt > openAt);
  assert.match(lead, /data-first-click="open"/);
  assert.match(lead, /data-first-read="open"/);
  assert.match(lead, /href="\/click\/lst_lead"/);
  assert.match(lead, /data-prize=""/);
  assert.match(lead, /data-rank-is-bid=""/);
  assert.match(lead, /data-rank-bid=""/);
  assert.match(lead, /Project budget, not the bid/);
  assert.match(lead, /\$3,200/);
  assert.match(lead, /\$12/);
  assert.match(lead, /4 clicks/);
  assert.equal((html.match(/Open this brief/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-click="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-first-read="open"/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-anchor=""/g) ?? []).length, 1);
  assert.match(lead, /href="#claim"/);
  assert.doesNotMatch(later, /Open this brief|Write this ticket|data-first-click|data-claim-anchor/);
  assert.match(later, /Open brief/);
  assert.match(html, /class="claim ticket-blank occupied-claim"/);
  assertDirectClaimPath(html);
  assert.match(html, /These tickets are not the last 7 days’ #1 prize/);
  assert.doesNotMatch(html, ACTION_RESIDUE);
  assert.doesNotMatch(cssSource, ACTION_RESIDUE);
  assert.match(cssSource, /\.week-occupied \.ticket-featured \.open-this-brief\[data-first-click="open"\]/);
  assert.match(cssSource, /\.week-occupied \.ticket-featured \.claim-anchor/);
  assert.match(cssSource, /\.week-occupied \.claim\.occupied-claim/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied lower fold summaries use only paid ranking and activity facts", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_summary_lead",
          buyer: "Summary Lead",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
          lastPaidAt: "2026-08-17T00:00:00.000Z",
          clicks: 4,
        }),
        listing({
          id: "lst_summary_second",
          buyer: "Summary Second",
          bidUsd: 9,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
          lastPaidAt: "2026-08-18T00:00:00.000Z",
          clicks: 2,
        }),
        listing({
          id: "lst_summary_third",
          buyer: "Summary Third",
          bidUsd: 7,
          firstPaidAt: "2026-08-19T00:00:00.000Z",
          lastPaidAt: "2026-08-19T00:00:00.000Z",
          clicks: 1,
        }),
        listing({
          id: "lst_summary_fourth",
          buyer: "Summary Fourth",
          bidUsd: 5,
          firstPaidAt: "2026-08-20T00:00:00.000Z",
          lastPaidAt: "2026-08-20T00:00:00.000Z",
          clicks: 0,
        }),
      ]),
    }),
  );
  const rankingAt = html.indexOf('data-todays-ranking=""');
  const activityAt = html.indexOf('data-latest-activity=""');
  const fourthAt = html.indexOf('data-listing-id="lst_summary_fourth"');
  assert.ok(rankingAt >= 0 && activityAt > rankingAt && fourthAt > activityAt);
  assert.match(html, /Bid order/);
  assert.match(html, /Paid ticket log/);
  assert.match(html, /data-summary-window="rolling-7-days"/);
  assert.match(html, /Summary Lead/);
  assert.match(html, /data-ranking-bid=""/);
  assert.match(html, /\$12/);
  assert.match(html, /data-activity-fact="last-paid"/);
  assert.match(html, /Paid 2026-08-17/);
  assert.match(html, /data-activity-fact="placement"/);
  assert.match(html, /Placement #1/);
  assert.match(html, /data-activity-fact="clicks"/);
  assert.match(html, /4 clicks/);
  assert.doesNotMatch(html, /createdAt|updatedAt|reconciliation event|avatar/);
  assert.match(cssSource, /\.summary-ranking-list\s*\{[^}]*grid-template-columns:\s*repeat\(3/);
  assert.match(cssSource, /\.latest-activity-list\s*\{[^}]*grid-template-columns:\s*repeat\(5/);
  assert.match(cssSource, /\.week-occupied \.hopper\.later-pack\[data-later-pack\]\s*\{[^}]*border-top:\s*0/);
});

test("expired paid tickets leave the desk empty with the direct claim path", () => {
  const expiredAt = new Date("2026-08-25T00:00:00.000Z");
  const expired = listing({
    id: "lst_expired",
    bidUsd: 12,
    firstPaidAt: "2026-08-17T00:00:00.000Z",
    lastPaidAt: "2026-08-17T00:00:00.000Z",
  });
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(expiredAt),
      listings: rankListings([expired], expiredAt),
    }),
  );
  assert.match(html, /data-desk-surface="empty"/);
  assert.match(html, /No paid brief/);
  assert.doesNotMatch(html, /data-listing-card/);
  assertDirectClaimPath(html);
});

test("unpaid tickets remain off the desk while Claim #1 stays honest", () => {
  const unpaid = listing({
    id: "lst_ghost",
    buyer: "Ghost Studio",
    bidUsd: 99,
    firstPaidAt: "",
    lastPaidAt: "",
  });
  assert.deepEqual(rankListings([unpaid]), []);
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: [],
      unpaid: [
        {
          sessionId: "fix_abandoned",
          weekId: WEEK,
          buyer: unpaid.buyer,
          winnerRule: unpaid.winnerRule,
          briefUrl: unpaid.briefUrl,
          bidUsd: unpaid.bidUsd,
        },
      ],
    }),
  );
  assert.match(html, /No paid brief/);
  assert.match(html, /Unpaid checkout stays off this desk/);
  assert.match(html, /An abandoned ticket is not #1/);
  assertDirectClaimPath(html);
  assert.doesNotMatch(html, /Open this brief|Write this ticket/);
});

test("rolling rank keeps Sunday payments through Monday and drops expired payments", () => {
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const sunday = listing({
    id: "lst_sunday",
    weekId: "2026-W33",
    bidUsd: 12,
    firstPaidAt: "2026-08-16T12:00:00.000Z",
    lastPaidAt: "2026-08-16T12:00:00.000Z",
  });
  const expired = listing({
    id: "lst_old",
    weekId: "2026-W33",
    bidUsd: 99,
    firstPaidAt: "2026-08-09T12:00:00.000Z",
    lastPaidAt: "2026-08-09T12:00:00.000Z",
  });
  assert.deepEqual(
    rankListings([sunday, expired], monday).map((row) => row.id),
    ["lst_sunday"],
  );
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(monday),
      listings: rankListings([sunday], monday),
    }),
  );
  assert.match(occupied, /Rolling last 7 days\. Not Monday 00:00 UTC\./);
  assert.match(occupied, /Open this brief/);
  assert.doesNotMatch(occupied, /data-empty-week/);
});

test("week and rules copy keep the rolling 7-day, bid-ranked contract", () => {
  const week = currentWeekUtc(new Date("2026-08-17T00:00:00.000Z"));
  assert.equal(week.weekId, "2026-W34");
  assert.equal(week.startsAt, "2026-08-10T00:00:00.000Z");
  assert.equal(week.endsAt, "2026-08-17T00:00:00.000Z");
  assert.match(specSource, /rolling last 7 days/i);
  assert.match(specSource, /older wins ties/i);
  assert.match(specSource, /raise pays difference/i);
  assert.match(specSource, /Waffo/);
  assert.match(specSource, /No invented ratings/);
  assert.match(buildSource, /live-smoke/);
  assert.match(aboutSource, /rolling last 7 days/i);
  assert.match(aboutSource, /Rank is the bid/);
  const about = renderToStaticMarkup(createElement(AboutPage));
  assert.match(about, /last 7 days/i);
  assert.match(about, /Rank is the bid/);
  assert.doesNotMatch(about, /★|⭐|4\.8 stars|data-stars|data-rating/i);
  assert.doesNotMatch(boardSource, ACTION_RESIDUE);
  assert.doesNotMatch(formSource, ACTION_RESIDUE);
  assert.doesNotMatch(cssSource, ACTION_RESIDUE);
});

test("occupied #1 winner rule is the prize before quieter rank, budget, and click facts", () => {
  const cssSize = (pattern: RegExp): number => {
    const match = cssSource.match(pattern);
    assert.ok(match, pattern.source);
    return Number(match[1]);
  };
  const prizeBlock = cssSource.match(
    /\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*\}/,
  )?.[0];
  const rankBlock = cssSource.match(
    /\.ticket-featured\[data-rank-is-bid\] \.ticket-bid-later \.rank-is-bid\s*\{[^}]*\}/,
  )?.[0];
  const budgetBlock = cssSource.match(
    /\.ticket-featured\[data-rank-is-bid\] \[data-budget-later\] \.budget-amount\s*\{[^}]*\}/,
  )?.[0];
  assert.ok(prizeBlock);
  assert.ok(rankBlock);
  assert.ok(budgetBlock);
  const prizeSize = cssSize(
    /\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const rankSize = cssSize(
    /\.ticket-featured\[data-rank-is-bid\] \.ticket-bid-later \.rank-is-bid\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const budgetSize = cssSize(
    /\.ticket-featured\[data-rank-is-bid\] \[data-budget-later\] \.budget-amount\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const clickSize = cssSize(
    /\.ticket-featured\[data-prize-before-price\] \.ticket-bid-later \.clicks\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(prizeSize > rankSize);
  assert.ok(rankSize > budgetSize);
  assert.ok(prizeSize > clickSize);
  assert.match(
    cssSource,
    /\.ticket-featured \.winner-rule-text\s*\{[^}]*font-weight:\s*700/,
  );
  assert.match(rankBlock, /font-weight:\s*600/);
  assert.match(budgetBlock, /font-weight:\s*500/);

  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          budgetUsd: 3200,
          winnerRule: "Best portfolio by Friday",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
          clicks: 4,
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const lead = html.slice(leadStart, hopperStart);
  const prizeAt = lead.indexOf('data-prize=""');
  const winnerAt = lead.lastIndexOf("Best portfolio by Friday");
  const rankBidAt = lead.indexOf('data-rank-bid=""');
  const clickAt = lead.indexOf("4 clicks");
  assert.ok(leadStart >= 0 && hopperStart > leadStart);
  assert.ok(prizeAt >= 0);
  assert.ok(winnerAt > prizeAt);
  assert.ok(rankBidAt > winnerAt);
  assert.ok(clickAt > rankBidAt);
  assert.match(lead, /data-prize-before-price=""/);
  assert.match(lead, /data-rank-is-bid=""/);
  assert.match(lead, /data-budget-later=""/);
  assert.match(lead, /Project budget, not the bid/);
  assert.match(lead, /\$3,200/);
  assert.match(lead, /\$12/);
  assert.match(lead, /4 clicks/);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("occupied later-rank tickets stay quieter than #1 — winner rule stays the prize", () => {
  const size = (pattern: RegExp): number => {
    const match = cssSource.match(pattern);
    assert.ok(match, pattern.source);
    return Number(match[1]);
  };
  const prizeSize = size(
    /\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterBuyerSize = size(
    /\.hopper \.ticket-later\[data-later-rank\] \.later-buyer\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterRuleSize = size(
    /\.hopper \.ticket-later\[data-later-rank\] \.later-rule \.winner-rule\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  const laterOpenSize = size(
    /\.hopper \.ticket-later\[data-later-rank\] a\.later-open\[data-later-open\]\s*\{[^}]*font-size:\s*([\d.]+)rem/,
  );
  assert.ok(prizeSize > laterBuyerSize);
  assert.ok(prizeSize > laterRuleSize);
  assert.ok(prizeSize > laterOpenSize);

  const laterTicketBlock = cssSource.match(
    /\.week-occupied \.hopper \.ticket-later\[data-later-rank\]\s*\{[^}]*\}/,
  )?.[0];
  const laterRuleBlock = cssSource.match(
    /\.week-occupied \.hopper \.ticket-later\[data-later-rank\] \.later-rule \.winner-rule\s*\{[^}]*\}/,
  )?.[0];
  const laterOpenBlock = cssSource.match(
    /\.week-occupied \.hopper \.ticket-later\[data-later-rank\] a\.later-open\[data-later-open\]\s*\{[^}]*\}/,
  )?.[0];
  assert.ok(laterTicketBlock);
  assert.ok(laterRuleBlock);
  assert.ok(laterOpenBlock);
  assert.match(laterTicketBlock, /box-shadow:\s*none/);
  assert.match(laterTicketBlock, /border:\s*1px dashed var\(--rule\)/);
  assert.doesNotMatch(laterTicketBlock, /background:\s*var\(--stamp\)/);
  assert.match(laterRuleBlock, /color:\s*var\(--muted\)/);
  assert.match(laterOpenBlock, /display:\s*inline/);
  assert.match(laterOpenBlock, /color:\s*var\(--muted\)/);
  assert.doesNotMatch(laterOpenBlock, /background:|var\(--stamp\)|min-height:\s*[2-9]/);

  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_lead",
          buyer: "Lead Studio",
          winnerRule: "Best portfolio by Friday",
          bidUsd: 12,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
          clicks: 4,
        }),
        listing({
          id: "lst_hopper",
          buyer: "Hopper Studio",
          budgetUsd: 800,
          winnerRule: "First qualified",
          bidUsd: 6,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
          clicks: 2,
        }),
        listing({
          id: "lst_third",
          buyer: "Third Studio",
          winnerRule: "Fixed price",
          bidUsd: 5,
          firstPaidAt: "2026-08-19T00:00:00.000Z",
        }),
      ]),
    }),
  );
  const leadStart = html.indexOf('data-listing-id="lst_lead"');
  const hopperStart = html.indexOf('data-listing-id="lst_hopper"');
  const claimAt = html.indexOf('id="claim"');
  const later = html.slice(hopperStart);
  assert.ok(claimAt >= 0 && leadStart >= 0 && claimAt < leadStart && hopperStart > leadStart);
  assert.match(html, /data-later-pack=""/);
  assert.match(html, /data-prize=""/);
  assert.match(html, /data-rank-is-bid=""/);
  assert.match(later, /data-later-rank=""/);
  assert.match(later, /data-later-open=""/);
  assert.match(later, /Open brief/);
  assert.match(later, /Budget \$800/);
  assert.match(later, /\$6/);
  assert.match(later, /2 clicks/);
  assert.doesNotMatch(
    later,
    /data-prize=|data-prize-before-price|prize-before-price|ticket-facts|data-rank-is-bid|data-rank-bid|data-budget-later|Claim #1|Claim rank|Open this brief|Write this ticket|data-first-click/,
  );
  assert.equal((html.match(/data-prize=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-claim-anchor=""/g) ?? []).length, 1);
  assert.doesNotMatch(html, RATINGS_FORBIDDEN);
});

test("r7 shared component reconstruction keeps semantic slots and card tracks", () => {
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_northwind",
          buyer: "Northwind Studio",
          briefUrl: "https://example.com/northwind",
          bidUsd: 12,
          clicks: 4,
          firstPaidAt: "2026-08-17T00:00:00.000Z",
        }),
        listing({
          id: "lst_signal",
          buyer: "Signal Works",
          briefUrl: "https://example.com/signal",
          bidUsd: 6,
          clicks: 2,
          firstPaidAt: "2026-08-18T00:00:00.000Z",
        }),
        listing({
          id: "lst_field_notes",
          buyer: "Field Notes Co",
          briefUrl: "https://example.com/field-notes",
          bidUsd: 5,
          clicks: 1,
          firstPaidAt: "2026-08-19T00:00:00.000Z",
        }),
      ]),
    }),
  );

  for (const slot of [
    "home-shell",
    "stats-pill",
    "period-tabs",
    "claim-hero",
    "claim-form",
    "claim-heading",
    "claim-controls",
    "claim-button",
    "desk-navigation",
    "top-three",
    "today-strip",
    "activity-strip",
  ]) {
    assert.match(html, new RegExp("data-slot=\\\"" + slot + "\\\""), slot);
  }

  const contextAt = html.indexOf('data-slot="stats-pill"');
  const periodAt = html.indexOf('data-slot="period-tabs"');
  const claimAt = html.indexOf('data-slot="claim-hero"');
  const headingAt = html.indexOf('data-slot="claim-heading"');
  const formAt = html.indexOf('data-slot="claim-form"');
  const controlsAt = html.indexOf('data-slot="claim-controls"');
  const railAt = html.indexOf('data-slot="desk-navigation"');
  const cardsAt = html.indexOf('data-slot="top-three"');
  const todayAt = html.indexOf('data-slot="today-strip"');
  const activityAt = html.indexOf('data-slot="activity-strip"');
  assert.ok(contextAt < periodAt && periodAt < claimAt);
  assert.ok(claimAt < headingAt && headingAt < formAt);
  assert.ok(formAt < controlsAt && controlsAt < railAt && railAt < cardsAt);
  const formEnd = html.indexOf("</form>", formAt);
  assert.ok(formEnd > formAt);
  assert.equal(
    html.slice(formAt, formEnd).includes('data-slot="claim-heading"'),
    false,
  );
  assert.match(html, /data-slot="url-input"/);
  assert.match(html, /data-slot="ticket-details-control"/);
  assert.ok(cardsAt < todayAt && todayAt < activityAt);

  assert.equal((html.match(/data-slot="paid-card"/g) ?? []).length, 3);
  assert.match(html, /data-rank="1"/);
  assert.match(html, /data-rank="2"/);
  assert.match(html, /data-rank="3"/);
  assert.match(html, /Northwind Studio/);
  assert.match(html, /Signal Works/);
  assert.match(html, /Field Notes Co/);
  assert.match(html, /data-read-budget="lead"/);
  assert.match(html, /data-read-deadline="lead"/);
  assert.match(html, /data-read-winner="lead"/);
  assert.match(html, /Paid 2026-08-17/);
  assert.match(html, /Open this brief/);
  assert.match(html, /Open brief/);
  assert.match(html, /data-ticket-meta=""/);
  assert.match(html, /data-later-open=""/);
  assert.equal((html.match(/data-ticket-actions=""/g) ?? []).length, 3);
  assert.equal((html.match(/See details/g) ?? []).length, 3);

  const componentCss = cssSource.slice(
    cssSource.lastIndexOf("Shared board components"),
  );
  assert.match(componentCss, /\.top-three-list[\s\S]*?gap:\s*0\.75rem/);
  assert.match(componentCss, /height:\s*6\.875rem/);
  assert.match(componentCss, /height:\s*7\.6875rem/);
  assert.match(componentCss, /height:\s*6\.625rem/);
  assert.match(componentCss, /height:\s*7\.4375rem/);
  assert.match(
    componentCss,
    /grid-template-columns:\s*minmax\(0, 1fr\) max-content/,
  );
  assert.match(
    componentCss,
    /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/,
  );
  assert.match(
    componentCss,
    /ticket-actions[\s\S]*?grid-column:\s*2[\s\S]*?grid-row:\s*3/,
  );
  assert.match(
    componentCss,
    /ticket-facts-preview[\s\S]*?grid-row:\s*2/,
  );
  assert.match(componentCss, /ticket-actions[\s\S]*?display:\s*flex/);
  assert.match(componentCss, /\.ticket-meta[\s\S]*?position:\s*static/);
  assert.match(componentCss, /\.later-meta[\s\S]*?position:\s*static/);
  assert.match(componentCss, /\.ticket-open[\s\S]*?position:\s*static/);
  assert.match(componentCss, /\.later-open-wrap[\s\S]*?position:\s*static/);
  assert.match(
    componentCss,
    /grid-template-columns:\s*2\.375rem minmax\(0, 1fr\)/,
  );
  assert.match(componentCss, /\.ticket-bid-later[\s\S]*?width:\s*max-content/);
  assert.match(
    componentCss,
    /\.later-rankline \.bid[\s\S]*?width:\s*max-content/,
  );
  assert.match(componentCss, /\.ticket-stub\s*\{[\s\S]*?position:\s*static/);
  assert.match(
    componentCss,
    /\.later-rankline\s*\{[\s\S]*?position:\s*static/,
  );
  assert.match(
    componentCss,
    /\.open-this-brief,[\s\S]*?\.later-open\[data-later-open\]\s*\{[\s\S]*?display:\s*inline[;\s]/,
  );
  assert.match(componentCss, /ticket-later\[data-rank="2"\][\s\S]*?background:\s*var\(--accent-wash-soft\)/);
  assert.match(componentCss, /ticket-later\[data-rank="3"\][\s\S]*?background:\s*color-mix/);
  const mobileRankCss = cssSource.slice(
    cssSource.lastIndexOf("r8.1 mobile rank correction"),
  );
  assert.match(mobileRankCss, /ticket-stub[\s\S]*?flex-direction:\s*row/);
  assert.match(mobileRankCss, /later-rankline[\s\S]*?flex-direction:\s*row/);
  assert.match(mobileRankCss, /ticket-stub[\s\S]*?padding:\s*1\.75rem 0 0 0\.75rem/);
  assert.match(mobileRankCss, /data-rank="2"|data-rank=\\"2\\"/);
  assert.match(mobileRankCss, /accent-wash-soft/);
  assert.match(mobileRankCss, /data-rank="3"|data-rank=\\"3\\"/);
  assert.match(mobileRankCss, /color-mix/);
  assert.doesNotMatch(componentCss, /terminal|r1[0-9]/i);
  assert.match(
    cssSource,
    /r7\.1 mobile form geometry[\s\S]*?\.claim-controls\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/,
  );
  assert.match(cssSource, /html\s*\{[\s\S]*?overflow-y:\s*scroll/);
  assert.match(cssSource, /body\s*\{[\s\S]*?overflow-x:\s*clip/);
});

test("empty and occupied mast copy names the rolling last-7-days window", () => {
  const empty = renderToStaticMarkup(
    createElement(Board, { week: WEEK_META, listings: [] }),
  );
  const occupied = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK_META,
      listings: rankListings([
        listing({
          id: "lst_sunday",
          bidUsd: 5,
          firstPaidAt: "2026-08-16T12:00:00.000Z",
        }),
      ]),
    }),
  );
  const periodMeta = (html: string): string => {
    const match = html.match(/<p class="period-meta"[^>]*>(.*?)<\/p>/);
    assert.ok(match);
    return match[1];
  };
  assert.equal(
    periodMeta(empty).replace("data-empty-since", "data-window-since"),
    periodMeta(occupied).replace("data-occupied-since", "data-window-since"),
  );
  for (const html of [empty, occupied]) {
    assert.match(html, /data-rolling-week="true"/);
    assert.match(html, /The last 7 days’ #1 freelance brief/);
    assert.match(html, /Last 7 days\./);
    assert.match(html, /Window last 7 days\./);
    assert.match(html, /Rolling last 7 days\. Not Monday 00:00 UTC\./);
    assert.doesNotMatch(html, /This week’s #1|Week 2026-W34|weekly public auction|weekly reset/i);
  }
  assert.match(empty, /data-empty-window=""/);
  assert.doesNotMatch(empty, /data-occupied-window=""/);
  assert.match(occupied, /data-occupied-window=""/);
  assert.doesNotMatch(occupied, /data-empty-window=""/);
  assert.match(empty, /No paid brief/);
  assert.match(occupied, /data-prize=""/);
});

test("README/SPEC/BUILD/layout copy keeps the rolling job-ticket contract", () => {
  assert.match(
    readmeSource,
    /Public auction for the last 7 days’ #1 freelance brief/,
  );
  assert.match(readmeSource, /Rank is the bid/);
  assert.match(readmeSource, /rolling last-7-days window/);
  assert.match(readmeSource, /Waffo Pancake \+ explicit fixture/);
  assert.doesNotMatch(readmeSource, /weekly public auction/i);

  assert.match(
    specSource,
    /Listing is \*\*buyer \+ budget \+ deadline \+ brief URL\*\*/,
  );
  assert.match(specSource, /rolling last 7 days/);
  assert.match(specSource, /not Monday 00:00 UTC/);
  assert.match(specSource, /older wins ties/);
  assert.match(specSource, /raise pays difference/);
  assert.match(specSource, /Live payments via Waffo Pancake/);

  assert.match(
    buildSource,
    /^\*\*Contract:\*\*.*rolling last-7-days week window/m,
  );
  assert.match(buildSource, /Public auction for the last 7 days’ #1 freelance brief/);
  assert.match(buildSource, /listing shape is buyer \+ budget \+ deadline \+ brief URL/i);
  assert.match(buildSource, /ranked cards with \*\*\$\*\* and \*\*clicks\*\*/i);
  assert.match(buildSource, /Explicit `fixture`, `waffo-test`, or `waffo-prod` mode/);
  assert.doesNotMatch(buildSource, /weekly public auction/i);

  assert.match(layoutSource, /default: "Brief desk — the last 7 days’ #1 freelance brief"/);
  assert.match(layoutSource, /last 7 days’ #1 job ticket/);
  assert.match(layoutSource, /Rank is the bid, not the project budget/);
  assert.doesNotMatch(layoutSource, /This week’s #1|weekly public auction/i);
});
