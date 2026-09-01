import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AboutPage from "../src/app/about/page";
import { Board } from "../src/app/board";
import RulesPage from "../src/app/rules/page";
import { CheckoutError, parseCheckoutInput } from "../src/billing/port";
import {
  HonestyError,
  assertHonestMarkup,
  htmlHasInventedRatings,
  rejectInventedRatings,
} from "../src/core/honesty";
import { resetListings } from "../src/core/listings";
import { currentWeekUtc } from "../src/core/week";

afterEach(() => {
  resetListings();
});

const WEEK = currentWeekUtc();

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    buyer: "Acme Studio",
    budgetUsd: "3200",
    deadline: "2026-09-15",
    winnerRule: "Best portfolio by Friday",
    briefUrl: "https://example.com/acme",
    amountUsd: "5",
    weekId: WEEK.weekId,
    ...overrides,
  };
}

test("rating field is rating_forbidden", () => {
  for (const extra of [
    { rating: "4.8" },
    { stars: 5 },
    { star: "5" },
    { reviewScore: 98 },
    { review_score: "4.9" },
    { hireRate: "98%" },
    { hire_rate: 0.98 },
    { reputation: "top" },
    { topRated: true },
  ]) {
    assert.throws(
      () => rejectInventedRatings(draft(extra)),
      (err: unknown) => {
        assert.ok(err instanceof HonestyError);
        assert.equal(err.code, "rating_forbidden");
        return true;
      },
    );
    assert.throws(
      () => parseCheckoutInput(draft(extra)),
      (err: unknown) => {
        assert.ok(err instanceof CheckoutError);
        assert.equal(err.code, "rating_forbidden");
        return true;
      },
    );
  }
});

test("star and review-score copy on submit is rating_forbidden", () => {
  assert.throws(
    () => parseCheckoutInput(draft({ winnerRule: "4.8 stars, top rated" })),
    (err: unknown) => {
      assert.ok(err instanceof CheckoutError);
      assert.equal(err.code, "rating_forbidden");
      return true;
    },
  );
  assert.throws(
    () => parseCheckoutInput(draft({ buyer: "Hire rate 98%" })),
    (err: unknown) => {
      assert.ok(err instanceof CheckoutError);
      assert.equal(err.code, "rating_forbidden");
      return true;
    },
  );
});

test("board HTML has no stars or review scores", () => {
  const html = renderToStaticMarkup(
    createElement(Board, { week: WEEK, listings: [] }),
  );
  assert.equal(htmlHasInventedRatings(html), false);
  assert.doesNotThrow(() => assertHonestMarkup(html));
  assert.match(html, /no invented ratings/i);
});

test("about and rules state min $5, older wins ties, raise pays difference, last 7 days, no invented ratings", () => {
  const about = renderToStaticMarkup(createElement(AboutPage));
  const rules = renderToStaticMarkup(createElement(RulesPage));

  assert.match(about, /data-page="about"/);
  assert.match(about, /Rank is the bid/);
  assert.match(about, /no invented ratings/i);
  assert.match(about, /Freelance Brief Board is a public auction/);
  assert.match(about, /English/);
  assert.match(about, /USD/);
  assert.match(about, /browse briefs from anywhere/);
  assert.match(about, /last 7 days’ #1 freelance brief/);
  assert.match(about, /rolling last 7 days/);
  assert.doesNotMatch(about, /weekly public auction/i);
  assert.doesNotMatch(about, /weekly UTC reset/i);
  assert.doesNotMatch(
    about,
    /outbid\.lol|freelance-brief-board|\bclone\b|\bv1\b|\bfixture\b|weekId|createdAt|paidAt|Waffo/i,
  );

  assert.match(rules, /data-page="rules"/);
  assert.match(rules, /\$5/);
  assert.match(rules, /brief placed first keeps the higher rank/);
  assert.match(rules, /same cleaned brief link may raise while its placement is active/i);
  assert.match(rules, /charged only the <strong>difference/);
  assert.match(rules, /does not reset for everyone at Monday midnight/);
  assert.match(rules, /rolling last 7 days/i);
  assert.match(rules, /No invented ratings/);
  assert.doesNotMatch(rules, /weekly UTC reset/i);
  assert.match(rules, /Tracking, referral, and affiliate parameters are removed/);
  assert.match(rules, /unsafe destinations are rejected/);
  assert.match(rules, /Public <strong>clicks<\/strong>/);
  assert.doesNotMatch(
    rules,
    /outbid\.lol|freelance-brief-board|\bclone\b|\bv1\b|\bfixture\b|weekId|createdAt|paidAt|Waffo/i,
  );

  assert.doesNotMatch(about, /4\.8 stars|data-stars|data-rating|★|⭐/);
  assert.doesNotMatch(rules, /4\.8 stars|data-stars|data-rating|★|⭐/);
});

test("occupied /rules explains active-placement raises in public language", () => {
  const html = renderToStaticMarkup(createElement(RulesPage));
  assert.match(html, /same cleaned brief link may raise while its placement is active/i);
  assert.match(html, /original payer is charged only the <strong>difference/);
  assert.match(html, /Each placement keeps its own seven-day window/);
  assert.match(html, /rolling last 7 days/i);
  assert.doesNotMatch(html, /weekId|createdAt|paidAt|Waffo|outbid\.lol|\bclone\b|\bfixture\b/i);
});
