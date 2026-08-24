import { NextResponse } from "next/server";
import { CheckoutError } from "../../../../billing/port";
import { getPaymentPort } from "../../../../billing/select";
import { ListingError } from "../../../../core/listing";
import { applyPaidEvent, forgetUnpaidCheckout } from "../../../../core/listings";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  try {
    const paid = await getPaymentPort().handleWebhook(rawBody, headers);
    applyPaidEvent(paid);
    return NextResponse.json({ received: true, applied: true });
  } catch (error) {
    if (error instanceof CheckoutError && error.code === "payment_incomplete") {
      const sessionId = unpaidSessionId(rawBody);
      if (sessionId) forgetUnpaidCheckout(sessionId);
      return NextResponse.json({ received: true, applied: false });
    }
    if (error instanceof ListingError) {
      return NextResponse.json({ error: error.code }, { status: error.httpStatus });
    }
    const message = error instanceof Error ? error.message : "invalid webhook";
    const status =
      message.startsWith("BLOCKED-SECRET") || message.includes("signature")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function unpaidSessionId(rawBody: string): string | undefined {
  try {
    const event = JSON.parse(rawBody) as unknown;
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return undefined;
    }
    const record = event as { data?: unknown; id?: unknown };
    const data =
      record.data && typeof record.data === "object" && !Array.isArray(record.data)
        ? (record.data as { id?: unknown })
        : record;
    return typeof data.id === "string" && data.id.trim() !== ""
      ? data.id
      : undefined;
  } catch {
    return undefined;
  }
}
