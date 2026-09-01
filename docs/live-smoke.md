# Live smoke — Freelance Brief Board

Operator-only. `bash scripts/live-smoke.sh` is **not** called from `scripts/test.sh`
or GitHub Actions. CI stays offline and cannot select a live Waffo mode.

`100%` for this unit means a **local process** walked every SPEC §14 flow.
With `WAFFO_MODE` unset or explicitly set to `fixture`, checkout uses the
offline fixture and makes no provider request. Live Waffo is opt-in through an
explicit `WAFFO_MODE=waffo-test` or `WAFFO_MODE=waffo-prod`; those modes are
never rewritten to fixture. Missing required credentials produce the exact
`BLOCKED-SECRET` verdict before provider startup. With complete credentials,
the checkout flow runs against the explicitly selected Waffo mode. Do not
invent ratings. An empty week is valid.

## How to run

```bash
bash scripts/live-smoke.sh
```

The script:

1. Refuses `CI=true` and `GITHUB_ACTIONS=true`.
2. Starts a local fixture process serving `/`, `/about`, `/rules`, `/checkout`,
   `/api/waffo/webhook`, `/click/:id`, and `/healthz` on a free loopback port.
   When an explicit live Waffo mode is supplied and passes the credential
   preflight, a separate guarded Waffo process handles only the live checkout.
3. Or attaches to `LIVE_SMOKE_BASE` if that server already answers
   `GET /healthz`.
4. Walks board, `/about`, `/rules`, checkout, click, and honesty.
5. Uses Waffo only when explicitly configured with a live mode; otherwise
   records the offline fixture checkout. An explicit live mode with a missing
   required credential records the exact missing-secret verdict and continues
   the read-only/fixture click flows without starting a provider process.
6. Kills the process it started and deletes its disposable workdir.

Overrides: `LIVE_SMOKE_BASE`, `LIVE_SMOKE_PORT`.

## Verdicts

| Label | Meaning |
|---|---|
| `PASS` | Flow completed as SPEC requires. |
| `PASS-ERROR` | Documented product error; nothing invented. |
| `BLOCKED-SECRET` | Explicit live Waffo credential is missing. |
| `FAIL` | Broken product or invented listing / rating. |

## What this does not do

- Does not call `scripts/live-smoke.sh` from `scripts/test.sh` or Actions.
- Does not select Waffo implicitly or use retired provider flags.
- Does not seed a fake paid #1 brief or invented ratings.
- Does not call Waffo unless the operator explicitly supplies a mode and
  credentials.
- Does not register webhooks, mutate products, or alter payment dashboards.
