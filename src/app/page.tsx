import React from "react";
import { getBoardListings, rankListings } from "../core/rank";
import { currentWeekUtc } from "../core/week";
import { Board } from "./board";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const now = new Date();
  const week = currentWeekUtc(now);
  const listings = rankListings(getBoardListings(now), now);
  return <Board week={week} listings={listings} />;
}
