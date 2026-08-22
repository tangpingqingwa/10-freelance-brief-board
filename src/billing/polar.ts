import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CheckoutError,
  polarAccessToken,
  polarLiveEnabled,
  polarWebhookSecret,
  publicBaseUrl,
  type CreateCheckoutInput,
  type CheckoutSession,
  type CheckoutStart,
  type ListingDraft,
  type PaidEvent,
  type PaymentPort,
  type PolarEnv,
} from "./port";

/** Only used when POLAR_LIVE=1. tests/ never fetch this host. */
export const POLAR_API_BASE = "https://api.polar.sh";

export type PolarPaymentPortOptions = {
  env?: PolarEnv;
  fetch?: typeof fetch;
};

type StoredSession = CheckoutSession & { paidAt?: string };

/** Live Polar Checkout. Never constructed unless POLAR_LIVE=1. */
export class PolarPaymentPort implements PaymentPort {
  readonly kind = "live" as const;
  private readonly env: PolarEnv;
  private readonly fetchFn: typeof fetch;
  private readonly sessions = new Map<string, StoredSession>();

  constructor(options: PolarPaymentPortOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchFn = options.fetch ?? fetch;
    if (!polarLiveEnabled(this.env)) {
      throw new Error("PolarPaymentPort requires POLAR_LIVE=1");
    }
    if (!polarAccessToken(this.env)) {
      throw new Error("BLOCKED-SECRET: POLAR_ACCESS_TOKEN");
    }
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart> {
    const token = this.requireToken();
    let response: Response;
    try {
      response = await this.fetchFn(`${POLAR_API_BASE}/v1/checkouts/`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          amount: input.amountUsd * 100,
          currency: "usd",
          success_url: `${publicBaseUrl(this.env)}/return?sessionId={CHECKOUT_ID}`,
          metadata: {
            buyer: input.listingDraft.buyer,
            budgetUsd: String(input.listingDraft.budgetUsd),
            deadline: input.listingDraft.deadline,
            winnerRule: input.listingDraft.winnerRule,
            briefUrl: input.listingDraft.briefUrl,
            bidUsd: String(input.listingDraft.bidUsd),
            weekId: input.listingDraft.weekId,
            kind: input.kind,
          },
        }),
      });
    } catch {
      throw new CheckoutError("polar_unavailable", 503);
    }
    if (!response.ok) {
      throw new CheckoutError("polar_unavailable", 503);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const sessionId = readString(payload.id);
    const checkoutUrl = readString(payload.url);
    if (!sessionId || !checkoutUrl) {
      throw new CheckoutError("polar_unavailable", 503);
    }
    this.sessions.set(sessionId, {
      sessionId,
      status: "open",
      checkoutUrl,
      listingDraft: { ...input.listingDraft },
      amountUsd: input.amountUsd,
      kind: input.kind,
    });
    return { checkoutUrl, sessionId };
  }

  getSession(sessionId: string): CheckoutSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return {
      sessionId: session.sessionId,
      status: session.status,
      checkoutUrl: session.checkoutUrl,
      listingDraft: { ...session.listingDraft },
      amountUsd: session.amountUsd,
      kind: session.kind,
    };
  }

  async handleWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<PaidEvent> {
    const secret = polarWebhookSecret(this.env);
    if (!secret) {
      throw new Error("BLOCKED-SECRET: POLAR_WEBHOOK_SECRET");
    }
    if (!verifyPolarSignature(rawBody, headers, secret)) {
      throw new Error("invalid Polar webhook signature");
    }
    const event = parseJson(rawBody);
    if (!isRecord(event)) {
      throw new CheckoutError("payment_incomplete", 402);
    }
    const data = isRecord(event.data) ? event.data : event;
    const status = readString(data.status) ?? "";
    const sessionId = readString(data.id);
    if (!sessionId) {
      throw new CheckoutError("payment_incomplete", 402);
    }
    if (status === "expired" || status === "failed" || status === "canceled") {
      const existing = this.sessions.get(sessionId);
      if (existing && existing.status !== "complete") {
        existing.status = "expired";
      }
      throw new CheckoutError("payment_incomplete", 402);
    }
    if (!isPaidStatus(status) && event.type !== "order.paid") {
      throw new CheckoutError("payment_incomplete", 402);
    }
    const existing = this.sessions.get(sessionId);
    const reconstructed = existing ? undefined : draftFromMetadata(data);
    const listingDraft = existing?.listingDraft ?? reconstructed?.draft;
    if (!listingDraft) {
      throw new CheckoutError("payment_incomplete", 402);
    }
    const paidAt = new Date().toISOString();
    const amountUsd = existing?.amountUsd ?? reconstructed?.amountUsd;
    const kind = existing?.kind ?? reconstructed?.kind ?? "create";
    if (amountUsd === undefined) {
      throw new CheckoutError("payment_incomplete", 402);
    }
    this.sessions.set(sessionId, {
      sessionId,
      status: "complete",
      checkoutUrl: existing?.checkoutUrl ?? "",
      listingDraft,
      amountUsd,
      kind,
      paidAt,
    });
    return {
      sessionId,
      listingDraft,
      amountUsd,
      kind,
      paidAt,
    };
  }

  private requireToken(): string {
    const token = polarAccessToken(this.env);
    if (!token) {
      throw new Error("BLOCKED-SECRET: POLAR_ACCESS_TOKEN");
    }
    return token;
  }
}

export function verifyPolarSignature(
  rawBody: string,
  headers: Record<string, string>,
  secret: string,
): boolean {
  const id = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signature = header(headers, "webhook-signature");
  if (!id || !timestamp || !signature) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  for (const part of signature.split(" ")) {
    const value = part.startsWith("v1,") ? part.slice(3) : part;
    if (safeEqual(value, expected)) {
      return true;
    }
  }
  return false;
}

function header(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === needle && value.trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isPaidStatus(status: string): boolean {
  return (
    status === "succeeded" ||
    status === "paid" ||
    status === "confirmed" ||
    status === "complete"
  );
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

function draftFromMetadata(
  data: Record<string, unknown>,
): { draft: ListingDraft; amountUsd: number; kind: "create" | "raise" } | undefined {
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const buyer = readString(metadata.buyer);
  const budgetUsd = readInt(metadata.budgetUsd);
  const deadline = readString(metadata.deadline);
  const winnerRule = readString(metadata.winnerRule);
  const briefUrl = readString(metadata.briefUrl);
  const bidUsd = readInt(metadata.bidUsd);
  const weekId = readString(metadata.weekId);
  if (
    !buyer ||
    budgetUsd === undefined ||
    !deadline ||
    !winnerRule ||
    !briefUrl ||
    bidUsd === undefined ||
    !weekId
  ) {
    return undefined;
  }
  const charged = readInt(data.amountUsd) ?? centsToUsd(readInt(data.amount)) ?? bidUsd;
  return {
    draft: {
      buyer,
      budgetUsd,
      deadline,
      winnerRule,
      briefUrl,
      bidUsd,
      weekId,
    },
    amountUsd: charged,
    kind: metadata.kind === "raise" ? "raise" : "create",
  };
}

function centsToUsd(cents: number | undefined): number | undefined {
  if (cents === undefined || cents % 100 !== 0) return undefined;
  return cents / 100;
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
