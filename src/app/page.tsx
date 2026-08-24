import React from "react";
import { listUnpaid } from "../core/listings";
import { getBoardListings, rankListings } from "../core/rank";
import { currentWeekUtc } from "../core/week";
import { Board } from "./board";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const week = currentWeekUtc();
  const listings = rankListings(getBoardListings(week.weekId));
  const unpaid = listUnpaid(week.weekId);
  return <Board week={week} listings={listings} unpaid={unpaid} />;
}
