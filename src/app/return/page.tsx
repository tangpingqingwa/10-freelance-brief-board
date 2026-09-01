import React from "react";
import {
  getCheckoutIntent,
  getListingForCheckout,
} from "../../core/listings";

export const dynamic = "force-dynamic";

type ReturnPageProps = {
  searchParams?: Promise<{
    intent?: string | string[];
    sessionId?: string | string[];
    checkoutId?: string | string[];
    status?: string | string[];
  }>;
};

export default async function ReturnPage({ searchParams }: ReturnPageProps) {
  const params = (await searchParams) ?? {};
  const result = resolveReturn(params);

  if (result.status === "cancel") {
    return (
      <main className="return-page" data-return="cancel">
        <h1>Checkout canceled</h1>
        <p>No rank claimed. An abandoned checkout does not list.</p>
        <p>
          <a href="/">Back to the board</a>
        </p>
      </main>
    );
  }

  if (result.status === "paid") {
    return (
      <main className="return-page" data-return="paid">
        <h1>You&apos;re on the board</h1>
        <p>
          {result.buyer
            ? `${result.buyer} is listed at $${result.bidUsd}.`
            : "Payment confirmed. Return to the board to see the current rank."}
        </p>
        <p>
          <a href="/">Back to the board</a>
        </p>
      </main>
    );
  }

  return (
    <main className="return-page" data-return="pending">
      <h1>Checkout pending</h1>
      <p>
        Payment has not been confirmed. No rank changes until confirmation,
        and an incomplete or abandoned brief stays off the board.
      </p>
      <p>
        <a href="/">Back to the board</a>
      </p>
    </main>
  );
}

function firstQuery(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveReturn(params: {
  intent?: string | string[];
  sessionId?: string | string[];
  checkoutId?: string | string[];
  status?: string | string[];
}): {
  status: "paid" | "pending" | "cancel";
  buyer?: string;
  bidUsd?: number;
} {
  // `status=cancel` is presentation input only. It cannot manufacture a
  // cancellation (or a paid row) without a durable intent state.
  const reference =
    firstQuery(params.intent) ??
    firstQuery(params.sessionId) ??
    firstQuery(params.checkoutId);
  if (!reference?.trim()) return { status: "pending" };

  const intent = getCheckoutIntent(reference.trim());
  if (!intent) return { status: "pending" };
  if (intent.status === "rejected" || intent.status === "expired" || intent.status === "failed") {
    return { status: "cancel" };
  }
  if (intent.status !== "paid") return { status: "pending" };

  const listing = getListingForCheckout(reference.trim());
  if (!listing) return { status: "pending" };
  return { status: "paid", buyer: listing.buyer, bidUsd: listing.bidUsd };
}
