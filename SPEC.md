# Freelance Brief Board — Product Development Spec

**Version:** 1.0
**Status:** Ready to build
**Repo:** https://github.com/tangpingqingwa/10-freelance-brief-board
**Market:** global English
**Currency:** USD only
**Clone of:** [outbid.lol](https://outbid.lol/) pay-to-rank mechanics
**Forbidden:** invented ratings, stars, review scores, chat/invite links, NSFW, live Polar in CI

This document is the product contract. If README and SPEC disagree, SPEC wins until README is updated. If SPEC and code disagree, fix one of them in the same PR.

Implementation plan (stack, modules, PR DAG): [BUILD.md](./BUILD.md).

---

## 1. Product statement

A weekly public auction for the **#1 freelance brief** so designers, developers, and editors see the demand first. Buyers in the US and EU pay USD to be seen by global freelancers. Rank is the bid. Nothing else.

Budget, deadline, and how the winner is chosen are **public**. There are no invented ratings, no star scores, and no “top freelancer” badges.

One-line pitch: **Bid USD. Own the #1 brief this week. Freelancers see you first.**

---

## 2. Goals and non-goals

### Goals

- Public leaderboard. Anyone can read the board without an account.
- No ads, no API keys, no revenue share with listed buyers or freelancers.
- Whole-dollar USD bids. Minimum **$5**. Increments of **$1**.
- Rank = current bid. Paying less than #1 still lists at the rank that bid can take.
- Equal bids: the **older** listing keeps the higher rank.
- Same listing can raise; **raise pays difference** only.
- Listing is **buyer + budget + deadline + brief URL**.
- Budget, deadline, and how the winner is chosen are public on the card.
- **Weekly reset UTC.** Live rank is the rolling last 7 days, not Monday 00:00 UTC. Bids older than 7 days do not carry.
- **No invented ratings.** Do not scrape or display stars, review scores, “top rated”, hire rates, or freelancer reputation.
- Strip tracking and affiliate query strings from the brief URL.
- Reject chat / invite links and NSFW.
- Public click counts on the brief URL.
- Live payments via Polar (merchant of record). Tests use a Polar **fixture**.
- Pages: board, about, rules, checkout return.

### Non-goals

- A freelance marketplace, proposals inbox, escrow, or hiring workflow.
- Invented ratings, stars, review counts, “98% hire rate”, or badge scores.
- Chat, DMs, comments, or accounts-as-social-graph.
- Multi-currency. USD only in v1.
- China-city default. Global English market. Buyers are US/EU; freelancers are global.
- Editorial picks that override money. Rank is the bid.
- Ads, affiliate networks, or revenue share with Upwork / Fiverr / job boards.

### Kill / change rules

- If after 90 days nobody will bid because freelancers are not looking, freeze features. Do not invent ratings or a marketplace to “fix” an empty week.
- Polar down → checkout fails closed. Do not invent a paid #1 brief.

---

## 3. Users

| Persona | Need |
|---|---|
| Buyer (US/EU) | Put a real brief first this week so designers / devs / editors see the demand first |
| Freelancer | See honest budget, deadline, and how the winner is chosen; open the real brief URL |
| Spectator | Watch who is paying. No login. |

There is no logged-in member. Payment is the only write path.

---

## 4. The slot

Each rolling last-7-days window has one open **#1 freelance brief** slot on a single global English board.

- #1 this week is the brief freelancers see first.
- Paying less than #1 still lists on the public board, at the rank that bid can take.
- After a payment ages out of the rolling last 7 days, it is gone from the live board. Want #1 again? Pay again. Monday 00:00 UTC is **not** the drop.
- An empty week is valid. There is **no** invented brief. Do not seed fake demand.

v1 is one public board. Do not fork ranking per craft (design / dev / edit). A later craft lane must reuse the same rank function.

---

## 5. Listing schema (normative)

A listing is created only after Polar (or the fixture checkout) reports a completed payment.

A listing is **buyer + budget + deadline + brief URL**.

```ts
type Listing = {
  id: string
  weekId: string            // ISO week label in UTC, e.g. "2026-W34"; rank uses lastPaidAt, not this label
  buyer: string             // 1–80 chars, trimmed; company or person
  budgetUsd: number         // whole USD project budget, public; not a rating
  deadline: string          // ISO calendar date (YYYY-MM-DD), public
  winnerRule: string        // how the winner is chosen, 1–280 chars, public
  briefUrl: string          // https, tracking stripped
  bidUsd: number            // integer >= 5; this is rank, not the project budget
  firstPaidAt: string       // ISO instant of first successful payment (tie-break)
  lastPaidAt: string
  clicks: number            // public brief-URL clicks; never a rating
}
```

**Required to place:** `buyer`, `budgetUsd`, `deadline`, `winnerRule`, `briefUrl`, `bidUsd`.

Identity for raise: same **canonical brief URL** still inside the rolling last 7 days. Same live listing → raise. Buyer name may be edited on raise; the URL key does not change. `weekId` stays a Polar/audit label — not raise identity. A buyer who paid Sunday still raises on Monday if that listing is inside last 7 days. After the window ends, the same URL is a new ticket (full bid), not a raise.

`budgetUsd` is the buyer’s stated project budget for the freelance work. It does **not** affect rank. `bidUsd` is the pay-to-rank amount. Do not conflate them on the card.

**Forbidden on the card and in the database:**

- Stars, review scores, “top rated”, hire rates, reputation, or any invented rating.
- Tracking query strings on the outbound brief URL.
- Chat / invite URLs. NSFW copy or brief URLs.

The board may show: rank, buyer, **budget**, **deadline**, **winner rule**, **$bid**, public **clicks**, brief CTA. It may not show ratings.

---

## 6. Ranking rules (normative)

Clone of outbid.lol. Rank is the bid. Nothing else.

| Rule | Detail |
|---|---|
| Currency | USD |
| Amount | Whole dollars only. Reject cents. |
| Minimum | **$5** on a first bid for a listing in this week |
| Rank | Descending `bidUsd`. **rank = bid** |
| Below #1 | Still lists, at the rank that amount can take |
| Ties | **Older wins ties.** Compare `firstPaidAt` ascending, then listing id |
| Raise | Same canonical `briefUrl` still inside the rolling last 7 days may raise. `weekId` is not the raise key. Charge **new − current** only |
| Steal | A *different* listing that wants that rank must pay the **full** target amount, not the incumbent’s difference |
| Floor after raise | New amount must be a whole dollar ≥ current + $1 and ≥ $5 |
| Claim | A **completed payment** claims the rank. Unpaid checkout does not |
| Period | Rankings are computed only among listings whose `lastPaidAt` is in the **rolling last 7 days**. Not Monday 00:00 UTC. Not a 24h lock on #1. |

Display order: `bidUsd DESC`, then `firstPaidAt ASC` (older wins ties), then `id ASC`.

There is no recency boost, editorial override, rating score, or “quality” rank in v1. Budget and deadline are public facts; they do not sort the board.

Worked examples, same week:

1. Empty board. A bids $5 → A is #1 at $5.
2. B bids $12 → B is #1, A is #2.
3. Two $12 bids → older `firstPaidAt` stays above.
4. A raises to $15 and pays **$10** difference → A is #1, B is #2. `firstPaidAt` unchanged.
5. C tries to pay only A’s $10 difference → rejected / not a raise. C must pay a full new bid.

---

## 7. Weekly reset (normative)

| Field | Value |
|---|---|
| Period | 7 days |
| Boundary | Rolling last 7 days from `now` (`now − 7d` inclusive). **Not** Monday 00:00:00.000 UTC |
| `weekId` | ISO week label in UTC, `YYYY-Www` (e.g. `2026-W34`). Rank does not expire on this label. |
| What resets | Live rank, bids, and click counters as payments age out of the rolling window |
| What does not carry | Payments older than 7 days. Want the next #1? Pay again. |
| History | Aged-out rows may stay readable as archive. They are not the live #1 brief. |
| Empty week | Valid. No invented brief. |

The board header shows the rolling last-7-days window. Occupied prize chrome (kicker, #1 heading, later-pack) names that rolling window, not a calendar week. Occupied mast period-meta follows last-7-days, not ISO `weekId`. Empty week may still show the `weekId` label. Empty week stays Claim #1 / No paid brief.

Do not carry bids after they age out of the rolling window. Submitting a brief URL whose last payment is older than 7 days is a **new** listing and pays a full bid ≥ $5.

---

## 8. Public fields (normative)

Every live card must show, in operator language:

1. **Buyer** — who is paying to be seen.
2. **Budget** — whole-USD project budget as submitted. Never invent or “estimate” a band.
3. **Deadline** — the submitted date. Never invent one.
4. **How the winner is chosen** — the buyer’s `winnerRule` text (portfolio, first qualified, fixed price, etc.). The site does not score or verify this.
5. **$bid** and public **clicks**.

Missing budget or deadline is a validation error, not a blank “competitive / ASAP” filler.

---

## 9. URL hygiene

On create and raise, normalize `briefUrl`:

1. Require `https:` (http → reject `url_insecure`).
2. Strip tracking / affiliate query keys: `utm_*`, `fbclid`, `gclid`, `gbraid`, `wbraid`, `msclkid`, `ref`, `ref_`, `affiliate`, `aff`, `irclickid`, `mc_cid`, `mc_eid`, `icid`, `si`, `igshid`.
3. Strip fragments.
4. Reject chat / invite hosts (telegram, t.me, wa.me, chat.whatsapp, discord.gg, discord.com/invite, m.me, signal.me).
5. Reject obvious NSFW path tokens and adult hosts (document the list in code; keep it boring).
6. Reject `javascript:`, `data:`, credentials-in-URL, and localhost / link-local hosts.
7. Known shorteners (`bit.ly`, `t.co`, `tinyurl.com`, `lnkd.in`) are not stored. Resolve one hop in live or reject.

Store and display only the stripped URL. Public clicks count on that stored URL.

---

## 10. Payments

`PaymentPort`:

```ts
createCheckout(input: {
  listingDraft: ListingDraft
  amountUsd: number          // full first bid, or raise difference
  kind: "create" | "raise"
}): Promise<{ checkoutUrl: string; sessionId: string }>

handleWebhook(rawBody: string, headers: Record<string, string>): Promise<PaidEvent>
```

| Mode | When | Behavior |
|---|---|---|
| Fixture | tests, `POLAR_FIXTURE_ONLY=1`, or Polar unset | In-memory / signed fixture session. No network |
| Live Polar | `POLAR_LIVE=1` + Polar secrets | Polar checkout + webhook. Merchant of record |

`POLAR_FIXTURE_ONLY=1` always wins. Unset / `0` / `true` stay fixture or fail-closed. CI must not set `POLAR_LIVE=1`.

Rank updates **only** after a successful paid event. Abandoned checkout does not create or raise a listing. Do not invent a paid #1 brief.

---

## 11. Pages

```
GET  /                         public board for the rolling last-7-days window + bid form
POST /checkout                 { buyer, budgetUsd, deadline, winnerRule, briefUrl, amountUsd }
                               → PaymentPort.createCheckout (create or raise)
GET  /return                   checkout return; show paid / pending, never trust query alone
GET  /click/:id                302 briefUrl; increment public clicks
GET  /about                    what this is; rank is money; no invented ratings
GET  /rules                    min $5, ties, raise = difference, rolling last 7 days, no NSFW, no ratings
GET  /healthz                  { ok: true }
```

Board UI (clone outbid.lol, not a redesign):

- Fields: buyer, budget, deadline, how the winner is chosen, brief URL, whole-dollar amount, one **Outbid** button.
- Ranked cards: rank, buyer, budget, deadline, winner rule, **$amount**, public **clicks**, open-brief control.
- No star widgets. No review scores. No invented ratings.

---

## 12. Errors

| Code | HTTP | When |
|---|---|---|
| `bid_not_whole` | 400 | cents or non-integer bid |
| `bid_below_min` | 400 | first bid &lt; $5 |
| `bid_not_higher` | 400 | raise ≤ current |
| `budget_not_whole` | 400 | project budget not a whole USD amount |
| `deadline_invalid` | 400 | missing or unparseable deadline |
| `url_insecure` | 400 | not https |
| `url_forbidden` | 400 | chat / NSFW / shortener / unusable host |
| `week_closed` | 400 | bid outside the rolling last-7-days window |
| `rating_forbidden` | 400 | submit tried to attach stars / review / hire-rate |
| `payment_incomplete` | 402 | checkout abandoned; board unchanged |
| `polar_unavailable` | 503 | live Polar down; fixture never invents a paid event |

Zero invented listings on any error. Zero invented ratings.

---

## 13. Acceptance

| # | Case | Expected |
|---|---|---|
| 1 | Empty week | 200, zero cards, bid form visible, no invented brief, no invented rating |
| 2 | First bid $5 fixture | listing appears; rank 1; `$5`; clicks 0; buyer + budget + deadline + brief URL shown |
| 3 | Second listing $8 | new listing #1; $5 listing #2 |
| 4 | Two $8 bids | older listing stays above |
| 5 | #2 raises to $12 | pays **$7** difference; becomes #1; `firstPaidAt` unchanged |
| 6 | Tracking query on brief URL | stored URL has tracking stripped |
| 7 | Chat invite URL | `url_forbidden`; no listing |
| 8 | NSFW brief URL | `url_forbidden`; no listing |
| 9 | Click brief CTA | 302 to stripped URL; public clicks +1 |
| 10 | Rating field / star copy | `rating_forbidden` or not rendered; no invented ratings |
| 11 | After a payment ages past 7 days | board drops that rank; Monday 00:00 UTC does not drop a bid still inside the window |
| 12 | `POLAR_LIVE` unset | fixture / fail-closed; no Polar network |

---

## 14. Live-smoke flows

Operator-only. `scripts/live-smoke.sh` is **not** called from `scripts/test.sh` or Actions.

Local process, `POLAR_LIVE=1` if Polar secrets exist, else record `BLOCKED-SECRET` for checkout only. Board, rules, about, and click still run.

| Flow | Pass |
|---|---|
| Board | 200, rolling last-7-days window, listing shape buyer + budget + deadline + brief URL, no invented ratings |
| About / rules | 200, state min $5, older wins ties, raise pays difference, rolling last 7 days (not Monday 00:00 UTC), no invented ratings |
| Create checkout | Polar session for a real https brief URL **or** `BLOCKED-SECRET` (`POLAR_ACCESS_TOKEN`) |
| Click | 302, click count increments (fixture listing allowed if live pay is blocked) |
| Honesty | no stars, no review scores, no invented #1 brief |

Missing Polar secret is not a license to invent a paid #1 brief.

---

## 15. Layout

```
/
  SPEC.md
  BUILD.md
  README.md
  CONTRIBUTING.md
  scripts/test.sh
  .github/workflows/ci.yml
```

Application tree is defined in [BUILD.md](./BUILD.md). This unit does not add app code.

---

## 16. Git collaboration (normative)

Development is GitHub trunk-based. **`main` is always cloneable, buildable, and testable.**

| Rule | Requirement |
|---|---|
| Integration branch | `main` only. No long-lived `develop`. |
| How code lands | Pull request into `main`. No direct push. |
| Required check | GitHub Actions workflow `ci` (job id `ci`) must be green. |
| Local / CI test | `bash scripts/test.sh` — offline, no production secrets. |
| Branch names | `feat/` `fix/` `docs/` `chore/` `test/` + short slug. |
| Merge | Squash. Delete the head branch. |
| Broken `main` | Treat as an incident. Fix on `fix/…` via PR. |

Full process: [CONTRIBUTING.md](./CONTRIBUTING.md).

Until there is an application binary, `scripts/test.sh` still has to pass: contract files exist, SPEC/CONTRIBUTING agree, no tracked secrets. Adding a server means **extending** that script with unit/contract tests. Live Polar calls are optional and must not be required for `main` to stay green.
