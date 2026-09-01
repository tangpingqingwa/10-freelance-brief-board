import { randomUUID } from "node:crypto";
import {
  attachCheckoutIntent,
  createCheckoutIntent,
  FIXTURE_PRODUCT_ID,
  getCheckoutIntent,
  getListingForCheckout,
  markCheckoutIntentExpired,
  type CheckoutIntent,
} from "../core/listings";
import { canonicalBriefUrl } from "../core/listing";
import { CheckoutError } from "./port";
import type {
  CheckoutSession,
  CheckoutStart,
  CreateCheckoutInput,
  PaidEvent,
  PaymentPort,
} from "./port";

/**
 * Deterministic, explicit test checkout port. It deliberately has no process
 * map: all session state is the same durable checkout intent used by routes.
 * The fixture webhook grammar accepts only a known local session.
 */
export class FixturePaymentPort implements PaymentPort {
  readonly kind = "fixture" as const;
  readonly productId = FIXTURE_PRODUCT_ID;

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart> {
    this.assertTestOnly();
    let intent: CheckoutIntent | undefined = input.intentId
      ? getCheckoutIntent(input.intentId)
      : undefined;
    if (input.intentId && !intent) {
      throw new CheckoutError("checkout_intent_unknown", 400);
    }
    if (intent && ["rejected", "failed", "expired"].includes(intent.status)) {
      throw new CheckoutError("checkout_not_open", 400);
    }
    if (intent && !sameIntentInput(intent, input)) {
      throw new CheckoutError("checkout_intent_conflict", 409);
    }
    if (intent?.providerCheckoutId && intent.checkoutUrl) {
      return {
        sessionId: intent.providerCheckoutId,
        checkoutUrl: intent.checkoutUrl,
        intentId: intent.intentId,
      };
    }
    intent ??= createCheckoutIntent(
      {
        listingDraft: input.listingDraft,
        amountUsd: input.amountUsd,
        kind: input.kind,
      },
      { productId: FIXTURE_PRODUCT_ID },
    );

    const sessionId = `fix_${randomUUID()}`;
    const checkoutUrl = `/return?checkoutId=${encodeURIComponent(sessionId)}`;
    const attached = attachCheckoutIntent(intent.intentId, sessionId, checkoutUrl);
    return {
      checkoutUrl: attached.checkoutUrl ?? checkoutUrl,
      sessionId,
      intentId: attached.intentId,
    };
  }

  getSession(sessionId: string): CheckoutSession | undefined {
    this.assertTestOnly();
    const intent = getCheckoutIntent(sessionId);
    return intent ? sessionFromIntent(intent, sessionId) : undefined;
  }

  /** Complete a known fixture checkout without changing rank. */
  completeSession(sessionId: string): PaidEvent {
    this.assertTestOnly();
    const intent = this.requireOpenIntent(sessionId);
    return paidEvent(
      intent,
      sessionId,
      `fixture-order:${sessionId}`,
      `fixture-webhook:${sessionId}`,
    );
  }

  abandonSession(sessionId: string): void {
    this.assertTestOnly();
    const intent = getCheckoutIntent(sessionId);
    if (!intent || intent.status === "paid") return;
    markCheckoutIntentExpired(sessionId);
  }

  async handleWebhook(
    rawBody: string,
    _headers: Record<string, string>,
  ): Promise<PaidEvent> {
    this.assertTestOnly();
    const event = parseJson(rawBody);
    if (!isRecord(event)) throw fixtureError();

    const data = isRecord(event.data) ? event.data : event;
    const eventType = typeof event.type === "string" ? event.type : "";
    const checkoutId =
      readString(data.checkout_id) ??
      readString(data.checkoutId) ??
      (eventType === "checkout.updated" ? readString(data.id) : undefined);
    if (!checkoutId) throw fixtureError();

    const intent = getCheckoutIntent(checkoutId);
    if (!intent) throw fixtureError();

    const status = readString(data.status) ?? "";
    if (
      eventType === "checkout.expired" ||
      eventType === "checkout.canceled" ||
      (eventType === "checkout.updated" &&
        (status === "expired" || status === "failed" || status === "canceled"))
    ) {
      markCheckoutIntentExpired(checkoutId);
      throw new CheckoutError("payment_incomplete", 402);
    }

    // Keep the old checkout.updated fixture as a narrow compatibility seam for
    // local tests, but never let it create a session or infer a listing.
    if (eventType === "checkout.updated") {
      if (!(status === "succeeded" || status === "paid" || status === "complete")) {
        throw fixtureError();
      }
      return paidEvent(
        intent,
        checkoutId,
        `fixture-order:${checkoutId}`,
        `fixture-webhook:${checkoutId}`,
      );
    }

    if (eventType !== "order.paid") {
      throw new CheckoutError("payment_event_unsupported", 400);
    }
    const orderId =
      readString(data.order_id) ??
      readString(data.orderId) ??
      readString(data.id);
    const webhookId = readString(event.webhook_id) ?? `fixture-webhook:${checkoutId}`;
    if (!orderId || !webhookId) throw fixtureError();
    const productId = readString(data.product_id) ?? readString(data.productId);
    if (productId && productId !== intent.productId) {
      throw new CheckoutError("product_mismatch", 400);
    }
    const currency = readString(data.currency);
    if (currency && currency.toLowerCase() !== intent.currency) {
      throw new CheckoutError("currency_mismatch", 400);
    }
    const amountCents = readInt(data.total_amount) ?? readInt(data.totalAmount);
    if (amountCents !== undefined && amountCents !== intent.expectedAmountCents) {
      throw new CheckoutError("amount_mismatch", 400);
    }
    const paidAt =
      readString(data.paid_at) ??
      readString(data.paidAt) ??
      new Date().toISOString();
    return paidEvent(intent, checkoutId, orderId, webhookId, paidAt);
  }

  private requireOpenIntent(sessionId: string): CheckoutIntent {
    const intent = getCheckoutIntent(sessionId);
    if (!intent) throw new CheckoutError("payment_incomplete", 402);
    if (intent.status === "expired" || intent.status === "failed") {
      throw new CheckoutError("payment_incomplete", 402);
    }
    if (!intent.providerCheckoutId) {
      throw new CheckoutError("payment_incomplete", 402);
    }
    return intent;
  }

  private assertTestOnly(): void {
    if (process.env.NODE_ENV === "production") {
      throw new CheckoutError("payment_provider_injection_forbidden", 503);
    }
  }
}

function paidEvent(
  intent: CheckoutIntent,
  checkoutId: string,
  orderId: string,
  webhookId: string,
  paidAt = new Date().toISOString(),
): PaidEvent {
  return {
    sessionId: checkoutId,
    intentId: intent.intentId,
    checkoutId,
    orderId,
    webhookId,
    listingDraft: { ...intent.listingDraft },
    amountUsd: intent.expectedAmountUsd,
    totalAmountCents: intent.expectedAmountCents,
    kind: intent.kind,
    paidAt,
    productId: intent.productId,
    currency: intent.currency,
    metadataHash: intent.metadataHash,
  };
}

function sessionFromIntent(
  intent: CheckoutIntent,
  sessionId: string,
): CheckoutSession {
  const listing = getListingForCheckout(sessionId);
  return {
    sessionId,
    intentId: intent.intentId,
    status:
      intent.status === "paid"
        ? "complete"
        : intent.status === "expired"
          ? "expired"
          : intent.status === "failed" || intent.status === "needs_reconciliation"
            ? "failed"
            : "open",
    checkoutUrl:
      intent.checkoutUrl ??
      `/return?checkoutId=${encodeURIComponent(sessionId)}`,
    listingDraft: { ...intent.listingDraft },
    amountUsd: intent.expectedAmountUsd,
    kind: intent.kind,
    currency: intent.currency,
    productId: intent.productId,
    providerOrderId: intent.providerOrderId,
    listingId: listing?.id,
    failureCode: intent.failureCode,
  };
}

function fixtureError(): CheckoutError {
  return new CheckoutError("payment_incomplete", 402);
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function readInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

function sameIntentInput(
  intent: CheckoutIntent,
  input: CreateCheckoutInput,
): boolean {
  const draft = input.listingDraft;
  return (
    intent.expectedAmountUsd === input.amountUsd &&
    intent.kind === input.kind &&
    intent.listingDraft.buyer === draft.buyer &&
    intent.listingDraft.budgetUsd === draft.budgetUsd &&
    intent.listingDraft.deadline === draft.deadline &&
    intent.listingDraft.winnerRule === draft.winnerRule &&
    canonicalBriefUrl(intent.listingDraft.briefUrl) === canonicalBriefUrl(draft.briefUrl) &&
    intent.listingDraft.bidUsd === draft.bidUsd &&
    intent.listingDraft.weekId === draft.weekId
  );
}
