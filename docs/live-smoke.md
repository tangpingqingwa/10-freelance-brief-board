# Live smoke — Freelance Brief Board

Operator-only. `bash scripts/live-smoke.sh` is **not** called from `scripts/test.sh` or GitHub Actions. CI and `scripts/test.sh` stay offline and must not set `POLAR_LIVE`.

`100%` for this unit means a **local process** walked every SPEC §14 flow. Fixture checkout is allowed for the click hop. Live Polar runs only when `POLAR_LIVE=1` and `POLAR_ACCESS_TOKEN` exists. Sandbox operator smoke must set `POLAR_API_BASE=https://sandbox-api.polar.sh` so checkout is a real `sandbox.polar.sh` URL, not a fixture `/return` listing. Missing Polar secret is `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` — that is not a fixture success and not a paid #1 brief. Do not invent ratings. An empty week is valid.

## How to run

```bash
bash scripts/live-smoke.sh
```

The script:

1. Refuses `CI=true` and `GITHUB_ACTIONS=true`.
2. Starts a local process that serves the same App Router handlers (`/`, `/about`, `/rules`, `/api/checkout`, `/api/polar/webhook`, `/click/:id`, `/healthz`) on a free loopback port with Polar env unset and `POLAR_FIXTURE_ONLY=1`. (`next dev` cannot compile the client bid form because webpack does not load `node:crypto` from `listings.ts`.)
3. Or attaches to `LIVE_SMOKE_BASE` if that server already answers `GET /healthz`.
4. Walks board, `/about`, `/rules`, checkout (live Polar or `BLOCKED-SECRET`), click, honesty.
5. Live Polar: if `POLAR_LIVE` is not `1` or `POLAR_ACCESS_TOKEN` is empty, prints `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` for checkout only. Board, rules, about, and click still run. A live PASS requires a real `https://sandbox.polar.sh/…` Checkout URL.
6. Kills the process it started and deletes the temp workdir.

Overrides: `LIVE_SMOKE_BASE`, `LIVE_SMOKE_PORT`.

Live Polar sandbox (operator machine; source `~/.polar/sandbox.env`, never commit it):

```bash
set -a
# shellcheck disable=SC1091
source "$HOME/.polar/sandbox.env"
set +a
unset POLAR_FIXTURE_ONLY
export POLAR_LIVE=1
export POLAR_API_BASE=https://sandbox-api.polar.sh
bash scripts/live-smoke.sh
```

Sandbox tokens return `401` on `https://api.polar.sh`. The live client defaults to production and honors `POLAR_API_BASE`. A PASS checkout URL must be a real `https://sandbox.polar.sh/…` Checkout, not a fixture `/return` listing. Missing `POLAR_ACCESS_TOKEN` stays `BLOCKED-SECRET`. Do not set `POLAR_LIVE` in `scripts/test.sh` or Actions.

## Verdicts

| Label | Meaning |
|---|---|
| `PASS` | Flow completed as SPEC requires. |
| `PASS-ERROR` | Documented product error; nothing invented. |
| `BLOCKED-SECRET` | Live Polar secret missing. Exact env var named. |
| `FAIL` | Broken product or invented listing / rating. |

## This session

Ran `bash scripts/test.sh` (offline, Polar env unset, `POLAR_FIXTURE_ONLY=1`) then `bash scripts/live-smoke.sh` on **2026-08-23** from `feat/live-polar-sandbox-smoke` (parent `b8dcadc` / `origin/main`). Offline `scripts/test.sh` exited 0 (`tsc --noEmit`, 54 `tsx --test`). Operator sourced `/Users/yann/.polar/sandbox.env` (mode 600; token length 53, webhook length 49, product id length 36 — values never printed or committed). `POLAR_LIVE=1`. `POLAR_FIXTURE_ONLY` unset. `POLAR_API_BASE=https://sandbox-api.polar.sh`. Sandbox token against production `https://api.polar.sh` is `401`. Script started a fixture process on `http://127.0.0.1:58743` for board/click, then a second live-flagged process for checkout. Week `2026-W34` UTC. No invented paid rank: empty board first, then one fixture-paid `brief.example/smoke-*` URL unique to this run after the paid webhook. Live checkout was a real `sandbox.polar.sh` Checkout URL, unpaid session not listed. Not a fixture `/return` listing.

| Flow | Result | Note |
|---|---|---|
| Board | **PASS** | `GET /` 200 week `2026-W34`. Empty board + buyer / budget / deadline / brief URL form. No invented ratings. |
| About / rules | **PASS** | `GET /about` and `GET /rules` 200. Min $5, older wins ties, raise pays difference, Monday 00:00:00.000 UTC, no invented ratings. |
| Create checkout | **PASS** | Live Polar sandbox Checkout URL (`https://sandbox.polar.sh/…`). Not a fixture `/return` listing. Unpaid session not listed. |
| Click | **PASS** | Fixture listing allowed. `GET /click/lst_55437fb9-b1f0-4a71-8f3e-54966ae83a45` 302 to stripped `https://brief.example/smoke-…`. Clicks `0→1`. Tracking query not stored. |
| Honesty | **PASS** | No stars, no review scores, no invented #1 brief on the empty week. |
| Honesty rating field | **PASS-ERROR** | `POST /api/checkout` with `rating=4.8` → 400 `rating_forbidden`. No listing. |

Process exit 0 (`PASS=5` `PASS-ERROR=1` `BLOCKED-SECRET=0` `FAIL=0`). Missing Polar secret would still be `BLOCKED-SECRET`, never an invented paid rank.

## What this does not do

- Does not call `scripts/live-smoke.sh` from `scripts/test.sh` or Actions.
- Does not set `POLAR_LIVE=1` in CI.
- Does not seed a fake paid #1 brief or invented ratings.
- Does not treat a missing Polar secret as a paid listing.
- Does not send the sandbox token to production `https://api.polar.sh`.
