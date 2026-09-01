import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET as getClick } from "../src/app/click/[id]/route";
import { Board } from "../src/app/board";
import { briefClickPath } from "../src/core/listing";
import { getListingById, resetListings } from "../src/core/listings";
import { getBoardListings, rankListings } from "../src/core/rank";
import { currentWeekUtc } from "../src/core/week";
import { settleFixtureEvent } from "./fixture-settlement";

afterEach(() => {
  resetListings();
});

const WEEK = currentWeekUtc();

test("GET /click/:id 302s to the stripped brief URL and increments clicks", async () => {
  const listing = settleFixtureEvent({
    sessionId: "chk_click",
    listingDraft: {
      buyer: "Acme Studio",
      budgetUsd: 3200,
      deadline: "2026-09-15",
      winnerRule: "Best portfolio by Friday",
      briefUrl: "https://example.com/acme?utm_source=board&fbclid=1#frag",
      bidUsd: 5,
      weekId: WEEK.weekId,
    },
    amountUsd: 5,
    kind: "create",
    paidAt: new Date().toISOString(),
  });
  assert.ok(listing);
  assert.equal(listing.briefUrl, "https://example.com/acme");
  assert.equal(listing.clicks, 0);
  assert.equal(briefClickPath(listing.id), `/click/${listing.id}`);

  const response = await getClick(new Request(`http://localhost/click/${listing.id}`), {
    params: Promise.resolve({ id: listing.id }),
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://example.com/acme");
  assert.doesNotMatch(response.headers.get("location") ?? "", /utm_/);
  assert.equal(getListingById(listing.id)?.clicks, 1);

  const again = await getClick(new Request(`http://localhost/click/${listing.id}`), {
    params: Promise.resolve({ id: listing.id }),
  });
  assert.equal(again.status, 302);
  assert.equal(getListingById(listing.id)?.clicks, 2);
  assert.equal(getBoardListings()[0]?.clicks, 2);
});

test("unknown listing click is 404 and does not invent a hop", async () => {
  const missing = await getClick(new Request("http://localhost/click/missing"), {
    params: Promise.resolve({ id: "missing" }),
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "listing_not_found" });
});

test("board brief CTA uses the click route and does not label clicks as ratings", () => {
  const listing = settleFixtureEvent({
    sessionId: "chk_ui_click",
    listingDraft: {
      buyer: "Acme Studio",
      budgetUsd: 3200,
      deadline: "2026-09-15",
      winnerRule: "Best portfolio by Friday",
      briefUrl: "https://example.com/acme",
      bidUsd: 5,
      weekId: WEEK.weekId,
    },
    amountUsd: 5,
    kind: "create",
    paidAt: new Date().toISOString(),
  });
  assert.ok(listing);
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: WEEK,
      listings: rankListings(getBoardListings()),
    }),
  );
  assert.match(html, new RegExp(`href="/click/${listing.id}"`));
  assert.match(html, /data-brief-url="https:\/\/example.com\/acme"/);
  assert.match(html, /0 clicks/);
  assert.doesNotMatch(html, /★|⭐|star rating|review score|top rated|hire rate/i);
});
