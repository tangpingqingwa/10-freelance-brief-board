import React from "react";
import { getBoardListings, rankListings } from "../core/rank";
import { currentWeekUtc } from "../core/week";
import { Board } from "./board";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const week = currentWeekUtc();
  const listings = rankListings(getBoardListings(week.weekId));
  return <Board week={week} listings={listings} />;
}
