import { MIN_BID_USD } from "../core/rank";
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

const RATING_KEY = /^(stars?|rating|reviewScore|review_score|hireRate|hire_rate)$/i;
const RATING_TEXT = /★|⭐|star rating|review score|top rated|hire rate/i;

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

  const briefUrl = parseHttpsUrl(body.briefUrl);
  const amountUsd = parseBidAmount(body.amountUsd ?? body.bidUsd);
  const weekId = readTrimmed(body.weekId) || currentWeekUtc().weekId;

  return {
    listingDraft: {
      buyer,
      budgetUsd,
      deadline,
      winnerRule,
      briefUrl,
      bidUsd: amountUsd,
      weekId,
    },
    amountUsd,
    kind: "create",
  };
}

function rejectRatings(body: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(body)) {
    if (RATING_KEY.test(key)) {
      throw new CheckoutError("rating_forbidden", 400);
    }
    if (typeof value === "string" && RATING_TEXT.test(value)) {
      throw new CheckoutError("rating_forbidden", 400);
    }
  }
}

function parseBidAmount(raw: unknown): number {
  const amount = parseWholeUsd(raw);
  if (amount === undefined) {
    throw new CheckoutError("bid_not_whole", 400);
  }
  if (amount < MIN_BID_USD) {
    throw new CheckoutError("bid_below_min", 400);
  }
  return amount;
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
  return parsed.toString();
}

function readTrimmed(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}
