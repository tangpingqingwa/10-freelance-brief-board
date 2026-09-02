#!/usr/bin/env bash
# Offline gate for main. Must exit 0 on a clean clone with no secrets.
# When application code lands, add unit/contract tests here. Do not delete the
# contract checks. Do not require live Waffo or any third-party network.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "== Node 22 runtime =="
command -v node >/dev/null || fail "node is required"
node_major="$(node --input-type=module -e 'process.stdout.write(process.versions.node.split(".")[0])')"
[[ "$node_major" =~ ^[0-9]+$ && "$node_major" -ge 22 ]] \
  || fail "Node 22+ is required (found $(node --version))"
grep -Eq '"node"[[:space:]]*:[[:space:]]*">=22"' package.json \
  || fail "package.json must require Node 22+"

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
grep -q 'Waffo' SPEC.md || fail "SPEC.md missing Waffo"
grep -q 'fixture' SPEC.md || fail "SPEC.md missing fixture payment mode"
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
grep -q 'node-version: 22' .github/workflows/ci.yml \
  || fail "ci.yml must pin Node 22"
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
for f in package.json tsconfig.json scripts/preflight.mjs src/app/healthz/route.ts tests/healthz.test.ts; do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q '/healthz' src/app/healthz/route.ts || grep -q 'HealthzOk' src/app/healthz/route.ts \
  || fail "src/app/healthz/route.ts missing healthz contract"
grep -q 'ok: true' src/app/healthz/route.ts || fail "healthz route missing { ok: true }"
grep -q 'scripts/preflight.mjs && next start' package.json \
  || fail "production start must preflight Waffo configuration"
grep -q '"@waffo/pancake-ts"' package.json \
  || fail "Waffo official SDK must be installed"
grep -q 'assertDatabaseReady' src/app/healthz/route.ts \
  || fail "healthz must probe the shared durable database"
grep -q 'export function assertDatabaseReady' src/db.ts \
  || fail "shared database helper must expose the readiness probe"
grep -q 'DATABASE_PATH is not ready' scripts/preflight.mjs \
  || fail "preflight must fail closed when the durable database is unusable"
if grep -E '"@polar-sh/sdk"|"@polar-sh/' package.json >/dev/null 2>&1; then
  fail "Polar SDK must not be installed in this unit"
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
grep -q 'ROLLING_WEEK_MS' src/core/week.ts || fail "week.ts must export a rolling last-7-days window"
grep -q 'bidInRollingWeek' src/core/week.ts || fail "week.ts must test paidAt against the rolling week"
grep -q 'weekIdUtc' src/core/week.ts || fail "week.ts missing weekIdUtc"
grep -q 'export function rankListings' src/core/rank.ts \
  || fail "rank.ts must export rankListings"
grep -q 'bidUsd' src/core/rank.ts || fail "rank.ts missing bidUsd sort"
grep -q 'firstPaidAt' src/core/rank.ts || fail "rank.ts missing firstPaidAt older-wins-ties"
grep -q 'getBoardListings' src/core/rank.ts || fail "rank.ts missing getBoardListings"
grep -q 'listPaidRolling' src/core/rank.ts || fail "live board must load paid listings in the rolling last-7-days window"
grep -q 'bidInRollingWeek' src/core/rank.ts || fail "rank.ts must quote against the rolling last-7-days window"
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
grep -q 'No paid brief' src/app/board.tsx || fail "empty week must say no paid brief"
grep -q 'no sample gig' src/app/board.tsx || fail "empty week must refuse a sample gig"
grep -q 'desk-surface-empty' src/app/board.tsx || fail "empty week must keep the empty-desk surface"
grep -q 'desk-surface-empty' src/app/board.css || fail "CSS missing empty-desk claim focus"
grep -q 'tells a freelancer no one has paid before Claim #1' tests/rank.test.ts \
  || fail "rank tests missing freelancer empty-week honesty-first order"
grep -q 'opening the paid #1 brief the freelancer move' tests/rank.test.ts \
  || fail "rank tests missing occupied-week open-this-brief freelancer move"
grep -q 'writing a new ticket the buyer move' tests/rank.test.ts \
  || fail "rank tests missing occupied-week write-this-ticket buyer move"
grep -q 'reading the paid #1 budget the freelancer fact' tests/rank.test.ts \
  || fail "rank tests missing occupied-week read-this-budget freelancer fact"
grep -q 'reading the paid #1 deadline the freelancer fact' tests/rank.test.ts \
  || fail "rank tests missing occupied-week read-this-deadline freelancer fact"
grep -q 'reading the paid #1 winner rule the freelancer fact' tests/rank.test.ts \
  || fail "rank tests missing occupied-week read-this-winner freelancer fact"
echo "== brief-desk action contract =="
grep -q 'data-claim-anchor' src/app/board.tsx \
  || fail "paid #1 must expose one semantic Claim #1 anchor"
grep -q 'claim-anchor' src/app/board.css \
  || fail "CSS must style the quiet Claim #1 anchor"
grep -q 'data-first-click={featured ? "open" : undefined}' src/app/board.tsx \
  || fail "paid #1 first action must be Open this brief"
grep -q 'data-first-read="open"' src/app/board.tsx \
  || fail "paid #1 must record the first read as Open this brief"
grep -q 'occupied-claim' src/app/outbid-form.tsx \
  || fail "occupied Claim #1 must use the occupied semantic state"
grep -q 'data-ticket-identity' src/app/outbid-form.tsx \
  || fail "empty and occupied forms must expose identity fields"
grep -q 'empty desk exposes every identity field before one direct Claim rank' tests/rank.test.ts \
  || fail "rank tests must cover the direct empty claim path"
grep -q 'occupied desk keeps one Open action, one quiet claim anchor' tests/rank.test.ts \
  || fail "rank tests must cover the occupied action path"
grep -q 'expired paid tickets leave the desk empty' tests/rank.test.ts \
  || fail "rank tests must cover expired empty state"
grep -q 'occupied #1 winner rule is the prize before quieter rank, budget, and click facts' tests/rank.test.ts \
  || fail "rank tests must cover the occupied prize-before-rank hierarchy"
grep -q 'occupied later-rank tickets stay quieter than #1' tests/rank.test.ts \
  || fail "rank tests must cover quieter later tickets"
grep -q 'empty and occupied mast copy names the rolling last-7-days window' tests/rank.test.ts \
  || fail "rank tests must cover consistent rolling mast copy"
grep -q 'README/SPEC/BUILD/layout copy keeps the rolling job-ticket contract' tests/rank.test.ts \
  || fail "rank tests must cover rolling document chrome"
if grep -E 'data-(open|write)-after-|data-first-click="claim"|Then[[:space:]]+the[[:space:]]+brief[[:space:]]+URL' \
  src/app/board.tsx src/app/board.css src/app/outbid-form.tsx tests/rank.test.ts >/dev/null; then
  fail "numbered/reveal action scaffolding must be absent"
fi
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -Eq 'Open this brief|Write this ticket|data-first-click="open"'; then
  fail "empty desk must not render occupied actions"
fi
grep -Fq '.week-occupied .ticket-featured .open-this-brief[data-first-click="open"]' src/app/board.css \
  || fail "occupied Open this brief style is missing"
grep -Fq '.week-occupied .ticket-featured .claim-anchor' src/app/board.css \
  || fail "occupied Claim anchor style is missing"
grep -Fq '.week-occupied .claim.occupied-claim' src/app/board.css \
  || fail "occupied Claim form style is missing"
grep -q 'Claim #1 for' src/app/outbid-form.tsx \
  || fail "form missing Claim #1"
grep -q 'className="amount-field"' src/app/outbid-form.tsx \
  || fail "form missing dashed amount"
grep -q 'className="step"' src/app/outbid-form.tsx \
  || fail "form missing ± steppers"
grep -q 'Outbid' src/app/outbid-form.tsx \
  || fail "form missing Outbid submit"
grep -q 'name="buyer"' src/app/outbid-form.tsx \
  || fail "form missing buyer"
grep -q 'name="budgetUsd"' src/app/outbid-form.tsx \
  || fail "form missing budget"
grep -q 'name="deadline"' src/app/outbid-form.tsx \
  || fail "form missing deadline"
grep -q 'name="winnerRule"' src/app/outbid-form.tsx \
  || fail "form missing winner rule"
grep -q 'name="briefUrl"' src/app/outbid-form.tsx \
  || fail "form missing brief URL"

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
grep -q 'same brief still inside last-7-days raises after the UTC week label rolls' tests/checkout.test.ts \
  || fail "checkout tests must raise across the UTC week label"

echo "== live-smoke stays operator-only =="
[[ -f scripts/live-smoke.sh ]] || fail "missing scripts/live-smoke.sh"
[[ -x scripts/live-smoke.sh ]] || fail "scripts/live-smoke.sh must be executable"
[[ -f docs/live-smoke.md ]] || fail "missing docs/live-smoke.md"
[[ -s docs/live-smoke.md ]] || fail "empty docs/live-smoke.md"
[[ -f tests/live-smoke.test.ts ]] || fail "missing tests/live-smoke.test.ts"
if grep -Eq '^\s*(bash )?(\./)?scripts/live-smoke\.sh' scripts/test.sh; then
  fail "test.sh must not invoke live-smoke.sh"
fi
if grep -E '^[[:space:]]*(export[[:space:]]+)?WAFFO_MODE=waffo-(test|prod)' scripts/test.sh >/dev/null; then
  fail "test.sh must not select live Waffo"
fi
grep -q 'WAFFO_MODE=fixture' scripts/live-smoke.sh \
  || fail "live-smoke.sh must force fixture mode"
grep -q 'WAFFO_PRIVATE_KEY' scripts/live-smoke.sh \
  || fail "live-smoke.sh must identify Waffo key handling"
grep -q 'run_live_waffo_checkout' scripts/live-smoke.sh \
  || fail "live-smoke.sh must guard explicit live Waffo checkout"
grep -q 'first_missing_live_secret' scripts/live-smoke.sh \
  || fail "live-smoke.sh must report exact missing Waffo secrets"
grep -q 'hasBudgetValue' scripts/live-smoke.sh \
  || fail "live-smoke.sh must require a value-bearing Budget fact"
grep -q 'hasDeadlineValue' scripts/live-smoke.sh \
  || fail "live-smoke.sh must require a value-bearing Due fact"
grep -q 'assert_card_parser_regression' scripts/live-smoke.sh \
  || fail "live-smoke.sh must run its empty-fact parser regression"
grep -q 'waffo\.ai' scripts/live-smoke.sh \
  || fail "live-smoke.sh must identify Waffo"
grep -q 'live-smoke refuses CI=true' scripts/live-smoke.sh \
  || fail "live-smoke.sh must refuse CI=true"
grep -q 'PASS-ERROR' docs/live-smoke.md || fail "live-smoke docs missing PASS-ERROR"
grep -q 'BLOCKED-SECRET' docs/live-smoke.md || fail "live-smoke docs missing BLOCKED-SECRET"

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
grep -q 'Freelance Brief Board is a public auction' src/app/about/page.tsx || fail "about must name this product"
grep -q '\$5' src/app/rules/page.tsx || fail "rules must state min \$5"
grep -q 'brief placed first keeps the higher rank' src/app/rules/page.tsx || fail "rules must state earlier placement wins ties"
grep -q 'same cleaned brief link may raise while its placement is' src/app/rules/page.tsx \
  || fail "rules must name rolling raise identity"
grep -q 'rolling last 7 days' src/app/rules/page.tsx \
  || fail "rules must name the rolling window"
grep -q 'No invented ratings' src/app/rules/page.tsx || fail "rules must forbid invented ratings"
grep -q 'utm_' src/core/url.ts || fail "url.ts must strip tracking keys"
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
  || fail "click route must redirect to brief"
grep -q 'briefClickPath' src/app/board.tsx || fail "board CTA must use click route"
grep -q 'Open this brief' src/app/board.tsx \
  || fail "featured #1 must say Open this brief"
grep -q 'data-open-brief' src/app/board.tsx \
  || fail "featured #1 must mark the open-brief action"
grep -q 'data-read-budget' src/app/board.tsx \
  || fail "featured #1 must mark the project budget"
grep -q 'data-read-deadline' src/app/board.tsx \
  || fail "featured #1 must mark the due date"
grep -q 'data-read-winner' src/app/board.tsx \
  || fail "featured #1 must mark the winner rule"
grep -q 'data-prize-before-price' src/app/board.tsx \
  || fail "featured #1 must stamp prize before price"
grep -q 'data-rank-is-bid' src/app/board.tsx \
  || fail "featured #1 must stamp rank as bid"
grep -q 'data-budget-later' src/app/board.tsx \
  || fail "featured #1 must keep project budget as a later fact"
grep -q 'function LaterRankTicket' src/app/board.tsx \
  || fail "later ranks must use quieter ticket anatomy"
grep -q 'data-later-rank' src/app/board.tsx \
  || fail "later ranks must stamp their state"
grep -q 'Open brief' src/app/board.tsx \
  || fail "later ranks must keep Open brief"
grep -q '.hopper .bid' src/app/board.css \
  || fail "CSS must keep later ranks quieter"
if grep -RInE '★|⭐|star rating|4\.8 stars|review score|top rated|hire rate|data-stars|data-rating' \
  src/app src/core --exclude='honesty.ts' --exclude-dir=about --exclude-dir=rules >/dev/null; then
  fail "board UI must not render invented ratings"
fi

echo "== checkout files =="
for f in \
  src/billing/port.ts \
  src/billing/fixture.ts \
  src/billing/waffo.ts \
  src/billing/select.ts \
  src/app/checkout/route.ts \
  src/app/api/waffo/webhook/route.ts \
  src/app/checkout/complete/page.tsx \
  src/app/return/page.tsx \
  tests/checkout.test.ts
do
  [[ -f "$f" ]] || fail "missing $f"
  [[ -s "$f" ]] || fail "empty $f"
done
grep -q 'createCheckout' src/billing/port.ts || fail "port.ts must define createCheckout"
grep -q 'handleWebhook' src/billing/port.ts || fail "port.ts must define handleWebhook"
grep -q 'WAFFO_MODE' src/config.ts src/billing/select.ts \
  || fail "provider selection must require explicit WAFFO_MODE"
grep -q 'export class FixturePaymentPort' src/billing/fixture.ts \
  || fail "fixture.ts must export FixturePaymentPort"
grep -q 'export class WaffoPaymentPort' src/billing/waffo.ts \
  || fail "waffo.ts must export WaffoPaymentPort"
grep -q 'verifyWebhook' src/billing/waffo.ts \
  || fail "waffo.ts must verify raw webhook bodies with the official SDK"
grep -q 'order.completed' src/billing/waffo.ts \
  || fail "waffo.ts must accept only order.completed"
grep -q 'data-return' src/app/return/page.tsx || fail "return page must expose paid/pending"
grep -q 'return/page' src/app/checkout/complete/page.tsx \
  || fail "Waffo success URL must land on the read-only completion page"
grep -q 'Payment has not been confirmed' src/app/return/page.tsx \
  || fail "return page must keep unconfirmed payments off the board"
grep -q 'action="/checkout"' src/app/outbid-form.tsx \
  || fail "Outbid form must POST to /checkout"
if grep -nE 'fetch\(|waffo\.ai|api\.waffo' src/billing/fixture.ts src/billing/port.ts >/dev/null; then
  fail "fixture/port must not call Waffo over the network"
fi
if grep -R --include='*.ts' --include='*.tsx' -E "from ['\"]@polar-sh" src tests >/dev/null 2>&1; then
  fail "src/tests must not import a Polar SDK"
fi
if grep -R --include='*.ts' --include='*.tsx' -nE 'fetch\(|https://api\.waffo\.ai|https://test\.waffo' tests \
  | grep -v 'fetch:' \
  | grep -v 'WAFFO_API_BASE' \
  | grep -v 'waffo\.example' >/dev/null; then
  fail "tests must not call live Waffo"
fi
if grep -R --include='*.ts' --include='*.tsx' -E "api\\.waffo\\.ai" src >/dev/null 2>&1; then
  if grep -R --include='*.ts' --include='*.tsx' -E "api\\.waffo\\.ai" src \
    | grep -v 'src/billing/waffo.ts' \
    | grep -v 'src/config.ts' >/dev/null 2>&1; then
    fail "only provider/config modules may mention the Waffo API host"
  fi
fi
if grep -RInE 'billing/polar' src/app src/core >/dev/null 2>&1; then
  fail "HTTP / pages must not import the retired provider adapter directly"
fi
if [[ -e src/billing/waffo-session.ts ]]; then
  fail "the retired handwritten Waffo session adapter must not remain in runtime source"
fi
if grep -Eq '^(export )?WAFFO_MODE=waffo-(test|prod)' scripts/test.sh .github/workflows/ci.yml; then
  fail "CI / test.sh must not select live Waffo"
fi

if [[ -f package.json ]]; then
  grep -q '"better-sqlite3"' package.json \
    || fail "SQLite runtime dependency must be installed"
  test -f src/db.ts \
    || fail "SQLite database module must exist"
  grep -q 'DATABASE_PATH' src/config.ts src/db.ts src/core/listings.ts \
    || fail "listing storage must resolve DATABASE_PATH"

  echo "== install =="
  if [[ ! -d node_modules ]]; then
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
  fi

  unset WAFFO_MODE WAFFO_MERCHANT_ID WAFFO_STORE_ID WAFFO_PRODUCT_ID WAFFO_PRIVATE_KEY WAFFO_PRIVATE_KEY_FILE WAFFO_WEBHOOK_TEST_PUBLIC_KEY WAFFO_WEBHOOK_PROD_PUBLIC_KEY WAFFO_API_BASE DATABASE_PATH
  export WAFFO_MODE=fixture
  test_workdir="$(mktemp -d "${TMPDIR:-/tmp}/freelance-brief-board-test.XXXXXX")"
  test_database="${test_workdir}/board.sqlite"
  cleanup_test_workdir() {
    if [[ -n "${test_workdir:-}" && -d "$test_workdir" ]]; then
      rm -rf -- "$test_workdir"
    fi
  }
  trap cleanup_test_workdir EXIT
  export DATABASE_PATH="$test_database"
  [[ "${WAFFO_MODE:-}" == "fixture" ]] || fail "test.sh must use explicit fixture mode"
  [[ "$DATABASE_PATH" != ":memory:" ]] || fail "offline gate must use a durable SQLite file"

  echo "== tsc --noEmit =="
  npx tsc --noEmit

  echo "== unit tests =="
  test_log="${test_workdir}/test.log"
  set +e
  npx tsx --test --test-concurrency=1 --test-reporter spec 'tests/**/*.test.ts' | tee "$test_log"
  test_status=${PIPESTATUS[0]}
  set -e
  [[ $test_status -eq 0 ]] || fail "unit tests failed"
  grep -Eq 'tests[[:space:]]+[1-9][0-9]*' "$test_log" \
    || fail "test runner reported 0 tests"
  grep -q '/healthz' "$test_log" \
    || fail "healthz test did not run"
  grep -q 'production readiness opens, migrates, and queries durable DB' "$test_log" \
    || fail "database readiness test did not run"
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
  grep -q 'live-smoke.sh is executable' "$test_log" \
    || fail "live-smoke offline guard test did not run"
  grep -q 'no paid brief' "$test_log" \
    || fail "brief-desk empty-week test did not run"
  grep -q 'yields the desk to Claim #1' "$test_log" \
    || fail "empty-week claim-first UX test did not run"
  grep -q 'opening the paid #1 brief' "$test_log" \
    || fail "occupied-week open-this-brief freelancer test did not run"
  grep -q 'writing a new ticket' "$test_log" \
    || fail "occupied-week write-this-ticket buyer test did not run"
  grep -q 'reading the paid #1 budget' "$test_log" \
    || fail "occupied-week read-this-budget freelancer test did not run"
  grep -q 'reading the paid #1 deadline' "$test_log" \
    || fail "occupied-week read-this-deadline freelancer test did not run"
  grep -q 'reading the paid #1 winner rule' "$test_log" \
    || fail "occupied-week read-this-winner freelancer test did not run"
  grep -q 'empty desk exposes every identity field before one direct Claim rank' "$test_log" \
    || fail "direct empty claim-path test did not run"
  grep -q 'occupied desk keeps one Open action, one quiet claim anchor' "$test_log" \
    || fail "occupied action-path test did not run"
  grep -q 'expired paid tickets leave the desk empty' "$test_log" \
    || fail "expired-ticket empty-state test did not run"
  grep -q 'unpaid tickets remain off the desk' "$test_log" \
    || fail "unpaid off-desk test did not run"
  grep -q 'rolling rank keeps Sunday payments' "$test_log" \
    || fail "rolling rank window test did not run"
  grep -q 'week and rules copy keep the rolling' "$test_log" \
    || fail "rolling rules copy test did not run"
  grep -q 'occupied #1 winner rule is the prize before quieter rank' "$test_log" \
    || fail "occupied prize-before-rank hierarchy test did not run"
  grep -q 'occupied later-rank tickets stay quieter than #1' "$test_log" \
    || fail "quieter later-ticket test did not run"
  grep -q 'empty and occupied mast copy names the rolling last-7-days window' "$test_log" \
    || fail "rolling mast-copy test did not run"
  grep -q 'README/SPEC/BUILD/layout copy keeps the rolling job-ticket contract' "$test_log" \
    || fail "rolling document-copy test did not run"
  grep -q 'claim .* paid .* restart .* rank survives' "$test_log" \
    || fail "SQLite claim-paid-restart-rank test did not run"
  grep -q 'click count survives a process restart' "$test_log" \
    || fail "SQLite click restart test did not run"
  grep -q 'two independent store instances share' "$test_log" \
    || fail "SQLite two-instance sharing test did not run"
  grep -q 'duplicate paid event is a no-op' "$test_log" \
    || fail "SQLite duplicate event test did not run"
  grep -q 'two-process stale raises serialize' "$test_log" \
    || fail "SQLite stale-raise serialization test did not run"
  grep -q 'out-of-order independent creates sharing' "$test_log" \
    || fail "SQLite out-of-order canonical-identity test did not run"

  echo "== next build =="
  NEXT_TELEMETRY_DISABLED=1 npm run build

  echo "== built runtime / durable SQLite =="
  node --input-type=module <<'NODE'
import { createServer } from "node:net";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const workdir = mkdtempSync(join(tmpdir(), "freelance-brief-board-runtime-"));
const databasePath = join(workdir, "board.sqlite");
let child;
let output = "";

function exportedKey(key, type) {
  return key.export({ type, format: "pem" }).toString();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("could not choose runtime gate port")));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stop(processHandle) {
  if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  await new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      processHandle.kill("SIGKILL");
      finish();
    }, 2_000);
    processHandle.once("close", finish);
    processHandle.kill("SIGTERM");
  });
}

let failure;
try {
  const port = await freePort();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const env = {
    PATH: process.env.PATH ?? "",
    NODE_ENV: "production",
    WAFFO_MODE: "waffo-test",
    WAFFO_MERCHANT_ID: `MER_${"A".repeat(22)}`,
    WAFFO_STORE_ID: `STO_${"B".repeat(22)}`,
    WAFFO_PRODUCT_ID: `PROD_${"C".repeat(22)}`,
    WAFFO_PRIVATE_KEY: exportedKey(privateKey, "pkcs8"),
    WAFFO_PRIVATE_KEY_FILE: "",
    WAFFO_WEBHOOK_TEST_PUBLIC_KEY: exportedKey(publicKey, "spki"),
    WAFFO_WEBHOOK_PROD_PUBLIC_KEY: "",
    WAFFO_API_BASE: "https://test.waffo.example",
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    DATABASE_PATH: databasePath,
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: "1",
  };
  child = spawn(process.execPath, ["scripts/preflight.mjs"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  child.on("error", (error) => { output += `${error.message}\n`; });
  const preflightResult = await new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  if (preflightResult.code !== 0) {
    throw new Error(`production preflight failed (exit=${preflightResult.code ?? preflightResult.signal})`);
  }

  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  child.on("error", (error) => { output += `${error.message}\n`; });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`built runtime exited before readiness (exit=${child.exitCode ?? child.signalCode})`);
    }
    try {
      const health = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1_000) });
      const healthBody = await health.text();
      if (health.status !== 200 || healthBody !== '{"ok":true}') {
        throw new Error(`unexpected /healthz response: ${health.status} ${healthBody}`);
      }
      const home = await fetch(`${base}/`, { signal: AbortSignal.timeout(1_000) });
      const homeBody = await home.text();
      if (home.status !== 200 || !homeBody.includes("data-empty-week")) {
        throw new Error(`unexpected / response: ${home.status}`);
      }
      ready = true;
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
  if (!ready) throw new Error("built runtime did not become ready");
  if (!existsSync(databasePath)) throw new Error("built runtime did not create durable SQLite file");
  const sqlite = (await import("better-sqlite3")).default;
  const db = new sqlite(databasePath, { readonly: true });
  try {
    if (db.pragma("journal_mode", { simple: true }) !== "wal") throw new Error("SQLite WAL is not enabled");
    if (db.pragma("quick_check", { simple: true }) !== "ok") throw new Error("SQLite quick_check failed");
  } finally {
    db.close();
  }
} catch (error) {
  failure = error;
} finally {
  await stop(child);
  rmSync(workdir, { recursive: true, force: true });
}

if (failure) {
  if (output) console.error(output);
  throw failure;
}
console.log("built runtime gate: npm preflight, next start, /healthz, /, and WAL SQLite passed; provider calls=0");
NODE
fi

echo "OK: buildable and testable"
