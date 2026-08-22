import { randomUUID } from "node:crypto";
import { CheckoutError } from "./port";
import type {
  CheckoutSession,
  CheckoutStart,
  CreateCheckoutInput,
  ListingDraft,
  PaidEvent,
  PaymentPort,
} from "./port";

type StoredSession = CheckoutSession & { paidAt?: string };

/** In-memory Polar. Rank changes only after a paid fixture event. */
export class FixturePaymentPort implements PaymentPort {
  readonly kind = "fixture" as const;
  private readonly sessions = new Map<string, StoredSession>();

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutStart> {
    const sessionId = `fix_${randomUUID()}`;
    const checkoutUrl = `/return?sessionId=${encodeURIComponent(sessionId)}`;
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
    return session ? copySession(session) : undefined;
  }

  completeSession(sessionId: string): PaidEvent {
    const session = this.requireSession(sessionId);
    if (session.status === "expired") {
      throw new CheckoutError("payment_incomplete", 402);
    }
    if (session.status !== "complete") {
      session.status = "complete";
      session.paidAt = new Date().toISOString();
    }
    return paidEvent(session);
  }

  abandonSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "complete") return;
    session.status = "expired";
  }

  async handleWebhook(
    rawBody: string,
    _headers: Record<string, string>,
  ): Promise<PaidEvent> {
    const event = parseJson(rawBody);
    if (!isRecord(event)) {
      throw new CheckoutError("payment_incomplete", 402);
    }
    const data = isRecord(event.data) ? event.data : event;
    const status = typeof data.status === "string" ? data.status : "";
    const sessionId = typeof data.id === "string" ? data.id : "";
    if (!sessionId) {
      throw new CheckoutError("payment_incomplete", 402);
    }
    if (status === "expired" || status === "failed" || status === "canceled") {
      this.abandonSession(sessionId);
      throw new CheckoutError("payment_incomplete", 402);
    }
    if (!isPaidStatus(status) && event.type !== "order.paid") {
      throw new CheckoutError("payment_incomplete", 402);
    }
    if (!this.sessions.has(sessionId)) {
      const draft = draftFromMetadata(data);
      if (!draft) {
        throw new CheckoutError("payment_incomplete", 402);
      }
      const amountUsd = draft.bidUsd;
      this.sessions.set(sessionId, {
        sessionId,
        status: "open",
        checkoutUrl: `/return?sessionId=${encodeURIComponent(sessionId)}`,
        listingDraft: draft,
        amountUsd,
        kind: "create",
      });
    }
    return this.completeSession(sessionId);
  }

  private requireSession(sessionId: string): StoredSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new CheckoutError("payment_incomplete", 402);
    }
    return session;
  }
}

function paidEvent(session: StoredSession): PaidEvent {
  return {
    sessionId: session.sessionId,
    listingDraft: { ...session.listingDraft },
    amountUsd: session.amountUsd,
    kind: session.kind,
    paidAt: session.paidAt ?? new Date().toISOString(),
  };
}

function copySession(session: StoredSession): CheckoutSession {
  return {
    sessionId: session.sessionId,
    status: session.status,
    checkoutUrl: session.checkoutUrl,
    listingDraft: { ...session.listingDraft },
    amountUsd: session.amountUsd,
    kind: session.kind,
  };
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

function draftFromMetadata(data: Record<string, unknown>): ListingDraft | undefined {
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const buyer = readString(metadata.buyer);
  const budgetUsd = readInt(metadata.budgetUsd);
  const deadline = readString(metadata.deadline);
  const winnerRule = readString(metadata.winnerRule);
  const briefUrl = readString(metadata.briefUrl);
  const bidUsd =
    readInt(metadata.bidUsd) ??
    readInt(data.amountUsd) ??
    centsToUsd(readInt(data.amount));
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
  return {
    buyer,
    budgetUsd,
    deadline,
    winnerRule,
    briefUrl,
    bidUsd,
    weekId,
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
