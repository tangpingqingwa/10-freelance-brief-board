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
};

export type CheckoutStart = {
  checkoutUrl: string;
  sessionId: string;
};

export type CheckoutStatus = "open" | "complete" | "expired";

export type CheckoutSession = {
  sessionId: string;
  status: CheckoutStatus;
  checkoutUrl: string;
  listingDraft: ListingDraft;
  amountUsd: number;
  kind: CheckoutKind;
};

export type PaidEvent = {
  sessionId: string;
  listingDraft: ListingDraft;
  amountUsd: number;
  kind: CheckoutKind;
  paidAt: string;
};

export type PaymentPort = {
  readonly kind: "fixture" | "live";
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

export type PolarEnv = Record<string, string | undefined>;

/** Live Polar only when POLAR_LIVE=1. POLAR_FIXTURE_ONLY=1 always wins. */
export function polarLiveEnabled(env: PolarEnv = process.env): boolean {
  if (env.POLAR_FIXTURE_ONLY === "1") return false;
  return env.POLAR_LIVE === "1";
}

export function polarAccessToken(env: PolarEnv = process.env): string | undefined {
  const token = env.POLAR_ACCESS_TOKEN?.trim();
  return token ? token : undefined;
}

export function polarWebhookSecret(env: PolarEnv = process.env): string | undefined {
  const secret = env.POLAR_WEBHOOK_SECRET?.trim();
  return secret ? secret : undefined;
}

export function publicBaseUrl(env: PolarEnv = process.env): string {
  const raw = env.PUBLIC_BASE_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return "http://localhost:3000";
}

export function parseCheckoutInput(body: Record<string, unknown>): CreateCheckoutInput {
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

  const briefUrl = parseHttpsUrl(body.briefUrl);
  const targetBidUsd = parseWholeUsd(body.amountUsd ?? body.bidUsd);
  if (targetBidUsd === undefined) {
    throw new CheckoutError("bid_not_whole", 400);
  }
  const weekId = readTrimmed(body.weekId) || currentWeekUtc().weekId;
  const existing = findPaidByIdentity(weekId, briefUrl);
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
    if (!Number.isInteger(raw) || raw < 0) return undefined;
    return raw;
  }
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().replace(/^\$/, "");
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number(trimmed);
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

function parseHttpsUrl(raw: unknown): string {
  const value = readTrimmed(raw);
  if (!value) {
    throw new CheckoutError("url_insecure", 400);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CheckoutError("url_insecure", 400);
  }
  if (parsed.protocol !== "https:") {
    throw new CheckoutError("url_insecure", 400);
  }
  try {
    return canonicalBriefUrl(parsed.toString());
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
