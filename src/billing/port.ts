import { HonestyError, rejectInventedRatings } from "../core/honesty";
import { ListingError, canonicalBriefUrl, quoteBid } from "../core/listing";
import { findPaidByIdentity } from "../core/listings";
import { isNsfwCopy } from "../core/url";
import { currentWeekUtc } from "../core/week";

export type CheckoutKind = "create" | "raise";

export type ListingDraft = {
  buyer: string;
  budgetUsd: number;
  deadline: string;
  winnerRule: string;
  briefUrl: string;
  bidUsd: number;
  weekId: string;
};

export type CreateCheckoutInput = {
  listingDraft: ListingDraft;
  amountUsd: number;
  kind: CheckoutKind;
  /** Local durable intent. Ports create one when called directly. */
  intentId?: string;
};

export type CheckoutStart = {
  checkoutUrl: string;
  sessionId: string;
  intentId?: string;
};

export type CheckoutStatus = "open" | "complete" | "expired" | "failed";

export type CheckoutSession = {
  sessionId: string;
  intentId?: string;
  status: CheckoutStatus;
  checkoutUrl: string;
  listingDraft: ListingDraft;
  amountUsd: number;
  kind: CheckoutKind;
  currency?: string;
  productId?: string;
  providerOrderId?: string;
  listingId?: string;
  failureCode?: string;
};

export type PaidEvent = {
  sessionId: string;
  intentId?: string;
  checkoutId?: string;
  orderId?: string;
  webhookId?: string;
  listingDraft: ListingDraft;
  amountUsd: number;
  kind: CheckoutKind;
  paidAt: string;
  productId?: string;
  currency?: string;
  totalAmountCents?: number;
  metadataHash?: string;
  payloadHash?: string;
  eventType?: string;
  eventId?: string;
  paymentId?: string;
  rawBodyHash?: string;
  intentFingerprint?: string;
  mode?: string;
  storeId?: string;
  taxCategory?: string;
  subtotal?: string;
  amount?: string;
  total?: string;
  taxAmount?: string;
};

export type PaymentPort = {
  readonly kind: "fixture" | "live";
  readonly productId?: string;
  close?(): void;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart>;
  handleWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<PaidEvent>;
  getSession(sessionId: string): CheckoutSession | undefined;
};

export class CheckoutError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(code);
    this.name = "CheckoutError";
  }
}

export type PaymentEnv = Record<string, string | undefined>;

/** Raise identity is `findPaidByIdentity` (last 7 days), not weekId. */
export function parseCheckoutInput(
  body: Record<string, unknown>,
  now: Date = new Date(),
): CreateCheckoutInput {
  rejectRatings(body);

  const buyer = readTrimmed(body.buyer);
  if (!buyer || buyer.length > 80) {
    throw new CheckoutError("invalid_listing", 400);
  }

  const budgetUsd = parseWholeUsd(body.budgetUsd);
  if (budgetUsd === undefined || budgetUsd < 1) {
    throw new CheckoutError("budget_not_whole", 400);
  }

  const deadline = parseDeadline(body.deadline);
  const winnerRule = readTrimmed(body.winnerRule);
  if (!winnerRule || winnerRule.length > 280) {
    throw new CheckoutError("invalid_listing", 400);
  }
  if (isNsfwCopy(buyer) || isNsfwCopy(winnerRule)) {
    throw new CheckoutError("url_forbidden", 400);
  }

  const briefUrl = parseBriefUrl(body.briefUrl);
  const targetBidUsd = parseWholeUsd(body.amountUsd ?? body.bidUsd);
  if (targetBidUsd === undefined) {
    throw new CheckoutError("bid_not_whole", 400);
  }
  const requestedWeekId = readTrimmed(body.weekId);
  const existing = findPaidByIdentity(briefUrl, now);
  const weekId =
    existing?.weekId || requestedWeekId || currentWeekUtc(now).weekId;
  const quote = planQuote(existing, targetBidUsd);

  return {
    listingDraft: {
      buyer,
      budgetUsd,
      deadline,
      winnerRule,
      briefUrl,
      bidUsd: quote.targetBidUsd,
      weekId,
    },
    amountUsd: quote.chargeUsd,
    kind: quote.kind,
  };
}

function planQuote(
  existing: { bidUsd: number } | undefined,
  targetBidUsd: number,
) {
  try {
    return quoteBid(existing, targetBidUsd);
  } catch (error) {
    if (error instanceof ListingError) {
      throw new CheckoutError(error.code, error.httpStatus);
    }
    throw error;
  }
}

function rejectRatings(body: Record<string, unknown>): void {
  try {
    rejectInventedRatings(body);
  } catch (error) {
    if (error instanceof HonestyError) {
      throw new CheckoutError(error.code, error.httpStatus);
    }
    throw error;
  }
}

function parseWholeUsd(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw) || raw < 0) return undefined;
    return raw;
  }
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().replace(/^\$/, "");
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : undefined;
}

function parseDeadline(raw: unknown): string {
  const value = readTrimmed(raw);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CheckoutError("deadline_invalid", 400);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new CheckoutError("deadline_invalid", 400);
  }
  return value;
}

function parseBriefUrl(raw: unknown): string {
  const value = readTrimmed(raw);
  if (!value) {
    throw new CheckoutError("url_insecure", 400);
  }
  try {
    return canonicalBriefUrl(value);
  } catch (error) {
    if (error instanceof ListingError) {
      throw new CheckoutError(error.code, error.httpStatus);
    }
    throw error;
  }
}

function readTrimmed(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}
