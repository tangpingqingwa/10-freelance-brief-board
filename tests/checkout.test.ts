import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST as checkoutPost } from "../src/app/checkout/route";
import { POST as webhookPost } from "../src/app/api/waffo/webhook/route";
import { POST as retiredWebhookPost } from "../src/app/api/polar/webhook/route";
import ReturnPage from "../src/app/return/page";
import CompletePage from "../src/app/checkout/complete/page";
import { FixturePaymentPort } from "../src/billing/fixture";
import {
  WaffoPaymentPort,
  WAFFO_API_BASE,
  canonicalWaffoPaidAt,
  centsToDisplay,
  displayToCents,
  isWaffoCheckoutUrl,
  isWaffoCheckoutUrlForSession,
} from "../src/billing/waffo";
import { CheckoutError, parseCheckoutInput } from "../src/billing/port";
import {
  assertProviderSettings,
  isPublicHttpsUrl,
  providerMode,
} from "../src/config";
import {
  createPaymentPort,
  getPaymentPort,
  resetPaymentPort,
  setPaymentPort,
} from "../src/billing/select";
import { ListingError, quoteBid, sameListingIdentity } from "../src/core/listing";
import { openBoardDatabase } from "../src/db";
import {
  createListingStore,
  findPaidByIdentity,
  listPaid,
  listUnpaid,
  PROVIDER_CLOCK_SKEW_MS,
  rememberUnpaidCheckout,
  resetListings,
  getCheckoutIntent,
  markCheckoutIntentRejected,
} from "../src/core/listings";
import { getBoardListings, MIN_BID_USD, rankListings } from "../src/core/rank";
import { Board } from "../src/app/board";
import { currentWeekUtc, weekIdUtc } from "../src/core/week";
import { settleFixtureEvent, settleFixtureEventInStore } from "./fixture-settlement";
import { GET as healthzGet } from "../src/app/healthz/route";

const WEEK = currentWeekUtc().weekId;
const mutableProcessEnv = process.env as unknown as Record<string, string | undefined>;

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

function waffoKeys(): { privateKey: string; publicKey: string } {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { privateKey: pair.privateKey, publicKey: pair.publicKey };
}

function waffoEnv(
  path: string,
  keys: { privateKey: string; publicKey: string },
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    WAFFO_MODE: "waffo-test",
    WAFFO_MERCHANT_ID: "MER_abcdefghijklmnopqrstuv",
    WAFFO_STORE_ID: "STO_abcdefghijklmnopqrstuv",
    WAFFO_PRODUCT_ID: "PROD_abcdefghijklmnopqrstuv",
    WAFFO_PRIVATE_KEY: keys.privateKey,
    WAFFO_WEBHOOK_TEST_PUBLIC_KEY: keys.publicKey,
    DATABASE_PATH: path,
    PUBLIC_BASE_URL: "http://localhost:3000",
    WAFFO_API_BASE: "https://test.waffo.example",
    ...overrides,
  };
}

function signWaffo(
  rawBody: string,
  privateKey: string,
  timestamp = Date.now(),
): string {
  const signature = createSign("RSA-SHA256")
    .update(`${timestamp}.${rawBody}`)
    .sign(privateKey, "base64");
  return `t=${timestamp},v1=${signature}`;
}

function completedEvent(
  intent: NonNullable<ReturnType<typeof getCheckoutIntent>>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const {
    id: deliveryIdOverride,
    eventId: businessEventIdOverride,
    storeId: eventStoreId,
    eventType: eventTypeOverride,
    mode: eventModeOverride,
    ...dataOverrides
  } = overrides;
  return {
    id: deliveryIdOverride ?? "delivery_test_1",
    timestamp: new Date().toISOString(),
    eventType: eventTypeOverride ?? "order.completed",
    eventId: businessEventIdOverride ?? "payment_test_1",
    storeId: eventStoreId ?? "STO_abcdefghijklmnopqrstuv",
    storeName: "Test Store",
    mode: eventModeOverride ?? "test",
    data: {
      orderId: "order_test_1",
      orderStatus: "completed",
      buyerEmail: "buyer@example.com",
      currency: "USD",
      amount: centsToDisplay(intent.expectedAmountCents),
      taxAmount: "0.00",
      subtotal: centsToDisplay(intent.expectedAmountCents),
      total: centsToDisplay(intent.expectedAmountCents),
      productName: "Rank",
      paymentId: "payment_test_1",
      paymentStatus: "succeeded",
      orderMerchantExternalId: intent.intentId,
      orderMetadata: intent.metadata,
      productMetadata: { productId: intent.productId },
      ...dataOverrides,
    },
  };
}

async function payFixture(
  checkout: FixturePaymentPort,
  fields: Record<string, string>,
) {
  const started = await checkout.createCheckout(parseCheckoutInput(fields));
  const paid = await checkout.handleWebhook(
    JSON.stringify({
      type: "checkout.updated",
      data: { id: started.sessionId, status: "succeeded" },
    }),
    {},
  );
  const listing = settleFixtureEvent(paid);
  assert.ok(listing);
  return { started, paid, listing };
}

afterEach(() => {
  resetListings();
  resetPaymentPort();
});

test("createPaymentPort requires explicit fixture or Waffo mode", () => {
  assert.equal(providerMode({ WAFFO_MODE: "fixture" }), "fixture");
  assert.equal(createPaymentPort({ WAFFO_MODE: "fixture" }).kind, "fixture");
  assert.throws(
    () => createPaymentPort({}),
    (error: unknown) => error instanceof CheckoutError &&
      error.code === "payment_provider_unconfigured",
  );
  assert.throws(
    () => createPaymentPort({ WAFFO_LIVE: "1" }),
    (error: unknown) => error instanceof CheckoutError &&
      error.code === "payment_provider_unconfigured",
  );
  assert.throws(
    () => createPaymentPort({ WAFFO_MODE: "waffo-test" }),
    /BLOCKED-/,
  );
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
  const listing = settleFixtureEvent(paid);
  assert.ok(listing);
  assert.equal(listing.bidUsd, 5);
  assert.equal(listing.clicks, 0);
  assert.equal(listing.buyer, "Acme Studio");
  assert.equal(listing.budgetUsd, 3200);
  assert.equal(listing.deadline, "2026-09-15");
  assert.equal(listing.briefUrl, "https://example.com/acme");

  const ranked = rankListings(getBoardListings());
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.bidUsd, 5);
});

test("abandoned checkout does not list", async () => {
  const checkout = new FixturePaymentPort();
  const started = await checkout.createCheckout(
    parseCheckoutInput(draftFields({ buyer: "Ghost", briefUrl: "https://example.com/ghost" })),
  );
  rememberUnpaidCheckout({
    sessionId: started.sessionId,
    listingDraft: parseCheckoutInput(
      draftFields({ buyer: "Ghost", briefUrl: "https://example.com/ghost" }),
    ).listingDraft,
  });
  assert.equal(listUnpaid(WEEK).length, 1);
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
  assert.equal(getBoardListings().length, 0);
});

test("underbid still lists below #1", async () => {
  const checkout = new FixturePaymentPort();
  const first = await checkout.createCheckout(
    parseCheckoutInput(draftFields({ amountUsd: "12", briefUrl: "https://example.com/top" })),
  );
  settleFixtureEvent(
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
  settleFixtureEvent(
    await checkout.handleWebhook(
      JSON.stringify({
        type: "checkout.updated",
        data: { id: second.sessionId, status: "succeeded" },
      }),
      {},
    ),
  );

  const ranked = rankListings(getBoardListings());
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]?.briefUrl, "https://example.com/top");
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.bidUsd, 12);
  assert.equal(ranked[1]?.briefUrl, "https://example.com/under");
  assert.equal(ranked[1]?.rank, 2);
  assert.equal(ranked[1]?.bidUsd, 5);
});

test("POST /checkout fixture pay $5 lists after webhook", async () => {
  const checkout = new FixturePaymentPort();
  setPaymentPort(checkout);

  const response = await checkoutPost(
    new Request("http://localhost/checkout", {
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
  assert.equal(getBoardListings().length, 0);

  const webhook = await webhookPost(
    new Request("http://localhost/api/waffo/webhook", {
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

  const ranked = rankListings(getBoardListings());
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.bidUsd, 5);
});

test("POST /checkout rejects bids below $5", async () => {
  const response = await checkoutPost(
    new Request("http://localhost/checkout", {
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
  assert.equal(getBoardListings().length, 0);
});

test("unknown fixture checkout or forged metadata never ranks", async () => {
  const checkout = new FixturePaymentPort();
  await assert.rejects(
    () => checkout.handleWebhook(
      JSON.stringify({
        type: "checkout.updated",
        data: {
          id: "attacker_session",
          status: "succeeded",
          metadata: { buyer: "Attacker", bidUsd: "999" },
        },
      }),
      {},
    ),
    (error: unknown) => error instanceof CheckoutError && error.code === "payment_incomplete",
  );
  assert.equal(getBoardListings().length, 0);
});

test("Waffo checkout uses official anonymous params and persists intent before provider", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-checkout-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  let calls = 0;
  let payload: Record<string, unknown> | undefined;
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({
    env,
    fetch: async (_input, init) => {
      calls += 1;
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          data: {
            sessionId: "SES_test_1",
            checkoutUrl: "https://checkout.waffo.ai/SES_test_1",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  const input = parseCheckoutInput(draftFields());
  const store = createListingStore({ databasePath: path });
  try {
    const started = await port.createCheckout(input);
    const retry = await port.createCheckout({ ...input, intentId: started.intentId });
    assert.deepEqual(retry, started);
    const intent = store.getCheckoutIntent(started.sessionId);
    assert.ok(intent);
    assert.equal(calls, 1);
    assert.equal(payload?.productId, "PROD_abcdefghijklmnopqrstuv");
    assert.equal(payload?.currency, "USD");
    assert.deepEqual(payload?.priceSnapshot, {
      amount: "5.00",
      taxCategory: "digital_goods",
    });
    assert.equal(payload?.orderMerchantExternalId, intent.intentId);
    assert.deepEqual(payload?.metadata, intent.metadata);
    assert.equal(String(payload?.successUrl),
      `http://localhost:3000/checkout/complete?intent=${encodeURIComponent(intent.intentId)}`);
    assert.equal(intent.status, "open");
    assert.equal(intent.expectedAmountCents, 500);
    assert.equal(listPaid(WEEK).length, 0);
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Waffo binds the hosted checkout URL to its returned session", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-session-binding-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({
    env,
    fetch: async () => new Response(JSON.stringify({ data: {
      sessionId: "SES_binding_a",
      checkoutUrl: "https://checkout.waffo.ai/SES_binding_b",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const store = createListingStore({ databasePath: path });
  try {
    await assert.rejects(
      () => port.createCheckout(parseCheckoutInput(draftFields({ briefUrl: "https://example.com/session-binding" }))),
      (error: unknown) => error instanceof CheckoutError && error.code === "waffo_ambiguous",
    );
    const pending = store.listUnpaid(WEEK);
    assert.equal(pending.length, 1);
    const intent = store.getCheckoutIntent(pending[0]!.sessionId);
    assert.ok(intent);
    assert.equal(intent.status, "unknown");
    assert.equal(intent.providerCheckoutId, undefined);
    assert.equal(intent.checkoutUrl, undefined);
    assert.equal(isWaffoCheckoutUrlForSession("https://checkout.waffo.ai/SES_binding_b", "SES_binding_a"), false);
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Waffo paid time stays in the rolling desk window or reconciles", async () => {
  const now = Date.parse("2026-08-27T12:00:00.000Z");
  assert.equal(
    canonicalWaffoPaidAt("2026-08-21T12:00:00.000Z", now),
    "2026-08-21T12:00:00.000Z",
  );
  assert.equal(canonicalWaffoPaidAt("2026-08-19T11:59:59.999Z", now), undefined);
  assert.equal(
    canonicalWaffoPaidAt("2026-08-27T12:00:00.001Z", now),
    "2026-08-27T12:00:00.001Z",
  );
  assert.equal(
    canonicalWaffoPaidAt(
      new Date(now + PROVIDER_CLOCK_SKEW_MS + 1).toISOString(),
      now,
    ),
    undefined,
  );
  assert.equal(canonicalWaffoPaidAt("2026-08-27", now), undefined);

  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-paid-window-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({
    env,
    fetch: async () => new Response(JSON.stringify({ data: {
      sessionId: "SES_paid_window",
      checkoutUrl: "https://checkout.waffo.ai/SES_paid_window",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const store = createListingStore({ databasePath: path });
  try {
    const input = parseCheckoutInput(draftFields({ briefUrl: "https://example.com/paid-window" }));
    await port.createCheckout(input);
    const intent = store.getCheckoutIntent("SES_paid_window");
    assert.ok(intent);
    const stale = JSON.stringify({
      ...completedEvent(intent),
      timestamp: "2026-08-19T11:59:59.999Z",
    });
    await assert.rejects(
      () => port.handleWebhook(stale, { "x-waffo-signature": signWaffo(stale, keys.privateKey) }),
      (error: unknown) => error instanceof CheckoutError && error.code === "paid_time_out_of_window",
    );
    assert.equal(store.listPaid(WEEK).length, 0);
    assert.equal(store.getCheckoutIntent(intent.intentId)?.status, "needs_reconciliation");
    assert.equal(store.listPaymentAuditEvents().at(-1)?.outcome, "reconciliation");
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Waffo persists intent creation, rejects pre-intent time, and keeps canonical ties", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-causal-time-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  let responseNumber = 0;
  const port = new WaffoPaymentPort({
    env,
    fetch: async () => {
      responseNumber += 1;
      const sessionId = `SES_causal_${responseNumber}`;
      return new Response(JSON.stringify({ data: {
        sessionId,
        checkoutUrl: `https://checkout.waffo.ai/${sessionId}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const store = createListingStore({ databasePath: path });
  try {
    const started = await port.createCheckout(
      parseCheckoutInput(draftFields({ briefUrl: "https://example.com/causal-time" })),
    );
    const intent = store.getCheckoutIntent(started.intentId!);
    assert.ok(intent);
    assert.match(intent.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const preIntent = JSON.stringify(completedEvent(intent, {
      id: "delivery_pre_intent",
      eventId: "payment_pre_intent",
      orderId: "order_pre_intent",
      paymentId: "payment_pre_intent",
    }));
    const preObject = JSON.parse(preIntent) as Record<string, unknown>;
    preObject.timestamp = new Date(Date.parse(intent.createdAt) - 1).toISOString();
    const preRaw = JSON.stringify(preObject);
    const prePaid = await port.handleWebhook(preRaw, {
      "x-waffo-signature": signWaffo(preRaw, keys.privateKey),
    });
    assert.throws(
      () => store.settlePaidEvent(prePaid),
      (error: unknown) => error instanceof ListingError && error.code === "paid_time_before_intent",
    );
    assert.equal(store.getCheckoutIntent(intent.intentId)?.status, "needs_reconciliation");
    assert.equal(store.getCheckoutIntent(intent.intentId)?.createdAt, intent.createdAt);
    assert.equal(store.listPaid(WEEK).length, 0);

    const tieAt = new Date(Date.now() + 1_000).toISOString();
    const tieIntents = await Promise.all([
      port.createCheckout(parseCheckoutInput(draftFields({
        buyer: "Tie A",
        briefUrl: "https://example.com/canonical-tie-a",
      }))),
      port.createCheckout(parseCheckoutInput(draftFields({
        buyer: "Tie B",
        briefUrl: "https://example.com/canonical-tie-b",
      }))),
    ]);
    const tieListings: Array<{ id: string; firstPaidAt: string }> = [];
    for (const [index, startedTie] of tieIntents.entries()) {
      const tieIntent = store.getCheckoutIntent(startedTie.intentId!);
      assert.ok(tieIntent);
      const tieObject = completedEvent(tieIntent, {
        id: `delivery_canonical_tie_${index}`,
        eventId: `payment_canonical_tie_${index}`,
        orderId: `order_canonical_tie_${index}`,
        paymentId: `payment_canonical_tie_${index}`,
      });
      tieObject.timestamp = tieAt;
      const tieRaw = JSON.stringify(tieObject);
      const tiePaid = await port.handleWebhook(tieRaw, {
        "x-waffo-signature": signWaffo(tieRaw, keys.privateKey),
      });
      const settled = store.settlePaidEvent(tiePaid);
      assert.ok(settled.listing);
      tieListings.push({ id: settled.listing.id, firstPaidAt: settled.listing.firstPaidAt });
    }
    assert.deepEqual(tieListings.map((row) => row.firstPaidAt), [tieAt, tieAt]);
    const ranked = rankListings(store.listPaid(WEEK));
    assert.deepEqual(
      ranked.filter((row) => row.firstPaidAt === tieAt).map((row) => row.id),
      tieListings.map((row) => row.id).sort(),
    );
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("late provider attachment preserves reconciliation and absent checkout identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-attach-race-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({
    env,
    fetch: async () => {
      throw new Error("late attachment regression must not call the provider");
    },
  });
  const store = createListingStore({ databasePath: path });
  const intentOptions = {
    productId: "PROD_abcdefghijklmnopqrstuv",
    storeId: "STO_abcdefghijklmnopqrstuv",
    providerMode: "waffo-test" as const,
    taxCategory: "digital_goods",
  };
  try {
    const rejectedIntent = store.createCheckoutIntent(
      {
        listingDraft: parseCheckoutInput(draftFields({
          briefUrl: "https://example.com/attach-reconciliation",
        })).listingDraft,
        amountUsd: 5,
        kind: "create",
      },
      { ...intentOptions, intentId: "intent_attach_reconciliation" },
    );
    const rejectedObject = completedEvent(rejectedIntent, {
      id: "delivery_attach_reconciliation",
      eventId: "payment_attach_reconciliation",
      orderId: "order_attach_reconciliation",
      paymentId: "payment_attach_reconciliation",
    });
    rejectedObject.timestamp = new Date(Date.parse(rejectedIntent.createdAt) - 1).toISOString();
    const rejectedRaw = JSON.stringify(rejectedObject);
    const rejectedPaid = await port.handleWebhook(rejectedRaw, {
      "x-waffo-signature": signWaffo(rejectedRaw, keys.privateKey),
    });
    assert.throws(
      () => store.settlePaidEvent(rejectedPaid),
      (error: unknown) => error instanceof ListingError && error.code === "paid_time_before_intent",
    );
    const reconciled = store.getCheckoutIntent(rejectedIntent.intentId);
    assert.equal(reconciled?.status, "needs_reconciliation");
    assert.equal(reconciled?.providerCheckoutId, undefined);
    assert.equal(reconciled?.failureCode, "paid_time_before_intent");

    const attachedAfterReject = store.attachCheckoutIntent(
      rejectedIntent.intentId,
      "SES_late_reconciliation",
      "https://checkout.waffo.ai/SES_late_reconciliation",
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.equal(attachedAfterReject.status, "needs_reconciliation");
    assert.equal(attachedAfterReject.failureCode, "paid_time_before_intent");
    assert.equal(attachedAfterReject.providerCheckoutId, "SES_late_reconciliation");
    const reconciliationDb = openBoardDatabase(path);
    try {
      const reconciliationPayment = reconciliationDb
        .prepare<[string], { provider_checkout_id: string | null }>(
          "SELECT provider_checkout_id FROM payments WHERE provider_order_id = ?",
        )
        .get("order_attach_reconciliation");
      assert.equal(reconciliationPayment?.provider_checkout_id, "SES_late_reconciliation");
    } finally {
      reconciliationDb.close();
    }

    const terminalRejectedIntent = store.createCheckoutIntent(
      {
        listingDraft: parseCheckoutInput(draftFields({
          buyer: "Rejected Before Provider Response",
          briefUrl: "https://example.com/attach-rejected",
        })).listingDraft,
        amountUsd: 5,
        kind: "create",
      },
      { ...intentOptions, intentId: "intent_attach_rejected" },
    );
    store.markCheckoutIntentRejected(terminalRejectedIntent.intentId, "provider_rejected");
    const attachedAfterRejection = store.attachCheckoutIntent(
      terminalRejectedIntent.intentId,
      "SES_late_rejected",
      "https://checkout.waffo.ai/SES_late_rejected",
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.equal(attachedAfterRejection.status, "rejected");
    assert.equal(attachedAfterRejection.failureCode, "provider_rejected");
    assert.equal(attachedAfterRejection.providerCheckoutId, "SES_late_rejected");

    const paidIntent = store.createCheckoutIntent(
      {
        listingDraft: parseCheckoutInput(draftFields({
          buyer: "No Session Buyer",
          briefUrl: "https://example.com/attach-no-checkout",
        })).listingDraft,
        amountUsd: 5,
        kind: "create",
      },
      { ...intentOptions, intentId: "intent_no_provider_checkout" },
    );
    const noCheckoutObject = completedEvent(paidIntent, {
      id: "delivery_no_provider_checkout",
      eventId: "payment_no_provider_checkout",
      orderId: "order_no_provider_checkout",
      paymentId: "payment_no_provider_checkout",
    });
    noCheckoutObject.timestamp = new Date(Date.now() + 1_000).toISOString();
    const noCheckoutRaw = JSON.stringify(noCheckoutObject);
    const paid = await port.handleWebhook(noCheckoutRaw, {
      "x-waffo-signature": signWaffo(noCheckoutRaw, keys.privateKey),
    });
    assert.equal(paid.checkoutId, undefined);
    assert.equal(paid.sessionId, paidIntent.intentId);
    const settled = store.settlePaidEvent(paid);
    assert.ok(settled.listing);
    const paidWithoutProviderId = store.getCheckoutIntent(paidIntent.intentId);
    assert.equal(paidWithoutProviderId?.status, "paid");
    assert.equal(paidWithoutProviderId?.providerCheckoutId, undefined);
    assert.equal(String(paidWithoutProviderId?.providerCheckoutId ?? ""), "");

    const db = openBoardDatabase(path);
    try {
      const row = db.prepare<[string], {
        provider_checkout_id: string | null;
        checkout_id: string | null;
      }>(
        `SELECT p.provider_checkout_id, w.checkout_id
           FROM payments p
           JOIN webhook_events w ON w.order_id = p.provider_order_id
          WHERE p.provider_order_id = ?`,
      ).get("order_no_provider_checkout");
      assert.equal(row?.provider_checkout_id, null);
      assert.equal(row?.checkout_id, null);
    } finally {
      db.close();
    }

    const lateSession = store.attachCheckoutIntent(
      paidIntent.intentId,
      "SES_late_real_session",
      "https://checkout.waffo.ai/SES_late_real_session",
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.equal(lateSession.status, "paid");
    assert.equal(lateSession.failureCode, undefined);
    assert.equal(lateSession.providerCheckoutId, "SES_late_real_session");
    assert.equal(store.getListingForCheckout("SES_late_real_session")?.id, settled.listing.id);
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("late provider attachment preserves an existing real checkout identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-attach-conflict-"));
  const path = join(directory, "board.sqlite");
  const store = createListingStore({ databasePath: path });
  try {
    const intent = store.createCheckoutIntent(
      {
        listingDraft: parseCheckoutInput(draftFields({
          briefUrl: "https://example.com/attach-identity-conflict",
        })).listingDraft,
        amountUsd: 5,
        kind: "create",
      },
      {
        intentId: "intent_attach_identity_conflict",
        productId: "PROD_abcdefghijklmnopqrstuv",
        storeId: "STO_abcdefghijklmnopqrstuv",
        providerMode: "waffo-test",
        taxCategory: "digital_goods",
      },
    );
    store.reserveWaffoAttempt({
      webhookId: "delivery_checkout_x",
      eventType: "order.completed",
      eventId: "payment_checkout_x",
      paymentId: "payment_checkout_x",
      orderId: "order_checkout_x",
      intentId: intent.intentId,
      checkoutId: "SES_checkout_x",
      payloadHash: "payload_checkout_x",
      rawBodyHash: "raw_checkout_x",
      reason: "paid_time_out_of_window",
      kind: "create",
      totalAmountCents: 500,
      paidAt: new Date().toISOString(),
    });

    assert.throws(
      () => store.attachCheckoutIntent(
        intent.intentId,
        "SES_checkout_y",
        "https://checkout.waffo.ai/SES_checkout_y",
        new Date(Date.now() + 60_000).toISOString(),
      ),
      (error: unknown) =>
        error instanceof ListingError && error.code === "checkout_intent_conflict",
    );
    assert.equal(store.getCheckoutIntent(intent.intentId)?.status, "needs_reconciliation");
    assert.equal(
      store.getCheckoutIntent(intent.intentId)?.failureCode,
      "paid_time_out_of_window",
    );
    assert.equal(store.listPaid(WEEK).length, 0);

    const db = openBoardDatabase(path);
    try {
      const event = db
        .prepare<[string], { checkout_id: string | null }>(
          "SELECT checkout_id FROM webhook_events WHERE intent_id = ?",
        )
        .get(intent.intentId);
      const payment = db
        .prepare<[string], { provider_checkout_id: string | null }>(
          "SELECT provider_checkout_id FROM payments WHERE provider_order_id = ?",
        )
        .get("order_checkout_x");
      assert.equal(event?.checkout_id, "SES_checkout_x");
      assert.equal(payment?.provider_checkout_id, "SES_checkout_x");
    } finally {
      db.close();
    }
    const conflict = store.listPaymentAuditEvents().at(-1);
    assert.equal(conflict?.outcome, "conflict");
    assert.equal(conflict?.reason, "checkout_id_conflict");
    assert.equal(conflict?.checkoutId, "SES_checkout_y");

    const matching = store.attachCheckoutIntent(
      intent.intentId,
      "SES_checkout_x",
      "https://checkout.waffo.ai/SES_checkout_x",
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.equal(matching.providerCheckoutId, "SES_checkout_x");
    assert.equal(matching.status, "needs_reconciliation");
    assert.equal(matching.failureCode, "paid_time_out_of_window");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("canonical checkout preserves reconciliation after a raced provider attachment", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-route-attach-race-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const store = createListingStore({ databasePath: path });
  let reservedIntentId: string | undefined;
  const port = new WaffoPaymentPort({
    env,
    fetch: async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        orderMerchantExternalId?: unknown;
      };
      if (typeof payload.orderMerchantExternalId !== "string") {
        throw new Error("provider response omitted the local intent identity");
      }
      reservedIntentId = payload.orderMerchantExternalId;
      const intent = store.getCheckoutIntent(payload.orderMerchantExternalId);
      assert.ok(intent);

      // A signed X delivery is verified while the provider response is still
      // in flight. Its stale payment is durably reserved for reconciliation.
      const signedX = completedEvent(intent, {
        id: "delivery_route_checkout_x",
        eventId: "payment_route_checkout_x",
        orderId: "order_route_checkout_x",
        paymentId: "payment_route_checkout_x",
        checkoutId: "SES_route_checkout_x",
      });
      signedX.timestamp = new Date(0).toISOString();
      const rawX = JSON.stringify(signedX);
      await assert.rejects(
        () => port.handleWebhook(rawX, {
          "x-waffo-signature": signWaffo(rawX, keys.privateKey),
        }),
        (error: unknown) =>
          error instanceof CheckoutError && error.code === "paid_time_out_of_window",
      );

      return new Response(JSON.stringify({ data: {
        sessionId: "SES_route_checkout_y",
        checkoutUrl: "https://checkout.waffo.ai/SES_route_checkout_y",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const previousEnv = { ...process.env };
  const restoreEnv = () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) process.env[key] = value;
    }
    setPaymentPort(port);
    const response = await checkoutPost(
      new Request("http://localhost/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(draftFields({
          briefUrl: "https://example.com/route-attach-race",
        })),
      }),
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "checkout_intent_conflict" });
    assert.ok(reservedIntentId);

    const reconciled = store.getCheckoutIntent(reservedIntentId);
    assert.equal(reconciled?.status, "needs_reconciliation");
    assert.equal(reconciled?.failureCode, "paid_time_out_of_window");
    assert.equal(reconciled?.providerCheckoutId, undefined);
    assert.equal(store.listPaid(WEEK).length, 0);

    const db = openBoardDatabase(path);
    try {
      const event = db.prepare<[string], {
        checkout_id: string | null;
        event_id: string;
        order_id: string;
      }>(
        "SELECT checkout_id, event_id, order_id FROM webhook_events WHERE intent_id = ?",
      ).get(reservedIntentId);
      assert.equal(event?.checkout_id, "SES_route_checkout_x");
      assert.equal(event?.event_id, "payment_route_checkout_x");
      assert.equal(event?.order_id, "order_route_checkout_x");
      const payment = db.prepare<[string], {
        provider_checkout_id: string | null;
      }>(
        "SELECT provider_checkout_id FROM payments WHERE provider_order_id = ?",
      ).get("order_route_checkout_x");
      assert.equal(payment?.provider_checkout_id, "SES_route_checkout_x");
    } finally {
      db.close();
    }
    const conflict = store.listPaymentAuditEvents().at(-1);
    assert.equal(conflict?.outcome, "conflict");
    assert.equal(conflict?.reason, "checkout_id_conflict");
    assert.equal(conflict?.checkoutId, "SES_route_checkout_y");

    // A matching late attachment still records X without changing the signed
    // reconciliation outcome or introducing Y as a second identity.
    const matching = store.attachCheckoutIntent(
      reservedIntentId,
      "SES_route_checkout_x",
      "https://checkout.waffo.ai/SES_route_checkout_x",
      new Date(Date.now() + 60_000).toISOString(),
    );
    assert.equal(matching.providerCheckoutId, "SES_route_checkout_x");
    assert.equal(matching.status, "needs_reconciliation");
    assert.equal(matching.failureCode, "paid_time_out_of_window");
  } finally {
    resetPaymentPort();
    restoreEnv();
    resetListings();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("canonical checkout returns safe HTML errors and preserves JSON errors", async () => {
  const html = await checkoutPost(
    new Request("http://localhost/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: formBody(draftFields({ amountUsd: "4" })),
    }),
  );
  assert.equal(html.status, 400);
  assert.match(html.headers.get("content-type") ?? "", /text\/html/);
  const htmlBody = await html.text();
  assert.match(htmlBody, /minimum first bid is \$5/i);
  assert.match(htmlBody, /Back to the brief desk/);

  const json = await checkoutPost(
    new Request("http://localhost/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: formBody(draftFields({ amountUsd: "4" })),
    }),
  );
  assert.equal(json.status, 400);
  assert.deepEqual(await json.json(), { error: "bid_below_min" });
});

test("Waffo rejects private or credential-bearing provider destinations before attachment", async () => {
  const unsafeUrls = [
    "https://127.0.0.1/steal",
    "https://user:pass@evil.example/steal",
    "https://[::ffff:7f00:1]/steal",
    "https://attacker.com/waffo-lookalike",
    "https://pancake.waffo.ai",
    "https://pancake.waffo.ai:443/store/test/checkout/session",
  ];
  for (const [index, checkoutUrl] of unsafeUrls.entries()) {
    const directory = mkdtempSync(join(tmpdir(), `freelance-waffo-url-${index}-`));
    const path = join(directory, "board.sqlite");
    const keys = waffoKeys();
    const env = waffoEnv(path, keys);
    const port = new WaffoPaymentPort({
      env,
      fetch: async () => new Response(
        JSON.stringify({ data: { sessionId: `SES_unsafe_${index}`, checkoutUrl } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    });
    const store = createListingStore({ databasePath: path });
    try {
      await assert.rejects(
        () => port.createCheckout(parseCheckoutInput(
          draftFields({ briefUrl: `https://example.com/unsafe-${index}` }),
        )),
        (error: unknown) => error instanceof CheckoutError && error.code === "waffo_ambiguous",
      );
      const unpaid = store.listUnpaid(WEEK);
      assert.equal(unpaid.length, 1, checkoutUrl);
      const intent = store.getCheckoutIntent(unpaid[0]!.sessionId);
      assert.ok(intent);
      assert.equal(intent.status, "unknown");
      assert.equal(intent.providerCheckoutId, undefined);
      assert.equal(intent.checkoutUrl, undefined);
      assert.equal(store.listPaid(WEEK).length, 0);
    } finally {
      store.close();
      port.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
  assert.equal(isWaffoCheckoutUrl("https://pancake.waffo.ai/store/test/checkout/session"), true);
  assert.equal(isWaffoCheckoutUrl("https://checkout.waffo.ai/session"), true);
  assert.equal(isWaffoCheckoutUrl("https://pancake.waffo.ai"), false);
  assert.equal(isWaffoCheckoutUrl("https://pancake.waffo.ai:443/store/test/checkout/session"), false);
});

test("Waffo signed order.completed settles atomically and exact replay is a no-op", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-paid-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({ env, fetch: async () => new Response(
    JSON.stringify({ data: {
      sessionId: "SES_test_1",
      checkoutUrl: "https://checkout.waffo.ai/SES_test_1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } }),
    { status: 200, headers: { "content-type": "application/json" } },
  ) });
  const store = createListingStore({ databasePath: path });
  try {
    const input = parseCheckoutInput(draftFields());
    const started = await port.createCheckout(input);
    const intent = store.getCheckoutIntent(started.sessionId);
    assert.ok(intent);
    const raw = JSON.stringify(completedEvent(intent));
    const signature = signWaffo(raw, keys.privateKey);
    const paid = await port.handleWebhook(raw, {
      "x-waffo-signature": signature,
    });
    const first = store.settlePaidEvent(paid);
    assert.ok(first.listing);
    assert.equal(first.listing.bidUsd, 5);
    const replay = store.settlePaidEvent(paid);
    assert.equal(replay.duplicate, true);
    assert.deepEqual(replay.listing, first.listing);
    assert.equal(store.listPaid(WEEK).length, 1);
    const secondRaw = raw.replace("delivery_test_1", "delivery_test_2");
    const secondPaid = await port.handleWebhook(secondRaw, {
      "x-waffo-signature": signWaffo(secondRaw, keys.privateKey),
    });
    assert.throws(
      () => store.settlePaidEvent(secondPaid),
      (error: unknown) => error instanceof ListingError && error.code === "payment_identifier_reuse",
    );
    assert.equal(store.listPaid(WEEK).length, 1);
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("signed config-drift captures reserve identities before mode/store correction", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-config-drift-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({
    env,
    fetch: async () => new Response(JSON.stringify({ data: {
      sessionId: "SES_config_drift",
      checkoutUrl: "https://pancake.waffo.ai/store/test/checkout/SES_config_drift",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  const store = createListingStore({ databasePath: path });
  try {
    const started = await port.createCheckout(parseCheckoutInput(draftFields()));
    const intent = store.getCheckoutIntent(started.intentId!);
    assert.ok(intent);
    const drift = JSON.stringify(completedEvent(intent, {
      id: "delivery_config_drift",
      eventId: "payment_config_drift",
      orderId: "order_config_drift",
      paymentId: "payment_config_drift",
      storeId: "STO_zyxwvutsrqponmlkjihgfe",
    }));
    await assert.rejects(
      () => port.handleWebhook(drift, {
        "x-waffo-signature": signWaffo(drift, keys.privateKey),
      }),
      (error: unknown) => error instanceof CheckoutError && error.code === "store_mismatch",
    );
    assert.equal(store.getCheckoutIntent(intent.intentId)?.status, "needs_reconciliation");
    assert.equal(store.listPaymentAuditEvents().at(-1)?.outcome, "reconciliation");

    const corrected = JSON.stringify(completedEvent(intent, {
      id: "delivery_config_drift",
      eventId: "payment_config_drift",
      orderId: "order_config_drift",
      paymentId: "payment_config_drift",
    }));
    const paid = await port.handleWebhook(corrected, {
      "x-waffo-signature": signWaffo(corrected, keys.privateKey),
    });
    assert.throws(
      () => store.settlePaidEvent(paid),
      (error: unknown) => error instanceof ListingError && error.code === "payment_identifier_reuse",
    );
    assert.equal(store.listPaid(WEEK).length, 0);
    assert.equal(store.listPaymentAuditEvents().at(-1)?.outcome, "conflict");
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Waffo requires a provider productMetadata binding, not merchant orderMetadata", async () => {
  for (const [label, productMetadata] of [
    ["omitted", undefined],
    ["malformed", { productId: 42 }],
    ["wrong", { productId: "PROD_wrong_product" }],
  ] as const) {
    const directory = mkdtempSync(join(tmpdir(), `freelance-waffo-product-${label}-`));
    const path = join(directory, "board.sqlite");
    const keys = waffoKeys();
    const env = waffoEnv(path, keys);
    const port = new WaffoPaymentPort({
      env,
      fetch: async () => new Response(JSON.stringify({ data: {
        sessionId: `SES_product_${label}`,
        checkoutUrl: `https://checkout.waffo.ai/SES_product_${label}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    const store = createListingStore({ databasePath: path });
    try {
      const started = await port.createCheckout(parseCheckoutInput(
        draftFields({ briefUrl: `https://example.com/product-${label}` }),
      ));
      const intent = store.getCheckoutIntent(started.intentId!);
      assert.ok(intent);
      const overrides: Record<string, unknown> = { productMetadata };
      const raw = JSON.stringify(completedEvent(intent, overrides));
      await assert.rejects(
        () => port.handleWebhook(raw, {
          "x-waffo-signature": signWaffo(raw, keys.privateKey),
        }),
        (error: unknown) => error instanceof CheckoutError && error.code === "product_mismatch",
        label,
      );
      assert.equal(store.getCheckoutIntent(intent.intentId)?.status, "needs_reconciliation");
      assert.equal(store.listPaid(WEEK).length, 0);
    } finally {
      store.close();
      port.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("a signed amount mismatch reserves identities and a changed body cannot later rank", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-reservation-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({
    env,
    fetch: async () => new Response(
      JSON.stringify({ data: {
        sessionId: "SES_reservation_1",
        checkoutUrl: "https://checkout.waffo.ai/SES_reservation_1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  });
  const store = createListingStore({ databasePath: path });
  try {
    const started = await port.createCheckout(parseCheckoutInput(draftFields()));
    const intent = store.getCheckoutIntent(started.sessionId);
    assert.ok(intent);
    const mismatch = JSON.stringify(completedEvent(intent, {
      id: "delivery_reserved_capture",
      eventId: "payment_reserved_capture",
      orderId: "order_reserved_capture",
      paymentId: "payment_reserved_capture",
      subtotal: "9.99",
      amount: "9.99",
      taxAmount: "0.00",
      total: "9.99",
    }));
    await assert.rejects(
      () => port.handleWebhook(mismatch, {
        "x-waffo-signature": signWaffo(mismatch, keys.privateKey),
      }),
      (error: unknown) => error instanceof CheckoutError && error.code === "amount_mismatch",
    );
    assert.equal(store.getCheckoutIntent(intent.intentId)?.status, "needs_reconciliation");
    assert.equal(store.listPaid(WEEK).length, 0);

    // The identities are unchanged, but the body now claims the expected
    // amount. The signed event is verified; settlement must still reject it.
    const changed = JSON.stringify(completedEvent(intent, {
      id: "delivery_reserved_capture",
      eventId: "payment_reserved_capture",
      orderId: "order_reserved_capture",
      paymentId: "payment_reserved_capture",
    }));
    const paid = await port.handleWebhook(changed, {
      "x-waffo-signature": signWaffo(changed, keys.privateKey),
    });
    assert.throws(
      () => store.settlePaidEvent(paid),
      (error: unknown) => error instanceof ListingError && error.code === "payment_identifier_reuse",
    );
    assert.equal(store.listPaid(WEEK).length, 0);
    assert.deepEqual(
      store.listPaymentAuditEvents().map((row) => row.outcome),
      ["rejected", "verified", "conflict"],
    );
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reservation or audit storage failure returns retryable 5xx and rolls back the rejection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-rejection-rollback-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({
    env,
    fetch: async () => new Response(
      JSON.stringify({ data: {
        sessionId: "SES_rejection_rollback",
        checkoutUrl: "https://checkout.waffo.ai/SES_rejection_rollback",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  });
  const store = createListingStore({ databasePath: path });
  const ledger = openBoardDatabase(path);
  const previousEnv = { ...process.env };
  const restoreEnv = () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) process.env[key] = value;
    }
    setPaymentPort(port);
    const started = await port.createCheckout(parseCheckoutInput(draftFields()));
    const intent = store.getCheckoutIntent(started.sessionId);
    assert.ok(intent);
    ledger.exec(`
      CREATE TRIGGER rejection_audit_failure
      BEFORE INSERT ON payment_audit_events
      WHEN NEW.outcome = 'rejected'
      BEGIN
        SELECT RAISE(ABORT, 'injected rejection audit failure');
      END;
    `);
    const raw = JSON.stringify(completedEvent(intent, {
      id: "delivery_rejection_rollback",
      eventId: "payment_rejection_rollback",
      orderId: "order_rejection_rollback",
      paymentId: "payment_rejection_rollback",
      total: "9.99",
      amount: "9.99",
      subtotal: "9.99",
    }));
    const response = await webhookPost(new Request("http://localhost/api/waffo/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-waffo-signature": signWaffo(raw, keys.privateKey),
      },
      body: raw,
    }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "0");
    assert.deepEqual(await response.json(), { error: "webhook_retryable" });
    assert.equal(store.getCheckoutIntent(intent.intentId)?.status, "open");
    assert.equal(store.listPaymentAuditEvents().length, 0);
    assert.equal(store.listPaid(WEEK).length, 0);
  } finally {
    restoreEnv();
    resetPaymentPort();
    ledger.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Waffo requires a future ISO expiry and rotates an attached expired session", async () => {
  for (const [label, expiry] of [
    ["missing", undefined],
    ["malformed", "not-a-date"],
    ["invalid-calendar", "2099-02-30T00:00:00.000Z"],
    ["past", "2020-01-01T00:00:00.000Z"],
  ] as const) {
    const directory = mkdtempSync(join(tmpdir(), `freelance-waffo-expiry-${label}-`));
    const path = join(directory, "board.sqlite");
    const keys = waffoKeys();
    const env = waffoEnv(path, keys);
    const port = new WaffoPaymentPort({
      env,
      fetch: async () => new Response(
        JSON.stringify({ data: {
          sessionId: `SES_expiry_${label}`,
          checkoutUrl: `https://checkout.waffo.ai/SES_expiry_${label}`,
          ...(expiry === undefined ? {} : { expiresAt: expiry }),
        } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    });
    const store = createListingStore({ databasePath: path });
    try {
      await assert.rejects(
        () => port.createCheckout(parseCheckoutInput(draftFields())),
        (error: unknown) => error instanceof CheckoutError && error.code === "waffo_ambiguous",
        label,
      );
      const intent = store.listUnpaid(WEEK)[0];
      assert.ok(intent);
      const saved = store.getCheckoutIntent(intent.sessionId);
      assert.ok(saved);
      assert.equal(saved.status, "unknown");
      assert.equal(saved.providerCheckoutId, undefined);
      assert.equal(saved.checkoutUrl, undefined);
    } finally {
      store.close();
      port.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }

  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-expiry-rotate-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  let calls = 0;
  const port = new WaffoPaymentPort({
    env,
    fetch: async () => {
      calls += 1;
      const sessionId = calls === 1 ? "SES_expired_old" : "SES_expired_new";
      return new Response(
        JSON.stringify({ data: {
          sessionId,
          checkoutUrl: `https://checkout.waffo.ai/${sessionId}`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  const store = createListingStore({ databasePath: path });
  const control = openBoardDatabase(path);
  try {
    const input = parseCheckoutInput(draftFields());
    const first = await port.createCheckout(input);
    control
      .prepare("UPDATE checkout_intents SET expires_at = ? WHERE intent_id = ?")
      .run("2020-01-01T00:00:00.000Z", first.intentId);
    const second = await port.createCheckout({ ...input, intentId: first.intentId });
    assert.equal(calls, 2);
    assert.equal(second.sessionId, "SES_expired_new");
    assert.equal(store.getCheckoutIntent(first.intentId!)?.providerCheckoutId, "SES_expired_new");
  } finally {
    control.close();
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Waffo settlement rolls back the listing when the payment ledger fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-rollback-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({
    env,
    fetch: async () => new Response(
      JSON.stringify({ data: {
        sessionId: "SES_rollback_1",
        checkoutUrl: "https://checkout.waffo.ai/SES_rollback_1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  });
  const store = createListingStore({ databasePath: path });
  const ledger = openBoardDatabase(path);
  try {
    const started = await port.createCheckout(parseCheckoutInput(draftFields()));
    const intent = store.getCheckoutIntent(started.sessionId);
    assert.ok(intent);
    const raw = JSON.stringify(completedEvent(intent, {
      id: "delivery_rollback_1",
      eventId: "payment_rollback_1",
      orderId: "order_rollback_1",
      paymentId: "payment_rollback_1",
    }));
    const paid = await port.handleWebhook(raw, {
      "x-waffo-signature": signWaffo(raw, keys.privateKey),
    });
    ledger.exec(`
      CREATE TRIGGER payment_insert_failure
      BEFORE INSERT ON payments
      WHEN NEW.status = 'applied'
      BEGIN
        SELECT RAISE(ABORT, 'injected payment ledger failure');
      END;
    `);
    assert.throws(
      () => store.settlePaidEvent(paid),
      /injected payment ledger failure/,
    );
    assert.equal(store.listPaid(WEEK).length, 0);
    assert.equal(store.getCheckoutIntent(intent.intentId)?.status, "open");
    assert.equal(store.listUnpaid(WEEK).length, 1);
  } finally {
    ledger.close();
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("canonical Waffo route returns retryable 5xx and leaves the intent open after a transaction failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-route-rollback-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({
    env,
    fetch: async () => new Response(
      JSON.stringify({ data: {
        sessionId: "SES_route_rollback",
        checkoutUrl: "https://checkout.waffo.ai/SES_route_rollback",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  });
  const store = createListingStore({ databasePath: path });
  const ledger = openBoardDatabase(path);
  const previousEnv = { ...process.env };
  const restoreEnv = () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) process.env[key] = value;
    }
    setPaymentPort(port);
    const started = await port.createCheckout(parseCheckoutInput(draftFields()));
    const intent = store.getCheckoutIntent(started.sessionId);
    assert.ok(intent);
    const raw = JSON.stringify(completedEvent(intent, {
      id: "delivery_route_rollback",
      eventId: "payment_route_rollback",
      orderId: "order_route_rollback",
      paymentId: "payment_route_rollback",
    }));
    ledger.exec(`
      CREATE TRIGGER route_payment_insert_failure
      BEFORE INSERT ON payments
      WHEN NEW.status = 'applied'
      BEGIN
        SELECT RAISE(ABORT, 'injected route payment failure');
      END;
    `);
    const response = await webhookPost(new Request("http://localhost/api/waffo/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-waffo-signature": signWaffo(raw, keys.privateKey),
      },
      body: raw,
    }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "0");
    assert.deepEqual(await response.json(), { error: "webhook_retryable" });
    assert.equal(store.listPaid(WEEK).length, 0);
    assert.equal(store.getCheckoutIntent(intent.intentId)?.status, "open");
    assert.equal(store.listUnpaid(WEEK).length, 1);
  } finally {
    restoreEnv();
    resetPaymentPort();
    ledger.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("canonical Waffo route retries changed identity when conflict audit persistence fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-conflict-audit-failure-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({
    env,
    fetch: async () => new Response(
      JSON.stringify({ data: {
        sessionId: "SES_conflict_audit",
        checkoutUrl: "https://checkout.waffo.ai/SES_conflict_audit",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  });
  const store = createListingStore({ databasePath: path });
  const ledger = openBoardDatabase(path);
  const previousEnv = { ...process.env };
  const restoreEnv = () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) process.env[key] = value;
    }
    setPaymentPort(port);
    const started = await port.createCheckout(parseCheckoutInput(draftFields()));
    const intent = store.getCheckoutIntent(started.sessionId);
    assert.ok(intent);
    const firstRaw = JSON.stringify(completedEvent(intent, {
      id: "delivery_conflict_audit_1",
      eventId: "payment_conflict_audit",
      orderId: "order_conflict_audit",
      paymentId: "payment_conflict_audit",
    }));
    const first = await webhookPost(new Request("http://localhost/api/waffo/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-waffo-signature": signWaffo(firstRaw, keys.privateKey),
      },
      body: firstRaw,
    }));
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { received: true, applied: true });

    ledger.exec(`
      CREATE TRIGGER conflict_audit_failure
      BEFORE INSERT ON payment_audit_events
      WHEN NEW.outcome = 'conflict'
      BEGIN
        SELECT RAISE(ABORT, 'injected conflict audit failure');
      END;
    `);
    const changedRaw = JSON.stringify(completedEvent(intent, {
      id: "delivery_conflict_audit_2",
      eventId: "payment_conflict_audit",
      orderId: "order_conflict_audit",
      paymentId: "payment_conflict_audit",
      total: "5.00",
    }));
    const changed = await webhookPost(new Request("http://localhost/api/waffo/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-waffo-signature": signWaffo(changedRaw, keys.privateKey),
      },
      body: changedRaw,
    }));
    assert.equal(changed.status, 503);
    assert.equal(changed.headers.get("retry-after"), "0");
    assert.deepEqual(await changed.json(), { error: "webhook_retryable" });
    assert.equal(store.listPaid(WEEK).length, 1);
    assert.equal(store.getCheckoutIntent(intent.intentId)?.status, "paid");
    const audit = store.listPaymentAuditEvents();
    assert.deepEqual(audit.map((row) => row.outcome), ["verified", "accepted", "verified"]);
    assert.equal(audit.some((row) => row.outcome === "conflict"), false);
  } finally {
    restoreEnv();
    resetPaymentPort();
    ledger.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retired legacy webhook path is a non-authoritative 410", async () => {
  const response = await retiredWebhookPost(new Request("http://localhost/api/polar/webhook", {
    method: "POST",
    body: "{}",
  }));
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    error: "webhook_path_moved",
    canonical: "/api/waffo/webhook",
  });
});

test("Waffo rejects invalid signature, wrong status, wrong store, currency, amount, and metadata", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-negative-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const port = new WaffoPaymentPort({ env: waffoEnv(path, keys), fetch: async () => new Response(
    JSON.stringify({ data: {
      sessionId: "SES_test_1",
      checkoutUrl: "https://checkout.waffo.ai/SES_test_1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } }),
    { status: 200, headers: { "content-type": "application/json" } },
  ) });
  const store = createListingStore({ databasePath: path });
  try {
    const started = await port.createCheckout(parseCheckoutInput(draftFields()));
    const intent = store.getCheckoutIntent(started.sessionId);
    assert.ok(intent);
    const raw = JSON.stringify(completedEvent(intent));
    await assert.rejects(
      () => port.handleWebhook(raw, {}),
      (error: unknown) => error instanceof CheckoutError && error.code === "invalid_webhook_signature",
    );
    await assert.rejects(
      () => port.handleWebhook(raw, {
        "x-waffo-signature": signWaffo(raw, keys.privateKey, Date.now() - 46 * 60 * 1000),
      }),
      (error: unknown) => error instanceof CheckoutError && error.code === "invalid_webhook_signature",
    );
    for (const [label, overrides] of [
      ["wrong status", { paymentStatus: "failed" }],
      ["wrong store", { storeId: "STO_zzzzzzzzzzzzzzzzzzzzzz" }],
      ["null checkout", { checkoutId: null }],
      ["wrong product", { productId: "PROD_zzzzzzzzzzzzzzzzzzzzzz" }],
      ["wrong currency", { currency: "EUR" }],
      ["wrong amount", { subtotal: "19.00", amount: "19.00", total: "19.00" }],
      ["wrong metadata", { orderMetadata: { ...intent.metadata, bidUsd: "19" } }],
      ["wrong event type", { eventType: "order.created" }],
    ] as const) {
      const candidate = JSON.stringify(completedEvent(intent, overrides));
      await assert.rejects(
        () => port.handleWebhook(candidate, {
          "x-waffo-signature": signWaffo(candidate, keys.privateKey),
        }),
        (error: unknown) => {
          assert.ok(error instanceof CheckoutError, label);
          return true;
        },
      );
      assert.equal(store.listPaid(WEEK).length, 0);
    }
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Waffo requires event and payment identifiers to match and rejects inconsistent money before settlement", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-money-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({
    env,
    fetch: async () => new Response(
      JSON.stringify({ data: {
        sessionId: "SES_money_1",
      checkoutUrl: "https://checkout.waffo.ai/SES_money_1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  });
  const store = createListingStore({ databasePath: path });
  try {
    const started = await port.createCheckout(parseCheckoutInput(draftFields()));
    const intent = store.getCheckoutIntent(started.sessionId);
    assert.ok(intent);

    // Independent reproduction: eventId is not paymentId while the signed
    // payload also claims subtotal $5, tax $0, and total $9.99.
    const mismatched = JSON.stringify(completedEvent(intent, {
      id: "delivery_money_mismatch",
      eventId: "payment_DIFFERENT",
      orderId: "order_review",
      paymentId: "payment_review",
      subtotal: "5.00",
      amount: "5.00",
      taxAmount: "0.00",
      total: "9.99",
    }));
    await assert.rejects(
      () => port.handleWebhook(mismatched, {
        "x-waffo-signature": signWaffo(mismatched, keys.privateKey),
      }),
      (error: unknown) => error instanceof CheckoutError && error.code === "payment_id_mismatch",
    );
    assert.equal(store.getCheckoutIntent(intent.intentId)?.status, "needs_reconciliation");
    assert.equal(store.listPaid(WEEK).length, 0);

    const inconsistent = JSON.stringify(completedEvent(intent, {
      id: "delivery_money_inconsistent",
      eventId: "payment_review_2",
      orderId: "order_review_2",
      paymentId: "payment_review_2",
      subtotal: "5.00",
      amount: "5.00",
      taxAmount: "0.00",
      total: "9.99",
    }));
    await assert.rejects(
      () => port.handleWebhook(inconsistent, {
        "x-waffo-signature": signWaffo(inconsistent, keys.privateKey),
      }),
      (error: unknown) => error instanceof CheckoutError && error.code === "amount_mismatch",
    );
    assert.equal(store.listPaid(WEEK).length, 0);
    const audit = store.listPaymentAuditEvents();
    assert.equal(audit.length, 2);
    assert.deepEqual(audit.map((row) => row.outcome), ["rejected", "conflict"]);
    assert.notEqual(audit[0]?.rawBodyHash, audit[1]?.rawBodyHash);
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("every verified replay attempt is append-only audited, including changed identifier reuse", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-audit-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({
    env,
    fetch: async () => new Response(
      JSON.stringify({ data: {
        sessionId: "SES_audit_1",
      checkoutUrl: "https://checkout.waffo.ai/SES_audit_1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  });
  const store = createListingStore({ databasePath: path });
  try {
    const started = await port.createCheckout(parseCheckoutInput(draftFields()));
    const intent = store.getCheckoutIntent(started.sessionId);
    assert.ok(intent);
    const raw = JSON.stringify(completedEvent(intent, {
      id: "delivery_audit_1",
      eventId: "payment_audit_1",
      orderId: "order_audit_1",
      paymentId: "payment_audit_1",
    }));
    const paid = await port.handleWebhook(raw, {
      "x-waffo-signature": signWaffo(raw, keys.privateKey),
    });
    assert.equal(store.settlePaidEvent(paid).duplicate, false);
    const changed = JSON.stringify(completedEvent(intent, {
      id: "delivery_audit_1",
      eventId: "payment_audit_1",
      orderId: "order_audit_1",
      paymentId: "payment_audit_1",
      total: "9.99",
    }));
    await assert.rejects(
      () => port.handleWebhook(changed, {
        "x-waffo-signature": signWaffo(changed, keys.privateKey),
      }),
      (error: unknown) => error instanceof CheckoutError && error.code === "amount_mismatch",
    );
    const audit = store.listPaymentAuditEvents();
    assert.equal(audit.length, 3);
    assert.deepEqual(audit.map((row) => row.outcome), ["verified", "accepted", "conflict"]);
    assert.notEqual(audit[0]?.rawBodyHash, audit[2]?.rawBodyHash);
    assert.equal(store.listPaid(WEEK).length, 1);
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Waffo decimal boundary rejects binary-looking cents and stale signatures", () => {
  assert.equal(centsToDisplay(1900), "19.00");
  assert.equal(displayToCents("19"), 1900);
  assert.equal(displayToCents("19.9"), 1990);
  assert.equal(displayToCents("19.999"), undefined);
  assert.equal(displayToCents("19e0"), undefined);
});

test("production Waffo mode fails closed for provider, URL, and durable-store gaps", () => {
  const keys = waffoKeys();
  const complete = {
    NODE_ENV: "production",
    WAFFO_MODE: "waffo-prod",
    WAFFO_MERCHANT_ID: "MER_abcdefghijklmnopqrstuv",
    WAFFO_STORE_ID: "STO_abcdefghijklmnopqrstuv",
    WAFFO_PRODUCT_ID: "PROD_abcdefghijklmnopqrstuv",
    WAFFO_PRIVATE_KEY: keys.privateKey,
    WAFFO_WEBHOOK_PROD_PUBLIC_KEY: keys.publicKey,
    PUBLIC_BASE_URL: "https://briefboard.example.com",
    DATABASE_PATH: "/tmp/freelance-board-prod.sqlite",
  };
  assert.equal(assertProviderSettings(complete), "waffo-prod");
  for (const name of ["WAFFO_MODE", "WAFFO_MERCHANT_ID", "WAFFO_STORE_ID", "WAFFO_PRODUCT_ID", "WAFFO_PRIVATE_KEY", "WAFFO_WEBHOOK_PROD_PUBLIC_KEY", "PUBLIC_BASE_URL", "DATABASE_PATH"] as const) {
    const candidate = { ...complete };
    delete candidate[name];
    assert.throws(() => assertProviderSettings(candidate), /BLOCKED-/,
      `missing ${name} must fail closed`);
  }
  assert.throws(
    () => assertProviderSettings({ ...complete, WAFFO_MODE: "fixture" }),
    /production cannot use fixture mode/,
  );
  assert.throws(
    () => assertProviderSettings({ ...complete, PUBLIC_BASE_URL: "http://briefboard.example.com" }),
    /HTTPS/,
  );
  assert.throws(
    () => assertProviderSettings({ ...complete, DATABASE_PATH: ":memory:" }),
    /durable shared file/,
  );
  // WAFFO_MODE is the only provider selector. A stale generic alias cannot
  // select Waffo, and cannot override an explicit Waffo mode.
  assert.equal(providerMode({ PAYMENT_MODE: "waffo-prod" }), undefined);
  assert.equal(
    providerMode({ WAFFO_MODE: "waffo-test", PAYMENT_MODE: "waffo-prod" }),
    "waffo-test",
  );
  assert.throws(
    () => assertProviderSettings({ ...complete, WAFFO_API_BASE: "https://attacker.example" }),
    /official|api\.waffo\.ai|production/,
  );
  assert.throws(
    () => assertProviderSettings({ ...complete, PUBLIC_BASE_URL: "https://127.0.0.1" }),
    /public HTTPS/,
  );
  for (const privateMappedHost of [
    "https://[::ffff:7f00:1]",
    "https://[::ffff:ac10:1]",
    "https://[::ffff:a9fe:1]",
    "https://[::ffff:6440:1]",
    "https://[100::1]",
    "https://[2001:db8::1]",
    "https://[ff02::1]",
  ]) {
    assert.throws(
      () => assertProviderSettings({ ...complete, PUBLIC_BASE_URL: privateMappedHost }),
      /public HTTPS/,
      privateMappedHost,
    );
  }
  for (const unsafeBase of [
    "https://brief.example/callback",
    "https://brief.example/?next=evil",
    "https://user:pass@brief.example",
    "https://briefboard",
  ]) {
    assert.throws(
      () => assertProviderSettings({ ...complete, PUBLIC_BASE_URL: unsafeBase }),
      /PUBLIC_BASE_URL/,
      unsafeBase,
    );
  }
  const explicitTest = waffoEnv("/tmp/freelance-waffo-test-isolated.sqlite", keys);
  assert.equal(
    assertProviderSettings({ ...explicitTest, NODE_ENV: "production" }),
    "waffo-test",
  );
  assert.throws(
    () => assertProviderSettings({ ...explicitTest, DATABASE_PATH: ":memory:" }),
    /durable shared file/,
  );
  assert.equal(providerMode({ POLAR_LIVE: "1", POLAR_FIXTURE_ONLY: "1" }), undefined);
});

test("production rejects injected fixture/reset seams and reserved public hosts", () => {
  const keys = waffoKeys();
  const production = {
    NODE_ENV: "production",
    WAFFO_MODE: "waffo-prod",
    WAFFO_MERCHANT_ID: "MER_abcdefghijklmnopqrstuv",
    WAFFO_STORE_ID: "STO_abcdefghijklmnopqrstuv",
    WAFFO_PRODUCT_ID: "PROD_abcdefghijklmnopqrstuv",
    WAFFO_PRIVATE_KEY: keys.privateKey,
    WAFFO_WEBHOOK_PROD_PUBLIC_KEY: keys.publicKey,
    PUBLIC_BASE_URL: "https://briefboard.example.com",
    DATABASE_PATH: "/tmp/freelance-waffo-injection.sqlite",
  };
  const priorNodeEnv = mutableProcessEnv.NODE_ENV;
  try {
    delete mutableProcessEnv.NODE_ENV;
    setPaymentPort(new FixturePaymentPort());
    assert.throws(
      () => getPaymentPort(production),
      (error: unknown) => error instanceof CheckoutError &&
        error.code === "payment_provider_injection_forbidden",
    );
    resetPaymentPort();

    setPaymentPort(new FixturePaymentPort());
    mutableProcessEnv.NODE_ENV = "production";
    assert.throws(
      () => setPaymentPort(new FixturePaymentPort()),
      /production cannot inject/,
    );
    assert.throws(
      () => resetPaymentPort(),
      /production cannot reset/,
    );
  } finally {
    delete mutableProcessEnv.NODE_ENV;
    resetPaymentPort();
    if (priorNodeEnv !== undefined) mutableProcessEnv.NODE_ENV = priorNodeEnv;
  }

  for (const host of [
    "https://brief.example",
    "https://brief.test",
    "https://brief.invalid",
    "https://brief.localhost",
    "https://brief.local",
    "https://brief.home.arpa",
    "https://briefboard",
    "https://127.0.0.1",
    "https://127.0.0.1.",
  ]) {
    assert.equal(isPublicHttpsUrl(host), false, host);
  }
  assert.equal(isPublicHttpsUrl("https://briefboard.example.com"), true);
  assert.equal(isPublicHttpsUrl("https://checkout.waffo.ai/session"), true);
});

test("production healthz and npm start fail closed before readiness when config is absent", async () => {
  const previousEnv = { ...process.env };
  try {
    mutableProcessEnv.NODE_ENV = "production";
    for (const name of [
      "WAFFO_MODE",
      "WAFFO_MERCHANT_ID",
      "WAFFO_STORE_ID",
      "WAFFO_PRODUCT_ID",
      "WAFFO_PRIVATE_KEY",
      "WAFFO_PRIVATE_KEY_FILE",
      "WAFFO_WEBHOOK_PROD_PUBLIC_KEY",
      "WAFFO_WEBHOOK_TEST_PUBLIC_KEY",
      "PUBLIC_BASE_URL",
      "DATABASE_PATH",
    ]) {
      delete process.env[name];
    }
    const health = healthzGet();
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), { ok: false, error: "not_ready" });

    const start = spawnSync("npm", ["run", "start"], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.notEqual(start.status, 0);
    assert.match(`${start.stdout}\n${start.stderr}`, /BLOCKED-CONFIG/);
    assert.doesNotMatch(`${start.stdout}\n${start.stderr}`, /started server|ready/i);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("production preflight and healthz parse the mode-scoped RSA keys", async () => {
  const keys = waffoKeys();
  const complete = {
    NODE_ENV: "production",
    WAFFO_MODE: "waffo-prod",
    WAFFO_MERCHANT_ID: "MER_abcdefghijklmnopqrstuv",
    WAFFO_STORE_ID: "STO_abcdefghijklmnopqrstuv",
    WAFFO_PRODUCT_ID: "PROD_abcdefghijklmnopqrstuv",
    WAFFO_PRIVATE_KEY: keys.privateKey,
    WAFFO_WEBHOOK_PROD_PUBLIC_KEY: keys.publicKey,
    PUBLIC_BASE_URL: "https://briefboard.com",
    DATABASE_PATH: "/tmp/freelance-waffo-r4-key-check.sqlite",
    WAFFO_API_BASE: "https://api.waffo.ai",
  };
  for (const [name, value] of [
    ["WAFFO_PRIVATE_KEY", "literal garbage"],
    ["WAFFO_WEBHOOK_PROD_PUBLIC_KEY", "literal garbage"],
  ] as const) {
    assert.throws(
      () => assertProviderSettings({ ...complete, [name]: value }),
      new RegExp(`BLOCKED-SECRET: ${name}`),
      name,
    );
  }

  const ec = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  assert.throws(
    () => assertProviderSettings({ ...complete, WAFFO_PRIVATE_KEY: ec.privateKey }),
    /BLOCKED-SECRET: WAFFO_PRIVATE_KEY/,
  );
  assert.throws(
    () => assertProviderSettings({ ...complete, WAFFO_WEBHOOK_PROD_PUBLIC_KEY: ec.publicKey }),
    /BLOCKED-SECRET: WAFFO_WEBHOOK_PROD_PUBLIC_KEY/,
  );
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-empty-key-"));
  const emptyKeyPath = join(directory, "private.pem");
  writeFileSync(emptyKeyPath, "");
  try {
    assert.throws(
      () => assertProviderSettings({
        ...complete,
        WAFFO_PRIVATE_KEY: undefined,
        WAFFO_PRIVATE_KEY_FILE: emptyKeyPath,
      }),
      /BLOCKED-SECRET: WAFFO_PRIVATE_KEY_FILE/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  const malformed = {
    ...process.env,
    ...complete,
    WAFFO_PRIVATE_KEY: "literal garbage",
    WAFFO_WEBHOOK_PROD_PUBLIC_KEY: "literal garbage",
  };
  const preflight = spawnSync(process.execPath, ["scripts/preflight.mjs"], {
    cwd: process.cwd(),
    env: malformed as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  assert.notEqual(preflight.status, 0);
  assert.match(`${preflight.stdout}\n${preflight.stderr}`, /BLOCKED-CONFIG/);

  const previousEnv = { ...process.env };
  try {
    for (const [name, value] of Object.entries(malformed)) {
      if (value !== undefined) mutableProcessEnv[name] = value;
    }
    const health = healthzGet();
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), { ok: false, error: "not_ready" });
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("Waffo timeout leaves a recoverable intent and signed completion can settle it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-timeout-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys, { WAFFO_REQUEST_TIMEOUT_MS: "10" });
  const port = new WaffoPaymentPort({
    env,
    fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    }),
  });
  const store = createListingStore({ databasePath: path });
  try {
    await assert.rejects(
      () => port.createCheckout({
        listingDraft: parseCheckoutInput(draftFields()).listingDraft,
        amountUsd: 5,
        kind: "create",
      }),
      (error: unknown) => error instanceof CheckoutError && error.code === "waffo_ambiguous",
    );
    const pending = store.listUnpaid(WEEK);
    assert.equal(pending.length, 1);
    const intent = store.getCheckoutIntent(pending[0]!.sessionId);
    assert.ok(intent);
    assert.equal(intent.status, "unknown");
    assert.equal(store.listPaid(WEEK).length, 0);

    const event = JSON.stringify(completedEvent(intent, { checkoutId: "SES_recovered" }));
    const paid = await port.handleWebhook(event, {
      "x-waffo-signature": signWaffo(event, keys.privateKey),
    });
    const settled = store.settlePaidEvent(paid);
    assert.equal(settled.duplicate, false);
    assert.equal(settled.listing?.bidUsd, 5);
    assert.equal(store.getCheckoutIntent(intent.intentId)?.status, "paid");
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("late Waffo provider failure preserves a signed reconciliation outcome", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-reconciliation-failure-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  let port: WaffoPaymentPort;
  let providerCalls = 0;
  port = new WaffoPaymentPort({
    env,
    fetch: async () => {
      providerCalls += 1;
      const inspector = createListingStore({ databasePath: path });
      try {
        const pending = inspector.listUnpaid(WEEK);
        assert.equal(pending.length, 1);
        const intent = inspector.getCheckoutIntent(pending[0]!.sessionId);
        assert.ok(intent);
        const event = completedEvent(intent, {
          id: "delivery_provider_failure_reconciliation",
          eventId: "payment_provider_failure_reconciliation",
          orderId: "order_provider_failure_reconciliation",
          paymentId: "payment_provider_failure_reconciliation",
          checkoutId: "SES_provider_failure_reconciliation",
        });
        event.timestamp = new Date(Date.parse(intent.createdAt) - 1).toISOString();
        const raw = JSON.stringify(event);
        const paid = await port.handleWebhook(raw, {
          "x-waffo-signature": signWaffo(raw, keys.privateKey),
        });
        assert.throws(
          () => inspector.settlePaidEvent(paid),
          (error: unknown) =>
            error instanceof ListingError && error.code === "paid_time_before_intent",
        );
      } finally {
        inspector.close();
      }
      throw new Error("provider transport failed after signed capture");
    },
  });
  const store = createListingStore({ databasePath: path });
  try {
    await assert.rejects(
      () => port.createCheckout({
        listingDraft: parseCheckoutInput(
          draftFields({ briefUrl: "https://example.com/reconciliation-failure" }),
        ).listingDraft,
        amountUsd: 5,
        kind: "create",
      }),
      (error: unknown) => error instanceof CheckoutError && error.code === "waffo_ambiguous",
    );
    assert.equal(providerCalls, 1);
    const intent = store.listUnpaid(WEEK)[0];
    assert.ok(intent);
    const state = store.getCheckoutIntent(intent.sessionId);
    assert.ok(state);
    assert.equal(state.status, "needs_reconciliation");
    assert.equal(state.failureCode, "paid_time_before_intent");
    assert.equal(store.listPaid(WEEK).length, 0);
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("late provider lifecycle writes preserve reconciliation and terminal truth", () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-intent-lifecycle-"));
  const path = join(directory, "board.sqlite");
  const store = createListingStore({ databasePath: path });
  const intentOptions = {
    productId: "PROD_abcdefghijklmnopqrstuv",
    storeId: "STO_abcdefghijklmnopqrstuv",
    providerMode: "waffo-test" as const,
    taxCategory: "digital_goods",
  };
  const makeIntent = (label: string) => store.createCheckoutIntent(
    {
      listingDraft: parseCheckoutInput(
        draftFields({
          buyer: `Lifecycle ${label}`,
          briefUrl: `https://example.com/lifecycle-${label}`,
        }),
      ).listingDraft,
      amountUsd: 5,
      kind: "create",
    },
    { ...intentOptions, intentId: `intent_lifecycle_${label}` },
  );
  try {
    const reconciliation = makeIntent("reconciliation");
    store.markCheckoutIntentNeedsReconciliation(
      reconciliation.intentId,
      "signed_capture_mismatch",
    );
    store.markCheckoutIntentUnknown(reconciliation.intentId, "provider_ambiguous");
    store.markCheckoutIntentRejected(reconciliation.intentId, "provider_rejected");
    const reconciliationState = store.getCheckoutIntent(reconciliation.intentId);
    assert.equal(reconciliationState?.status, "needs_reconciliation");
    assert.equal(reconciliationState?.failureCode, "signed_capture_mismatch");

    const rejected = makeIntent("rejected");
    store.markCheckoutIntentRejected(rejected.intentId, "provider_rejected");
    store.markCheckoutIntentUnknown(rejected.intentId, "provider_ambiguous");
    const rejectedState = store.getCheckoutIntent(rejected.intentId);
    assert.equal(rejectedState?.status, "rejected");
    assert.equal(rejectedState?.failureCode, "provider_rejected");

    const expired = makeIntent("expired");
    store.markCheckoutIntentRejected(expired.intentId, "checkout_expired");
    store.markCheckoutIntentExpired(expired.intentId);
    const beforeLateFailureDb = openBoardDatabase(path);
    let beforeLateFailure: {
      status: string;
      lifecycle: string;
      failure_code: string | null;
      updated_at: string;
    } | undefined;
    try {
      beforeLateFailure = beforeLateFailureDb
        .prepare<[string], typeof beforeLateFailure>(
          "SELECT status, lifecycle, failure_code, updated_at FROM checkout_intents WHERE intent_id = ?",
        )
        .get(expired.intentId);
    } finally {
      beforeLateFailureDb.close();
    }
    assert.equal(beforeLateFailure?.status, "expired");
    assert.equal(beforeLateFailure?.lifecycle, "rejected");
    store.markCheckoutIntentUnknown(expired.intentId, "provider_ambiguous");
    store.markCheckoutIntentRejected(expired.intentId, "provider_rejected");
    const afterLateFailureDb = openBoardDatabase(path);
    try {
      const afterLateFailure = afterLateFailureDb
        .prepare<[string], typeof beforeLateFailure>(
          "SELECT status, lifecycle, failure_code, updated_at FROM checkout_intents WHERE intent_id = ?",
        )
        .get(expired.intentId);
      assert.deepEqual(afterLateFailure, beforeLateFailure);
    } finally {
      afterLateFailureDb.close();
    }

    const paid = makeIntent("paid");
    const paidAt = new Date().toISOString();
    const paidResult = store.settleVerifiedOrder({
      intentId: paid.intentId,
      checkoutId: "SES_lifecycle_paid",
      orderId: "order_lifecycle_paid",
      webhookId: "delivery_lifecycle_paid",
      eventType: "order.completed",
      eventId: "payment_lifecycle_paid",
      paymentId: "payment_lifecycle_paid",
      intentFingerprint: paid.intentFingerprint,
      rawBodyHash: "raw_lifecycle_paid",
      mode: "test",
      storeId: paid.storeId,
      taxCategory: paid.taxCategory,
      subtotal: "5.00",
      amount: "5.00",
      total: "5.00",
      taxAmount: "0.00",
      listingDraft: paid.listingDraft,
      kind: paid.kind,
      productId: paid.productId,
      currency: paid.currency,
      totalAmountCents: paid.expectedAmountCents,
      paidAt,
      metadataHash: paid.metadataHash,
      payloadHash: "payload_lifecycle_paid",
    });
    assert.ok(paidResult.listing);
    store.markCheckoutIntentUnknown(paid.intentId, "provider_ambiguous");
    store.markCheckoutIntentRejected(paid.intentId, "provider_rejected");
    const paidState = store.getCheckoutIntent(paid.intentId);
    assert.equal(paidState?.status, "paid");
    assert.equal(paidState?.failureCode, undefined);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Waffo request deadline covers a stalled response body and aborts it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-stalled-body-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys, { WAFFO_REQUEST_TIMEOUT_MS: "20" });
  let signal: AbortSignal | undefined;
  const port = new WaffoPaymentPort({
    env,
    fetch: async (_input, init) => {
      signal = init?.signal ?? undefined;
      const stream = new ReadableStream<Uint8Array>({ start() {} });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const store = createListingStore({ databasePath: path });
  try {
    const draft = parseCheckoutInput(draftFields({ briefUrl: "https://example.com/stalled-body" }));
    const outcome = await Promise.race([
      port.createCheckout(draft).then(() => "resolved", () => "rejected"),
      new Promise<string>((resolve) => setTimeout(() => resolve("still-pending"), 150)),
    ]);
    assert.equal(outcome, "rejected");
    assert.equal(signal?.aborted, true);
    const pending = store.listUnpaid(WEEK);
    assert.equal(pending.length, 1);
    const intent = store.getCheckoutIntent(pending[0]!.sessionId);
    assert.equal(intent?.status, "unknown");
    assert.equal(store.listPaid(WEEK).length, 0);
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Waffo ambiguous status and non-JSON responses remain recoverable", async () => {
  for (const [label, status, body, contentType] of [
    ["408", 408, JSON.stringify({ errors: [{ message: "timeout" }] }), "application/json"],
    ["409", 409, JSON.stringify({ errors: [{ message: "conflict" }] }), "application/json"],
    ["425", 425, JSON.stringify({ errors: [{ message: "too early" }] }), "application/json"],
    ["429", 429, JSON.stringify({ errors: [{ message: "rate limited" }] }), "application/json"],
    ["non-json", 400, "upstream closed after accepting", "text/plain"],
  ] as const) {
    const directory = mkdtempSync(join(tmpdir(), `freelance-waffo-ambiguous-${label}-`));
    const path = join(directory, "board.sqlite");
    const keys = waffoKeys();
    const env = waffoEnv(path, keys);
    const port = new WaffoPaymentPort({
      env,
      fetch: async () => new Response(body, {
        status,
        headers: { "content-type": contentType },
      }),
    });
    const store = createListingStore({ databasePath: path });
    try {
      const input = parseCheckoutInput(draftFields({ briefUrl: `https://example.com/ambiguous-${label}` }));
      await assert.rejects(
        () => port.createCheckout(input),
        (error: unknown) => error instanceof CheckoutError && error.code === "waffo_ambiguous",
        label,
      );
      const pending = store.listUnpaid(WEEK);
      assert.equal(pending.length, 1, label);
      const intent = store.getCheckoutIntent(pending[0]!.sessionId);
      assert.ok(intent);
      assert.equal(intent.status, "unknown", label);
      assert.equal(intent.failureCode, "provider_ambiguous", label);

      // A later signed capture can recover an ambiguous provider response, but
      // only through the immutable local intent and exact product metadata.
      const raw = JSON.stringify(completedEvent(intent, {
        id: `delivery_ambiguous_${label}`,
        eventId: `payment_ambiguous_${label}`,
        orderId: `order_ambiguous_${label}`,
        paymentId: `payment_ambiguous_${label}`,
      }));
      const paid = await port.handleWebhook(raw, {
        "x-waffo-signature": signWaffo(raw, keys.privateKey),
      });
      const settled = store.settlePaidEvent(paid);
      assert.equal(settled.duplicate, false, label);
      assert.equal(settled.listing?.bidUsd, 5, label);
    } finally {
      store.close();
      port.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("two Waffo port instances share a durable intent and settlement after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-restart-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const response = () => new Response(JSON.stringify({ data: {
    sessionId: "SES_shared_1",
      checkoutUrl: "https://checkout.waffo.ai/SES_shared_1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
  } }), { status: 200, headers: { "content-type": "application/json" } });
  const first = new WaffoPaymentPort({ env, fetch: async () => response() });
  let second: WaffoPaymentPort | undefined;
  let store: ReturnType<typeof createListingStore> | undefined;
  try {
    const started = await first.createCheckout(parseCheckoutInput(draftFields()));
    second = new WaffoPaymentPort({ env, fetch: async () => {
      throw new Error("restart webhook must not call provider");
    } });
    assert.equal(second.getSession(started.sessionId)?.status, "open");
    const intent = second.getSession(started.sessionId)?.intentId;
    assert.ok(intent);
    store = createListingStore({ databasePath: path });
    const durableIntent = store.getCheckoutIntent(intent);
    assert.ok(durableIntent);
    const raw = JSON.stringify(completedEvent(durableIntent));
    const paid = await second.handleWebhook(raw, {
      "x-waffo-signature": signWaffo(raw, keys.privateKey),
    });
    const result = store.settlePaidEvent(paid);
    assert.equal(result.duplicate, false);
    assert.equal(first.getSession(started.sessionId)?.status, "complete");
    first.close();
    second.close();
    second = new WaffoPaymentPort({ env, fetch: async () => {
      throw new Error("post-restart webhook must not call provider");
    } });
    assert.equal(second.getSession(started.sessionId)?.status, "complete");
    assert.equal(second.getSession(started.sessionId)?.listingId, result.listing?.id);
  } finally {
    store?.close();
    first.close();
    second?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("competing signed Waffo raises reject the stale capture and never compound to $19", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-waffo-stale-"));
  const path = join(directory, "board.sqlite");
  const keys = waffoKeys();
  const env = waffoEnv(path, keys);
  const port = new WaffoPaymentPort({ env, fetch: async () => new Response(
    JSON.stringify({ data: {
      sessionId: "SES_unused_1",
      checkoutUrl: "https://checkout.waffo.ai/SES_unused_1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } }),
    { status: 200, headers: { "content-type": "application/json" } },
  ) });
  const store = createListingStore({ databasePath: path });
  try {
    const seed = settleFixtureEventInStore(store, {
      sessionId: "fixture_seed_for_waffo",
      listingDraft: parseCheckoutInput(draftFields({ briefUrl: "https://example.com/stale" })).listingDraft,
      amountUsd: 5,
      kind: "create",
      paidAt: new Date().toISOString(),
    }).listing;
    assert.ok(seed);
    const raiseDraft = parseCheckoutInput(draftFields({
      buyer: "Raise Buyer",
      briefUrl: "https://example.com/stale",
      amountUsd: "12",
    })).listingDraft;
    const makeIntent = (suffix: string) => {
      const intent = store.createCheckoutIntent(
        { listingDraft: raiseDraft, amountUsd: 7, kind: "raise" },
        {
          intentId: `intent_stale_${suffix}`,
          productId: "PROD_abcdefghijklmnopqrstuv",
          storeId: "STO_abcdefghijklmnopqrstuv",
          providerMode: "waffo-test",
          taxCategory: "digital_goods",
          quoteBaseBidUsd: 5,
        },
      );
      return store.attachCheckoutIntent(
        intent.intentId,
        `SES_stale_${suffix}`,
        `https://checkout.waffo.ai/SES_stale_${suffix}`,
        new Date(Date.now() + 60_000).toISOString(),
      );
    };
    const firstIntent = makeIntent("a");
    const secondIntent = makeIntent("b");
    const firstObject = completedEvent(firstIntent, {
      id: "delivery_stale_a",
      eventId: "payment_stale_a",
      checkoutId: "SES_stale_a",
      orderId: "order_stale_a",
      paymentId: "payment_stale_a",
    });
    const secondObject = completedEvent(secondIntent, {
      id: "delivery_stale_b",
      eventId: "payment_stale_b",
      checkoutId: "SES_stale_b",
      orderId: "order_stale_b",
      paymentId: "payment_stale_b",
    });
    const firstRaw = JSON.stringify(firstObject);
    const secondRaw = JSON.stringify(secondObject);
    const first = await port.handleWebhook(firstRaw, {
      "x-waffo-signature": signWaffo(firstRaw, keys.privateKey),
    });
    const second = await port.handleWebhook(secondRaw, {
      "x-waffo-signature": signWaffo(secondRaw, keys.privateKey),
    });
    assert.equal(store.settlePaidEvent(first).listing?.bidUsd, 12);
    assert.throws(
      () => store.settlePaidEvent(second),
      (error: unknown) => error instanceof ListingError && error.code === "bid_not_higher",
    );
    assert.equal(store.findPaidByIdentity("https://example.com/stale")?.bidUsd, 12);
    assert.equal(store.getCheckoutIntent(secondIntent.intentId)?.status, "needs_reconciliation");
    const rejected = store.getCheckoutIntent(secondIntent.intentId);
    assert.equal(rejected?.failureCode, "bid_not_higher");
  } finally {
    store.close();
    port.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("/return and /checkout/complete are read-only durable paid/cancel views", async () => {
  const pendingHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({ sessionId: "missing" }),
    }),
  );
  assert.match(pendingHtml, /data-return="pending"/);
  assert.match(pendingHtml, /Payment has not been confirmed/);
  assert.match(pendingHtml, /Back to the board/);

  const cancelHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({
        sessionId: "missing",
        status: "cancel",
      }),
    }),
  );
  assert.match(cancelHtml, /data-return="pending"/);
  assert.match(cancelHtml, /Payment has not been confirmed/);

  const unknownCompleteHtml = renderToStaticMarkup(
    await CompletePage({
      searchParams: Promise.resolve({ intent: "unknown-intent", status: "paid" }),
    }),
  );
  assert.match(unknownCompleteHtml, /data-return="pending"/);

  const checkout = new FixturePaymentPort();
  setPaymentPort(checkout);
  const started = await checkout.createCheckout(parseCheckoutInput(draftFields()));
  const openHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({ sessionId: started.sessionId }),
    }),
  );
  assert.match(openHtml, /data-return="pending"/);
  assert.equal(getBoardListings().length, 0);

  const abandoned = await checkout.createCheckout(
    parseCheckoutInput(draftFields({ buyer: "Abandoned", briefUrl: "https://example.com/abandoned" })),
  );
  checkout.abandonSession(abandoned.sessionId);
  const abandonedHtml = renderToStaticMarkup(
    await CompletePage({
      searchParams: Promise.resolve({ intent: abandoned.intentId }),
    }),
  );
  assert.match(abandonedHtml, /data-return="cancel"/);

  const failed = await checkout.createCheckout(
    parseCheckoutInput(draftFields({ buyer: "Failed", briefUrl: "https://example.com/failed" })),
  );
  markCheckoutIntentRejected(failed.intentId!, "provider_rejected");
  const failedHtml = renderToStaticMarkup(
    await CompletePage({
      searchParams: Promise.resolve({ intent: failed.intentId }),
    }),
  );
  assert.match(failedHtml, /data-return="cancel"/);

  settleFixtureEvent(checkout.completeSession(started.sessionId));
  const paidHtml = renderToStaticMarkup(
    await ReturnPage({
      searchParams: Promise.resolve({ sessionId: started.sessionId }),
    }),
  );
  assert.match(paidHtml, /data-return="paid"/);
  assert.match(paidHtml, /Acme Studio is listed at \$5/);

  // Simulate a fresh request/process: the completion page re-reads the
  // durable intent/listing and still cannot settle from query parameters.
  resetPaymentPort();
  const restartedPaidHtml = renderToStaticMarkup(
    await CompletePage({
      searchParams: Promise.resolve({ intent: started.intentId, status: "cancel" }),
    }),
  );
  assert.match(restartedPaidHtml, /data-return="paid"/);
  assert.equal(getBoardListings().length, 1);
});

test("getPaymentPort shares the fixture across checkout and webhook", async () => {
  const fixtureEnv = { WAFFO_MODE: "fixture" };
  const first = getPaymentPort(fixtureEnv);
  assert.equal(first.kind, "fixture");
  const started = await first.createCheckout(parseCheckoutInput(draftFields()));
  const second = getPaymentPort(fixtureEnv);
  const paid = await second.handleWebhook(
    JSON.stringify({
      type: "checkout.updated",
      data: { id: started.sessionId, status: "succeeded" },
    }),
    {},
  );
  settleFixtureEvent(paid);
  assert.equal(getBoardListings().length, 1);
});

test("quoteBid charges the full first bid and only the raise difference", () => {
  assert.deepEqual(quoteBid(undefined, 5), {
    kind: "create",
    targetBidUsd: 5,
    chargeUsd: 5,
  });
  assert.deepEqual(quoteBid({ bidUsd: 5 }, 12), {
    kind: "raise",
    targetBidUsd: 12,
    chargeUsd: 7,
  });
  assert.throws(
    () => quoteBid({ bidUsd: 5 }, 5),
    (error: unknown) => {
      assert.ok(error instanceof ListingError);
      assert.equal(error.code, "bid_not_higher");
      return true;
    },
  );
  assert.throws(
    () => quoteBid({ bidUsd: 12 }, 7),
    (error: unknown) => {
      assert.ok(error instanceof ListingError);
      assert.equal(error.code, "bid_not_higher");
      return true;
    },
  );
});

test("SPEC acceptance 5: #2 raises $5 → $12, pays $7, firstPaidAt unchanged", async () => {
  const checkout = new FixturePaymentPort();
  const first = await payFixture(
    checkout,
    draftFields({
      buyer: "Acme Studio",
      amountUsd: "5",
      briefUrl: "https://example.com/acme",
    }),
  );
  await payFixture(
    checkout,
    draftFields({
      buyer: "Cover Bid",
      amountUsd: "8",
      briefUrl: "https://example.com/cover",
    }),
  );

  const before = rankListings(getBoardListings());
  assert.equal(before[0]?.briefUrl, "https://example.com/cover");
  assert.equal(before[1]?.briefUrl, "https://example.com/acme");
  assert.equal(before[1]?.bidUsd, 5);
  const firstPaidAt = first.listing.firstPaidAt;

  const raiseInput = parseCheckoutInput(
    draftFields({
      buyer: "Acme Studio",
      amountUsd: "12",
      briefUrl: "https://example.com/acme",
    }),
  );
  assert.equal(raiseInput.kind, "raise");
  assert.equal(raiseInput.amountUsd, 7);
  assert.equal(raiseInput.listingDraft.bidUsd, 12);

  setPaymentPort(checkout);
  const raiseResponse = await checkoutPost(
    new Request("http://localhost/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: formBody(
        draftFields({
          buyer: "Acme Studio",
          amountUsd: "12",
          briefUrl: "https://example.com/acme",
        }),
      ),
    }),
  );
  assert.equal(raiseResponse.status, 200);
  const started = (await raiseResponse.json()) as { sessionId: string };
  const session = checkout.getSession(started.sessionId);
  assert.ok(session);
  assert.equal(session.kind, "raise");
  assert.equal(session.amountUsd, 7);
  assert.equal(session.listingDraft.bidUsd, 12);
  assert.equal(listPaid(WEEK).find((row) => row.id === first.listing.id)?.bidUsd, 5);

  const paid = await checkout.handleWebhook(
    JSON.stringify({
      type: "checkout.updated",
      data: { id: started.sessionId, status: "succeeded" },
    }),
    {},
  );
  const raised = settleFixtureEvent(paid);
  assert.ok(raised);
  assert.equal(paid.kind, "raise");
  assert.equal(paid.amountUsd, 7);
  assert.equal(raised.id, first.listing.id);
  assert.equal(raised.bidUsd, 12);
  assert.equal(raised.firstPaidAt, firstPaidAt);
  assert.equal(raised.lastPaidAt, paid.paidAt);

  const ranked = rankListings(getBoardListings());
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]?.briefUrl, "https://example.com/acme");
  assert.equal(ranked[0]?.rank, 1);
  assert.equal(ranked[0]?.bidUsd, 12);
  assert.equal(ranked[0]?.firstPaidAt, firstPaidAt);
  assert.equal(ranked[1]?.briefUrl, "https://example.com/cover");
  assert.equal(ranked[1]?.bidUsd, 8);
});

test("different listing cannot steal by paying only the raise difference", async () => {
  const checkout = new FixturePaymentPort();
  await payFixture(
    checkout,
    draftFields({
      amountUsd: "12",
      briefUrl: "https://example.com/incumbent",
    }),
  );

  const steal = parseCheckoutInput(
    draftFields({
      buyer: "Rival",
      amountUsd: "7",
      briefUrl: "https://example.com/rival",
    }),
  );
  assert.equal(steal.kind, "create");
  assert.equal(steal.amountUsd, 7);
  assert.equal(steal.listingDraft.bidUsd, 7);

  await payFixture(
    checkout,
    draftFields({
      buyer: "Rival",
      amountUsd: "7",
      briefUrl: "https://example.com/rival",
    }),
  );

  const ranked = rankListings(getBoardListings());
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]?.briefUrl, "https://example.com/incumbent");
  assert.equal(ranked[0]?.bidUsd, 12);
  assert.equal(ranked[1]?.briefUrl, "https://example.com/rival");
  assert.equal(ranked[1]?.bidUsd, 7);
});

test("bid_not_higher when raise is not above the current bid", async () => {
  const checkout = new FixturePaymentPort();
  setPaymentPort(checkout);
  await payFixture(
    checkout,
    draftFields({ amountUsd: "8", briefUrl: "https://example.com/stay" }),
  );

  const same = await checkoutPost(
    new Request("http://localhost/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: formBody(draftFields({ amountUsd: "8", briefUrl: "https://example.com/stay" })),
    }),
  );
  assert.equal(same.status, 400);
  assert.deepEqual(await same.json(), { error: "bid_not_higher" });

  const lower = await checkoutPost(
    new Request("http://localhost/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: formBody(draftFields({ amountUsd: "7", briefUrl: "https://example.com/stay" })),
    }),
  );
  assert.equal(lower.status, 400);
  assert.deepEqual(await lower.json(), { error: "bid_not_higher" });

  const listed = listPaid(WEEK);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.bidUsd, 8);
});

test("unpaid raise checkout leaves the current bid unchanged", async () => {
  const checkout = new FixturePaymentPort();
  const first = await payFixture(
    checkout,
    draftFields({ amountUsd: "5", briefUrl: "https://example.com/hold" }),
  );
  const started = await checkout.createCheckout(
    parseCheckoutInput(
      draftFields({ amountUsd: "12", briefUrl: "https://example.com/hold" }),
    ),
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
  const listed = listPaid(WEEK);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, first.listing.id);
  assert.equal(listed[0]?.bidUsd, 5);
  assert.equal(listed[0]?.firstPaidAt, first.listing.firstPaidAt);
});

test("unpaid checkout stays off the ticket desk until payment is confirmed", async () => {
  const checkout = new FixturePaymentPort();
  setPaymentPort(checkout);
  const response = await checkoutPost(
    new Request("http://localhost/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: formBody(
        draftFields({
          buyer: "Ghost Studio",
          winnerRule: "Best portfolio by Friday",
          briefUrl: "https://example.com/ghost",
        }),
      ),
    }),
  );
  assert.equal(response.status, 200);
  const started = (await response.json()) as { sessionId: string };
  assert.ok(started.sessionId);
  assert.equal(listPaid(WEEK).length, 0);
  assert.equal(getBoardListings().length, 0);
  const leftover = listUnpaid(WEEK);
  assert.equal(leftover.length, 1);
  assert.equal(leftover[0]?.buyer, "Ghost Studio");
  assert.equal(leftover[0]?.winnerRule, "Best portfolio by Friday");

  const html = renderToStaticMarkup(
    createElement(Board, {
      week: currentWeekUtc(),
      listings: rankListings(getBoardListings()),
      unpaid: leftover,
    }),
  );
  assert.match(html, /No paid brief/);
  assert.match(html, /data-unpaid-off=""/);
  assert.match(html, /until payment is confirmed/);
  assert.doesNotMatch(html, /payment provider reports paid/);
  assert.match(html, /Claim #1 for/);
  assert.doesNotMatch(html, /Ghost Studio/);
  assert.doesNotMatch(html, /Best portfolio by Friday/);
  assert.doesNotMatch(html, /ticket-featured/);
  assert.doesNotMatch(html, /data-prize=/);
  assert.doesNotMatch(html, /Open this brief/);

  checkout.abandonSession(started.sessionId);
  const expired = await webhookPost(
    new Request("http://localhost/api/waffo/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "checkout.updated",
        data: { id: started.sessionId, status: "expired" },
      }),
    }),
  );
  assert.equal(expired.status, 200);
  assert.deepEqual(await expired.json(), { received: true, applied: false });
  assert.equal(listPaid(WEEK).length, 0);
  assert.equal(listUnpaid(WEEK).length, 0);
  assert.equal(getBoardListings().length, 0);
});

test("same canonical brief URL in the same week is a raise", async () => {
  const checkout = new FixturePaymentPort();
  const first = await payFixture(
    checkout,
    draftFields({
      amountUsd: "5",
      briefUrl: "https://EXAMPLE.com/same#frag",
    }),
  );
  assert.equal(first.listing.briefUrl, "https://example.com/same");

  const raiseInput = parseCheckoutInput(
    draftFields({
      amountUsd: "9",
      briefUrl: "https://example.com:443/same/",
    }),
  );
  assert.equal(raiseInput.kind, "raise");
  assert.equal(raiseInput.amountUsd, 4);
  assert.equal(raiseInput.listingDraft.briefUrl, "https://example.com/same");

  const raised = await payFixture(
    checkout,
    draftFields({
      amountUsd: "9",
      briefUrl: "https://example.com:443/same/",
    }),
  );
  assert.equal(raised.listing.id, first.listing.id);
  assert.equal(raised.listing.bidUsd, 9);
  assert.equal(raised.listing.firstPaidAt, first.listing.firstPaidAt);
  assert.equal(listPaid(WEEK).length, 1);
});

test("same brief URL after the rolling last-7-days window pays a full new bid", () => {
  const agedOut = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const then = settleFixtureEvent({
    sessionId: "chk_then",
    listingDraft: {
      buyer: "Acme Studio",
      budgetUsd: 3200,
      deadline: "2026-09-15",
      winnerRule: "Best portfolio by Friday",
      briefUrl: "https://example.com/weekly",
      bidUsd: 12,
      weekId: "2026-W33",
    },
    amountUsd: 12,
    kind: "create",
    paidAt: agedOut,
  });
  const now = settleFixtureEvent({
    sessionId: "chk_now",
    listingDraft: {
      buyer: "Acme Studio",
      budgetUsd: 3200,
      deadline: "2026-09-15",
      winnerRule: "Best portfolio by Friday",
      briefUrl: "https://example.com/weekly",
      bidUsd: 5,
      weekId: WEEK,
    },
    amountUsd: 5,
    kind: "create",
    paidAt: new Date().toISOString(),
  });
  assert.ok(then);
  assert.ok(now);
  assert.notEqual(now.id, then.id);
  assert.equal(now.bidUsd, 5);
  assert.equal(listPaid("2026-W33").length, 1);
  assert.equal(listPaid(WEEK).length, 1);
  assert.equal(getBoardListings().length, 1);
  assert.equal(getBoardListings()[0]?.id, now.id);
});

test("same brief still inside last-7-days raises after the UTC week label rolls", () => {
  const sunday = new Date("2026-08-16T12:00:00.000Z");
  const monday = new Date("2026-08-17T00:00:00.000Z");
  const url = "https://example.com/sunday-raise";
  assert.equal(weekIdUtc(sunday), "2026-W33");
  assert.equal(weekIdUtc(monday), "2026-W34");
  assert.equal(
    sameListingIdentity(
      { weekId: "2026-W33", briefUrl: url },
      { weekId: "2026-W34", briefUrl: url },
    ),
    true,
  );

  const placed = settleFixtureEvent({
    sessionId: "chk_sunday",
    listingDraft: {
      buyer: "Sunday Buyer",
      budgetUsd: 3200,
      deadline: "2026-09-15",
      winnerRule: "Best portfolio by Friday",
      briefUrl: url,
      bidUsd: 5,
      weekId: "2026-W33",
    },
    amountUsd: 5,
    kind: "create",
    paidAt: sunday.toISOString(),
  });
  assert.ok(placed);
  assert.equal(placed.weekId, "2026-W33");
  assert.equal(placed.bidUsd, 5);
  assert.equal(findPaidByIdentity(url, monday)?.id, placed.id);
  assert.equal(findPaidByIdentity(url, monday)?.weekId, "2026-W33");

  const raiseInput = parseCheckoutInput(
    draftFields({
      buyer: "Sunday Raised",
      amountUsd: "7",
      briefUrl: url,
      weekId: "2026-W34",
    }),
    monday,
  );
  assert.equal(raiseInput.kind, "raise");
  assert.equal(raiseInput.amountUsd, 2);
  assert.equal(raiseInput.listingDraft.bidUsd, 7);
  assert.equal(raiseInput.listingDraft.weekId, "2026-W33");

  const raised = settleFixtureEvent({
    sessionId: "chk_monday_raise",
    listingDraft: raiseInput.listingDraft,
    amountUsd: raiseInput.amountUsd,
    kind: raiseInput.kind,
    paidAt: monday.toISOString(),
  });
  assert.ok(raised);
  assert.equal(raised.id, placed.id);
  assert.equal(raised.weekId, "2026-W33");
  assert.equal(raised.bidUsd, 7);
  assert.equal(raised.firstPaidAt, placed.firstPaidAt);

  const aged = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000 + 1);
  assert.equal(findPaidByIdentity(url, aged), undefined);
  const agedInput = parseCheckoutInput(
    draftFields({
      amountUsd: "5",
      briefUrl: url,
      weekId: "2026-W34",
    }),
    aged,
  );
  assert.equal(agedInput.kind, "create");
  assert.equal(agedInput.amountUsd, 5);
});

test("HTTP pages do not import the retired provider adapter", () => {
  const checkoutSrc = readFileSync(
    join(process.cwd(), "src", "app", "checkout", "route.ts"),
    "utf8",
  );
  const webhookSrc = readFileSync(
    join(process.cwd(), "src", "app", "api", "waffo", "webhook", "route.ts"),
    "utf8",
  );
  const returnSrc = readFileSync(
    join(process.cwd(), "src", "app", "return", "page.tsx"),
    "utf8",
  );
  const listingsSrc = readFileSync(
    join(process.cwd(), "src", "core", "listings.ts"),
    "utf8",
  );
  assert.doesNotMatch(checkoutSrc, /billing\/polar/);
  assert.doesNotMatch(webhookSrc, /billing\/polar/);
  assert.doesNotMatch(returnSrc, /billing\/polar/);
  assert.doesNotMatch(listingsSrc, /applyPaidEvent/);
  assert.equal(
    existsSync(join(process.cwd(), "src", "billing", "waffo-session.ts")),
    false,
    "the handwritten legacy adapter must be quarantined outside runtime source",
  );
});
