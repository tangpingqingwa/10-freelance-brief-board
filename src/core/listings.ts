import { createHash, randomUUID } from "node:crypto";
import type {
  CheckoutKind,
  ListingDraft,
  PaidEvent,
} from "../billing/port";
import {
  openBoardDatabase,
  resolveDatabasePath,
  type BoardDatabase,
} from "../db";
import type { DatabaseEnv, ProviderMode } from "../config";
import {
  ListingError,
  canonicalBriefUrl,
  quoteBid,
} from "./listing";
import { isPaidListing, type Listing } from "./rank";
import { bidInRollingWeek, ROLLING_WEEK_MS } from "./week";

type StoredListing = Listing;

/** Open checkout. Never a ranked ticket until a paid event is applied. */
export type UnpaidTicket = {
  sessionId: string;
  weekId: string;
  buyer: string;
  winnerRule: string;
  briefUrl: string;
  bidUsd: number;
};

export type CheckoutIntentStatus =
  | "creating"
  | "open"
  | "unknown"
  | "paid"
  | "rejected"
  | "needs_reconciliation"
  | "pending"
  | "failed"
  | "expired";

export type CheckoutIntent = {
  intentId: string;
  listingDraft: ListingDraft;
  expectedAmountUsd: number;
  expectedAmountCents: number;
  currency: string;
  productId: string;
  kind: CheckoutKind;
  intentFingerprint: string;
  quoteBaseBidUsd: number;
  quoteBaseBidCents: number;
  targetBidCents: number;
  storeId: string;
  providerMode: ProviderMode;
  taxCategory: string;
  status: CheckoutIntentStatus;
  providerCheckoutId?: string;
  checkoutUrl?: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  expiresAt?: string;
  metadata: Record<string, string>;
  metadataHash: string;
  /** Immutable local receipt of the checkout intent, before provider I/O. */
  createdAt: string;
  paidAt?: string;
  failureCode?: string;
};

export type VerifiedOrderSettlement = {
  intentId: string;
  checkoutId?: string;
  orderId: string;
  webhookId: string;
  eventType?: string;
  eventId?: string;
  paymentId?: string;
  intentFingerprint?: string;
  rawBodyHash?: string;
  mode?: string;
  storeId?: string;
  taxCategory?: string;
  subtotal?: string;
  amount?: string;
  total?: string;
  taxAmount?: string;
  listingDraft: ListingDraft;
  kind: CheckoutKind;
  productId: string;
  currency: string;
  totalAmountCents: number;
  paidAt: string;
  metadataHash: string;
  payloadHash: string;
};

export type SettlementResult = {
  listing: Listing | null;
  duplicate: boolean;
};

export type PaymentAuditOutcome =
  | "verified"
  | "accepted"
  | "rejected"
  | "duplicate"
  | "conflict"
  | "reconciliation";

export type PaymentAuditInput = {
  outcome: PaymentAuditOutcome;
  reason?: string;
  webhookId?: string;
  eventType?: string;
  eventId?: string;
  paymentId?: string;
  orderId?: string;
  intentId?: string;
  checkoutId?: string;
  mode?: string;
  storeId?: string;
  payloadHash?: string;
  rawBodyHash?: string;
};

/**
 * A signed Waffo attempt whose provider identities are structurally trusted,
 * but whose business payload cannot be settled. The reservation is durable so
 * a later body that reuses an identity cannot turn a rejected capture into a
 * ranked listing.
 */
export type WaffoAttemptReservation = {
  webhookId: string;
  eventType: string;
  eventId: string;
  paymentId: string;
  orderId: string;
  intentId: string;
  checkoutId?: string;
  payloadHash: string;
  rawBodyHash: string;
  reason: string;
  mode?: string;
  storeId?: string;
  totalAmountCents?: number;
  kind?: CheckoutKind;
  paidAt?: string;
};

export type WaffoAttemptReservationResult = "reserved" | "duplicate" | "conflict";

export type PaymentAuditRecord = PaymentAuditInput & {
  auditId: number;
  receivedAt: string;
  payloadHash: string;
  rawBodyHash: string;
};

export const FIXTURE_PRODUCT_ID = "fixture-product";
/** Provider timestamps may lead the receiver's wall clock only slightly. */
export const PROVIDER_CLOCK_SKEW_MS = 5 * 60 * 1000;

type ListingRow = {
  id: string;
  week_id: string;
  buyer: string;
  budget_usd: number;
  deadline: string;
  winner_rule: string;
  brief_url: string;
  bid_usd: number;
  first_paid_at: string;
  last_paid_at: string;
  clicks: number;
};

type UnpaidRow = ListingRow & {
  session_id: string;
  created_at: string;
  updated_at: string;
};

type PaymentRow = {
  id: number;
  listing_id: string | null;
  polar_session: string;
  provider_checkout_id: string | null;
  provider_payment_id: string | null;
  provider_order_id: string | null;
  amount_usd: number;
  kind: "create" | "raise";
  paid_at: string;
  status: "applied" | "rejected";
  error_code: string | null;
};

type CheckoutIntentRow = {
  intent_id: string;
  week_id: string;
  buyer: string;
  budget_usd: number;
  deadline: string;
  winner_rule: string;
  brief_url: string;
  bid_usd: number;
  expected_amount_usd: number;
  expected_amount_cents: number;
  currency: string;
  product_id: string;
  kind: CheckoutKind;
  lifecycle: CheckoutIntentStatus;
  intent_fingerprint: string;
  quote_base_bid_usd: number;
  quote_base_bid_cents: number;
  target_bid_cents: number;
  store_id: string;
  provider_mode: ProviderMode;
  tax_category: string;
  status: CheckoutIntentStatus;
  provider_checkout_id: string | null;
  checkout_url: string | null;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  metadata_json: string;
  metadata_hash: string;
  paid_at: string | null;
  failure_code: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type WebhookEventRow = {
  webhook_id: string;
  event_type: string;
  event_id: string;
  payment_id: string | null;
  intent_id: string | null;
  order_id: string;
  checkout_id: string | null;
  payload_hash: string;
  raw_body_hash: string;
  status: "applied" | "rejected";
  error_code: string | null;
};

export type ListingStoreOptions = {
  databasePath?: string;
  env?: DatabaseEnv;
};

export type CreateCheckoutIntentOptions = {
  intentId?: string;
  productId: string;
  currency?: string;
  storeId?: string;
  providerMode?: ProviderMode;
  taxCategory?: string;
  quoteBaseBidUsd?: number;
};

const LISTING_COLUMNS = `
  id,
  week_id,
  buyer,
  budget_usd,
  deadline,
  winner_rule,
  brief_url,
  bid_usd,
  first_paid_at,
  last_paid_at,
  clicks
`;

const UNPAID_COLUMNS = `
  session_id,
  week_id,
  buyer,
  budget_usd,
  deadline,
  winner_rule,
  brief_url,
  bid_usd,
  created_at,
  updated_at
`;

const INTENT_COLUMNS = `
  intent_id,
  week_id,
  buyer,
  budget_usd,
  deadline,
  winner_rule,
  brief_url,
  bid_usd,
  expected_amount_usd,
  expected_amount_cents,
  currency,
  product_id,
  kind,
  lifecycle,
  intent_fingerprint,
  quote_base_bid_usd,
  quote_base_bid_cents,
  target_bid_cents,
  store_id,
  provider_mode,
  tax_category,
  status,
  provider_checkout_id,
  checkout_url,
  provider_order_id,
  provider_payment_id,
  metadata_json,
  metadata_hash,
  paid_at,
  failure_code,
  expires_at,
  created_at,
  updated_at
`;

/**
 * SQLite-backed board state. Use a shared file in a deployed process; tests
 * can pass `:memory:` or a temporary file explicitly.
 */
export class ListingStore {
  readonly databasePath: string;
  private readonly db: BoardDatabase;
  private readonly production: boolean;

  constructor(options: ListingStoreOptions | string = {}) {
    const explicitPath =
      typeof options === "string" ? options : options.databasePath;
    const env = typeof options === "string" ? process.env : options.env ?? process.env;
    this.production = env.NODE_ENV === "production";
    this.databasePath = resolveDatabasePath(explicitPath, env);
    this.db = openBoardDatabase(this.databasePath, env);
  }

  private transaction<T>(operation: () => T): T {
    const run = this.db.transaction(operation);
    return run.immediate();
  }

  /** Append one provider attempt; this method never updates an old attempt. */
  private appendPaymentAudit(input: PaymentAuditInput): void {
    const rawBodyHash = input.rawBodyHash?.trim() || input.payloadHash?.trim() || "missing";
    const payloadHash = input.payloadHash?.trim() || rawBodyHash;
    this.db
      .prepare(
        `INSERT INTO payment_audit_events (
           received_at, outcome, reason, webhook_id, event_type, event_id,
           payment_id, order_id, intent_id, checkout_id, mode, store_id,
           payload_hash, raw_body_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        input.outcome,
        input.reason?.trim() || null,
        input.webhookId?.trim() || null,
        input.eventType?.trim() || null,
        input.eventId?.trim() || null,
        input.paymentId?.trim() || null,
        input.orderId?.trim() || null,
        input.intentId?.trim() || null,
        input.checkoutId?.trim() || null,
        input.mode?.trim() || null,
        input.storeId?.trim() || null,
        payloadHash,
        rawBodyHash,
      );
  }

  /** Public only so a provider boundary can durably audit a verified reject. */
  recordPaymentAudit(input: PaymentAuditInput): void {
    this.transaction(() => this.appendPaymentAudit(input));
  }

  listPaymentAuditEvents(): PaymentAuditRecord[] {
    return this.db
      .prepare<[], {
        audit_id: number;
        received_at: string;
        outcome: PaymentAuditOutcome;
        reason: string | null;
        webhook_id: string | null;
        event_type: string | null;
        event_id: string | null;
        payment_id: string | null;
        order_id: string | null;
        intent_id: string | null;
        checkout_id: string | null;
        mode: string | null;
        store_id: string | null;
        payload_hash: string;
        raw_body_hash: string;
      }>(
        `SELECT audit_id, received_at, outcome, reason, webhook_id, event_type,
                event_id, payment_id, order_id, intent_id, checkout_id, mode,
                store_id, payload_hash, raw_body_hash
           FROM payment_audit_events
          ORDER BY audit_id ASC`,
      )
      .all()
      .map((row) => ({
        auditId: row.audit_id,
        receivedAt: row.received_at,
        outcome: row.outcome,
        reason: row.reason ?? undefined,
        webhookId: row.webhook_id ?? undefined,
        eventType: row.event_type ?? undefined,
        eventId: row.event_id ?? undefined,
        paymentId: row.payment_id ?? undefined,
        orderId: row.order_id ?? undefined,
        intentId: row.intent_id ?? undefined,
        checkoutId: row.checkout_id ?? undefined,
        mode: row.mode ?? undefined,
        storeId: row.store_id ?? undefined,
        payloadHash: row.payload_hash,
        rawBodyHash: row.raw_body_hash,
      }));
  }

  private readListingById(id: string): Listing | undefined {
    const row = this.db
      .prepare<[string], ListingRow>(
        `SELECT ${LISTING_COLUMNS} FROM listings WHERE id = ? LIMIT 1`,
      )
      .get(id);
    if (!row) return undefined;
    const listing = listingFromRow(row);
    return isPaidListing(listing) ? listing : undefined;
  }

  private readPaymentBySession(sessionId: string): PaymentRow | undefined {
    return this.db
      .prepare<[string], PaymentRow>(
        `SELECT id, listing_id, polar_session, provider_checkout_id,
                provider_payment_id, provider_order_id, amount_usd, kind,
                paid_at, status, error_code
           FROM payments
          WHERE polar_session = ?
          LIMIT 1`,
      )
      .get(sessionId);
  }

  private readPaymentByCheckoutId(checkoutId: string): PaymentRow | undefined {
    return this.db
      .prepare<[string, string], PaymentRow>(
        `SELECT id, listing_id, polar_session, provider_checkout_id,
                provider_payment_id, provider_order_id, amount_usd, kind,
                paid_at, status, error_code
           FROM payments
          WHERE provider_checkout_id = ? OR polar_session = ?
          LIMIT 1`,
      )
      .get(checkoutId, checkoutId);
  }

  /**
   * Resolve the current canonical identity using the receiver's wall clock.
   *
   * Settlement must not use a provider event timestamp as the window's `now`:
   * deliveries can arrive out of order, so a valid listing paid later than a
   * delayed event would otherwise look like a future row and a second create
   * could be inserted. The public board still uses `listPaidRolling`, which
   * keeps the strict `[now - 7d, now]` visibility window. Here, a persisted
   * future row is retained as the current identity while provider clock skew
   * is reconciled, preventing another create intent from bypassing it.
   */
  private readCurrentByBriefUrl(
    briefUrl: string,
    now: Date,
  ): Listing | undefined {
    const rows = this.db
      .prepare<[string], ListingRow>(
        `SELECT ${LISTING_COLUMNS}
           FROM listings
          WHERE brief_url = ?
          ORDER BY id ASC`,
      )
      .all(briefUrl)
      .map(listingFromRow)
      .filter(isPaidListing);
    const windowStart = now.getTime() - ROLLING_WEEK_MS;
    return rows
      .filter((row) => {
        const lastPaidAt = Date.parse(row.lastPaidAt);
        return Number.isFinite(lastPaidAt) && lastPaidAt >= windowStart;
      })
      .sort((left, right) => {
        const lastPaidDelta =
          Date.parse(right.lastPaidAt) - Date.parse(left.lastPaidAt);
        return lastPaidDelta || left.id.localeCompare(right.id);
      })[0];
  }

  private readCheckoutIntentByRef(
    reference: string,
  ): CheckoutIntent | undefined {
    const row = this.db
      .prepare<[string, string], CheckoutIntentRow>(
        `SELECT ${INTENT_COLUMNS}
           FROM checkout_intents
          WHERE intent_id = ? OR provider_checkout_id = ?
          LIMIT 1`,
      )
      .get(reference, reference);
    return row ? intentFromRow(row) : undefined;
  }

  private readCheckoutIntentById(
    intentId: string,
  ): CheckoutIntent | undefined {
    const row = this.db
      .prepare<[string], CheckoutIntentRow>(
        `SELECT ${INTENT_COLUMNS}
           FROM checkout_intents
          WHERE intent_id = ?
          LIMIT 1`,
      )
      .get(intentId);
    return row ? intentFromRow(row) : undefined;
  }

  private readWebhookEventByWebhookId(
    webhookId: string,
  ): WebhookEventRow | undefined {
    return this.db
      .prepare<[string], WebhookEventRow>(
        `SELECT webhook_id, event_type, event_id, payment_id, intent_id,
                order_id, checkout_id, payload_hash, raw_body_hash, status,
                error_code
           FROM webhook_events
          WHERE webhook_id = ?
          LIMIT 1`,
      )
      .get(webhookId);
  }

  private readWebhookEventByOrderId(
    orderId: string,
  ): WebhookEventRow | undefined {
    return this.db
      .prepare<[string], WebhookEventRow>(
        `SELECT webhook_id, event_type, event_id, payment_id, intent_id,
                order_id, checkout_id, payload_hash, raw_body_hash, status,
                error_code
           FROM webhook_events
          WHERE order_id = ?
          LIMIT 1`,
      )
      .get(orderId);
  }

  private readWebhookEventByBusinessId(
    eventType: string,
    eventId: string,
    paymentId: string,
  ): WebhookEventRow | undefined {
    return this.db
      .prepare<[string, string, string], WebhookEventRow>(
        `SELECT webhook_id, event_type, event_id, payment_id, intent_id,
                order_id, checkout_id, payload_hash, raw_body_hash, status,
                error_code
           FROM webhook_events
          WHERE (event_type = ? AND event_id = ?)
             OR payment_id = ?
          LIMIT 1`,
      )
      .get(eventType, eventId, paymentId);
  }

  private readWebhookEventByCheckoutId(
    checkoutId: string,
  ): WebhookEventRow | undefined {
    return this.db
      .prepare<[string], WebhookEventRow>(
        `SELECT webhook_id, event_type, event_id, payment_id, intent_id,
                order_id, checkout_id, payload_hash, raw_body_hash, status,
                error_code
           FROM webhook_events
          WHERE checkout_id = ?
          LIMIT 1`,
      )
      .get(checkoutId);
  }

  private readWebhookEventByIntentId(
    intentId: string,
  ): WebhookEventRow | undefined {
    return this.db
      .prepare<[string], WebhookEventRow>(
        `SELECT webhook_id, event_type, event_id, payment_id, intent_id,
                order_id, checkout_id, payload_hash, raw_body_hash, status,
                error_code
           FROM webhook_events
          WHERE intent_id = ?
          LIMIT 1`,
      )
      .get(intentId);
  }

  private readListingForCheckout(
    checkoutId: string,
  ): Listing | undefined {
    const payment = this.db
      .prepare<[string, string], PaymentRow>(
        `SELECT id, listing_id, polar_session, provider_checkout_id,
                provider_payment_id, provider_order_id, amount_usd, kind,
                paid_at, status, error_code
           FROM payments
          WHERE provider_checkout_id = ? OR polar_session = ?
          ORDER BY id DESC
          LIMIT 1`,
      )
      .get(checkoutId, checkoutId);
    return payment?.listing_id
      ? this.readListingById(payment.listing_id)
      : undefined;
  }

  /** Resolve a settled listing when a provider delivery omitted checkoutId. */
  private readListingForIntent(intentId: string): Listing | undefined {
    const event = this.readWebhookEventByIntentId(intentId);
    if (!event?.order_id) return undefined;
    const payment = this.db
      .prepare<[string], { listing_id: string | null }>(
        `SELECT listing_id
           FROM payments
          WHERE provider_order_id = ?
          ORDER BY id DESC
          LIMIT 1`,
      )
      .get(event.order_id);
    return payment?.listing_id
      ? this.readListingById(payment.listing_id)
      : undefined;
  }

  /** Persist the immutable local checkout intent before a provider call. */
  createCheckoutIntent(
    input: { listingDraft: ListingDraft; amountUsd: number; kind: CheckoutKind },
    options: CreateCheckoutIntentOptions,
  ): CheckoutIntent {
    const productId = options.productId.trim();
    if (!productId) {
      throw new ListingError("product_not_configured", 503);
    }
    const currency = (options.currency ?? "USD").trim().toUpperCase();
    if (currency !== "USD") {
      throw new ListingError("currency_not_supported", 400);
    }
    if (
      !Number.isSafeInteger(input.amountUsd) ||
      input.amountUsd < 0 ||
      !Number.isSafeInteger(input.amountUsd * 100)
    ) {
      throw new ListingError("amount_not_whole", 400);
    }
    const canonical = canonicalBriefUrl(input.listingDraft.briefUrl);
    const intentId = options.intentId?.trim() || `intent_${randomUUID()}`;
    const listingDraft = { ...input.listingDraft, briefUrl: canonical };
    const quoteBaseBidUsd =
      options.quoteBaseBidUsd ??
      (input.kind === "raise" ? input.listingDraft.bidUsd - input.amountUsd : 0);
    if (
      !Number.isSafeInteger(quoteBaseBidUsd) ||
      quoteBaseBidUsd < 0 ||
      !Number.isSafeInteger(quoteBaseBidUsd * 100) ||
      !Number.isSafeInteger(listingDraft.bidUsd) ||
      listingDraft.bidUsd < 0 ||
      !Number.isSafeInteger(listingDraft.bidUsd * 100)
    ) {
      throw new ListingError("amount_not_whole", 400);
    }
    const storeId = options.storeId?.trim() || "fixture-store";
    const providerMode = options.providerMode ?? "fixture";
    const taxCategory = options.taxCategory?.trim() || "digital_goods";
    const targetBidCents = listingDraft.bidUsd * 100;
    const quoteBaseBidCents = quoteBaseBidUsd * 100;
    const intentFingerprint = sha256(
      stableJson({
        intentId,
        listingDraft,
        expectedAmountUsd: input.amountUsd,
        expectedAmountCents: input.amountUsd * 100,
        quoteBaseBidUsd,
        quoteBaseBidCents,
        targetBidCents,
        currency,
        productId,
        storeId,
        providerMode,
        taxCategory,
        kind: input.kind,
      }),
    );
    const metadata = checkoutIntentMetadata(
      intentId,
      intentFingerprint,
      listingDraft,
      input.amountUsd,
      input.kind,
      productId,
      currency,
      quoteBaseBidCents,
      targetBidCents,
      storeId,
      providerMode,
      taxCategory,
    );
    const metadataJson = stableJson(metadata);
    const metadataHash = sha256(metadataJson);
    const now = new Date().toISOString();

    return this.transaction(() => {
      const existing = this.readCheckoutIntentById(intentId);
      if (existing) {
        if (
          existing.metadataHash !== metadataHash ||
          existing.productId !== productId ||
          existing.currency.toUpperCase() !== currency ||
          existing.expectedAmountUsd !== input.amountUsd ||
          existing.kind !== input.kind ||
          existing.intentFingerprint !== intentFingerprint
        ) {
          throw new ListingError("checkout_intent_conflict", 409);
        }
        return existing;
      }

      this.db
        .prepare(
          `INSERT INTO checkout_intents (
             intent_id, week_id, buyer, budget_usd, deadline, winner_rule,
             brief_url, bid_usd, expected_amount_usd, expected_amount_cents,
             currency, product_id, kind, lifecycle, intent_fingerprint,
             quote_base_bid_usd, quote_base_bid_cents, target_bid_cents,
             store_id, provider_mode, tax_category, status,
             provider_checkout_id, checkout_url, provider_order_id,
             provider_payment_id, metadata_json, metadata_hash, paid_at,
             failure_code, expires_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?,
                     ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL,
                     ?, ?, NULL, NULL, NULL, ?, ?)` ,
        )
        .run(
          intentId,
          listingDraft.weekId,
          listingDraft.buyer,
          listingDraft.budgetUsd,
          listingDraft.deadline,
          listingDraft.winnerRule,
          canonical,
          listingDraft.bidUsd,
          input.amountUsd,
          input.amountUsd * 100,
          currency,
          productId,
          input.kind,
          intentFingerprint,
          quoteBaseBidUsd,
          quoteBaseBidCents,
          targetBidCents,
          storeId,
          providerMode,
          taxCategory,
          metadataJson,
          metadataHash,
          now,
          now,
        );
      return this.readCheckoutIntentById(intentId) as CheckoutIntent;
    });
  }

  /**
   * Read every durable provider-checkout fact for one immutable intent while
   * its attachment transaction is holding the write lock. A checkout response
   * may arrive after a signed delivery, so the intent row alone is not enough
   * to establish which provider session already won the race.
   */
  private readCheckoutIdentityFacts(
    intentId: string,
    intent: CheckoutIntent,
  ): string[] {
    const rows = this.db
      .prepare<
        [string, string, string, string, string, string, string, string],
        { checkout_id: string | null }
      >(
        `SELECT provider_checkout_id AS checkout_id
           FROM checkout_intents
          WHERE intent_id = ?
         UNION ALL
         SELECT checkout_id
           FROM checkout_events
          WHERE intent_id = ? AND checkout_id IS NOT NULL
         UNION ALL
         SELECT checkout_id
           FROM webhook_events
          WHERE intent_id = ? AND checkout_id IS NOT NULL
         UNION ALL
         SELECT checkout_id
           FROM payment_audit_events
          WHERE intent_id = ?
            AND checkout_id IS NOT NULL
            AND outcome <> 'conflict'
         UNION ALL
         SELECT p.provider_checkout_id AS checkout_id
           FROM payments p
           LEFT JOIN webhook_events w ON w.order_id = p.provider_order_id
          WHERE p.provider_checkout_id IS NOT NULL
            AND (
              p.polar_session = ?
              OR p.provider_order_id = ?
              OR p.provider_payment_id = ?
              OR w.intent_id = ?
            )`,
      )
      .all(
        intentId,
        intentId,
        intentId,
        intentId,
        `intent:${intentId}`,
        intent.providerOrderId ?? "",
        intent.providerPaymentId ?? "",
        intentId,
      );
    return [
      ...new Set(
        rows
          .map((row) => row.checkout_id?.trim())
          .filter((checkoutId): checkoutId is string => Boolean(checkoutId)),
      ),
    ];
  }

  /** Persist an attach conflict without changing any existing provider fact. */
  private recordCheckoutIdentityConflict(
    intent: CheckoutIntent,
    attemptedCheckoutId: string,
    existingCheckoutIds: string[],
  ): void {
    const payloadHash = sha256(
      stableJson({
        type: "checkout_attachment_conflict",
        intentId: intent.intentId,
        attemptedCheckoutId,
        existingCheckoutIds: [...existingCheckoutIds].sort(),
      }),
    );
    this.appendPaymentAudit({
      outcome: "conflict",
      reason: "checkout_id_conflict",
      intentId: intent.intentId,
      checkoutId: attemptedCheckoutId,
      payloadHash,
      rawBodyHash: payloadHash,
    });
    this.db
      .prepare(
        `UPDATE checkout_intents SET
           lifecycle = CASE
             WHEN status = 'paid' OR lifecycle IN
               ('paid', 'rejected', 'needs_reconciliation', 'expired')
               THEN lifecycle
             ELSE 'needs_reconciliation'
           END,
           failure_code = CASE
             WHEN status = 'paid' OR lifecycle IN
               ('paid', 'rejected', 'needs_reconciliation', 'expired')
               THEN failure_code
             ELSE 'checkout_id_conflict'
           END,
           updated_at = ?
         WHERE intent_id = ?`,
      )
      .run(new Date().toISOString(), intent.intentId);
  }

  /**
   * Attach the provider checkout exactly once; retries cannot rebind it.
   *
   * The provider response can race a signed delivery. The compare-and-set
   * therefore preserves one real provider identity: a matching ID may fill a
   * NULL attachment, but a different ID is durably conflicted. The
   * lifecycle/failure columns only reopen an intent that was in a recoverable
   * pre-settlement state. A paid, rejected, or reconciliation intent may gain
   * its real provider facts later, but it can never lose its terminal truth.
   */
  attachCheckoutIntent(
    intentId: string,
    providerCheckoutId: string,
    checkoutUrl: string,
    expiresAt?: string,
  ): CheckoutIntent {
    const checkoutId = providerCheckoutId.trim();
    const url = checkoutUrl.trim();
    if (!checkoutId || !url) {
      throw new ListingError("checkout_provider_invalid", 503);
    }
    const attached = this.transaction(() => {
      const intent = this.readCheckoutIntentById(intentId);
      if (!intent) throw new ListingError("checkout_intent_unknown", 404);
      const existingCheckoutIds = this.readCheckoutIdentityFacts(intentId, intent);
      const conflictingCheckoutIds = existingCheckoutIds.filter(
        (existingId) => existingId !== checkoutId,
      );
      if (conflictingCheckoutIds.length > 0) {
        this.recordCheckoutIdentityConflict(
          intent,
          checkoutId,
          conflictingCheckoutIds,
        );
        // Commit the durable conflict before returning the error. Throwing
        // inside this transaction would roll back the audit/reconciliation
        // marker and leave a late provider response indistinguishable from a
        // transient attach failure.
        return undefined;
      }
      if (
        intent.providerCheckoutId &&
        (intent.providerCheckoutId !== checkoutId || intent.checkoutUrl !== url)
      ) {
        throw new ListingError("checkout_intent_conflict", 409);
      }
      try {
        const update = this.db
          .prepare(
            `UPDATE checkout_intents SET
               provider_checkout_id = COALESCE(provider_checkout_id, ?),
               checkout_url = COALESCE(checkout_url, ?),
               status = CASE
                 WHEN lifecycle IN ('creating', 'open', 'unknown') THEN 'open'
                 ELSE status
               END,
               lifecycle = CASE
                 WHEN lifecycle IN ('creating', 'open', 'unknown') THEN 'open'
                 ELSE lifecycle
               END,
               expires_at = COALESCE(expires_at, ?),
               failure_code = CASE
                 WHEN lifecycle IN ('creating', 'open', 'unknown') THEN NULL
                 ELSE failure_code
               END,
               updated_at = ?
             WHERE intent_id = ?
               AND (provider_checkout_id IS NULL OR provider_checkout_id = ?)`,
          )
          .run(
            checkoutId,
            url,
            expiresAt ?? null,
            new Date().toISOString(),
            intentId,
            checkoutId,
          );
        if (update.changes !== 1) {
          throw new ListingError("checkout_intent_conflict", 409);
        }
      } catch (error) {
        if (error instanceof ListingError) throw error;
        if (isSqliteConstraintError(error)) {
          throw new ListingError("checkout_provider_reused", 409);
        }
        throw error;
      }
      // Record the attachment without changing a terminal checkout event. A
      // real session is still useful after a no-checkout signed delivery, but
      // the delivery's paid/rejected/reconciliation state remains authoritative.
      const terminalState = isTerminalIntentStatus(intent.status);
      const providerState = terminalState ? intent.status : "open";
      this.db
        .prepare(
          `INSERT INTO checkout_events (
             event_key, intent_id, checkout_id, provider_state,
             payload_hash, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(intent_id) DO UPDATE SET
             checkout_id = COALESCE(checkout_events.checkout_id, excluded.checkout_id),
             provider_state = CASE
               WHEN checkout_events.provider_state IN
                 ('paid', 'rejected', 'needs_reconciliation', 'expired')
                 THEN checkout_events.provider_state
               ELSE excluded.provider_state
             END,
             payload_hash = checkout_events.payload_hash`,
        )
        .run(
          `checkout:${intentId}`,
          intentId,
          checkoutId,
          providerState,
          sha256(stableJson({ intentId, checkoutId, url })),
          new Date().toISOString(),
        );
      this.db
        .prepare(
          `UPDATE payments
              SET provider_checkout_id = ?
            WHERE provider_checkout_id IS NULL
              AND (provider_order_id = ? OR polar_session = ?)`,
        )
        .run(
          checkoutId,
          intent.providerOrderId ?? "",
          `intent:${intentId}`,
        );
      return this.readCheckoutIntentById(intentId) as CheckoutIntent;
    });
    if (!attached) {
      throw new ListingError("checkout_intent_conflict", 409);
    }
    return attached;
  }

  markCheckoutIntentFailed(intentId: string, failureCode: string): void {
    this.markCheckoutIntentRejected(intentId, failureCode);
  }

  markCheckoutIntentRejected(intentId: string, failureCode: string): void {
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE checkout_intents SET
             status = CASE
               WHEN status IN ('paid', 'expired') OR lifecycle IN
                 ('paid', 'needs_reconciliation', 'rejected', 'expired')
                 THEN status
               ELSE 'failed'
             END,
             lifecycle = CASE
               WHEN status IN ('paid', 'expired') OR lifecycle IN
                 ('paid', 'needs_reconciliation', 'rejected', 'expired')
                 THEN lifecycle
               ELSE 'rejected'
             END,
             failure_code = CASE
               WHEN status IN ('paid', 'expired') OR lifecycle IN
                 ('paid', 'needs_reconciliation', 'rejected', 'expired')
                 THEN failure_code
               ELSE ?
             END,
             updated_at = CASE
               WHEN status IN ('paid', 'expired') OR lifecycle IN
                 ('paid', 'needs_reconciliation', 'rejected', 'expired')
                 THEN updated_at
               ELSE ?
             END
           WHERE intent_id = ?`,
        )
        .run(failureCode, new Date().toISOString(), intentId);
    });
  }

  markCheckoutIntentUnknown(intentId: string, failureCode: string): void {
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE checkout_intents SET
             lifecycle = CASE
               WHEN status IN ('paid', 'expired') OR lifecycle IN
                 ('paid', 'needs_reconciliation', 'rejected', 'expired')
                 THEN lifecycle
               ELSE 'unknown'
             END,
             failure_code = CASE
               WHEN status IN ('paid', 'expired') OR lifecycle IN
                 ('paid', 'needs_reconciliation', 'rejected', 'expired')
                 THEN failure_code
               ELSE ?
             END,
             updated_at = CASE
               WHEN status IN ('paid', 'expired') OR lifecycle IN
                 ('paid', 'needs_reconciliation', 'rejected', 'expired')
                 THEN updated_at
               ELSE ?
             END
           WHERE intent_id = ?`,
        )
        .run(failureCode, new Date().toISOString(), intentId);
    });
  }

  markCheckoutIntentNeedsReconciliation(
    intentId: string,
    reason: string,
  ): void {
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE checkout_intents SET
             lifecycle = CASE WHEN status = 'paid' THEN lifecycle ELSE 'needs_reconciliation' END,
             failure_code = CASE WHEN status = 'paid' THEN failure_code ELSE ? END,
             updated_at = ?
           WHERE intent_id = ?`,
        )
        .run(reason, new Date().toISOString(), intentId);
    });
  }

  /**
   * Reserve a signature-verified but non-settleable Waffo attempt in one
   * transaction. The attempt audit, identity ledgers, payment reservation,
   * and intent reconciliation marker either all commit or the caller gets a
   * retryable storage error.
   */
  reserveWaffoAttempt(
    input: WaffoAttemptReservation,
  ): WaffoAttemptReservationResult {
    const normalized = {
      ...input,
      webhookId: input.webhookId.trim(),
      eventType: input.eventType.trim(),
      eventId: input.eventId.trim(),
      paymentId: input.paymentId.trim(),
      orderId: input.orderId.trim(),
      intentId: input.intentId.trim(),
      // A signed Waffo completion is allowed to omit checkoutId. Keep the
      // provider identity absent; the local intent remains the recovery key.
      checkoutId: input.checkoutId?.trim() ?? "",
      payloadHash: input.payloadHash.trim(),
      rawBodyHash: input.rawBodyHash.trim(),
      reason: input.reason.trim() || "payment_rejected",
    };
    if (
      !normalized.webhookId ||
      !normalized.eventType ||
      !normalized.eventId ||
      !normalized.paymentId ||
      !normalized.orderId ||
      !normalized.intentId ||
      !normalized.payloadHash ||
      !normalized.rawBodyHash
    ) {
      throw new ListingError("payment_identity_missing", 400);
    }

    return this.transaction(() => {
      const existing = this.db
        .prepare<
          [string, string, string, string, string, string, string],
          WebhookEventRow
        >(
          `SELECT webhook_id, event_type, event_id, payment_id, intent_id,
                  order_id, checkout_id, payload_hash, raw_body_hash, status,
                  error_code
             FROM webhook_events
            WHERE webhook_id = ?
               OR order_id = ?
               OR (event_type = ? AND event_id = ?)
               OR payment_id = ?
               OR checkout_id = ?
               OR intent_id = ?
            LIMIT 1`,
        )
        .get(
          normalized.webhookId,
          normalized.orderId,
          normalized.eventType,
          normalized.eventId,
          normalized.paymentId,
          normalized.checkoutId,
          normalized.intentId,
        );
      const ledgerSession = normalized.checkoutId || `intent:${normalized.intentId}`;
      const existingPayment = this.db
        .prepare<
          [string, string, string, string],
          { polar_session: string; provider_checkout_id: string | null; provider_payment_id: string | null; provider_order_id: string | null }
        >(
          `SELECT polar_session, provider_checkout_id, provider_payment_id,
                  provider_order_id
             FROM payments
            WHERE polar_session = ?
               OR provider_checkout_id = ?
               OR provider_payment_id = ?
               OR provider_order_id = ?
            LIMIT 1`,
        )
        .get(
          ledgerSession,
          normalized.checkoutId,
          normalized.paymentId,
          normalized.orderId,
        );

      const sameEvent = existing &&
        existing.webhook_id === normalized.webhookId &&
        existing.event_type === normalized.eventType &&
        existing.event_id === normalized.eventId &&
        existing.payment_id === normalized.paymentId &&
        existing.order_id === normalized.orderId &&
        (existing.checkout_id ?? "") === normalized.checkoutId &&
        existing.payload_hash === normalized.payloadHash &&
        existing.raw_body_hash === normalized.rawBodyHash;
      if (sameEvent) {
        this.appendPaymentAudit({
          ...normalized,
          outcome: "duplicate",
          reason: "exact_replay",
        });
        return "duplicate";
      }
      if (existing || existingPayment) {
        this.appendPaymentAudit({
          ...normalized,
          outcome: "conflict",
          reason: "payment_identifier_reuse",
        });
        return "conflict";
      }

      this.db
        .prepare(
          `INSERT INTO webhook_events (
             webhook_id, event_type, event_id, payment_id, intent_id,
             order_id, checkout_id, payload_hash, raw_body_hash, status,
             error_code, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'rejected', ?, ?)`,
        )
        .run(
          normalized.webhookId,
          normalized.eventType,
          normalized.eventId,
          normalized.paymentId,
          normalized.intentId,
          normalized.orderId,
          normalized.checkoutId || null,
          normalized.payloadHash,
          normalized.rawBodyHash,
          normalized.reason,
          new Date().toISOString(),
        );

      const rejectedAmountCents = normalized.totalAmountCents;
      if (
        normalized.kind &&
        typeof rejectedAmountCents === "number" &&
        Number.isInteger(rejectedAmountCents) &&
        rejectedAmountCents >= 0 &&
        rejectedAmountCents % 100 === 0
      ) {
        this.db
          .prepare(
            `INSERT INTO payments (
               listing_id, polar_session, provider_checkout_id,
               provider_payment_id, provider_order_id, amount_usd, kind,
               paid_at, status, error_code, created_at
             ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 'rejected', ?, ?)`,
          )
          .run(
            ledgerSession,
            normalized.checkoutId || null,
            normalized.paymentId,
            normalized.orderId,
            rejectedAmountCents / 100,
            normalized.kind,
            normalized.paidAt ?? new Date().toISOString(),
            normalized.reason,
            new Date().toISOString(),
          );
      }

      const intent = this.readCheckoutIntentById(normalized.intentId);
      if (intent) {
        this.db
          .prepare(
            `INSERT INTO checkout_events (
               event_key, intent_id, checkout_id, provider_state,
               payload_hash, created_at
             ) VALUES (?, ?, ?, 'needs_reconciliation', ?, ?)
             ON CONFLICT(intent_id) DO UPDATE SET
               checkout_id = COALESCE(checkout_events.checkout_id, excluded.checkout_id),
               provider_state = CASE
                 WHEN checkout_events.provider_state = 'paid' THEN 'paid'
                 ELSE 'needs_reconciliation'
               END,
               payload_hash = CASE
                 WHEN checkout_events.provider_state = 'paid'
                   THEN checkout_events.payload_hash
                 ELSE excluded.payload_hash
               END`,
          )
          .run(
            `checkout:${normalized.intentId}`,
            normalized.intentId,
            normalized.checkoutId || null,
            normalized.payloadHash,
            new Date().toISOString(),
          );
        this.db
          .prepare(
            `UPDATE checkout_intents SET
               lifecycle = CASE WHEN status = 'paid' THEN lifecycle
                 ELSE 'needs_reconciliation' END,
               failure_code = CASE WHEN status = 'paid' THEN failure_code ELSE ? END,
               updated_at = ?
             WHERE intent_id = ? AND status <> 'paid'`,
          )
          .run(normalized.reason, new Date().toISOString(), normalized.intentId);
      }
      this.appendPaymentAudit({
        ...normalized,
        outcome: isReconciliationReason(normalized.reason)
          ? "reconciliation"
          : "rejected",
      });
      return "reserved";
    });
  }

  /** Clear an expired provider attachment before creating a fresh checkout. */
  clearExpiredCheckoutAttachment(intentId: string, reason = "checkout_expired"): void {
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE checkout_intents SET
             provider_checkout_id = NULL,
             checkout_url = NULL,
             expires_at = NULL,
             lifecycle = CASE WHEN status = 'paid' THEN lifecycle ELSE 'unknown' END,
             failure_code = CASE WHEN status = 'paid' THEN failure_code ELSE ? END,
             updated_at = ?
           WHERE intent_id = ? AND status <> 'paid'`,
        )
        .run(reason, new Date().toISOString(), intentId);
      // An expired, still-open checkout response is not a settled provider
      // identity. Drop only that provisional checkout-event identity so a
      // fresh session can be attached; terminal/reconciliation facts remain
      // immutable and are still compared by attachCheckoutIntent.
      this.db
        .prepare(
          `UPDATE checkout_events
              SET checkout_id = NULL
            WHERE intent_id = ?
              AND provider_state NOT IN
                ('paid', 'rejected', 'needs_reconciliation', 'expired')`,
        )
        .run(intentId);
    });
  }

  markCheckoutIntentExpired(reference: string): void {
    this.transaction(() => {
      this.db
        .prepare(
          `UPDATE checkout_intents SET
             status = CASE WHEN status = 'paid' THEN status ELSE 'expired' END,
             lifecycle = CASE WHEN status = 'paid' THEN lifecycle ELSE 'rejected' END,
             updated_at = ?
           WHERE intent_id = ? OR provider_checkout_id = ?`,
        )
        .run(new Date().toISOString(), reference, reference);
    });
  }

  getCheckoutIntent(reference: string): CheckoutIntent | undefined {
    return this.readCheckoutIntentByRef(reference);
  }

  getListingForCheckout(reference: string): Listing | undefined {
    const intent = this.readCheckoutIntentByRef(reference);
    if (!intent) return undefined;
    return intent.providerCheckoutId
      ? this.readListingForCheckout(intent.providerCheckoutId) ??
          this.readListingForIntent(intent.intentId)
      : this.readListingForIntent(intent.intentId);
  }

  /**
   * Settle one SDK-verified order and its delivery/order ledgers atomically.
   * Identifier reuse with a changed signed payload is a hard rejection.
   */
  settleVerifiedOrder(input: VerifiedOrderSettlement): SettlementResult {
    const canonical = canonicalBriefUrl(input.listingDraft.briefUrl);
    const normalized = {
      ...input,
      intentId: input.intentId.trim(),
      checkoutId: input.checkoutId?.trim() ?? "",
      orderId: input.orderId.trim(),
      webhookId: input.webhookId.trim(),
      eventType: input.eventType?.trim() || "order.completed",
      eventId: input.eventId?.trim() || input.paymentId?.trim() || input.orderId.trim(),
      paymentId: input.paymentId?.trim() || input.orderId.trim(),
      rawBodyHash: input.rawBodyHash?.trim() || input.payloadHash,
      productId: input.productId.trim(),
      currency: input.currency.trim().toUpperCase(),
      mode: input.mode?.trim() || undefined,
      storeId: input.storeId?.trim() || undefined,
      taxCategory: input.taxCategory?.trim() || undefined,
      listingDraft: { ...input.listingDraft, briefUrl: canonical },
    };
    try {
      if (normalized.eventType !== "order.completed") {
        throw new ListingError("payment_event_unsupported", 400);
      }
      if (normalized.eventId !== normalized.paymentId) {
        throw new ListingError("payment_id_mismatch", 400);
      }
      return this.transaction(() => {
        const byWebhook = this.readWebhookEventByWebhookId(normalized.webhookId);
        const byOrder = this.readWebhookEventByOrderId(normalized.orderId);
        const byBusiness = this.readWebhookEventByBusinessId(
          normalized.eventType,
          normalized.eventId,
          normalized.paymentId,
        );
        const byCheckoutEvent = normalized.checkoutId
          ? this.readWebhookEventByCheckoutId(normalized.checkoutId)
          : undefined;
        const byIntent = this.readWebhookEventByIntentId(normalized.intentId);
        const byCheckout = normalized.checkoutId
          ? this.readPaymentByCheckoutId(normalized.checkoutId)
          : undefined;
        if (byWebhook || byOrder || byBusiness || byCheckoutEvent || byIntent || byCheckout) {
          const previous = byWebhook ?? byOrder ?? byBusiness ?? byCheckoutEvent ?? byIntent;
          if (
            previous &&
            previous.webhook_id === normalized.webhookId &&
            previous.event_type === normalized.eventType &&
            previous.event_id === normalized.eventId &&
            previous.payment_id === normalized.paymentId &&
            previous.order_id === normalized.orderId &&
            (previous.checkout_id ?? "") === normalized.checkoutId &&
            previous.payload_hash === normalized.payloadHash &&
            previous.raw_body_hash === normalized.rawBodyHash
          ) {
            this.appendPaymentAudit({
              outcome: "duplicate",
              reason: "exact_replay",
              webhookId: normalized.webhookId,
              eventType: normalized.eventType,
              eventId: normalized.eventId,
              paymentId: normalized.paymentId,
              orderId: normalized.orderId,
              intentId: normalized.intentId,
              checkoutId: normalized.checkoutId,
              mode: normalized.mode,
              storeId: normalized.storeId,
              payloadHash: normalized.payloadHash,
              rawBodyHash: normalized.rawBodyHash,
            });
            return {
              listing: normalized.checkoutId
                ? this.readListingForCheckout(normalized.checkoutId) ??
                  this.readListingForIntent(normalized.intentId) ??
                  null
                : this.readListingForIntent(normalized.intentId) ?? null,
              duplicate: true,
            };
          }
          throw new ListingError("payment_identifier_reuse", 409);
        }

        const intent = this.readCheckoutIntentById(normalized.intentId);
        if (!intent) {
          throw new ListingError("checkout_intent_unknown", 400);
        }
        if (
          intent.providerCheckoutId &&
          normalized.checkoutId &&
          intent.providerCheckoutId !== normalized.checkoutId
        ) {
          throw new ListingError("checkout_id_mismatch", 400);
        }
        if (
          intent.status === "rejected" ||
          intent.status === "failed" ||
          intent.status === "expired" ||
          intent.status === "needs_reconciliation"
        ) {
          throw new ListingError("checkout_not_open", 400);
        }
        if (intent.providerOrderId && intent.providerOrderId !== normalized.orderId) {
          throw new ListingError("order_id_reuse", 409);
        }
        if (intent.providerPaymentId && intent.providerPaymentId !== normalized.paymentId) {
          throw new ListingError("payment_id_reuse", 409);
        }
        if (intent.productId !== normalized.productId) {
          throw new ListingError("product_mismatch", 400);
        }
        if (intent.currency.toUpperCase() !== normalized.currency) {
          throw new ListingError("currency_mismatch", 400);
        }
        const expectedMode = intent.providerMode === "waffo-prod"
          ? "prod"
          : intent.providerMode === "waffo-test"
            ? "test"
            : "fixture";
        if (normalized.mode && normalized.mode !== expectedMode) {
          throw new ListingError("mode_mismatch", 400);
        }
        if (normalized.storeId && intent.storeId !== normalized.storeId) {
          throw new ListingError("store_mismatch", 400);
        }
        if (normalized.taxCategory && intent.taxCategory !== normalized.taxCategory) {
          throw new ListingError("tax_category_mismatch", 400);
        }
        if (
          normalized.intentFingerprint &&
          intent.intentFingerprint !== normalized.intentFingerprint
        ) {
          throw new ListingError("metadata_mismatch", 400);
        }
        if (intent.expectedAmountCents !== normalized.totalAmountCents) {
          throw new ListingError("amount_mismatch", 400);
        }
        if (intent.metadataHash !== normalized.metadataHash) {
          throw new ListingError("metadata_mismatch", 400);
        }
        if (!sameListingDraft(intent.listingDraft, normalized.listingDraft)) {
          throw new ListingError("metadata_mismatch", 400);
        }
        if (intent.kind !== normalized.kind) {
          throw new ListingError("kind_mismatch", 400);
        }
        const totalAmountCents = normalized.totalAmountCents;
        if (!Number.isInteger(totalAmountCents) || totalAmountCents < 0) {
          throw new ListingError("amount_mismatch", 400);
        }
        const paidAtMs = parseProviderPaidAt(normalized.paidAt);
        const intentCreatedAtMs = parseProviderPaidAt(intent.createdAt);
        let persistedPaidAt = normalized.paidAt;
        if (intent.providerMode !== "fixture") {
          if (paidAtMs === undefined || intentCreatedAtMs === undefined) {
            throw new ListingError("paid_time_invalid", 400);
          }
          const receiptMs = Date.now();
          if (!Number.isFinite(receiptMs)) {
            throw new ListingError("paid_time_invalid", 400);
          }
          if (paidAtMs < intentCreatedAtMs) {
            throw new ListingError("paid_time_before_intent", 400);
          }
          if (
            paidAtMs < receiptMs - ROLLING_WEEK_MS ||
            paidAtMs > receiptMs + PROVIDER_CLOCK_SKEW_MS
          ) {
            throw new ListingError("paid_time_out_of_window", 400);
          }
          // `parseProviderPaidAt` only accepts this exact representation, but
          // persist the round-tripped value so every ranking/tie ledger uses
          // one canonical UTC string.
          persistedPaidAt = new Date(paidAtMs).toISOString();
        } else {
          const paidAt = new Date(normalized.paidAt);
          if (!Number.isFinite(paidAt.getTime())) {
            throw new ListingError("paid_time_invalid", 400);
          }
        }
        const paidAt = new Date(persistedPaidAt);
        if (!Number.isFinite(paidAt.getTime())) {
          throw new ListingError("paid_time_invalid", 400);
        }

        // Resolve raise/create identity against the current stored desk, not
        // the provider timestamp. A delayed event may have an earlier paidAt
        // than a listing already committed by another delivery.
        const identityNow = intent.providerMode === "fixture"
          // Fixture events intentionally carry a virtual clock so deterministic
          // tests can exercise rolling-week boundaries without changing the
          // process clock. Live Waffo identity always uses receiver time.
          ? paidAt
          : new Date();
        const existing = this.readCurrentByBriefUrl(canonical, identityNow);
        if (existing && normalized.kind === "create") {
          throw new ListingError("brief_identity_conflict", 409);
        }
        const quote = quoteBid(existing, normalized.listingDraft.bidUsd);
        if (
          quote.kind !== normalized.kind ||
          quote.chargeUsd * 100 !== totalAmountCents
        ) {
          throw new ListingError(
            quote.kind === "raise" ? "bid_not_higher" : "amount_mismatch",
            400,
          );
        }

        const listing = this.writePaidListing(
          existing,
          normalized.listingDraft,
          quote.targetBidUsd,
          persistedPaidAt,
        );
        this.db
          .prepare(
            `INSERT INTO payments (
               listing_id, polar_session, provider_checkout_id,
               provider_payment_id, provider_order_id, amount_usd, kind,
               paid_at, status, error_code, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'applied', NULL, ?)`,
          )
          .run(
            listing.id,
            normalized.checkoutId || `intent:${normalized.intentId}`,
            normalized.checkoutId || null,
            normalized.paymentId,
            normalized.orderId,
            totalAmountCents / 100,
            normalized.kind,
            persistedPaidAt,
            new Date().toISOString(),
          );
        this.db
          .prepare(
            `INSERT INTO webhook_events (
               webhook_id, event_type, event_id, payment_id, intent_id,
               order_id, checkout_id, payload_hash, raw_body_hash, status,
               error_code, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', NULL, ?)`,
          )
          .run(
            normalized.webhookId,
            normalized.eventType,
            normalized.eventId,
            normalized.paymentId,
            normalized.intentId,
            normalized.orderId,
            normalized.checkoutId || null,
            normalized.payloadHash,
            normalized.rawBodyHash,
            new Date().toISOString(),
          );
        this.db
          .prepare(
            `UPDATE checkout_intents SET
               status = 'paid', lifecycle = 'paid',
               provider_checkout_id = COALESCE(provider_checkout_id, NULLIF(?, '')),
               provider_order_id = ?, provider_payment_id = ?, paid_at = ?,
               failure_code = NULL, updated_at = ?
             WHERE intent_id = ?`,
          )
          .run(
            normalized.checkoutId,
            normalized.orderId,
            normalized.paymentId,
            persistedPaidAt,
            new Date().toISOString(),
            normalized.intentId,
          );
        this.db
          .prepare(
            `INSERT INTO checkout_events (
               event_key, intent_id, checkout_id, provider_state,
               payload_hash, created_at
             ) VALUES (?, ?, ?, 'paid', ?, ?)
             ON CONFLICT(intent_id) DO UPDATE SET
               checkout_id = COALESCE(checkout_events.checkout_id, excluded.checkout_id),
               provider_state = 'paid',
               payload_hash = excluded.payload_hash`,
          )
          .run(
            `checkout:${normalized.intentId}`,
            normalized.intentId,
            normalized.checkoutId || null,
            normalized.payloadHash,
            new Date().toISOString(),
          );
        if (normalized.checkoutId) {
          this.db
            .prepare("DELETE FROM unpaid_checkouts WHERE session_id = ?")
            .run(normalized.checkoutId);
        }
        this.appendPaymentAudit({
          outcome: "accepted",
          webhookId: normalized.webhookId,
          eventType: normalized.eventType,
          eventId: normalized.eventId,
          paymentId: normalized.paymentId,
          orderId: normalized.orderId,
          intentId: normalized.intentId,
          checkoutId: normalized.checkoutId,
          mode: normalized.mode,
          storeId: normalized.storeId,
          payloadHash: normalized.payloadHash,
          rawBodyHash: normalized.rawBodyHash,
        });
        return { listing, duplicate: false };
      });
    } catch (error) {
      if (error instanceof ListingError) {
        this.recordRejectedVerifiedEvent(normalized, error.code);
      }
      throw error;
    }
  }

  private writePaidListing(
    existing: Listing | undefined,
    draft: ListingDraft,
    targetBidUsd: number,
    paidAt: string,
  ): Listing {
    const canonical = canonicalBriefUrl(draft.briefUrl);
    if (existing) {
      // Keep the original week label, canonical URL, and first-paid tie fact.
      this.db
        .prepare(
          `UPDATE listings SET
             buyer = ?, budget_usd = ?, deadline = ?, winner_rule = ?,
             bid_usd = ?, last_paid_at = ?
           WHERE id = ?`,
        )
        .run(
          draft.buyer,
          draft.budgetUsd,
          draft.deadline,
          draft.winnerRule,
          targetBidUsd,
          paidAt,
          existing.id,
        );
      return this.readListingById(existing.id) as Listing;
    }

    const listing: Listing = {
      id: `lst_${randomUUID()}`,
      weekId: draft.weekId,
      buyer: draft.buyer,
      budgetUsd: draft.budgetUsd,
      deadline: draft.deadline,
      winnerRule: draft.winnerRule,
      briefUrl: canonical,
      bidUsd: targetBidUsd,
      firstPaidAt: paidAt,
      lastPaidAt: paidAt,
      clicks: 0,
    };
    this.db
      .prepare(
        `INSERT INTO listings (
           id, week_id, buyer, budget_usd, deadline, winner_rule,
           brief_url, bid_usd, first_paid_at, last_paid_at, clicks
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        listing.id,
        listing.weekId,
        listing.buyer,
        listing.budgetUsd,
        listing.deadline,
        listing.winnerRule,
        listing.briefUrl,
        listing.bidUsd,
        listing.firstPaidAt,
        listing.lastPaidAt,
        listing.clicks,
      );
    return listing;
  }

  reset(): void {
    if (this.production || process.env.NODE_ENV === "production") {
      throw new Error("BLOCKED-CONFIG: production cannot reset listing state");
    }
    this.transaction(() => {
      // reset() is the explicit test fixture reset. The production ledger is
      // append-only; temporarily dropping its guards lets isolated tests clear
      // their database without weakening normal UPDATE/DELETE protection.
      this.db.exec(
        "DROP TRIGGER IF EXISTS payment_audit_events_no_update; DROP TRIGGER IF EXISTS payment_audit_events_no_delete;",
      );
      this.db.prepare("DELETE FROM payment_audit_events").run();
      this.db.prepare("DELETE FROM payments").run();
      this.db.prepare("DELETE FROM webhook_events").run();
      this.db.prepare("DELETE FROM checkout_intents").run();
      this.db.prepare("DELETE FROM unpaid_checkouts").run();
      this.db.prepare("DELETE FROM listings").run();
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS payment_audit_events_no_update
        BEFORE UPDATE ON payment_audit_events
        BEGIN
          SELECT RAISE(ABORT, 'payment audit ledger is append-only');
        END;
        CREATE TRIGGER IF NOT EXISTS payment_audit_events_no_delete
        BEFORE DELETE ON payment_audit_events
        BEGIN
          SELECT RAISE(ABORT, 'payment audit ledger is append-only');
        END;
      `);
    });
  }

  listPaid(weekId: string): Listing[] {
    return this.db
      .prepare<[string], ListingRow>(
        `SELECT ${LISTING_COLUMNS}
           FROM listings
          WHERE week_id = ?
          ORDER BY id ASC`,
      )
      .all(weekId)
      .map(listingFromRow)
      .filter(isPaidListing);
  }

  /** Live board: paid rows whose last payment is still inside rolling 7 days. */
  listPaidRolling(now: Date = new Date()): Listing[] {
    return this.db
      .prepare<[], ListingRow>(
        `SELECT ${LISTING_COLUMNS}
           FROM listings
          ORDER BY id ASC`,
      )
      .all()
      .map(listingFromRow)
      .filter(
        (row) => isPaidListing(row) && bidInRollingWeek(row.lastPaidAt, now),
      );
  }

  /** Open checkout. It stays off the ticket desk until paid. */
  listUnpaid(weekId?: string): UnpaidTicket[] {
    const intents = weekId === undefined
      ? this.db
          .prepare<[], CheckoutIntentRow>(
            `SELECT ${INTENT_COLUMNS}
               FROM checkout_intents
              WHERE lifecycle IN ('creating', 'open', 'unknown', 'needs_reconciliation')
              ORDER BY created_at ASC, intent_id ASC`,
          )
          .all()
      : this.db
          .prepare<[string], CheckoutIntentRow>(
            `SELECT ${INTENT_COLUMNS}
               FROM checkout_intents
              WHERE week_id = ?
                AND lifecycle IN ('creating', 'open', 'unknown', 'needs_reconciliation')
              ORDER BY created_at ASC, intent_id ASC`,
          )
          .all(weekId);
    const intentTickets = intents.map(unpaidFromIntentRow);
    const legacyRows = weekId === undefined
      ? this.db
          .prepare<[], UnpaidRow>(
            `SELECT ${UNPAID_COLUMNS}
               FROM unpaid_checkouts
              ORDER BY created_at ASC, session_id ASC`,
          )
          .all()
      : this.db
          .prepare<[string], UnpaidRow>(
            `SELECT ${UNPAID_COLUMNS}
               FROM unpaid_checkouts
              WHERE week_id = ?
              ORDER BY created_at ASC, session_id ASC`,
          )
          .all(weekId);
    const legacyTickets = legacyRows.map(unpaidFromRow);
    return [
      ...intentTickets,
      ...legacyTickets.filter(
        (legacy) => !intentTickets.some((intent) => intent.sessionId === legacy.sessionId),
      ),
    ];
  }

  rememberUnpaidCheckout(input: {
    sessionId: string;
    listingDraft: ListingDraft;
  }): void {
    const existing = this.getCheckoutIntent(input.sessionId);
    if (existing) return;
    const legacyIntentId = `legacy_${sha256(input.sessionId).slice(0, 32)}`;
    const intent = this.createCheckoutIntent(
      {
        listingDraft: input.listingDraft,
        amountUsd: input.listingDraft.bidUsd,
        kind: "create",
      },
      {
        intentId: legacyIntentId,
        productId: FIXTURE_PRODUCT_ID,
      },
    );
    this.attachCheckoutIntent(
      intent.intentId,
      input.sessionId,
      `/return?sessionId=${encodeURIComponent(input.sessionId)}`,
    );
  }

  forgetUnpaidCheckout(sessionId: string): void {
    this.db
      .prepare<[string]>("DELETE FROM unpaid_checkouts WHERE session_id = ?")
      .run(sessionId);
    this.markCheckoutIntentExpired(sessionId);
  }

  /** Raise identity: same canonical brief URL still inside last 7 days. Not weekId. */
  findPaidByIdentity(
    briefUrl: string,
    now: Date = new Date(),
  ): Listing | undefined {
    const canonical = canonicalBriefUrl(briefUrl);
    return this.readCurrentByBriefUrl(canonical, now);
  }

  getListingById(id: string): Listing | undefined {
    return this.readListingById(id);
  }

  /** Public brief-URL hops. Never a rating. */
  incrementListingClicks(id: string): Listing | undefined {
    return this.transaction(() => {
      const result = this.db
        .prepare<[string]>(
          "UPDATE listings SET clicks = clicks + 1 WHERE id = ?",
        )
        .run(id);
      if (result.changes === 0) return undefined;
      return this.readListingById(id);
    });
  }

  /** Apply an explicit provider settlement returned by the payment boundary. */
  settlePaidEvent(event: PaidEvent): SettlementResult {
    const eventCheckoutId = event.checkoutId?.trim();
    let intent = event.intentId
      ? this.getCheckoutIntent(event.intentId)
      : undefined;
    intent ??= eventCheckoutId
      ? this.getCheckoutIntent(eventCheckoutId)
      : this.getCheckoutIntent(event.sessionId.trim());
    if (!intent) {
      throw new ListingError("checkout_intent_unknown", 400);
    }
    // `sessionId` is also the required local port API anchor. When Waffo omits
    // checkoutId it must not be promoted to a synthetic provider identity.
    const checkoutId = eventCheckoutId || intent.providerCheckoutId || "";
    const settlementAnchor = checkoutId || `intent:${intent.intentId}`;
    return this.settleVerifiedOrder({
      intentId: intent.intentId,
      checkoutId,
      orderId: event.orderId?.trim() || `legacy-order:${settlementAnchor}`,
      webhookId: event.webhookId?.trim() || `legacy-webhook:${settlementAnchor}`,
      eventType: event.eventType || "order.completed",
      eventId: event.eventId?.trim() || event.orderId?.trim() || `legacy-order:${settlementAnchor}`,
      paymentId: event.paymentId?.trim() || event.orderId?.trim() || `legacy-payment:${settlementAnchor}`,
      intentFingerprint: event.intentFingerprint || intent.intentFingerprint,
      rawBodyHash: event.rawBodyHash,
      mode: event.mode,
      storeId: event.storeId,
      taxCategory: event.taxCategory,
      subtotal: event.subtotal,
      amount: event.amount,
      total: event.total,
      taxAmount: event.taxAmount,
      listingDraft: event.listingDraft,
      kind: event.kind,
      productId: event.productId?.trim() || intent.productId,
      currency: event.currency?.trim() || intent.currency,
      totalAmountCents: event.totalAmountCents ?? event.amountUsd * 100,
      paidAt: event.paidAt,
      metadataHash: event.metadataHash || intent.metadataHash,
      payloadHash:
        event.payloadHash ||
        sha256(
          JSON.stringify({
            sessionId: event.sessionId,
            intentId: event.intentId,
            checkoutId: event.checkoutId,
            orderId: event.orderId,
            listingDraft: event.listingDraft,
            amountUsd: event.amountUsd,
            kind: event.kind,
            paidAt: event.paidAt,
          }),
        ),
    });
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  private recordRejectedVerifiedEvent(
    event: VerifiedOrderSettlement,
    errorCode: string,
  ): void {
    // This is a separate transaction because the detecting settlement
    // transaction has already rolled back. It is nevertheless mandatory: a
    // captured-but-unapplied event must either leave a durable reconciliation
    // record or escape as an internal error so the webhook gets retryable 5xx.
    this.transaction(() => {
      this.appendPaymentAudit({
        outcome: isConflictErrorCode(errorCode)
          ? "conflict"
          : isReconciliationReason(errorCode)
            ? "reconciliation"
            : "rejected",
        reason: errorCode,
        webhookId: event.webhookId,
        eventType: event.eventType ?? "order.completed",
        eventId: event.eventId ?? event.paymentId ?? event.orderId,
        paymentId: event.paymentId ?? event.orderId,
        orderId: event.orderId,
        intentId: event.intentId,
        checkoutId: event.checkoutId,
        mode: event.mode,
        storeId: event.storeId,
        payloadHash: event.payloadHash,
        rawBodyHash: event.rawBodyHash ?? event.payloadHash,
      });
      if (!event.webhookId || !event.orderId) return;
      const checkoutId = event.checkoutId?.trim() || null;
      const ledgerSession = checkoutId || `intent:${event.intentId}`;
      this.db
        .prepare(
          `INSERT OR IGNORE INTO webhook_events (
             webhook_id, event_type, event_id, payment_id, intent_id,
             order_id, checkout_id, payload_hash, raw_body_hash, status,
             error_code, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'rejected', ?, ?)`,
        )
        .run(
          event.webhookId,
          event.eventType ?? "order.completed",
          event.eventId ?? event.paymentId ?? event.orderId,
          event.paymentId ?? event.orderId,
          event.intentId,
          event.orderId,
          checkoutId,
          event.payloadHash,
          event.rawBodyHash ?? event.payloadHash,
          errorCode,
          new Date().toISOString(),
        );
      if (
        Number.isInteger(event.totalAmountCents) &&
        event.totalAmountCents >= 0 &&
        event.totalAmountCents % 100 === 0
      ) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO payments (
               listing_id, polar_session, provider_checkout_id,
               provider_payment_id, provider_order_id, amount_usd, kind,
               paid_at, status, error_code, created_at
             ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 'rejected', ?, ?)`,
          )
          .run(
            ledgerSession,
            checkoutId,
            event.paymentId ?? event.orderId,
            event.orderId,
            event.totalAmountCents / 100,
            event.kind,
            event.paidAt,
            errorCode,
            new Date().toISOString(),
          );
      }
      if (event.intentId) {
        this.db
          .prepare(
            `INSERT INTO checkout_events (
               event_key, intent_id, checkout_id, provider_state,
               payload_hash, created_at
             ) VALUES (?, ?, ?, 'needs_reconciliation', ?, ?)
             ON CONFLICT(intent_id) DO UPDATE SET
               checkout_id = COALESCE(checkout_events.checkout_id, excluded.checkout_id),
               provider_state = CASE
                 WHEN checkout_events.provider_state = 'paid' THEN 'paid'
                 ELSE 'needs_reconciliation'
               END,
               payload_hash = CASE
                 WHEN checkout_events.provider_state = 'paid'
                   THEN checkout_events.payload_hash
                 ELSE excluded.payload_hash
               END`,
          )
          .run(
            `checkout:${event.intentId}`,
            event.intentId,
            checkoutId,
            event.payloadHash,
            new Date().toISOString(),
          );
        this.db
          .prepare(
            `UPDATE checkout_intents SET
               lifecycle = CASE WHEN status = 'paid' THEN lifecycle
                 ELSE 'needs_reconciliation' END,
               failure_code = CASE WHEN status = 'paid' THEN failure_code ELSE ? END,
               updated_at = ?
             WHERE intent_id = ? AND status <> 'paid'`,
          )
          .run(errorCode, new Date().toISOString(), event.intentId);
      }
    });
  }
}

function isConflictErrorCode(errorCode: string): boolean {
  return /reuse|conflict|identifier/i.test(errorCode);
}

function isReconciliationReason(reason: string): boolean {
  return /^(?:mode|store|product|currency|tax_category|metadata|checkout_id)_mismatch$/.test(reason) ||
    reason === "checkout_intent_conflict" ||
    reason === "checkout_id_unknown" ||
    reason === "paid_time_invalid" ||
    reason === "paid_time_out_of_window" ||
    reason === "paid_time_before_intent";
}

function isTerminalIntentStatus(status: CheckoutIntentStatus): boolean {
  return status === "paid" ||
    status === "rejected" ||
    status === "needs_reconciliation" ||
    status === "expired";
}

/** Parse only the canonical UTC representation used by the provider ledger. */
function parseProviderPaidAt(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() !== value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return undefined;
  }
  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  return Number.isFinite(timestamp) && parsed.toISOString() === value
    ? timestamp
    : undefined;
}

function listingFromRow(row: ListingRow): Listing {
  return {
    id: row.id,
    weekId: row.week_id,
    buyer: row.buyer,
    budgetUsd: row.budget_usd,
    deadline: row.deadline,
    winnerRule: row.winner_rule,
    briefUrl: row.brief_url,
    bidUsd: row.bid_usd,
    firstPaidAt: row.first_paid_at,
    lastPaidAt: row.last_paid_at,
    clicks: row.clicks,
  };
}

function unpaidFromRow(row: UnpaidRow): UnpaidTicket {
  return {
    sessionId: row.session_id,
    weekId: row.week_id,
    buyer: row.buyer,
    winnerRule: row.winner_rule,
    briefUrl: row.brief_url,
    bidUsd: row.bid_usd,
  };
}

function unpaidFromIntentRow(row: CheckoutIntentRow): UnpaidTicket {
  return {
    sessionId: row.provider_checkout_id ?? row.intent_id,
    weekId: row.week_id,
    buyer: row.buyer,
    winnerRule: row.winner_rule,
    briefUrl: row.brief_url,
    bidUsd: row.bid_usd,
  };
}

function intentFromRow(row: CheckoutIntentRow): CheckoutIntent {
  let metadata: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.metadata_json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      metadata = Object.fromEntries(
        Object.entries(parsed).filter(
          ([, value]) => typeof value === "string",
        ),
      ) as Record<string, string>;
    }
  } catch {
    // A malformed row is still returned as an immutable intent; settlement
    // compares the stored hash and will reject it rather than guessing.
  }
  return {
    intentId: row.intent_id,
    listingDraft: {
      buyer: row.buyer,
      budgetUsd: row.budget_usd,
      deadline: row.deadline,
      winnerRule: row.winner_rule,
      briefUrl: row.brief_url,
      bidUsd: row.bid_usd,
      weekId: row.week_id,
    },
    expectedAmountUsd: row.expected_amount_usd,
    expectedAmountCents: row.expected_amount_cents,
    currency: row.currency,
    productId: row.product_id,
    kind: row.kind,
    intentFingerprint: row.intent_fingerprint,
    quoteBaseBidUsd: row.quote_base_bid_usd,
    quoteBaseBidCents: row.quote_base_bid_cents,
    targetBidCents: row.target_bid_cents,
    storeId: row.store_id,
    providerMode: row.provider_mode,
    taxCategory: row.tax_category,
    status: row.lifecycle || row.status,
    providerCheckoutId: row.provider_checkout_id ?? undefined,
    checkoutUrl: row.checkout_url ?? undefined,
    providerOrderId: row.provider_order_id ?? undefined,
    providerPaymentId: row.provider_payment_id ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    metadata,
    metadataHash: row.metadata_hash,
    createdAt: row.created_at,
    paidAt: row.paid_at ?? undefined,
    failureCode: row.failure_code ?? undefined,
  };
}

function checkoutIntentMetadata(
  intentId: string,
  intentFingerprint: string,
  draft: ListingDraft,
  amountUsd: number,
  kind: CheckoutKind,
  productId: string,
  currency: string,
  quoteBaseBidCents: number,
  targetBidCents: number,
  storeId: string,
  providerMode: ProviderMode,
  taxCategory: string,
): Record<string, string> {
  return {
    intentId,
    intentFingerprint,
    targetBidCents: String(targetBidCents),
    chargeCents: String(amountUsd * 100),
    quoteBaseBidCents: String(quoteBaseBidCents),
    canonicalUrl: draft.briefUrl,
    buyer: draft.buyer,
    budgetUsd: String(draft.budgetUsd),
    deadline: draft.deadline,
    winnerRule: draft.winnerRule,
    briefUrl: draft.briefUrl,
    bidUsd: String(draft.bidUsd),
    weekId: draft.weekId,
    kind,
    amountUsd: String(amountUsd),
    currency,
    productId,
    storeId,
    mode: providerMode,
    taxCategory,
  };
}

function sameListingDraft(left: ListingDraft, right: ListingDraft): boolean {
  return (
    left.buyer === right.buyer &&
    left.budgetUsd === right.budgetUsd &&
    left.deadline === right.deadline &&
    left.winnerRule === right.winnerRule &&
    canonicalBriefUrl(left.briefUrl) === canonicalBriefUrl(right.briefUrl) &&
    left.bidUsd === right.bidUsd &&
    left.weekId === right.weekId
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function isSqliteConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint|unique/i.test(error.message);
}

let defaultStore: ListingStore | undefined;
let defaultStorePath: string | undefined;

function getDefaultStore(): ListingStore {
  const path = resolveDatabasePath(undefined, process.env);
  if (!defaultStore || defaultStorePath !== path) {
    defaultStore?.close();
    defaultStore = new ListingStore(path);
    defaultStorePath = path;
  }
  return defaultStore;
}

export function createListingStore(
  options: ListingStoreOptions | string = {},
): ListingStore {
  return new ListingStore(options);
}

export function resetListings(): void {
  getDefaultStore().reset();
}

export function listPaid(weekId: string): Listing[] {
  return getDefaultStore().listPaid(weekId);
}

export function listPaidRolling(now: Date = new Date()): Listing[] {
  return getDefaultStore().listPaidRolling(now);
}

export function listUnpaid(weekId?: string): UnpaidTicket[] {
  return getDefaultStore().listUnpaid(weekId);
}

export function rememberUnpaidCheckout(input: {
  sessionId: string;
  listingDraft: ListingDraft;
}): void {
  getDefaultStore().rememberUnpaidCheckout(input);
}

export function forgetUnpaidCheckout(sessionId: string): void {
  getDefaultStore().forgetUnpaidCheckout(sessionId);
}

export function findPaidByIdentity(
  briefUrl: string,
  now: Date = new Date(),
): Listing | undefined {
  return getDefaultStore().findPaidByIdentity(briefUrl, now);
}

export function getListingById(id: string): Listing | undefined {
  return getDefaultStore().getListingById(id);
}

export function incrementListingClicks(id: string): Listing | undefined {
  return getDefaultStore().incrementListingClicks(id);
}

export function createCheckoutIntent(
  input: { listingDraft: ListingDraft; amountUsd: number; kind: CheckoutKind },
  options: CreateCheckoutIntentOptions,
): CheckoutIntent {
  return getDefaultStore().createCheckoutIntent(input, options);
}

export function attachCheckoutIntent(
  intentId: string,
  providerCheckoutId: string,
  checkoutUrl: string,
  expiresAt?: string,
): CheckoutIntent {
  return getDefaultStore().attachCheckoutIntent(
    intentId,
    providerCheckoutId,
    checkoutUrl,
    expiresAt,
  );
}

export function markCheckoutIntentFailed(
  intentId: string,
  failureCode: string,
): void {
  getDefaultStore().markCheckoutIntentFailed(intentId, failureCode);
}

export function markCheckoutIntentRejected(
  intentId: string,
  failureCode: string,
): void {
  getDefaultStore().markCheckoutIntentRejected(intentId, failureCode);
}

export function markCheckoutIntentUnknown(
  intentId: string,
  failureCode: string,
): void {
  getDefaultStore().markCheckoutIntentUnknown(intentId, failureCode);
}

export function markCheckoutIntentNeedsReconciliation(
  intentId: string,
  reason: string,
): void {
  getDefaultStore().markCheckoutIntentNeedsReconciliation(intentId, reason);
}

export function markCheckoutIntentExpired(reference: string): void {
  getDefaultStore().markCheckoutIntentExpired(reference);
}

export function getCheckoutIntent(
  reference: string,
): CheckoutIntent | undefined {
  return getDefaultStore().getCheckoutIntent(reference);
}

export function getListingForCheckout(reference: string): Listing | undefined {
  return getDefaultStore().getListingForCheckout(reference);
}

export function settlePaidEvent(event: PaidEvent): SettlementResult {
  return getDefaultStore().settlePaidEvent(event);
}

export function listPaymentAuditEvents(): PaymentAuditRecord[] {
  return getDefaultStore().listPaymentAuditEvents();
}
