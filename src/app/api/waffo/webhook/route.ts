import { NextResponse } from "next/server";
import { CheckoutError, type PaymentPort } from "../../../../billing/port";
import { getPaymentPort } from "../../../../billing/select";
import { ListingError } from "../../../../core/listing";
import { settlePaidEvent } from "../../../../core/listings";

/** Canonical Waffo Pancake settlement boundary. */
export async function POST(request: Request): Promise<Response> {
  // Reading the body once, before any JSON parsing, is required by Waffo's
  // signature contract and keeps the signed payload hash authoritative.
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let paymentPort: PaymentPort | undefined;
  try {
    paymentPort = getPaymentPort();
    const paid = await paymentPort.handleWebhook(rawBody, headers);
    const result = settlePaidEvent(paid);
    return NextResponse.json({
      received: true,
      applied: !result.duplicate,
    });
  } catch (error) {
    if (error instanceof CheckoutError) {
      if (error.code === "payment_event_duplicate") {
        return NextResponse.json({ received: true, applied: false });
      }
      if (error.code === "payment_incomplete" &&
          paymentPort?.kind === "fixture") {
        return NextResponse.json({ received: true, applied: false });
      }
      return NextResponse.json(
        { error: error.code },
        { status: error.httpStatus, headers: retryHeaders(error.httpStatus) },
      );
    }
    if (error instanceof ListingError) {
      return NextResponse.json(
        { error: error.code },
        { status: error.httpStatus, headers: retryHeaders(error.httpStatus) },
      );
    }
    // A database/transaction/provider-boundary failure is not an invalid
    // signed event. Returning a retryable 5xx leaves the immutable intent open
    // when SQLite rolled the settlement transaction back.
    return NextResponse.json(
      { error: "webhook_retryable" },
      { status: 503, headers: retryHeaders(503) },
    );
  }
}

function retryHeaders(status: number): Record<string, string> {
  return status >= 500 ? { "retry-after": "0" } : {};
}
