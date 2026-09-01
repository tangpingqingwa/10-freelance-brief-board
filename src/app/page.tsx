import type { Metadata } from "next";
import React from "react";
import { listUnpaid } from "../core/listings";
import { getBoardListings, rankListings } from "../core/rank";
import { currentWeekUtc } from "../core/week";
import { Board } from "./board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function HomePage() {
  const now = new Date();
  const week = currentWeekUtc(now);
  const listings = rankListings(getBoardListings(now), now);
  const unpaid = listUnpaid();
  return <Board week={week} listings={listings} unpaid={unpaid} />;
}
