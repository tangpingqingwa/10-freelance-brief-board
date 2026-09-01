import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Board } from "../src/app/board";
import { rankListings, type Listing } from "../src/core/rank";
import { currentWeekUtc } from "../src/core/week";

const pageSource = readFileSync(
  new URL("../src/app/page.tsx", import.meta.url),
  "utf8",
);

function fixtureListing(
  id: string,
  buyer: string,
  briefUrl: string,
  bidUsd: number,
  firstPaidAt: string,
  winnerRule: string,
): Listing {
  return {
    id,
    weekId: "2026-W34",
    buyer,
    budgetUsd: 1_700,
    deadline: "2026-09-10",
    winnerRule,
    briefUrl,
    bidUsd,
    firstPaidAt,
    lastPaidAt: firstPaidAt,
    clicks: 12,
  };
}

test("freelance-native fixture rows still render the ordinary brief desk", () => {
  const now = new Date("2026-08-29T12:00:00.000Z");
  const listings = rankListings(
    [
      fixtureListing(
        "see",
        "Cinderblock Office",
        "https://cinderblock-brief.example/editorial-launch",
        17_000,
        "2026-08-29T10:00:00.000Z",
        "Strongest editorial launch concept",
      ),
      fixtureListing(
        "tutti",
        "Rook & Relay",
        "https://rook-relay.example/product-story",
        16_000,
        "2026-08-29T10:01:00.000Z",
        "Best scoped product story",
      ),
      fixtureListing(
        "joni",
        "Morrow Field Co.",
        "https://morrow-field.example/onboarding-flow",
        14_028,
        "2026-08-29T10:02:00.000Z",
        "Cleanest onboarding flow",
      ),
    ],
    now,
  );
  const html = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(now),
      listings,
    }),
  );

  assert.match(html, /data-brief-desk=""/);
  assert.doesNotMatch(html, /data-reference-fixture/);
  assert.doesNotMatch(html, /DTC Picks Daily|picks\.daily|outbid\.lol/i);
  assert.match(html, /Cinderblock Office/);
  assert.match(html, /Rook &amp; Relay/);
  assert.match(html, /Morrow Field Co\./);
  assert.match(html, /Strongest editorial launch concept/);
  assert.match(html, /Best scoped product story/);
  assert.match(html, /Cleanest onboarding flow/);
  assert.match(html, /cinderblock-brief\.example\/editorial-launch/);
  assert.match(html, /rook-relay\.example\/product-story/);
  assert.match(html, /morrow-field\.example\/onboarding-flow/);
  assert.doesNotMatch(
    html,
    /See Labs|Tutti Studio|Joni AI|See Studio|Tutti Works|Joni Labs|see\.io|tutti\.so|joni\.ai/i,
  );
  assert.deepEqual(
    listings.map(({ id, bidUsd, firstPaidAt, lastPaidAt, clicks, rank }) => ({
      id,
      bidUsd,
      firstPaidAt,
      lastPaidAt,
      clicks,
      rank,
    })),
    [
      {
        id: "see",
        bidUsd: 17_000,
        firstPaidAt: "2026-08-29T10:00:00.000Z",
        lastPaidAt: "2026-08-29T10:00:00.000Z",
        clicks: 12,
        rank: 1,
      },
      {
        id: "tutti",
        bidUsd: 16_000,
        firstPaidAt: "2026-08-29T10:01:00.000Z",
        lastPaidAt: "2026-08-29T10:01:00.000Z",
        clicks: 12,
        rank: 2,
      },
      {
        id: "joni",
        bidUsd: 14_028,
        firstPaidAt: "2026-08-29T10:02:00.000Z",
        lastPaidAt: "2026-08-29T10:02:00.000Z",
        clicks: 12,
        rank: 3,
      },
    ],
  );
  assert.match(html, /href="\/click\/see"/);
  assert.match(html, /Budget \$1,700/);
  assert.match(html, /Claim #1 for/);
  assert.match(html, /data-rank-is-bid=""/);
  assert.match(html, /data-clicks=""/);
});

test("homepage source has no exact-host or reference-renderer branch", () => {
  assert.doesNotMatch(pageSource, /OutbidReferenceFixturePage|renderBoardPage/);
  assert.doesNotMatch(pageSource, /OUTBID_REFERENCE_ROWS|providerMode/);
  assert.doesNotMatch(pageSource, /see\.io|tutti\.so|joni\.ai/);
});
