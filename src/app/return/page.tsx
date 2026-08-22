import React from "react";
import { getPaymentPort } from "../../billing/select";
import { listPaid } from "../../core/listings";

export const dynamic = "force-dynamic";

type ReturnPageProps = {
  searchParams?: Promise<{
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
            : "Payment completed. Rank updates only after paid."}
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
        Payment is not complete. Rank updates only after a paid webhook or
        fixture event. This page does not trust the query string alone.
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
  sessionId?: string | string[];
  checkoutId?: string | string[];
  status?: string | string[];
}): {
  status: "paid" | "pending" | "cancel";
  buyer?: string;
  bidUsd?: number;
} {
  const sessionId = firstQuery(params.sessionId) ?? firstQuery(params.checkoutId);
  const rawStatus = firstQuery(params.status);
  const canceled = rawStatus === "cancel" || rawStatus === "canceled";

  if (canceled) {
    return { status: "cancel" };
  }
  if (!sessionId) {
    return { status: "pending" };
  }

  const session = getPaymentPort().getSession(sessionId);
  if (!session) {
    return { status: "pending" };
  }
  if (session.status === "expired") {
    return { status: "cancel" };
  }
  if (session.status !== "complete") {
    return { status: "pending" };
  }

  const listing = listPaid(session.listingDraft.weekId).find(
    (row) => row.briefUrl === session.listingDraft.briefUrl,
  );
  if (!listing) {
    return { status: "pending" };
  }
  return { status: "paid", buyer: listing.buyer, bidUsd: listing.bidUsd };
}
