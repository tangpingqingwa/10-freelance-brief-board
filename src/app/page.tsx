import React from "react";
import { listUnpaid } from "../core/listings";
import { getBoardListings, rankListings } from "../core/rank";
import { currentWeekUtc } from "../core/week";
import { Board } from "./board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function HomePage() {
  const now = new Date();
  const week = currentWeekUtc(now);
  const listings = rankListings(getBoardListings(now), now);
  const unpaid = listUnpaid();
  return <Board week={week} listings={listings} unpaid={unpaid} />;
}
