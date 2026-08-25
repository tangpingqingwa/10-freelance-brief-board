import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Rules · Freelance Brief Board",
  description:
    "Min $5. Older wins ties. Raise pays the difference. Rolling last 7 days, not Monday 00:00 UTC. No invented ratings.",
};

export default function RulesPage() {
  return (
    <main className="doc-page" data-page="rules">
      <h1>Rules</h1>
      <p>
        These rules are the product. A bidder can predict rank from this page
        alone. Rank is the bid. There are no invented ratings.
      </p>

      <h2>Ranking</h2>
      <table>
        <tbody>
          <tr>
            <th>Rank is the bid</th>
            <td>
              Sort by <code>bidUsd</code> descending. Nothing else — no recency
              boost, no editorial pick, no quality score.
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
            <td>
              <strong>Older wins ties.</strong> Compare{" "}
              <code>firstPaidAt</code> ascending, then listing id.
            </td>
          </tr>
          <tr>
            <th>Raise</th>
            <td>
              Same canonical brief URL still inside last 7 days raises.{" "}
              <code>weekId</code> stays an audit label — not raise identity.{" "}
              <strong>Raise pays difference</strong> only (
              <code>new − current</code>). New amount must be a whole dollar ≥
              current + $1.
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
              A completed payment claims the rank. Unpaid checkout does not. We
              do not invent a paid #1 brief.
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
              <code>now − 7d</code> inclusive through <code>now</code>.{" "}
              <strong>Not Monday 00:00:00.000 UTC</strong>. A buyer outside
              that civil midnight does not lose the ticket on a timezone tax.
            </td>
          </tr>
          <tr>
            <th>
              <code>weekId</code>
            </th>
            <td>
              ISO week in UTC, <code>YYYY-Www</code> (e.g. <code>2026-W34</code>
              ). Label only. Rank expires from <code>lastPaidAt</code>, not
              Monday midnight.
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
        An empty week is valid. There is no #1 brief until someone pays. Do not
        invent a brief.
      </p>

      <h2>No invented ratings</h2>
      <p>
        We never display stars, review scores, hire rates, reputation, or “top
        freelancer” badges. Submitting those fields is{" "}
        <code>rating_forbidden</code>. Public <strong>clicks</strong> on{" "}
        <code>GET /click/:id</code> are the only counter. Clicks are not a
        rating.
      </p>

      <h2>Brief URL hygiene</h2>
      <ol>
        <li>
          Require <code>https:</code>. <code>http:</code> is{" "}
          <code>url_insecure</code>.
        </li>
        <li>
          Strip tracking and affiliate query keys: <code>utm_*</code>,{" "}
          <code>fbclid</code>, <code>gclid</code>, <code>gbraid</code>,{" "}
          <code>wbraid</code>, <code>msclkid</code>, <code>ref</code>,{" "}
          <code>ref_</code>, <code>affiliate</code>, <code>aff</code>,{" "}
          <code>irclickid</code>, <code>mc_cid</code>, <code>mc_eid</code>,{" "}
          <code>icid</code>, <code>si</code>, <code>igshid</code>.
        </li>
        <li>Strip fragments. Store and click only the stripped URL.</li>
        <li>
          Reject chat / invite hosts: Telegram, <code>t.me</code>,{" "}
          <code>wa.me</code>, chat.whatsapp, <code>discord.gg</code>, Discord
          invite, <code>m.me</code>, <code>signal.me</code>.
        </li>
        <li>
          Reject <strong>NSFW</strong> path tokens and adult hosts. Reject{" "}
          <code>javascript:</code>, <code>data:</code>, credentials-in-URL, and
          localhost / link-local hosts.
        </li>
        <li>
          Known shorteners (<code>bit.ly</code>, <code>t.co</code>,{" "}
          <code>tinyurl.com</code>, <code>lnkd.in</code>) are not stored.
        </li>
      </ol>
      <p>
        Chat / invite and NSFW fail as <code>url_forbidden</code>. No listing.
        No charge.
      </p>
    </main>
  );
}
