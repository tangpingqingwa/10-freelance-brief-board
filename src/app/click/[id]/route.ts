import { NextResponse } from "next/server";
import { incrementListingClicks } from "../../../core/listings";

export const CLICK_PATH = "/click" as const;

type ClickContext = {
  params: Promise<{ id: string }> | { id: string };
};

/** Public brief-URL hop. Clicks are not a rating. */
export async function GET(
  _request: Request,
  context: ClickContext,
): Promise<Response> {
  const params = await Promise.resolve(context.params);
  const id = params.id?.trim() ?? "";
  const listing = incrementListingClicks(id);
  if (!listing) {
    return NextResponse.json({ error: "listing_not_found" }, { status: 404 });
  }
  const response = NextResponse.redirect(listing.briefUrl, 302);
  response.headers.set("cache-control", "private, no-store");
  return response;
}
