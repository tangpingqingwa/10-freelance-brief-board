import { NextResponse } from "next/server";
import { CheckoutError } from "../../../../billing/port";
import { getPaymentPort } from "../../../../billing/select";
import { applyPaidEvent } from "../../../../core/listings";

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
      return NextResponse.json({ received: true, applied: false });
    }
    const message = error instanceof Error ? error.message : "invalid webhook";
    const status =
      message.startsWith("BLOCKED-SECRET") || message.includes("signature")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
