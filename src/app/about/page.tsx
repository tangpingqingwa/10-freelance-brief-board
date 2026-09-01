import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "About · Freelance Brief Board",
  description:
    "Public auction for the last 7 days’ #1 freelance brief. Rank is the bid. No invented ratings.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <main className="doc-page" data-page="about">
      <h1>About</h1>
      <p>
        Freelance Brief Board is a public auction for the{" "}
        <strong>last 7 days’ #1 freelance brief</strong> so designers,
        developers, and editors see the demand first. Buyers in the US and EU
        pay whole US dollars. Freelancers anywhere can read the board. Rank
        lives in a <strong>rolling last 7 days</strong> window, not Monday
        00:00 UTC.
      </p>
      <p>
        <strong>Rank is the bid.</strong> Rank is money. Nothing else. Paying
        less than #1 still lists at the rank that bid can take. Equal bids: the
        older listing keeps the higher rank.
      </p>
      <p>
        A listing is <strong>buyer + budget + deadline + brief URL</strong>.
        Budget, deadline, and how the winner is chosen are public facts. They
        never sort the board.
      </p>
      <p>
        There are <strong>no invented ratings</strong>. We do not scrape or
        display stars, review scores, “top freelancer” badges, hire rates, or
        reputation. Public <strong>clicks</strong> on the brief URL are the only
        counter. Clicks are not a rating.
      </p>
      <p>
        The board is in <strong>English</strong>, bids use{" "}
        <strong>USD</strong>, and freelancers can browse briefs from anywhere.
      </p>
      <p>
        Anyone can read the board without an account. A brief appears only
        after payment is confirmed. A canceled or abandoned checkout never
        creates a #1 brief.
      </p>
      <p>
        <a href="/rules">Read the rules</a> for the $5 minimum, older-wins ties,
        raise-pays-difference, rolling last 7 days, and banned chat
        / NSFW URLs.
      </p>
    </main>
  );
}
