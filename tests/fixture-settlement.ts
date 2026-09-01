import { createHash } from "node:crypto";
import {
  attachCheckoutIntent,
  createCheckoutIntent,
  FIXTURE_PRODUCT_ID,
  getCheckoutIntent,
  settlePaidEvent,
  type ListingStore,
  type SettlementResult,
} from "../src/core/listings";
import type { PaidEvent } from "../src/billing/port";

/**
 * Test-only settlement setup. Production code must receive a durable intent
 * from checkout and may only call settlePaidEvent after provider validation.
 */
export function settleFixtureEvent(event: PaidEvent): ReturnType<ListingStore["settlePaidEvent"]>["listing"] {
  return settleFixtureEventInStore(undefined, event).listing;
}

export function settleFixtureEventInStore(
  existingStore: ListingStore | undefined,
  event: PaidEvent,
): SettlementResult {
  const checkoutId = event.checkoutId?.trim() || event.sessionId.trim();
  const orderId = event.orderId?.trim() || `fixture-order:${checkoutId}`;
  const paymentId = event.paymentId?.trim() || orderId;
  const intentId = event.intentId?.trim() || `fixture-intent-${hash(checkoutId)}`;
  const targetBidUsd = event.listingDraft.bidUsd;
  const quoteBaseBidUsd = event.kind === "raise"
    ? targetBidUsd - event.amountUsd
    : 0;
  const createIntent = existingStore
    ? existingStore.createCheckoutIntent.bind(existingStore)
    : createCheckoutIntent;
  const attachIntent = existingStore
    ? existingStore.attachCheckoutIntent.bind(existingStore)
    : attachCheckoutIntent;
  const settle = existingStore
    ? existingStore.settlePaidEvent.bind(existingStore)
    : settlePaidEvent;
  const findIntent = existingStore
    ? existingStore.getCheckoutIntent.bind(existingStore)
    : getCheckoutIntent;
  const intent = findIntent(intentId) ?? findIntent(checkoutId) ?? createIntent(
    {
      listingDraft: event.listingDraft,
      amountUsd: event.amountUsd,
      kind: event.kind,
    },
    {
      intentId,
      productId: event.productId ?? FIXTURE_PRODUCT_ID,
      currency: event.currency ?? "USD",
      storeId: event.storeId ?? "fixture-store",
      providerMode: "fixture",
      taxCategory: event.taxCategory ?? "digital_goods",
      quoteBaseBidUsd,
    },
  );
  if (!intent.providerCheckoutId) {
    attachIntent(
      intent.intentId,
      checkoutId,
      `/return?sessionId=${encodeURIComponent(checkoutId)}`,
    );
  } else if (intent.providerCheckoutId !== checkoutId) {
    throw new Error(`fixture intent ${intent.intentId} is attached to another checkout`);
  }
  const result = settle({
    ...event,
    intentId: intent.intentId,
    checkoutId,
    orderId,
    webhookId: event.webhookId?.trim() || `fixture-delivery:${checkoutId}`,
    eventType: event.eventType ?? "order.completed",
    eventId: event.eventId?.trim() || paymentId,
    paymentId,
    productId: event.productId ?? intent.productId,
    currency: event.currency ?? intent.currency,
    totalAmountCents: event.totalAmountCents ?? event.amountUsd * 100,
    metadataHash: event.metadataHash ?? intent.metadataHash,
    intentFingerprint: event.intentFingerprint ?? intent.intentFingerprint,
    mode: event.mode ?? "fixture",
    storeId: event.storeId ?? intent.storeId,
    taxCategory: event.taxCategory ?? intent.taxCategory,
  });
  return result;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
