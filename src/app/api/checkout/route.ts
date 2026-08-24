import { NextResponse } from "next/server";
import { CheckoutError, parseCheckoutInput } from "../../../billing/port";
import { getPaymentPort } from "../../../billing/select";
import { rememberUnpaidCheckout } from "../../../core/listings";

export async function POST(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  let body: Record<string, unknown>;
  try {
    body = await readBody(request);
  } catch {
    return jsonError("invalid_listing", 400);
  }

  try {
    const input = parseCheckoutInput(body);
    const started = await getPaymentPort().createCheckout(input);
    rememberUnpaidCheckout({
      sessionId: started.sessionId,
      listingDraft: input.listingDraft,
    });
    if (wantsJson(request)) {
      return NextResponse.json(started);
    }
    return NextResponse.redirect(new URL(started.checkoutUrl, origin), 303);
  } catch (error) {
    if (error instanceof CheckoutError) {
      if (wantsJson(request)) {
        return jsonError(error.code, error.httpStatus);
      }
      const back = new URL("/", origin);
      back.searchParams.set("error", error.code);
      return NextResponse.redirect(back, 303);
    }
    throw error;
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

function wantsJson(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  const contentType = request.headers.get("content-type") ?? "";
  return accept.includes("application/json") || contentType.includes("application/json");
}

function jsonError(code: string, status: number): NextResponse {
  return NextResponse.json({ error: code }, { status });
}
