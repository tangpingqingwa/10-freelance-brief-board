import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Rules · Freelance Brief Board",
  description:
    "Min $5. Older wins ties. Raise pays the difference. Rolling last 7 days, not Monday 00:00 UTC. No invented ratings.",
  alternates: { canonical: "/rules" },
};

export default function RulesPage() {
  return (
    <main className="doc-page" data-page="rules">
      <h1>Rules</h1>
      <p>
        The board follows the published rules below. There are no hidden
        ranking factors: rank is the bid, and ratings never affect position.
      </p>

      <h2>Ranking</h2>
      <table>
        <tbody>
          <tr>
            <th>Rank is the bid</th>
            <td>
              Briefs are ordered by bid from highest to lowest. Recency,
              editorial preference, and quality scores do not affect rank.
            </td>
          </tr>
          <tr>
            <th>Whole dollars</th>
            <td>USD only. Integers. No cents. Step is $1.</td>
          </tr>
          <tr>
            <th>Minimum</th>
            <td>
              First bid for a listing in the rolling last 7 days must be{" "}
              <strong>$5</strong>.
            </td>
          </tr>
          <tr>
            <th>Below #1 still lists</th>
            <td>
              Paying less than #1 still appears at the rank that bid can take.
              Those briefs are not the #1 brief.
            </td>
          </tr>
          <tr>
            <th>Equal bids</th>
            <td>The brief placed first keeps the higher rank.</td>
          </tr>
          <tr>
            <th>Raise</th>
            <td>
              The same cleaned brief link may raise while its placement is
              active. The original payer is charged only the{" "}
              <strong>difference</strong>, and the new total must be at least
              $1 higher.
            </td>
          </tr>
          <tr>
            <th>Cannot steal the difference</th>
            <td>
              A different listing that wants that rank must pay the{" "}
              <strong>full</strong> target amount, not the incumbent’s
              difference.
            </td>
          </tr>
          <tr>
            <th>Payment claims rank</th>
            <td>
              Rank changes only after payment is confirmed. An incomplete or
              abandoned checkout never appears on the board.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Rolling last 7 days</h2>
      <table>
        <tbody>
          <tr>
            <th>Period</th>
            <td>
              Rolling last 7 days. Live rank is paid bids still inside that
              window. Not a 24h lock on #1.
            </td>
          </tr>
          <tr>
            <th>Boundary</th>
            <td>
              Each placement keeps its own seven-day window. The board does not
              reset for everyone at Monday midnight.
            </td>
          </tr>
          <tr>
            <th>What resets</th>
            <td>
              Live rank, bids, and click counters as payments age out of the
              rolling window.
            </td>
          </tr>
          <tr>
            <th>What does not carry</th>
            <td>
              Payments older than 7 days. Want #1 again? Pay again. Unpaid
              checkout stays off the board.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        If nobody has paid for an active placement, the board has no #1 brief.
      </p>

      <h2>No invented ratings</h2>
      <p>
        We never display stars, review scores, hire rates, reputation, or “top
        freelancer” badges. Public <strong>clicks</strong> on the brief link are
        the only counter. Clicks are not a rating.
      </p>

      <h2>Brief URL hygiene</h2>
      <ol>
        <li>Use a secure, public brief link.</li>
        <li>Tracking, referral, and affiliate parameters are removed.</li>
        <li>Strip fragments. Store and click only the stripped URL.</li>
        <li>
          Reject chat / invite hosts: Telegram, <code>t.me</code>,{" "}
          <code>wa.me</code>, chat.whatsapp, <code>discord.gg</code>, Discord
          invite, <code>m.me</code>, <code>signal.me</code>.
        </li>
        <li>
          Adult content and private, local-only, credentialed, or otherwise
          unsafe destinations are rejected.
        </li>
        <li>
          Known shorteners (<code>bit.ly</code>, <code>t.co</code>,{" "}
          <code>tinyurl.com</code>, <code>lnkd.in</code>) are not stored.
        </li>
      </ol>
      <p>
        Rejected links never create a listing or start a charge.
      </p>
    </main>
  );
}
