import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  WaffoPancake,
  WaffoPancakeError,
  verifyWebhook,
  TaxCategory,
  type WebhookEvent,
  type WebhookEventData,
} from "@waffo/pancake-ts";
import {
  createListingStore,
  PROVIDER_CLOCK_SKEW_MS,
  type CheckoutIntent,
  type WaffoAttemptReservationResult,
} from "../core/listings";
import { ListingError, canonicalBriefUrl } from "../core/listing";
import { ROLLING_WEEK_MS } from "../core/week";
import {
  assertProviderSettings,
  databasePath,
  providerMode,
  publicBaseUrl,
  waffoApiBase,
  type DatabaseEnv,
  type ProviderMode,
} from "../config";
import {
  CheckoutError,
  type CheckoutSession,
  type CheckoutStart,
  type CreateCheckoutInput,
  type PaidEvent,
  type PaymentPort,
  type PaymentEnv,
} from "./port";

export const WAFFO_API_BASE = "https://api.waffo.ai";

export type WaffoPaymentPortOptions = {
  env?: PaymentEnv;
  fetch?: typeof fetch;
  /** Test-only public-key injection; production still requires its env key. */
  webhookPublicKey?: string;
};

type WaffoMode = Exclude<ProviderMode, "fixture">;
type WaffoData = WebhookEventData & Record<string, unknown>;

/** Official Waffo Pancake adapter; live settlement is selected explicitly. */
export class WaffoPaymentPort implements PaymentPort {
  readonly kind = "live" as const;
  readonly productId: string;
  private readonly storeId: string;
  private readonly env: PaymentEnv;
  private readonly mode: WaffoMode;
  private readonly environment: "test" | "prod";
  private readonly webhookPublicKey?: string;
  private readonly timeoutMs: number;
  private readonly client: WaffoPancake;
  private readonly store;

  constructor(options: WaffoPaymentPortOptions = {}) {
    this.env = options.env ?? process.env;
    const mode = providerMode(this.env);
    if (mode !== "waffo-test" && mode !== "waffo-prod") {
      throw new Error("WaffoPaymentPort requires WAFFO_MODE=waffo-test or waffo-prod");
    }
    this.mode = mode;
    this.environment = mode === "waffo-prod" ? "prod" : "test";
    const validationEnv: DatabaseEnv = {
      ...this.env,
      ...(options.webhookPublicKey && this.environment === "test"
        ? { WAFFO_WEBHOOK_TEST_PUBLIC_KEY: options.webhookPublicKey }
        : {}),
    };
    assertProviderSettings(validationEnv);
    this.productId = requireEnv(this.env, "WAFFO_PRODUCT_ID");
    this.storeId = requireEnv(this.env, "WAFFO_STORE_ID");
    const merchantId = requireEnv(this.env, "WAFFO_MERCHANT_ID");
    const privateKey = loadPrivateKey(this.env);
    // A generated/injected key is a test seam only. Production verification
    // always uses the explicitly configured production environment key.
    this.webhookPublicKey =
      this.environment === "test"
        ? options.webhookPublicKey ?? this.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY?.trim()
        : this.env.WAFFO_WEBHOOK_PROD_PUBLIC_KEY?.trim();
    const fetchFn = options.fetch ?? fetch;
    const timeoutMs = readTimeout(this.env);
    this.timeoutMs = timeoutMs;
    this.client = new WaffoPancake({
      merchantId,
      privateKey,
      environment: this.environment,
      baseUrl: waffoApiBase(this.env),
      fetch: (input, init) => fetchWithTimeout(fetchFn, input, init, timeoutMs),
      webhookPublicKey: this.webhookPublicKey,
    });
    // A port instance intentionally owns a connection to the configured
    // shared file, so a second instance observes the first one's intents.
    this.store = createListingStore({
      databasePath: databasePath(this.env),
      env: validationEnv,
    });
  }

  /** Release the SQLite handle when a test/worker owns a short-lived port. */
  close(): void {
    this.store.close();
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart> {
    let intent = input.intentId
      ? this.store.getCheckoutIntent(input.intentId)
      : undefined;
    if (input.intentId && !intent) {
      throw new CheckoutError("checkout_intent_unknown", 400);
    }
    if (
      intent &&
      ["rejected", "failed", "expired", "paid", "needs_reconciliation"].includes(intent.status)
    ) {
      throw new CheckoutError("checkout_not_open", 400);
    }
    if (
      intent &&
      (!sameIntentInput(intent, input) ||
        intent.productId !== this.productId ||
        intent.storeId !== this.storeId ||
        intent.providerMode !== this.mode ||
        intent.taxCategory !== "digital_goods")
    ) {
      throw new CheckoutError("checkout_intent_conflict", 409);
    }
    if (intent && (intent.providerCheckoutId || intent.checkoutUrl)) {
      // The provider SDK rotates its own idempotency key. Once our durable
      // intent has a session, retries must reuse that attachment instead of
      // creating a second provider checkout for the same charge.
      if (
        intent.providerCheckoutId &&
        intent.checkoutUrl &&
        isWaffoCheckoutUrlForSession(intent.checkoutUrl, intent.providerCheckoutId) &&
        isFutureIsoTimestamp(intent.expiresAt)
      ) {
        return {
          sessionId: intent.providerCheckoutId,
          checkoutUrl: intent.checkoutUrl,
          intentId: intent.intentId,
        };
      }
      // A missing, malformed, or elapsed expiry is not a buyer destination.
      // Drop only the stale attachment; the immutable brief/price intent is
      // retained and a fresh provider checkout may be created below.
      this.store.clearExpiredCheckoutAttachment(intent.intentId);
      intent = this.store.getCheckoutIntent(intent.intentId);
      if (!intent) throw new CheckoutError("checkout_intent_unknown", 400);
    }
    intent ??= this.store.createCheckoutIntent(
      {
        listingDraft: input.listingDraft,
        amountUsd: input.amountUsd,
        kind: input.kind,
      },
      {
        productId: this.productId,
        currency: "USD",
        storeId: this.storeId,
        providerMode: this.mode,
        taxCategory: "digital_goods",
      },
    );

    const base = publicBaseUrl(this.env);
    if (!base) throw new CheckoutError("waffo_unavailable", 503);
    try {
      const session = await withTimeout(
        this.client.checkout.anonymous.create({
        productId: this.productId,
        currency: "USD",
        priceSnapshot: {
          amount: centsToDisplay(intent.expectedAmountCents),
          taxCategory: TaxCategory.DigitalGoods,
        },
        successUrl: `${base}/checkout/complete?intent=${encodeURIComponent(intent.intentId)}`,
        orderMerchantExternalId: intent.intentId,
        metadata: intent.metadata,
        }),
        this.timeoutMs,
        "provider response timeout",
      );
      if (
        !session.sessionId ||
        !session.checkoutUrl ||
        !isWaffoCheckoutUrlForSession(session.checkoutUrl, session.sessionId) ||
        !isFutureIsoTimestamp(session.expiresAt)
      ) {
        this.store.markCheckoutIntentUnknown(intent.intentId, "invalid_provider_response");
        throw new CheckoutError("waffo_ambiguous", 503);
      }
      const attached = this.store.attachCheckoutIntent(
        intent.intentId,
        session.sessionId,
        session.checkoutUrl,
        session.expiresAt,
      );
      return {
        sessionId: attached.providerCheckoutId ?? session.sessionId,
        checkoutUrl: attached.checkoutUrl ?? session.checkoutUrl,
        intentId: attached.intentId,
      };
    } catch (error) {
      if (error instanceof CheckoutError) throw error;
      if (
        error instanceof ListingError &&
        ["checkout_intent_conflict", "checkout_provider_reused"].includes(error.code)
      ) {
        // A later provider response may disagree with a real checkout identity
        // already recorded by a signed delivery. That is a durable conflict,
        // not an ambiguous transport failure, and must not reopen the intent.
        throw new CheckoutError("checkout_intent_conflict", 409);
      }
      if (isDefinitiveProviderError(error)) {
        this.store.markCheckoutIntentRejected(intent.intentId, "provider_rejected");
        throw new CheckoutError("waffo_rejected", 400);
      }
      this.store.markCheckoutIntentUnknown(intent.intentId, "provider_ambiguous");
      throw new CheckoutError("waffo_ambiguous", 503);
    }
  }

  getSession(sessionId: string): CheckoutSession | undefined {
    const intent = this.store.getCheckoutIntent(sessionId);
    if (!intent) return undefined;
    const listing = this.store.getListingForCheckout(sessionId);
    return {
      sessionId,
      intentId: intent.intentId,
      status:
        intent.status === "paid"
          ? "complete"
          : intent.status === "rejected" ||
              intent.status === "expired" ||
              intent.status === "needs_reconciliation"
            ? "failed"
            : "open",
      checkoutUrl: intent.checkoutUrl ?? `${publicBaseUrl(this.env) ?? ""}/checkout/complete?intent=${intent.intentId}`,
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

  async handleWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<PaidEvent> {
    const signature = header(headers, "x-waffo-signature");
    let event: WebhookEvent<WaffoData>;
    try {
      event = verifyWebhook(rawBody, signature, {
        environment: this.environment,
        publicKey: this.webhookPublicKey,
      }) as WebhookEvent<WaffoData>;
    } catch {
      throw new CheckoutError("invalid_webhook_signature", 400);
    }
    try {
      if (!isRecord(event) || typeof event.timestamp !== "string") {
        throw new CheckoutError("invalid_webhook_payload", 400);
      }
    if (event.eventType !== "order.completed") {
      throw new CheckoutError("payment_event_unsupported", 400);
    }
    if (event.mode !== this.environment) {
      throw new CheckoutError("mode_mismatch", 400);
    }
    const expectedStore = this.storeId;
    if (event.storeId !== expectedStore) {
      throw new CheckoutError("store_mismatch", 400);
    }
    const data = event.data;
    if (!isRecord(data)) {
      throw new CheckoutError("invalid_webhook_payload", 400);
    }
    if (
      data.orderStatus !== "completed" ||
      data.paymentStatus !== "succeeded" ||
      data.currency !== "USD"
    ) {
      throw new CheckoutError("payment_incomplete", 400);
    }
    const paymentId = readRequired(data.paymentId);
    const orderId = readRequired(data.orderId);
    const intentId = readRequired(data.orderMerchantExternalId);
    const deliveryId = readRequired(event.id);
    const businessEventId = readRequired(event.eventId);
    if (!paymentId || !orderId || !intentId || !deliveryId || !businessEventId) {
      throw new CheckoutError("payment_incomplete", 400);
    }
    if (
      typeof event.eventId !== "string" ||
      typeof data.paymentId !== "string" ||
      event.eventId !== data.paymentId
    ) {
      throw new CheckoutError("payment_id_mismatch", 400);
    }
    const intent = this.store.getCheckoutIntent(intentId);
    if (!intent) throw new CheckoutError("checkout_intent_unknown", 400);
    if (
      intent.productId !== this.productId ||
      intent.storeId !== expectedStore ||
      intent.providerMode !== this.mode ||
      intent.taxCategory !== "digital_goods"
    ) {
      throw new CheckoutError("checkout_intent_conflict", 409);
    }
    const checkoutIdPresent = Object.prototype.hasOwnProperty.call(data, "checkoutId");
    const sessionIdPresent = Object.prototype.hasOwnProperty.call(data, "sessionId");
    // A null/empty checkoutId must not be bypassed by a legacy sessionId alias.
    const checkoutFieldPresent = checkoutIdPresent || sessionIdPresent;
    const eventCheckoutId = checkoutIdPresent
      ? readRequired(data.checkoutId)
      : readRequired(data.sessionId);
    if (checkoutFieldPresent && !eventCheckoutId) {
      throw new CheckoutError("checkout_id_missing", 400);
    }
    if (
      eventCheckoutId &&
      intent.providerCheckoutId &&
      eventCheckoutId !== intent.providerCheckoutId
    ) {
      throw new CheckoutError("checkout_id_mismatch", 400);
    }
    const providerProductId = readRequired(data.productId);
    if (
      Object.prototype.hasOwnProperty.call(data, "productId") &&
      !providerProductId
    ) {
      throw new CheckoutError("product_mismatch", 400);
    }
    if (providerProductId && providerProductId !== intent.productId) {
      throw new CheckoutError("product_mismatch", 400);
    }
    // `orderMetadata` is merchant-controlled and can be echoed unchanged by
    // an attacker who knows our intent shape. The product-level metadata is
    // populated by Waffo from the configured product and is the authoritative
    // product binding for settlement.
    if (!productMetadataMatches(data.productMetadata, intent.productId)) {
      throw new CheckoutError("product_mismatch", 400);
    }
    const eventIntentFingerprint = readRequired(data.intentFingerprint);
    if (
      Object.prototype.hasOwnProperty.call(data, "intentFingerprint") &&
      (!eventIntentFingerprint || eventIntentFingerprint !== intent.intentFingerprint)
    ) {
      throw new CheckoutError("metadata_mismatch", 400);
    }
    if (!metadataEquals(data.orderMetadata, intent.metadata)) {
      throw new CheckoutError("metadata_mismatch", 400);
    }
    const chargeCents = exactSubtotalCents(data);
    if (chargeCents !== intent.expectedAmountCents) {
      throw new CheckoutError("amount_mismatch", 400);
    }
    const paidAt = canonicalWaffoPaidAt(event.timestamp);
    if (!paidAt) {
      throw new CheckoutError("paid_time_out_of_window", 400);
    }
    // Waffo's documented order.completed payload may omit a checkout ID. In
    // that case the immutable external intent ID + exact metadata is the
    // reconciliation anchor. If Waffo supplies a checkout ID, it must bind to
    // the attached local session (or to an intent still in creating/unknown
    // recovery state after an ambiguous response).
    if (
      eventCheckoutId &&
      !intent.providerCheckoutId &&
      !["creating", "unknown", "needs_reconciliation"].includes(intent.status)
    ) {
      throw new CheckoutError("checkout_id_unknown", 400);
    }
    // Checkout IDs are provider facts, not local intent IDs.  Waffo permits a
    // signed completion without checkoutId, so retain that absence and use
    // the immutable intent only as the local settlement anchor.
    const providerCheckoutId = eventCheckoutId ?? intent.providerCheckoutId;
    const localSessionId = providerCheckoutId ?? intent.intentId;
    const payloadHash = sha256(stableJson(event));
    const paid: PaidEvent = {
      sessionId: localSessionId,
      intentId: intent.intentId,
      ...(providerCheckoutId ? { checkoutId: providerCheckoutId } : {}),
      orderId,
      webhookId: deliveryId,
      eventType: event.eventType,
      eventId: businessEventId,
      paymentId,
      intentFingerprint: intent.metadata.intentFingerprint,
      listingDraft: { ...intent.listingDraft },
      amountUsd: intent.expectedAmountUsd,
      totalAmountCents: chargeCents,
      kind: intent.kind,
      paidAt,
      productId: intent.productId,
      currency: intent.currency,
      metadataHash: sha256(stableJson(intent.metadata)),
      payloadHash,
      rawBodyHash: sha256(rawBody),
      mode: event.mode,
      storeId: event.storeId,
      taxCategory: intent.taxCategory,
      subtotal: data.subtotal,
      amount: data.amount,
      total: data.total,
      taxAmount: data.taxAmount,
    };
    this.recordWebhookAudit(rawBody, event, "verified");
    return paid;
    } catch (error) {
      if (error instanceof CheckoutError) {
        // A structurally trusted signed attempt is reserved together with its
        // reconciliation marker and audit row. Storage errors intentionally
        // escape this block so the route emits retryable 5xx.
        const reservation = this.reserveTrustedAttempt(rawBody, event, error.code);
        if (reservation === "duplicate") {
          // A byte-for-byte signed retry of a previously reserved non-ranking
          // attempt has no new business effect. Let the webhook route answer
          // 2xx so Waffo stops retrying, without manufacturing a PaidEvent.
          throw new CheckoutError("payment_event_duplicate", 200);
        }
        if (!reservation) {
          this.recordWebhookAudit(
            rawBody,
            event,
            isConflictErrorCode(error.code) ? "conflict" : "rejected",
            error.code,
          );
        }
      }
      throw error;
    }
  }

  private reserveTrustedAttempt(
    rawBody: string,
    event: WebhookEvent<WaffoData>,
    reason: string,
  ): WaffoAttemptReservationResult | undefined {
    if (!isRecord(event) || typeof event.data !== "object" || event.data === null) {
      return undefined;
    }
    const data = event.data as WaffoData;
    const webhookId = readRequired(event.id);
    // Keep a signed attempt durable even when a malformed event omits the
    // business type. The type is still rejected by the caller, but `unknown`
    // gives the identity ledger a stable namespace for replay protection.
    const eventType = readRequired(event.eventType) ?? "unknown";
    const eventId = readRequired(event.eventId);
    const paymentId = readRequired(data.paymentId);
    const orderId = readRequired(data.orderId);
    const intentId = readRequired(data.orderMerchantExternalId);
    if (
      !webhookId ||
      !eventType ||
      !eventId ||
      !paymentId ||
      !orderId ||
      !intentId
    ) {
      return undefined;
    }
    const intent = this.store.getCheckoutIntent(intentId);
    const checkoutId =
      readRequired(data.checkoutId) ??
      readRequired(data.sessionId) ??
      intent?.providerCheckoutId ??
      "";
    const timestamp = canonicalProviderTimestamp(event.timestamp);
    const payloadHash = sha256(stableJson(event));
    return this.store.reserveWaffoAttempt({
      webhookId,
      eventType,
      eventId,
      paymentId,
      orderId,
      intentId,
      checkoutId,
      reason,
      mode: event.mode,
      storeId: event.storeId,
      totalAmountCents: attemptAmountCents(data),
      kind: intent?.kind,
      paidAt: timestamp ?? undefined,
      payloadHash,
      rawBodyHash: sha256(rawBody),
    });
  }

  private recordWebhookAudit(
    rawBody: string,
    event: unknown,
    outcome: "verified" | "rejected" | "conflict",
    reason?: string,
  ): void {
    const record = isRecord(event) ? event : undefined;
    const data = record && isRecord(record.data) ? record.data : undefined;
    this.store.recordPaymentAudit({
      outcome,
      reason,
      webhookId: readRequired(record?.id),
      eventType: readRequired(record?.eventType),
      eventId: readRequired(record?.eventId),
      paymentId: readRequired(data?.paymentId),
      orderId: readRequired(data?.orderId),
      intentId: readRequired(data?.orderMerchantExternalId),
      checkoutId: readRequired(data?.checkoutId) ?? readRequired(data?.sessionId),
      mode: readRequired(record?.mode),
      storeId: readRequired(record?.storeId),
      payloadHash: sha256(stableJson(event)),
      rawBodyHash: sha256(rawBody),
    });
  }
}

function requireEnv(env: PaymentEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`BLOCKED-CONFIG: ${name}`);
  return value;
}

function loadPrivateKey(env: PaymentEnv): string {
  const inline = env.WAFFO_PRIVATE_KEY?.trim();
  if (inline) return inline.replace(/\\n/g, "\n");
  const path = env.WAFFO_PRIVATE_KEY_FILE?.trim();
  if (path) {
    try {
      const key = readFileSync(path, "utf8").trim();
      if (key) return key;
    } catch {
      throw new Error("BLOCKED-SECRET: WAFFO_PRIVATE_KEY_FILE");
    }
  }
  throw new Error("BLOCKED-SECRET: WAFFO_PRIVATE_KEY");
}

function readTimeout(env: PaymentEnv): number {
  const raw = env.WAFFO_REQUEST_TIMEOUT_MS?.trim();
  const value = raw ? Number(raw) : 10_000;
  return Number.isInteger(value) && value > 0 ? value : 10_000;
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let rejectDeadline: ((error: Error) => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });
  // A network call may never yield a Response, in which case no body wrapper
  // can observe the deadline. Attach a sink so its internal timeout remains a
  // normal control signal rather than an unhandled rejection.
  void deadline.catch(() => undefined);
  const parentSignal = init?.signal;
  const onParentAbort = () => {
    if (!controller.signal.aborted) controller.abort(parentSignal?.reason);
  };
  if (parentSignal) {
    if (parentSignal.aborted) onParentAbort();
    else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }
  const cleanup = () => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  };
  timer = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(new Error("provider response timeout"));
    rejectDeadline?.(new Error("provider response timeout"));
  }, timeoutMs);
  try {
    const response = await fetchFn(input, { ...init, signal: controller.signal });
    // The official SDK calls response.json() after fetch resolves. Keep the
    // same deadline alive through that body parse; a headers-only response
    // must not leave an intent stuck in `creating` forever.
    return wrapResponseBodyDeadline(response, deadline, cleanup);
  } catch (error) {
    cleanup();
    throw error;
  }
}

function wrapResponseBodyDeadline(
  response: Response,
  deadline: Promise<never>,
  cleanup: () => void,
): Response {
  const bodyMethods = new Set(["arrayBuffer", "blob", "bytes", "formData", "json", "text"]);
  return new Proxy(response, {
    get(target, property, receiver) {
      // Undici's Response accessors use private fields and require the real
      // Response as their receiver; the proxy itself would throw on `.status`.
      const value = Reflect.get(target, property, target);
      if (typeof property !== "string" || !bodyMethods.has(property) || typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) =>
        Promise.race([
          Promise.resolve(Reflect.apply(value, target, args)),
          deadline,
        ]).finally(cleanup);
    },
  });
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isDefinitiveProviderError(error: unknown): boolean {
  if (!(error instanceof WaffoPancakeError) || error.status < 400 || error.status >= 500) {
    return false;
  }
  if ([408, 409, 425, 429].includes(error.status)) return false;
  // The SDK wraps a response whose body was not valid JSON in a 4xx-shaped
  // WaffoPancakeError. The provider may have accepted the request, so retain
  // the intent as unknown instead of releasing it as a definitive reject.
  return !error.errors.some((entry) =>
    typeof entry?.message === "string" && /non[- ]json|response from/i.test(entry.message),
  );
}

function header(headers: Record<string, string>, name: string): string | undefined {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected && value.trim()) return value;
  }
      return undefined;
}

function readRequired(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    return undefined;
  }
  return value;
}

export function isWaffoCheckoutUrl(value: string): boolean {
  if (typeof value !== "string" || value !== value.trim() || !value) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
    return false;
  }
  // URL normalizes default ports away, so inspect the original authority too.
  const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1] ?? "";
  if (authority.includes(":")) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "pancake.waffo.ai" && host !== "checkout.waffo.ai") return false;
  return parsed.pathname.length > 1 && parsed.pathname[1] !== "/";
}

/**
 * Waffo documents the hosted URL as ending in the returned session id. Keep
 * the URL and provider session attached as one identity; a response that
 * mixes the two is ambiguous and must remain recoverable, never redirecting a
 * buyer to another checkout.
 */
export function isWaffoCheckoutUrlForSession(
  value: string,
  sessionId: string,
): boolean {
  if (!isWaffoCheckoutUrl(value) || !readRequired(sessionId)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const last = segments.at(-1);
  if (!last) return false;
  try {
    return decodeURIComponent(last) === sessionId;
  } catch {
    return false;
  }
}

/**
 * Provider paid time is also the board's occupancy/tie timestamp. Accept a
 * strict, zoned ISO date-time only while it can still be shown in the
 * promised rolling seven-day desk window. Older/future captures are durable
 * reconciliation records, not ranked listings.
 */
export function canonicalWaffoPaidAt(
  value: unknown,
  now = Date.now(),
): string | undefined {
  const timestamp = parseIsoDateTime(value);
  if (timestamp === undefined) return undefined;
  if (
    timestamp < now - ROLLING_WEEK_MS ||
    timestamp > now + PROVIDER_CLOCK_SKEW_MS
  ) return undefined;
  return new Date(timestamp).toISOString();
}

function isFutureIsoTimestamp(value: unknown, now = Date.now()): value is string {
  const time = parseIsoDateTime(value);
  return time !== undefined && time > now;
}

function parseIsoDateTime(value: unknown): number | undefined {
  if (typeof value !== "string" || value !== value.trim()) return undefined;
  // Waffo documents webhook timestamps as ISO-8601 UTC. Keep one exact
  // millisecond representation in the settlement/tie ledger; Date.parse
  // alone accepts date-only and non-UTC values that are unsafe here.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 || month > 12 ||
    day < 1 || day > daysInMonth[month - 1]! ||
    hour > 23 || minute > 59 || second > 59
  ) {
    return undefined;
  }
  const parsed = new Date(value);
  const time = parsed.getTime();
  return Number.isFinite(time) && parsed.toISOString() === value ? time : undefined;
}

function canonicalProviderTimestamp(value: unknown): string | undefined {
  const parsed = parseIsoDateTime(value);
  return parsed === undefined ? undefined : new Date(parsed).toISOString();
}

function attemptAmountCents(data: WaffoData): number | undefined {
  for (const key of ["subtotal", "amount", "total"] as const) {
    const value = data[key];
    if (typeof value !== "string") continue;
    const cents = displayToCents(value);
    if (cents !== undefined) return cents;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConflictErrorCode(code: string): boolean {
  return /conflict|reuse|identifier/i.test(code);
}

export function centsToDisplay(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("amount_not_whole");
  }
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function displayToCents(value: string): number | undefined {
  const raw = value;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return undefined;
  try {
    const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
    return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : undefined;
  } catch {
    return undefined;
  }
}

function exactSubtotalCents(data: WaffoData): number {
  if (typeof data.amount !== "string" || typeof data.taxAmount !== "string") {
    throw new CheckoutError("amount_mismatch", 400);
  }
  const amount = displayToCents(data.amount);
  const tax = displayToCents(data.taxAmount);
  if (amount === undefined || tax === undefined) {
    throw new CheckoutError("amount_mismatch", 400);
  }
  const subtotalPresent = Object.prototype.hasOwnProperty.call(data, "subtotal");
  if (subtotalPresent && (typeof data.subtotal !== "string" || !data.subtotal.trim())) {
    throw new CheckoutError("amount_mismatch", 400);
  }
  const totalPresent = Object.prototype.hasOwnProperty.call(data, "total");
  if (totalPresent && (typeof data.total !== "string" || !data.total.trim())) {
    throw new CheckoutError("amount_mismatch", 400);
  }
  const total = totalPresent ? displayToCents(data.total as string) : undefined;
  if (totalPresent && total === undefined) {
    throw new CheckoutError("amount_mismatch", 400);
  }
  if (!subtotalPresent) {
    // Without an explicit subtotal there is no safe tax-inclusive anchor:
    // accept only a tax-free amount exactly equal to the local intent. A
    // present total is still checked so malformed or inflated totals cannot
    // hide behind the buyer's tax line.
    if (tax !== 0 || (totalPresent && total !== amount)) {
      throw new CheckoutError("amount_mismatch", 400);
    }
    return amount;
  }

  const subtotal = displayToCents(data.subtotal as string);
  if (subtotal === undefined) {
    throw new CheckoutError("amount_mismatch", 400);
  }
  if (total === undefined) {
    if (tax !== 0 || amount !== subtotal) {
      throw new CheckoutError("amount_mismatch", 400);
    }
    return subtotal;
  }
  if (!Number.isSafeInteger(subtotal + tax) || total !== subtotal + tax) {
    throw new CheckoutError("amount_mismatch", 400);
  }
  // Waffo's price snapshot is tax-exclusive. Depending on the webhook
  // projection, `amount` is either the subtotal or the tax-inclusive total;
  // both must agree with the documented equation, and only `subtotal` is used
  // as the ranked charge by the caller.
  if (amount !== subtotal && amount !== total) {
    throw new CheckoutError("amount_mismatch", 400);
  }
  return subtotal;
}

function metadataEquals(
  actual: Record<string, string> | undefined,
  expected: Record<string, string>,
): boolean {
  if (!actual) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every(
      (key, index) =>
        key === expectedKeys[index] &&
        typeof actual[key] === "string" &&
        actual[key] === expected[key],
    )
  );
}

function productMetadataMatches(value: unknown, expectedProductId: string): boolean {
  if (!isRecord(value)) return false;
  const productId = readRequired(value.productId);
  if (!productId || productId !== expectedProductId) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
