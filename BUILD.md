# Freelance Brief Board — Detailed Specification and Build Plan

**Contract:** [SPEC.md](./SPEC.md) wins on ranking, rolling last-7-days week window, listing shape, ratings honesty, and errors.
**This file** wins on stack, module boundaries, test layout, and the PR sequence.
**Git:** [CONTRIBUTING.md](./CONTRIBUTING.md). Every `### PR N:` row is one squash-merged PR. `main` stays green.

Pay-to-rank clone of outbid.lol. Public auction for the last 7 days’ #1 freelance brief so designers, developers, and editors see the demand first. Buyers (US/EU) pay USD. Budget, deadline, and how the winner is chosen are public. No invented ratings.

---

## 1. Stack

| Layer | Choice |
|---|---|
| Runtime | Node 22, TypeScript `strict` |
| App | Next.js App Router (outbid-like public board) + Route Handlers |
| DB | SQLite via `better-sqlite3` (weeks, listings, payments, clicks) |
| Payments | `PaymentPort`. Adapter `fixture` in tests; live Polar when `POLAR_LIVE=1` |
| Tests | `node:test` + `tsx` + fixture Polar. No live Polar in CI |
| Process | `next dev` locally; `next start` in prod. `/healthz` on the same process |

**Out of stack:** Prisma, Redis, Kubernetes, a ratings engine, a marketplace inbox, a second ranking algorithm.

---

## 2. Ranking and week

```
weeks (id pk, starts_at, ends_at)          -- rolling last 7 days; weekId is a label
listings (id, week_id, brief_key, buyer, budget_usd, deadline, winner_rule,
          brief_url, bid_usd, first_paid_at, clicks)
payments (id, listing_id, polar_session, amount_usd, kind create|raise)
```

Board query (rolling last 7 days only):

```
WHERE last_paid_at >= now - 7 days AND last_paid_at <= now
ORDER BY bid_usd DESC, first_paid_at ASC, id ASC
```

Rank does not filter by Monday 00:00 UTC `weekId`. Adding a craft lane later must not touch this `ORDER BY`.

Identity key for raise: canonical `briefUrl` still inside the rolling last-7-days window. Raise identity is the same canonical brief URL still inside that window — not `weekId`.

`budget_usd` and `deadline` are stored and shown. They never appear in `ORDER BY`.

---

## 3. Target tree

```
/
  SPEC.md
  BUILD.md
  README.md
  CONTRIBUTING.md
  package.json                 # PR 1
  scripts/test.sh
  scripts/live-smoke.sh        # live-smoke PR
  docs/live-smoke.md
  src/
    app/
      page.tsx                 # public board
      about/page.tsx
      rules/page.tsx
      return/page.tsx
      api/checkout/route.ts
      api/polar/webhook/route.ts
      click/[id]/route.ts
      healthz/route.ts
    core/
      rank.ts                  # ORDER BY contract
      week.ts                  # rolling last-7-days window; weekId label
      listing.ts               # buyer + budget + deadline + brief URL
      url.ts                   # strip tracking, reject chat/NSFW
      honesty.ts               # reject invented ratings / stars
    billing/
      port.ts
      fixture.ts
      polar.ts                 # live, env-gated
    db.ts
    config.ts
  tests/
    rank.test.ts
    week.test.ts
    listing.test.ts
    checkout.test.ts
    click.test.ts
    honesty.test.ts
    fixtures/
  .github/workflows/ci.yml
```

HTTP / pages call `core/*` only. They do not import `billing/polar.ts` directly.

No application `src/` in this docs PR.

---

## 4. Tests (offline)

| Test | Assert |
|---|---|
| week | rolling last-7-days window; Monday 00:00 UTC does not drop a bid still inside 7 days |
| rank | higher bid above; **older wins ties**; below-#1 still lists |
| raise | $5 → $12 charges **$7**; other listing cannot steal by paying $7; same brief still in last 7 days raises after `weekId` rolls |
| listing | buyer + budget + deadline + brief URL required; rating field rejected |
| url | `utm_source` stripped; telegram invite → `url_forbidden` |
| honesty | board HTML has no stars / review scores; `rating_forbidden` on submit |
| polar fixture | unpaid checkout does not list; paid fixture event lists |
| clicks | GET click route 302 + increments public brief-URL clicks |
| live gate | unset / `0` / `true` stay fixture; `POLAR_FIXTURE_ONLY=1` wins |

`scripts/test.sh` stays offline. Once `package.json` exists it runs `tsc --noEmit` and `node:test`. It must never call `scripts/live-smoke.sh`.

---

## 5. PR plan

Each heading below is one PR. Dependencies are hard. Do not start the next PR in the same branch.

### PR 1: skeleton / CI
- **Description:** package.json, tsconfig, Next healthz, extend `scripts/test.sh` to typecheck + run tests once src exists. CI job stays named `ci`.
- **Files:** `package.json`, `tsconfig.json`, `src/app/healthz/route.ts`, `scripts/test.sh`, `.gitignore`
- **Dependencies:** None
- **Acceptance:** `GET /healthz` → `{ ok: true }`. `bash scripts/test.sh` green offline.

### PR 2: board UI like outbid.lol
- **Description:** Public board: buyer, budget, deadline, winner rule, brief URL, whole-dollar amount, Outbid button, ranked cards with **$** and **clicks**. Honest empty week. No invented ratings.
- **Files:** `src/app/page.tsx`, `src/core/week.ts`, `src/core/rank.ts`, board styles, `tests/rank.test.ts`
- **Dependencies:** PR 1
- **Acceptance:** Empty week renders the form and no #1 brief. Cards show money not ratings. Sort matches SPEC. Listing shape is buyer + budget + deadline + brief URL.

### PR 3: checkout
- **Description:** `PaymentPort.createCheckout`. Fixture adapter for tests. Live Polar behind `POLAR_LIVE=1`. Rank changes only on paid webhook / fixture event. Min $5. Underbid still lists.
- **Files:** `src/billing/port.ts`, `src/billing/fixture.ts`, `src/billing/polar.ts`, `src/app/api/checkout/route.ts`, `src/app/api/polar/webhook/route.ts`, `src/app/return/page.tsx`, `tests/checkout.test.ts`
- **Dependencies:** PR 2
- **Acceptance:** $5 fixture create lists at #1. Abandoned checkout does not. CI does not set `POLAR_LIVE`.

### PR 4: raise-bid
- **Description:** Same canonical brief URL still inside last 7 days raises; `weekId` is not the raise key. Different listing pays full amount. `firstPaidAt` unchanged.
- **Files:** `src/core/listing.ts`, checkout raise path, `tests/checkout.test.ts`
- **Dependencies:** PR 3
- **Acceptance:** SPEC acceptance 5. `bid_not_higher` when raise ≤ current.

### PR 5: rules / about
- **Description:** `/about`, `/rules`. Strip tracking. Reject chat/NSFW. Reject invented ratings. Public click route on the brief URL.
- **Files:** `src/app/about/page.tsx`, `src/app/rules/page.tsx`, `src/core/url.ts`, `src/core/honesty.ts`, `src/app/click/[id]/route.ts`, `tests/listing.test.ts`, `tests/click.test.ts`, `tests/honesty.test.ts`
- **Dependencies:** PR 2
- **Acceptance:** Rules page states min $5, older wins ties, raise pays difference, weekly UTC reset, no invented ratings. Tracking keys stripped. Click 302s the brief URL.

### PR 6: live-smoke
- **Description:** Operator script walks board, about/rules, checkout (live Polar or `BLOCKED-SECRET`), click, honesty. Not in CI.
- **Files:** `scripts/live-smoke.sh`, `docs/live-smoke.md`, `tests/live-smoke.test.ts` (offline guards only)
- **Dependencies:** PR 3, PR 5
- **Acceptance:** Script is executable. `scripts/test.sh` and `.github/workflows/ci.yml` do not invoke it. Docs record PASS / PASS-ERROR / BLOCKED-SECRET. No invented paid rank. No invented ratings.

---

## 6. Env

| Var | Role |
|---|---|
| `POLAR_LIVE` | `1` selects live Polar. Unset / `0` / `true` stay fixture or fail-closed |
| `POLAR_FIXTURE_ONLY` | `1` always wins |
| `POLAR_ACCESS_TOKEN` | Live Polar. Missing → live-smoke `BLOCKED-SECRET` |
| `POLAR_WEBHOOK_SECRET` | Live webhook verify |
| `POLAR_API_BASE` | Optional. Default `https://api.polar.sh`. Sandbox smoke uses `https://sandbox-api.polar.sh`. Never set in `scripts/test.sh` or Actions. |
| `POLAR_PRODUCT_ID` | Optional Polar product. Sandbox Checkout typically requires it. |
| `DATABASE_PATH` | SQLite file; default `./data/freelance-brief-board.sqlite` |

Dockerfile / runbook may land with a later deploy PR. Image must not set `POLAR_LIVE=1`.

---

## 7. Rollback

Any PR that makes `scripts/test.sh` red is reverted with `fix/` via PR. Do not force-push `main`.
