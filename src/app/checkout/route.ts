import { NextResponse } from "next/server";
import { providerMode } from "../../config";
import {
  CheckoutError,
  parseCheckoutInput,
} from "../../billing/port";
import { getPaymentPort } from "../../billing/select";
import {
  attachCheckoutIntent,
  createCheckoutIntent,
  markCheckoutIntentUnknown,
} from "../../core/listings";
import { ListingError } from "../../core/listing";
import { isWaffoCheckoutUrlForSession } from "../../billing/waffo";

/** Canonical checkout boundary. The product contract is POST /checkout. */
export async function POST(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  let body: Record<string, unknown>;
  try {
    body = await readBody(request);
  } catch {
    return requestWantsJson(request)
      ? jsonError("invalid_listing", 400)
      : htmlError("invalid_listing", 400);
  }

  let intentId: string | undefined;
  try {
    const input = parseCheckoutInput(body);
    const port = getPaymentPort();
    const mode = providerMode(process.env) ?? "fixture";
    const intent = createCheckoutIntent(input, {
      productId: port.productId ?? "fixture-product",
      currency: "USD",
      storeId: process.env.WAFFO_STORE_ID ?? "fixture-store",
      providerMode: mode,
      taxCategory: "digital_goods",
    });
    intentId = intent.intentId;

    // The intent is durable before createCheckout can make its provider call.
    const started = await port.createCheckout({ ...input, intentId });
    if (started.intentId && started.intentId !== intentId) {
      throw new CheckoutError("checkout_intent_conflict", 409);
    }
    if (
      port.kind === "live" &&
      !isWaffoCheckoutUrlForSession(started.checkoutUrl, started.sessionId)
    ) {
      throw new CheckoutError("checkout_provider_invalid", 503);
    }
    const attached = attachCheckoutIntent(
      intentId,
      started.sessionId,
      started.checkoutUrl,
    );
    const response = {
      ...started,
      intentId: attached.intentId,
      sessionId: attached.providerCheckoutId ?? started.sessionId,
      checkoutUrl: attached.checkoutUrl ?? started.checkoutUrl,
    };
    if (requestWantsJson(request)) return NextResponse.json(response);
    return NextResponse.redirect(new URL(response.checkoutUrl, origin), 303);
  } catch (error) {
    const preservesDurableIntentTruth =
      error instanceof CheckoutError &&
      (error.code === "waffo_ambiguous" ||
        error.code === "waffo_rejected" ||
        error.code === "checkout_intent_conflict");
    if (intentId && !preservesDurableIntentTruth) {
      // A custom/injected port may fail before it has classified its own
      // outcome. Unknown is recoverable and never creates a board row.
      try {
        markCheckoutIntentUnknown(intentId, errorCode(error));
      } catch {
        // Preserve the actionable checkout error if the database is unavailable.
      }
    }
    if (error instanceof CheckoutError || error instanceof ListingError) {
      const code = error.code;
      return requestWantsJson(request)
        ? jsonError(code, error.httpStatus)
        : htmlError(code, error.httpStatus);
    }
    return requestWantsJson(request)
      ? jsonError("checkout_unavailable", 503)
      : htmlError("checkout_unavailable", 503);
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const parsed = (await request.json()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid_listing");
    }
    return parsed as Record<string, unknown>;
  }
  const form = await request.formData();
  const body: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") body[key] = value;
  }
  return body;
}

function requestWantsJson(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  const contentType = request.headers.get("content-type") ?? "";
  return accept.includes("application/json") || contentType.includes("application/json");
}

function jsonError(code: string, status: number): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

const HUMAN_ERRORS: Record<string, string> = {
  invalid_listing: "Please complete the brief details and try again.",
  budget_not_whole: "Project budget must be a whole-dollar amount.",
  deadline_invalid: "Please enter a valid deadline.",
  bid_not_whole: "Your bid must be a whole-dollar amount.",
  bid_below_min: "The minimum first bid is $5.",
  bid_not_higher: "That bid does not beat the current #1.",
  url_insecure: "Use an HTTPS brief URL.",
  url_forbidden: "That brief URL cannot be used here.",
  rating_forbidden: "Ratings are not part of this board.",
  checkout_intent_conflict: "This checkout no longer matches the saved brief.",
  checkout_intent_unknown: "This checkout could not be recovered.",
  checkout_not_open: "This checkout is no longer open.",
  checkout_provider_invalid: "The payment checkout response was incomplete.",
  payment_provider_unconfigured: "Checkout is temporarily unavailable.",
  waffo_unavailable: "Payment is temporarily unavailable. No rank was changed.",
  waffo_ambiguous: "Payment status is being reconciled. No rank was changed yet.",
  waffo_rejected: "Payment could not be started. No rank was changed.",
  checkout_unknown: "Checkout could not be started. No rank was changed.",
  checkout_unavailable: "Checkout is temporarily unavailable. No rank was changed.",
};

function htmlError(code: string, status: number): NextResponse {
  const message = HUMAN_ERRORS[code] ?? HUMAN_ERRORS.checkout_unavailable!;
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Checkout unavailable</title></head><body><main><h1>Checkout unavailable</h1><p>${message}</p><p><a href="/">Back to the brief desk</a></p></main></body></html>`;
  return new NextResponse(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : "checkout_unknown";
}
