import { NextResponse } from "next/server";

/**
 * Retained only as a migration guard. This legacy path is not a provider
 * selector and can never settle a listing.
 */
export function POST(_request: Request): Response {
  return NextResponse.json(
    { error: "webhook_path_moved", canonical: "/api/waffo/webhook" },
    { status: 410 },
  );
}
