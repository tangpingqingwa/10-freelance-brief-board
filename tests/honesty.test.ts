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
  assert.match(about, /freelance-brief-board/);
  assert.match(about, /outbid\.lol/);
  assert.match(about, /English/);
  assert.match(about, /USD/);
  assert.match(about, /global/i);
  assert.match(about, /last 7 days’ #1 freelance brief/);
  assert.match(about, /rolling last 7 days/);
  assert.doesNotMatch(about, /weekly public auction/i);
  assert.doesNotMatch(about, /weekly UTC reset/i);

  assert.match(rules, /data-page="rules"/);
  assert.match(rules, /\$5/);
  assert.match(rules, /Older wins ties/);
  assert.match(rules, /Raise pays difference/);
  assert.match(rules, /Not Monday 00:00:00.000 UTC/);
  assert.match(rules, /rolling last 7 days/i);
  assert.match(rules, /No invented ratings/);
  assert.doesNotMatch(rules, /weekly UTC reset/i);
  assert.match(rules, /utm_\*/);
  assert.match(rules, /url_forbidden/);
  assert.match(rules, /GET \/click\/:id/);
  assert.match(rules, /rating_forbidden/);

  assert.doesNotMatch(about, /4\.8 stars|data-stars|data-rating|★|⭐/);
  assert.doesNotMatch(rules, /4\.8 stars|data-stars|data-rating|★|⭐/);
});

test("occupied /rules raise identity is last-7-days, not the UTC week label", () => {
  const html = renderToStaticMarkup(createElement(RulesPage));
  assert.match(html, /Same canonical brief URL still inside last 7 days raises/);
  assert.match(html, /weekId<\/code> stays an audit label — not raise identity/);
  assert.doesNotMatch(html, /same UTC week raises/i);
  assert.doesNotMatch(html, /same weekId/i);
  assert.doesNotMatch(html, /Already on this week/);
  assert.match(html, /Raise pays difference/);
  assert.match(html, /Not Monday 00:00:00.000 UTC/);
  assert.match(html, /rolling last 7 days/i);
});
