import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST as checkoutPost } from "../src/app/api/checkout/route";
import { POST as webhookPost } from "../src/app/api/polar/webhook/route";
import ReturnPage from "../src/app/return/page";
import { FixturePaymentPort } from "../src/billing/fixture";
import { PolarPaymentPort, POLAR_API_BASE } from "../src/billing/polar";
import { CheckoutError, parseCheckoutInput, polarLiveEnabled } from "../src/billing/port";
import {
  createPaymentPort,
  getPaymentPort,
  resetPaymentPort,
  setPaymentPort,
} from "../src/billing/select";
import { applyPaidEvent, listPaid, resetListings } from "../src/core/listings";
import { getBoardListings, MIN_BID_USD, rankListings } from "../src/core/rank";
import { currentWeekUtc } from "../src/core/week";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "polar");
const WEEK = currentWeekUtc().weekId;

function loadPolarFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

function draftFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    buyer: "Acme Studio",
    budgetUsd: "3200",
    deadline: "2026-09-15",
    winnerRule: "Best portfolio by Friday",
    briefUrl: "https://example.com/acme",
    amountUsd: String(MIN_BID_USD),
    weekId: WEEK,
    ...overrides,
  };
}

function formBody(fields: Record<string, string>): URLSearchParams {
  return new URLSearchParams(fields);
}

afterEach(() => {
  resetListings();
  resetPaymentPort();
});

test("createPaymentPort stays fixture unless POLAR_LIVE=1", () => {
  assert.equal(polarLiveEnabled({}), false);
  assert.equal(polarLiveEnabled({ POLAR_LIVE: "0" }), false);
  assert.equal(polarLiveEnabled({ POLAR_LIVE: "true" }), false);
  assert.equal(polarLiveEnabled({ POLAR_LIVE: "1", POLAR_FIXTURE_ONLY: "1" }), false);
  assert.equal(createPaymentPort({}).kind, "fixture");
  assert.equal(createPaymentPort({ POLAR_LIVE: "0" }).kind, "fixture");
  assert.throws(
    () => createPaymentPort({ POLAR_LIVE: "1" }),
    /BLOCKED-SECRET: POLAR_ACCESS_TOKEN/,
  );
  const live = createPaymentPort({
    POLAR_LIVE: "1",
    POLAR_ACCESS_TOKEN: "polar_tok_test",
  });
  assert.equal(live.kind, "live");
});

test("SPEC acceptance 2: $5 fixture create lists at #1", async () => {
  const checkout = new FixturePaymentPort();
  const started = await checkout.createCheckout(parseCheckoutInput(draftFields()));
  assert.equal(listPaid(WEEK).length, 0);

  const paid = await checkout.handleWebhook(
    JSON.stringify({
      type: "checkout.updated",
      data: { id: started.sessionId, status: "succeeded" },
    }),
    {},
  );
  const listing = applyPaidEvent(paid);
  assert.ok(listing);
  assert.equal(listing.bidUsd, 5);
  assert.equal(listing.clicks, 0);
  assert.equal(listing.buyer, "Acme Studio");
  assert.equal(listing.budgetUsd, 3200);
  assert.equal(listing.deadline, "2026-09-15");
  assert.equal(listing.briefUrl, "https://example.com/acme");

  const ranked = rankListings(getBoardListings(WEEK));
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.bidUsd, 5);
});

test("abandoned checkout does not list", async () => {
  const checkout = new FixturePaymentPort();
  const started = await checkout.createCheckout(
    parseCheckoutInput(draftFields({ buyer: "Ghost", briefUrl: "https://example.com/ghost" })),
  );
  checkout.abandonSession(started.sessionId);
  await assert.rejects(
    () =>
      checkout.handleWebhook(
        JSON.stringify({
          type: "checkout.updated",
          data: { id: started.sessionId, status: "expired" },
        }),
        {},
      ),
    (error: unknown) => {
      assert.ok(error instanceof CheckoutError);
      assert.equal(error.code, "payment_incomplete");
      return true;
    },
  );
  assert.deepEqual(listPaid(WEEK), []);
  assert.equal(getBoardListings(WEEK).length, 0);
});

test("underbid still lists below #1", async () => {
  const checkout = new FixturePaymentPort();
  const first = await checkout.createCheckout(
    parseCheckoutInput(draftFields({ amountUsd: "12", briefUrl: "https://example.com/top" })),
  );
  applyPaidEvent(
    await checkout.handleWebhook(
      JSON.stringify({
        type: "checkout.updated",
        data: { id: first.sessionId, status: "succeeded" },
      }),
      {},
    ),
  );

  const second = await checkout.createCheckout(
    parseCheckoutInput(
      draftFields({
        buyer: "Under Bid",
        amountUsd: "5",
        briefUrl: "https://example.com/under",
      }),
    ),
  );
  applyPaidEvent(
    await checkout.handleWebhook(
      JSON.stringify({
        type: "checkout.updated",
        data: { id: second.sessionId, status: "succeeded" },
      }),
      {},
    ),
  );

  const ranked = rankListings(getBoardListings(WEEK));
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]?.briefUrl, "https://example.com/top");
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.bidUsd, 12);
  assert.equal(ranked[1]?.briefUrl, "https://example.com/under");
  assert.equal(ranked[1]?.rank, 2);
  assert.equal(ranked[1]?.bidUsd, 5);
});

test("POST /api/checkout fixture pay $5 lists after webhook", async () => {
  const checkout = new FixturePaymentPort();
  setPaymentPort(checkout);

  const response = await checkoutPost(
    new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: formBody(draftFields()),
    }),
  );
  assert.equal(response.status, 200);
  const started = (await response.json()) as { sessionId: string; checkoutUrl: string };
  assert.ok(started.sessionId);
  assert.equal(getBoardListings(WEEK).length, 0);

  const webhook = await webhookPost(
    new Request("http://localhost/api/polar/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "checkout.updated",
        data: { id: started.sessionId, status: "succeeded" },
      }),
    }),
  );
  assert.equal(webhook.status, 200);
  assert.deepEqual(await webhook.json(), { received: true, applied: true });

  const ranked = rankListings(getBoardListings(WEEK));
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.bidUsd, 5);
});

test("POST /api/checkout rejects bids below $5", async () => {
  const response = await checkoutPost(
    new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: formBody(draftFields({ amountUsd: "4" })),
    }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "bid_below_min" });
  assert.equal(getBoardListings(WEEK).length, 0);
});

test("fixture webhook from recorded Polar paid event inserts the listing", async () => {
  const webhook = await webhookPost(
    new Request("http://localhost/api/polar/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: loadPolarFixture("checkout-paid.json"),
    }),
  );
  assert.equal(webhook.status, 200);
  assert.deepEqual(await webhook.json(), { received: true, applied: true });

  const listings = listPaid("2026-W34");
  assert.equal(listings.length, 1);
  assert.equal(listings[0]?.briefUrl, "https://example.com/acme");
  assert.equal(listings[0]?.bidUsd, 5);
  assert.equal(listings[0]?.clicks, 0);

  const again = await webhookPost(
    new Request("http://localhost/api/polar/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: loadPolarFixture("checkout-paid.json"),
    }),
  );
  assert.equal(again.status, 200);
  assert.equal(listPaid("2026-W34").length, 1);
});

test("recorded expired Polar session is a no-op", async () => {
  const expired = await webhookPost(
    new Request("http://localhost/api/polar/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: loadPolarFixture("checkout-expired.json"),
    }),
  );
  assert.equal(expired.status, 200);
  assert.deepEqual(await expired.json(), { received: true, applied: false });
  assert.equal(listPaid("2026-W34").length, 0);
});

test("live PolarPaymentPort never fetches unless POLAR_LIVE=1", async () => {
  assert.throws(
    () => new PolarPaymentPort({ env: {} }),
    /PolarPaymentPort requires POLAR_LIVE=1/,
  );
  assert.throws(
    () => new PolarPaymentPort({ env: { POLAR_LIVE: "1" } }),
    /BLOCKED-SECRET: POLAR_ACCESS_TOKEN/,
  );

  let fetches = 0;
  const polar = new PolarPaymentPort({
    env: {
      POLAR_LIVE: "1",
      POLAR_ACCESS_TOKEN: "polar_tok_test",
      PUBLIC_BASE_URL: "http://localhost:3000",
    },
    fetch: async (input) => {
      fetches += 1;
      assert.equal(String(input), `${POLAR_API_BASE}/v1/checkouts/`);
      return new Response(loadPolarFixture("checkout-created.json"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const session = await polar.createCheckout(parseCheckoutInput(draftFields()));
  assert.equal(fetches, 1);
  assert.equal(session.sessionId, "chk_recorded_open");
  assert.equal(session.checkoutUrl, "https://polar.example/checkout/chk_recorded_open");
});

test("live Polar webhook applies only with a valid signature", async () => {
  const secret = "whsec_test";
  const polar = new PolarPaymentPort({
    env: {
      POLAR_LIVE: "1",
      POLAR_ACCESS_TOKEN: "polar_tok_test",
      POLAR_WEBHOOK_SECRET: secret,
    },
    fetch: async () => {
      throw new Error("live Polar must not fetch from webhook tests");
    },
  });
  setPaymentPort(polar);

  const raw = loadPolarFixture("underbid-paid.json");
  const unsigned = await webhookPost(
    new Request("http://localhost/api/polar/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    }),
  );
  assert.equal(unsigned.status, 400);
  assert.equal(listPaid("2026-W34").length, 0);

  const webhookId = "msg_1";
  const timestamp = "1710000000";
  const signature = createHmac("sha256", secret)
    .update(`${webhookId}.${timestamp}.${raw}`)
    .digest("base64");
  const signed = await webhookPost(
    new Request("http://localhost/api/polar/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": webhookId,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${signature}`,
      },
      body: raw,
    }),
  );
  assert.equal(signed.status, 200);
  assert.deepEqual(await signed.json(), { received: true, applied: true });
  const listings = listPaid("2026-W34");
  assert.equal(listings.length, 1);
  assert.equal(listings[0]?.bidUsd, 8);
  assert.equal(listings[0]?.briefUrl, "https://example.com/under");
});

test("/return markup shows paid only after a completed session", async () => {
  const pendingHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({ sessionId: "missing" }),
    }),
  );
  assert.match(pendingHtml, /data-return="pending"/);
  assert.match(pendingHtml, /does not trust the query string/i);
  assert.match(pendingHtml, /Back to the board/);

  const cancelHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({
        sessionId: "missing",
        status: "cancel",
      }),
    }),
  );
  assert.match(cancelHtml, /data-return="cancel"/);
  assert.match(cancelHtml, /abandoned checkout does not list/i);

  const checkout = new FixturePaymentPort();
  setPaymentPort(checkout);
  const started = await checkout.createCheckout(parseCheckoutInput(draftFields()));
  const openHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({ sessionId: started.sessionId }),
    }),
  );
  assert.match(openHtml, /data-return="pending"/);
  assert.equal(getBoardListings(WEEK).length, 0);

  applyPaidEvent(checkout.completeSession(started.sessionId));
  const paidHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({ sessionId: started.sessionId }),
    }),
  );
  assert.match(paidHtml, /data-return="paid"/);
  assert.match(paidHtml, /Acme Studio is listed at \$5/);
});

test("getPaymentPort shares the fixture across checkout and webhook", async () => {
  const first = getPaymentPort();
  assert.equal(first.kind, "fixture");
  const started = await first.createCheckout(parseCheckoutInput(draftFields()));
  const second = getPaymentPort();
  const paid = await second.handleWebhook(
    JSON.stringify({
      type: "checkout.updated",
      data: { id: started.sessionId, status: "succeeded" },
    }),
    {},
  );
  applyPaidEvent(paid);
  assert.equal(getBoardListings(WEEK).length, 1);
});

test("HTTP pages do not import billing/polar.ts", () => {
  const checkoutSrc = readFileSync(
    join(process.cwd(), "src", "app", "api", "checkout", "route.ts"),
    "utf8",
  );
  const webhookSrc = readFileSync(
    join(process.cwd(), "src", "app", "api", "polar", "webhook", "route.ts"),
    "utf8",
  );
  const returnSrc = readFileSync(
    join(process.cwd(), "src", "app", "return", "page.tsx"),
    "utf8",
  );
  assert.doesNotMatch(checkoutSrc, /billing\/polar/);
  assert.doesNotMatch(webhookSrc, /billing\/polar/);
  assert.doesNotMatch(returnSrc, /billing\/polar/);
});
