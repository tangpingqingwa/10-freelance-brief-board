# Live smoke — Freelance Brief Board

Operator-only. `bash scripts/live-smoke.sh` is **not** called from `scripts/test.sh` or GitHub Actions. CI and `scripts/test.sh` stay offline and must not set `POLAR_LIVE`.

`100%` for this unit means a **local process** walked every SPEC §14 flow. Fixture checkout is allowed for the click hop. Live Polar runs only when `POLAR_LIVE=1` and `POLAR_ACCESS_TOKEN` exists. Missing Polar secret is `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` — that is not a fixture success and not a paid #1 brief. Do not invent ratings. An empty week is valid.

## How to run

```bash
bash scripts/live-smoke.sh
```

The script:

1. Refuses `CI=true` and `GITHUB_ACTIONS=true`.
2. Starts a local process that serves the same App Router handlers (`/`, `/about`, `/rules`, `/api/checkout`, `/api/polar/webhook`, `/click/:id`, `/healthz`) on a free loopback port with Polar env unset and `POLAR_FIXTURE_ONLY=1`. (`next dev` cannot compile the client bid form because webpack does not load `node:crypto` from `listings.ts`.)
3. Or attaches to `LIVE_SMOKE_BASE` if that server already answers `GET /healthz`.
4. Walks board, `/about`, `/rules`, checkout (live Polar or `BLOCKED-SECRET`), click, honesty.
5. Live Polar: if `POLAR_LIVE` is not `1` or `POLAR_ACCESS_TOKEN` is empty, prints `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` for checkout only. Board, rules, about, and click still run.
6. Kills the process it started and deletes the temp workdir.

Overrides: `LIVE_SMOKE_BASE`, `LIVE_SMOKE_PORT`.

Live Polar (operator machine with a real token):

```bash
POLAR_LIVE=1 POLAR_ACCESS_TOKEN=… bash scripts/live-smoke.sh
```

## Verdicts

| Label | Meaning |
|---|---|
| `PASS` | Flow completed as SPEC requires. |
| `PASS-ERROR` | Documented product error; nothing invented. |
| `BLOCKED-SECRET` | Live Polar secret missing. Exact env var named. |
| `FAIL` | Broken product or invented listing / rating. |

## This session

Ran `bash scripts/live-smoke.sh` on **2026-08-22** from `feat/live-smoke` (parent `fd78e23`, about/rules on `origin/main`). Local process started by the script on `http://127.0.0.1:54279`. Week `2026-W34`. `POLAR_LIVE` unset. `POLAR_ACCESS_TOKEN` unset. Fixture path for click only. No invented paid rank: empty board first, then one fixture-paid `brief.example/smoke-*` URL unique to this run after the paid webhook.

Also refused `CI=true` (`FAIL: live-smoke refuses CI=true`) and `GITHUB_ACTIONS=true`.

| Flow | Result | Note |
|---|---|---|
| Board | **PASS** | `GET /` 200 week `2026-W34`. Empty board + buyer / budget / deadline / brief URL form. No invented ratings. |
| About / rules | **PASS** | `GET /about` and `GET /rules` 200. Min $5, older wins ties, raise pays difference, Monday 00:00:00.000 UTC, no invented ratings. |
| Create checkout | **BLOCKED-SECRET** | `BLOCKED-SECRET: POLAR_ACCESS_TOKEN` |
| Click | **PASS** | Fixture listing allowed. `GET /click/lst_872ab292-98c1-451f-835c-73e85db7c450` 302 to stripped `https://brief.example/smoke-…`. Clicks `0→1`. Tracking query not stored. |
| Honesty | **PASS** | No stars, no review scores, no invented #1 brief on the empty week. |
| Honesty rating field | **PASS-ERROR** | `POST /api/checkout` with `rating=4.8` → 400 `rating_forbidden`. No listing. |

Process exit 0 (`PASS=4` `PASS-ERROR=1` `BLOCKED-SECRET=1` `FAIL=0`). Re-run with `POLAR_LIVE=1` and a real token to complete Polar Checkout; missing token must stay `BLOCKED-SECRET`, never a fixture listing.

## What this does not do

- Does not call `scripts/live-smoke.sh` from `scripts/test.sh` or Actions.
- Does not set `POLAR_LIVE=1` in CI.
- Does not seed a fake paid #1 brief or invented ratings.
- Does not treat a missing Polar secret as a paid listing.
