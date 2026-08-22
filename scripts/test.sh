#!/usr/bin/env bash
# Offline gate for main. Must exit 0 on a clean clone with no secrets.
# When application code lands, add unit/contract tests here. Do not delete the
# contract checks. Do not require live Polar or any third-party network.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "== contract files =="
for f in README.md SPEC.md BUILD.md CONTRIBUTING.md scripts/test.sh; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done

echo "== contributing rules are documented =="
grep -q 'main must always be buildable' CONTRIBUTING.md \
  || grep -q 'main` must always be buildable' CONTRIBUTING.md \
  || fail "CONTRIBUTING.md does not state the main-branch rule"

echo "== SPEC mentions git collaboration =="
grep -q 'Git collaboration' SPEC.md || fail "SPEC.md missing Git collaboration section"

echo "== SPEC product contract =="
grep -q 'buyer + budget + deadline + brief URL' SPEC.md || fail "SPEC.md missing listing shape"
grep -q 'Weekly reset UTC' SPEC.md || fail "SPEC.md missing weekly reset UTC"
grep -q 'No invented ratings' SPEC.md || fail "SPEC.md missing no invented ratings"
grep -Fq 'Minimum **$5**' SPEC.md || fail "SPEC.md missing min $5"
grep -q 'older wins ties' SPEC.md || fail "SPEC.md missing older-wins-ties"
grep -q 'raise pays difference' SPEC.md || fail "SPEC.md missing raise-pays-difference"
grep -q 'Polar' SPEC.md || fail "SPEC.md missing Polar"
grep -q 'fixture' SPEC.md || fail "SPEC.md missing fixture Polar"
grep -q '/about' SPEC.md || fail "SPEC.md missing /about"
grep -q '/rules' SPEC.md || fail "SPEC.md missing /rules"
grep -q 'public click' SPEC.md || fail "SPEC.md missing public clicks"

echo "== BUILD PR sequence through live-smoke =="
grep -qE '^### PR 1: skeleton' BUILD.md || fail "BUILD.md missing ### PR 1: skeleton"
grep -qE '^### PR 2: board UI like outbid.lol' BUILD.md || fail "BUILD.md missing ### PR 2: board UI like outbid.lol"
grep -qE '^### PR 3: checkout' BUILD.md || fail "BUILD.md missing ### PR 3: checkout"
grep -qE '^### PR 4: raise-bid' BUILD.md || fail "BUILD.md missing ### PR 4: raise-bid"
grep -qE '^### PR 5: rules' BUILD.md || fail "BUILD.md missing ### PR 5: rules / about"
grep -qE '^### PR 6: live-smoke' BUILD.md || fail "BUILD.md missing ### PR 6: live-smoke"
if ! grep -E '^### PR [0-9]+:' BUILD.md >/dev/null; then
  fail "BUILD.md PR headings must be ### PR N: title"
fi
if grep -Eq '^\s*(bash )?scripts/live-smoke\.sh' scripts/test.sh; then
  fail "test.sh must not invoke live-smoke.sh"
fi

echo "== CI job ci =="
[[ -f .github/workflows/ci.yml ]] || fail "missing .github/workflows/ci.yml"
grep -qE '^name: ci$' .github/workflows/ci.yml || fail "ci.yml missing workflow name ci"
grep -qE '^  ci:' .github/workflows/ci.yml || fail "ci.yml missing job id ci"
grep -q 'bash scripts/test.sh' .github/workflows/ci.yml || fail "ci.yml must run scripts/test.sh"
if grep -Eqi 'POLAR_LIVE=1|POLAR_ACCESS_TOKEN=' .github/workflows/ci.yml; then
  fail "CI must not set live Polar"
fi
if grep -q 'scripts/live-smoke.sh' .github/workflows/ci.yml; then
  fail "live-smoke.sh must not be called from Actions"
fi

echo "== no committed secrets =="
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git ls-files | grep -E '(^|/)\.env$|(^|/)id_rsa$|\.pem$|credentials\.json$' >/dev/null; then
    fail "secret-like path is tracked"
  fi
fi

echo "== markdown is UTF-8 text =="
file -b --mime-encoding README.md SPEC.md BUILD.md CONTRIBUTING.md | grep -qiE 'utf-8|us-ascii' \
  || fail "docs are not UTF-8/ASCII"

echo "== skeleton files =="
for f in package.json tsconfig.json src/app/healthz/route.ts tests/healthz.test.ts; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q '/healthz' src/app/healthz/route.ts || grep -q 'HealthzOk' src/app/healthz/route.ts \
  || fail "src/app/healthz/route.ts missing healthz contract"
grep -q 'ok: true' src/app/healthz/route.ts || fail "healthz route missing { ok: true }"
if grep -E '"@polar-sh/sdk"|"@polar-sh/' package.json >/dev/null 2>&1; then
  fail "do not add a live Polar SDK in this unit"
fi
echo "== board UI files =="
for f in \
  src/app/page.tsx \
  src/app/layout.tsx \
  src/app/board.tsx \
  src/app/board.css \
  src/app/outbid-form.tsx \
  src/core/week.ts \
  src/core/rank.ts \
  tests/rank.test.ts \
  tests/week.test.ts
do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q 'currentWeekUtc' src/core/week.ts || fail "week.ts missing currentWeekUtc"
grep -q 'Monday' src/core/week.ts || fail "week.ts must document Monday 00:00 UTC"
grep -q 'weekIdUtc' src/core/week.ts || fail "week.ts missing weekIdUtc"
grep -q 'export function rankListings' src/core/rank.ts \
  || fail "rank.ts must export rankListings"
grep -q 'bidUsd' src/core/rank.ts || fail "rank.ts missing bidUsd sort"
grep -q 'firstPaidAt' src/core/rank.ts || fail "rank.ts missing firstPaidAt older-wins-ties"
grep -q 'getBoardListings' src/core/rank.ts || fail "rank.ts missing getBoardListings"
grep -q 'listPaid' src/core/rank.ts || fail "live board must load paid listings only"
grep -q 'rankListings' src/app/page.tsx || fail "page.tsx must rank through rankListings"
grep -q 'getBoardListings' src/app/page.tsx \
  || fail "page.tsx must load the board through getBoardListings"
grep -q 'currentWeekUtc' src/app/page.tsx || fail "page.tsx must use currentWeekUtc"
grep -q 'Outbid' src/app/outbid-form.tsx || fail "form missing Outbid button"
grep -q 'name="buyer"' src/app/outbid-form.tsx || fail "form missing buyer"
grep -q 'name="budgetUsd"' src/app/outbid-form.tsx || fail "form missing budget"
grep -q 'name="deadline"' src/app/outbid-form.tsx || fail "form missing deadline"
grep -q 'name="winnerRule"' src/app/outbid-form.tsx || fail "form missing winner rule"
grep -q 'name="briefUrl"' src/app/outbid-form.tsx || fail "form missing brief URL"
grep -q 'name="amountUsd"' src/app/outbid-form.tsx || fail "form missing amount"
grep -q 'data-empty-week' src/app/board.tsx || fail "board missing honest empty week"
grep -q 'data-bid' src/app/board.tsx || fail "cards must show the bid amount"
grep -q 'data-clicks' src/app/board.tsx || fail "cards must show public clicks"
grep -q 'data-budget' src/app/board.tsx || fail "cards must show budget"
grep -q 'data-deadline' src/app/board.tsx || fail "cards must show deadline"
grep -q 'board.css' src/app/layout.tsx || fail "root layout must load board styles"
grep -q 'older' tests/rank.test.ts || fail "rank tests missing older-wins-ties"
if grep -RInEi '★|⭐|star rating|4\.8 stars|review score|top rated|hire rate|data-stars|data-rating' \
  src/app src/core --exclude='honesty.ts' --exclude-dir=about --exclude-dir=rules >/dev/null
then
  fail "board UI must not render stars or invented ratings"
fi
echo "== raise-bid files =="
for f in src/core/listing.ts tests/checkout.test.ts; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q 'export function quoteBid' src/core/listing.ts || fail "listing.ts must export quoteBid"
grep -q 'bid_not_higher' src/core/listing.ts || fail "listing.ts missing bid_not_higher"
grep -q 'canonicalBriefUrl' src/core/listing.ts || fail "listing.ts missing canonical brief URL identity"
grep -q 'firstPaidAt' src/core/listings.ts || fail "listings.ts must keep firstPaidAt"
grep -q 'quoteBid' src/core/listings.ts || fail "paid raise must go through quoteBid"
grep -q 'kind: quote.kind' src/billing/port.ts || fail "checkout must plan create vs raise"
grep -q 'chargeUsd' src/billing/port.ts || fail "checkout must charge the raise difference"
grep -q 'bid_not_higher' tests/checkout.test.ts || fail "checkout tests missing bid_not_higher"
grep -q 'pays \$7' tests/checkout.test.ts || fail "checkout tests missing \$5 → \$12 pays \$7"
if [[ -f scripts/live-smoke.sh ]]; then
  fail "PR 5 must not add live-smoke"
fi

echo "== rules / about / url / honesty / click =="
for f in \
  src/app/about/page.tsx \
  src/app/rules/page.tsx \
  src/core/url.ts \
  src/core/honesty.ts \
  src/app/click/\[id\]/route.ts \
  tests/listing.test.ts \
  tests/click.test.ts \
  tests/honesty.test.ts
do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q 'href="/about"' src/app/layout.tsx || fail "nav must link to /about"
grep -q 'href="/rules"' src/app/layout.tsx || fail "nav must link to /rules"
grep -q 'Rank is the bid' src/app/about/page.tsx || fail "about must state rank is the bid"
grep -q 'no invented ratings' src/app/about/page.tsx || fail "about must forbid invented ratings"
grep -q 'freelance-brief-board' src/app/about/page.tsx || fail "about must name the freelance-brief-board vertical"
grep -q '\$5' src/app/rules/page.tsx || fail "rules must state min \$5"
grep -q 'Older wins ties' src/app/rules/page.tsx || fail "rules must state older wins ties"
grep -q 'Raise pays difference' src/app/rules/page.tsx || fail "rules must state raise pays difference"
grep -q 'Monday 00:00:00.000 UTC' src/app/rules/page.tsx || fail "rules must state weekly UTC reset"
grep -q 'No invented ratings' src/app/rules/page.tsx || fail "rules must forbid invented ratings"
grep -q 'utm_' src/core/url.ts || fail "url.ts must strip utm_ tracking keys"
grep -q 'url_forbidden' src/core/url.ts || fail "url.ts must reject forbidden URLs"
grep -q 't.me' src/core/url.ts || fail "url.ts must reject telegram invites"
grep -q 'export function canonicalizeBriefUrl' src/core/url.ts \
  || fail "url.ts must export canonicalizeBriefUrl"
grep -q 'rating_forbidden' src/core/honesty.ts || fail "honesty.ts must reject invented ratings"
grep -q 'rejectInventedRatings' src/core/honesty.ts \
  || fail "honesty.ts must export rejectInventedRatings"
grep -q 'incrementListingClicks' 'src/app/click/[id]/route.ts' \
  || fail "click route must increment public clicks"
grep -q 'NextResponse.redirect' 'src/app/click/[id]/route.ts' \
  || fail "click route must 302 to the brief URL"
grep -q 'briefClickPath' src/app/board.tsx || fail "board brief CTA must use the click route"
grep -q 'utm_source' tests/listing.test.ts || fail "listing tests must cover tracking strip"
grep -q 't.me' tests/listing.test.ts || fail "listing tests must reject telegram"
grep -q 'rating_forbidden' tests/listing.test.ts \
  || fail "listing tests must reject invented ratings"
grep -q '302' tests/click.test.ts || fail "click tests must assert 302"
grep -q 'rating_forbidden' tests/honesty.test.ts \
  || fail "honesty tests must reject invented ratings"
if grep -RInE '4\.8 stars' src/app/about/page.tsx src/app/rules/page.tsx >/dev/null; then
  fail "about/rules must not invent ratings"
fi

echo "== checkout files =="
for f in \
  src/billing/port.ts \
  src/billing/fixture.ts \
  src/billing/polar.ts \
  src/app/api/checkout/route.ts \
  src/app/api/polar/webhook/route.ts \
  src/app/return/page.tsx \
  tests/checkout.test.ts
do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q 'createCheckout' src/billing/port.ts || fail "port.ts must define createCheckout"
grep -q 'handleWebhook' src/billing/port.ts || fail "port.ts must define handleWebhook"
grep -q 'POLAR_FIXTURE_ONLY' src/billing/port.ts \
  || fail "port.ts must honor POLAR_FIXTURE_ONLY"
grep -q 'export class FixturePaymentPort' src/billing/fixture.ts \
  || fail "fixture.ts must export FixturePaymentPort"
grep -q 'export class PolarPaymentPort' src/billing/polar.ts \
  || fail "polar.ts must export PolarPaymentPort"
grep -q 'POLAR_LIVE' src/billing/polar.ts || fail "polar.ts must stay env-gated"
grep -q 'data-return' src/app/return/page.tsx || fail "return page must expose paid/pending"
grep -q 'does not trust the query' src/app/return/page.tsx \
  || fail "return page must not trust the query string alone"
grep -q 'action="/api/checkout"' src/app/outbid-form.tsx \
  || fail "Outbid form must POST to /api/checkout"
if grep -nE 'fetch\(|polar\.sh|api\.polar' src/billing/fixture.ts src/billing/port.ts >/dev/null; then
  fail "fixture/port must not call Polar over the network"
fi
if grep -R --include='*.ts' --include='*.tsx' -E "from ['\"]@polar-sh" src tests >/dev/null 2>&1; then
  fail "src/tests must not import a Polar SDK"
fi
if grep -R --include='*.ts' --include='*.tsx' -E "api\\.polar\\.sh" tests >/dev/null 2>&1; then
  fail "tests must not call live Polar"
fi
if grep -R --include='*.ts' --include='*.tsx' -E "api\\.polar\\.sh" src >/dev/null 2>&1; then
  if grep -R --include='*.ts' --include='*.tsx' -E "api\\.polar\\.sh" src | grep -v 'src/billing/polar.ts' >/dev/null 2>&1; then
    fail "only src/billing/polar.ts may mention the Polar API host"
  fi
fi
if grep -RInE 'billing/polar' src/app src/core >/dev/null 2>&1; then
  fail "HTTP / pages must not import billing/polar.ts directly"
fi
if grep -Eq '^(export )?POLAR_LIVE=1' scripts/test.sh .github/workflows/ci.yml; then
  fail "CI / test.sh must not set POLAR_LIVE=1"
fi

if [[ -f package.json ]]; then
  echo "== install =="
  if [[ ! -d node_modules ]]; then
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
  fi

  unset POLAR_LIVE POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET
  export POLAR_FIXTURE_ONLY=1
  [[ "${POLAR_LIVE:-}" != "1" ]] || fail "POLAR_LIVE must stay unset in test.sh"

  echo "== tsc --noEmit =="
  npx tsc --noEmit

  echo "== unit tests =="
  test_log="$(mktemp)"
  trap 'rm -f "$test_log"' EXIT
  set +e
  npx tsx --test --test-concurrency=1 --test-reporter spec 'tests/**/*.test.ts' | tee "$test_log"
  test_status=${PIPESTATUS[0]}
  set -e
  [[ $test_status -eq 0 ]] || fail "unit tests failed"
  grep -Eq 'tests[[:space:]]+[1-9][0-9]*' "$test_log" \
    || fail "test runner reported 0 tests"
  grep -q '/healthz' "$test_log" \
    || fail "healthz test did not run"
  grep -q 'older' "$test_log" \
    || fail "rank older-wins-ties test did not run"
  grep -q 'fixture create' "$test_log" \
    || fail "checkout $5 fixture create test did not run"
  grep -q 'abandoned' "$test_log" \
    || fail "abandoned checkout test did not run"
  grep -q 'underbid' "$test_log" \
    || fail "underbid still-lists test did not run"
  grep -q 'pays $7' "$test_log" \
    || fail "raise $5 → $12 pays $7 test did not run"
  grep -q 'bid_not_higher' "$test_log" \
    || fail "bid_not_higher raise test did not run"
  grep -q 'utm_source' "$test_log" \
    || fail "url tracking-strip test did not run"
  grep -q 'telegram' "$test_log" \
    || fail "chat-ban test did not run"
  grep -q 'GET /click' "$test_log" \
    || fail "click route test did not run"
  grep -q 'rating_forbidden' "$test_log" \
    || fail "honesty rating_forbidden test did not run"
  grep -q 'about and rules' "$test_log" \
    || fail "about/rules copy test did not run"
fi

echo "OK: buildable and testable"
