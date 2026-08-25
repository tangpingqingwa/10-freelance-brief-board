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
grep -q 'writing a new ticket after the winner rule the buyer hop' tests/rank.test.ts \
  || fail "rank tests missing occupied-week write-after-rule buyer hop"
grep -q 'win the first click after Write follows the winner rule' tests/rank.test.ts \
  || fail "rank tests missing occupied-week open-after-write first click"
grep -q 'concentrates writing a new ticket after Open this brief wins the first click' tests/rank.test.ts \
  || fail "rank tests missing occupied-week write-after-open first-write hop"
grep -q 'concentrates opening the paid #1 brief after Write this ticket is concentrated' tests/rank.test.ts \
  || fail "rank tests missing occupied-week open-after-write-first freelancer hop"
grep -q 'concentrates writing a new ticket after Open this brief is re-concentrated' tests/rank.test.ts \
  || fail "rank tests missing occupied-week write-after-open-two buyer hop"
grep -q 'concentrates opening the paid #1 brief after Write this ticket is re-concentrated' tests/rank.test.ts \
  || fail "rank tests missing occupied-week open-after-write-two freelancer hop"
grep -q 'concentrates writing a new ticket after Open this brief is re-concentrated again' tests/rank.test.ts \
  || fail "rank tests missing occupied-week write-after-open-three buyer hop"
grep -q 'concentrates opening the paid #1 brief after Write this ticket is re-concentrated again' tests/rank.test.ts \
  || fail "rank tests missing occupied-week open-after-write-three freelancer hop"
grep -q 'concentrates writing a new ticket after Open this brief is re-concentrated a fourth time' tests/rank.test.ts \
  || fail "rank tests missing occupied-week write-after-open-four buyer hop"
grep -q 'concentrates opening the paid #1 brief after Write this ticket is re-concentrated a fourth time' tests/rank.test.ts \
  || fail "rank tests missing occupied-week open-after-write-four freelancer hop"
grep -q 'concentrates writing a new ticket after Open this brief is re-concentrated a fifth time' tests/rank.test.ts \
  || fail "rank tests missing occupied-week write-after-open-five buyer hop"
grep -q 'concentrates opening the paid #1 brief after Write this ticket is re-concentrated a fifth time' tests/rank.test.ts \
  || fail "rank tests missing occupied-week open-after-write-five freelancer hop"
grep -q 'concentrates writing a new ticket after Open this brief is re-concentrated a sixth time' tests/rank.test.ts \
  || fail "rank tests missing occupied-week write-after-open-six buyer hop"
if ! awk '
  /desk-surface-empty \.spike-quiet/ { spike=NR }
  /desk-surface-empty \.claim/ { claim=NR }
  END { exit !(spike && claim && spike < claim) }
' src/app/board.css; then
  fail "empty-desk CSS must paint No paid brief above Claim #1"
fi
grep -q 'data-brief-desk' src/app/board.tsx || fail "board must be a brief desk"
grep -q 'card ticket' src/app/board.tsx || fail "paid listings must render as tickets"
grep -q 'Who is buying' src/app/board.tsx || fail "ticket missing who is buying"
grep -q 'What it pays' src/app/board.tsx || fail "ticket missing what it pays"
grep -q 'When it’s due' src/app/board.tsx || fail "ticket missing when it’s due"
grep -q 'How a winner is chosen' src/app/board.tsx || fail "ticket missing winner rule"
grep -q 'data-bid' src/app/board.tsx || fail "cards must show the bid amount"
grep -q 'data-clicks' src/app/board.tsx || fail "cards must show public clicks"
grep -q 'data-budget' src/app/board.tsx || fail "cards must show budget"
grep -q 'data-deadline' src/app/board.tsx || fail "cards must show deadline"
grep -q 'data-winner-rule' src/app/board.tsx || fail "cards must show winner rule"
grep -q 'Claim #1' src/app/outbid-form.tsx || fail "form missing Claim #1"
grep -q 'amount-field' src/app/outbid-form.tsx || fail "form missing dashed amount field"
grep -q 'className="step"' src/app/outbid-form.tsx || fail "form missing ± steppers"
grep -q 'Who is buying' src/app/outbid-form.tsx || fail "ticket form missing who is buying"
grep -q 'What it pays' src/app/outbid-form.tsx || fail "ticket form missing what it pays"
grep -q 'When it’s due' src/app/outbid-form.tsx || fail "ticket form missing when it’s due"
grep -q 'How a winner is chosen' src/app/outbid-form.tsx || fail "ticket form missing winner rule"
grep -q 'ticket-stub' src/app/board.css || fail "CSS missing ticket stub"
grep -q 'ticket-facts' src/app/board.css || fail "CSS missing ticket facts"
grep -q 'desk-surface' src/app/board.css || fail "CSS missing brief-desk surface"
grep -q 'empty-stamp' src/app/board.css || fail "CSS missing empty-week stamp"
if grep -qE 'grid-template-columns: 1fr 1fr' src/app/outbid-form.tsx src/app/board.tsx; then
  fail "do not ship a long generic two-column form"
fi
if grep -qiE 'proposal|portfolio gallery|chat inbox|message the buyer' src/app/board.tsx src/app/outbid-form.tsx; then
  fail "product UI must not add proposals, chat, or portfolios"
fi
grep -q 'board.css' src/app/layout.tsx || fail "root layout must load board styles"
grep -q 'older' tests/rank.test.ts || fail "rank tests missing older-wins-ties"
grep -q 'no paid brief' tests/rank.test.ts || fail "rank tests missing no-paid-brief empty week"
grep -q 'Who is buying' tests/rank.test.ts || fail "rank tests missing ticket labels"
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
grep -q 'same brief still inside last-7-days raises after the UTC week label rolls' tests/checkout.test.ts \
  || fail "checkout tests must raise a Sunday pay across Monday weekId"

echo "== live-smoke stays operator-only =="
[[ -f scripts/live-smoke.sh ]] || fail "missing scripts/live-smoke.sh"
[[ -x scripts/live-smoke.sh ]] || fail "scripts/live-smoke.sh must be executable"
[[ -f docs/live-smoke.md ]] || fail "missing docs/live-smoke.md"
[[ -s docs/live-smoke.md ]] || fail "empty docs/live-smoke.md"
[[ -f tests/live-smoke.test.ts ]] || fail "missing tests/live-smoke.test.ts"
if grep -Eq '^\s*(bash )?(\./)?scripts/live-smoke\.sh' scripts/test.sh; then
  fail "test.sh must not invoke live-smoke.sh"
fi
if grep -E '^[[:space:]]*(export[[:space:]]+)?POLAR_LIVE=1' scripts/test.sh >/dev/null; then
  fail "test.sh must not set POLAR_LIVE=1"
fi
grep -q 'BLOCKED-SECRET: POLAR_ACCESS_TOKEN' scripts/live-smoke.sh \
  || fail "live-smoke.sh must name BLOCKED-SECRET: POLAR_ACCESS_TOKEN"
grep -q 'POLAR_LIVE' scripts/live-smoke.sh \
  || fail "live-smoke.sh must gate live Polar on POLAR_LIVE"
grep -q 'sandbox.polar.sh' scripts/live-smoke.sh \
  || fail "live-smoke.sh must require a sandbox.polar.sh Checkout URL"
grep -q 'POLAR_API_BASE' scripts/live-smoke.sh \
  || fail "live-smoke.sh must pass POLAR_API_BASE to the live process"
grep -q 'live-smoke refuses CI=true' scripts/live-smoke.sh \
  || fail "live-smoke.sh must refuse CI=true"
grep -q 'PASS-ERROR' docs/live-smoke.md || fail "docs/live-smoke.md missing PASS-ERROR"
grep -q 'BLOCKED-SECRET' docs/live-smoke.md || fail "docs/live-smoke.md missing BLOCKED-SECRET"

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
grep -q 'Same canonical brief URL still inside last 7 days raises' src/app/rules/page.tsx \
  || fail "rules must name last-7-days raise identity"
grep -q 'weekId</code> stays an audit label — not raise identity' src/app/rules/page.tsx \
  || fail "occupied /rules must keep weekId as an audit label"
grep -q 'Not Monday 00:00:00.000 UTC' src/app/rules/page.tsx \
  || fail "rules must state rolling last 7 days, not Monday 00:00 UTC"
grep -q 'rolling last 7 days' src/app/rules/page.tsx \
  || fail "rules must name the rolling last-7-days window"
grep -q 'rolling last 7 days' src/app/about/page.tsx \
  || fail "about must name the rolling last-7-days window"
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
grep -q 'Open this brief' src/app/board.tsx \
  || fail "featured #1 ticket must say Open this brief"
grep -q 'data-open-brief' src/app/board.tsx \
  || fail "featured #1 ticket must mark the open-brief hop"
grep -q 'open-this-brief' src/app/board.css \
  || fail "CSS missing featured Open this brief stamp"
grep -q 'Write this ticket' src/app/outbid-form.tsx \
  || fail "occupied write ticket must say Write this ticket"
grep -q 'data-write-ticket' src/app/outbid-form.tsx \
  || fail "occupied write ticket must mark the buyer write hop"
grep -q 'write-this-ticket' src/app/board.css \
  || fail "CSS missing occupied Write this ticket stamp"
grep -q 'data-read-budget' src/app/board.tsx \
  || fail "featured #1 ticket must mark the project budget"
grep -q 'Project budget, not the bid' src/app/board.tsx \
  || fail "featured #1 ticket must say project budget is not the bid"
grep -q 'read-this-budget' src/app/board.css \
  || fail "CSS missing featured project-budget fact"
grep -q 'budget-amount' src/app/board.tsx \
  || fail "featured #1 ticket must name the project-budget amount"
if ! awk '
  /ticket-featured \.ticket-read-budget/ { fact=NR }
  /ticket-featured \.open-this-brief/ { open=NR }
  END { exit !(fact && open && fact < open) }
' src/app/board.css; then
  fail "featured CSS must paint project budget above Open this brief"
fi
grep -q 'data-read-deadline' src/app/board.tsx \
  || fail "featured #1 ticket must mark the due date"
grep -q 'Due date, not a score' src/app/board.tsx \
  || fail "featured #1 ticket must say the due date is not a score"
grep -q 'read-this-deadline' src/app/board.css \
  || fail "CSS missing featured due-date fact"
grep -q 'deadline-date' src/app/board.tsx \
  || fail "featured #1 ticket must name the submitted due date"
if ! awk '
  /ticket-featured \.ticket-read-budget/ { budget=NR }
  /ticket-featured \.ticket-read-deadline/ { fact=NR }
  /ticket-featured \.open-this-brief/ { open=NR }
  END { exit !(budget && fact && open && budget < fact && fact < open) }
' src/app/board.css; then
  fail "featured CSS must paint due date between project budget and Open this brief"
fi
grep -q 'data-read-winner' src/app/board.tsx \
  || fail "featured #1 ticket must mark the winner rule"
grep -q 'Winner rule, not a score' src/app/board.tsx \
  || fail "featured #1 ticket must say the winner rule is not a score"
grep -q 'read-this-winner' src/app/board.css \
  || fail "CSS missing featured winner-rule fact"
grep -q 'winner-rule-text' src/app/board.tsx \
  || fail "featured #1 ticket must name the submitted winner rule"
if ! awk '
  /ticket-featured \.ticket-read-budget/ { budget=NR }
  /ticket-featured \.ticket-read-deadline/ { deadline=NR }
  /ticket-featured \.ticket-read-winner/ { fact=NR }
  /ticket-featured \.open-this-brief/ { open=NR }
  END { exit !(budget && deadline && fact && open && budget < deadline && deadline < fact && fact < open) }
' src/app/board.css; then
  fail "featured CSS must paint winner rule between due date and Open this brief"
fi
grep -q 'data-write-after-rule' src/app/board.tsx \
  || fail "featured #1 ticket must mark write-after-rule"
grep -q 'after the winner rule' src/app/board.tsx \
  || fail "featured #1 ticket must say write sits after the winner rule"
grep -q 'write-after-rule' src/app/board.css \
  || fail "CSS missing featured write-after-rule hop"
grep -q 'href="#claim"' src/app/board.tsx \
  || fail "write-after-rule hop must jump to Claim #1"
if ! awk '
  /ticket-featured \.ticket-read-winner/ { fact=NR }
  /ticket-featured \.write-after-rule \{/ { hop=NR }
  /ticket-featured \.open-this-brief \{/ { open=NR }
  END { exit !(fact && hop && open && fact < open && open < hop) }
' src/app/board.css; then
  fail "featured CSS must paint Open this brief between winner rule and write-after-rule"
fi
grep -q 'data-first-click' src/app/board.tsx \
  || fail "featured #1 Open this brief must mark the first click"
grep -q '"open"' src/app/board.tsx \
  || fail "featured #1 first click must be Open this brief"
grep -q 'data-first-click="open"' src/app/board.css \
  || fail "CSS must make Open this brief win the first click"
if ! awk '
  /ticket-featured \.open-this-brief \{/ { open=NR }
  /ticket-featured \.open-this-brief\[data-first-click="open"\]/ { first=NR }
  /ticket-featured \.write-after-rule \{/ { hop=NR }
  END { exit !(open && first && hop && open < first && first < hop) }
' src/app/board.css; then
  fail "featured CSS must paint first-click Open this brief louder than write-after-rule"
fi
grep -q 'data-write-after-open' src/app/board.tsx \
  || fail "featured #1 Write this ticket must concentrate after Open this brief"
grep -q 'data-write-after-open' src/app/board.css \
  || fail "CSS must concentrate Write this ticket after Open this brief"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-write-after-open'; then
  fail "empty week must not concentrate Write this ticket after Open this brief"
fi
if ! awk '
  /ticket-featured \.open-this-brief\[data-first-click="open"\]/ { first=NR }
  /ticket-featured \.write-after-rule \{/ { hop=NR }
  /ticket-featured \.write-after-rule\[data-write-after-open\]/ { write=NR }
  END { exit !(first && hop && write && first < hop && hop < write) }
' src/app/board.css; then
  fail "featured CSS must concentrate Write this ticket after first-click Open this brief"
fi
grep -q 'data-open-after-write-first' src/app/board.tsx \
  || fail "featured #1 Open this brief must concentrate after Write this ticket"
grep -q 'data-first-read' src/app/board.tsx \
  || fail "featured #1 Open this brief must mark the first read"
grep -q 'data-open-after-write-first' src/app/board.css \
  || fail "CSS must concentrate Open this brief after Write this ticket"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-open-after-write-first'; then
  fail "empty week must not concentrate Open this brief after Write this ticket"
fi
if ! awk '
  /ticket-featured \.open-this-brief\[data-first-click="open"\]/ { first=NR }
  /ticket-featured \.open-this-brief\[data-open-after-write-first\]/ { open=NR }
  /ticket-featured \.write-after-rule\[data-write-after-open\]/ { write=NR }
  END { exit !(first && open && write && first < open && open < write) }
' src/app/board.css; then
  fail "featured CSS must concentrate Open this brief after Write this ticket"
fi
grep -q 'data-write-after-open-two' src/app/board.tsx \
  || fail "featured #1 Write this ticket must concentrate after Open this brief is re-concentrated"
grep -q 'data-write-after-open-two' src/app/board.css \
  || fail "CSS must concentrate Write this ticket after Open this brief is re-concentrated"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-write-after-open-two'; then
  fail "empty week must not concentrate Write this ticket after Open this brief is re-concentrated"
fi
if ! awk '
  /ticket-featured \.open-this-brief\[data-open-after-write-first\] \{/ { open=NR }
  /ticket-featured \.write-after-rule\[data-write-after-open\]/ { write=NR }
  /ticket-featured \.write-after-rule\[data-write-after-open-two\]/ { two=NR }
  END { exit !(open && write && two && open < write && write < two) }
' src/app/board.css; then
  fail "featured CSS must concentrate Write this ticket after Open this brief is re-concentrated"
fi
grep -q 'data-open-after-write-two' src/app/board.tsx \
  || fail "featured #1 Open this brief must concentrate after Write this ticket is re-concentrated"
grep -q 'data-open-after-write-two' src/app/board.css \
  || fail "CSS must concentrate Open this brief after Write this ticket is re-concentrated"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-open-after-write-two'; then
  fail "empty week must not concentrate Open this brief after Write this ticket is re-concentrated"
fi
if ! awk '
  /ticket-featured \.write-after-rule\[data-write-after-open-two\]/ { write=NR }
  /ticket-featured \.open-this-brief\[data-open-after-write-first\] \{/ { open=NR }
  /ticket-featured \.open-this-brief\[data-open-after-write-two\]/ { two=NR }
  END { exit !(write && open && two && open < write && write < two) }
' src/app/board.css; then
  fail "featured CSS must concentrate Open this brief after Write this ticket is re-concentrated"
fi
grep -q 'data-write-after-open-three' src/app/board.tsx \
  || fail "featured #1 Write this ticket must concentrate after Open this brief is re-concentrated again"
grep -q 'data-write-after-open-three' src/app/board.css \
  || fail "CSS must concentrate Write this ticket after Open this brief is re-concentrated again"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-write-after-open-three'; then
  fail "empty week must not concentrate Write this ticket after Open this brief is re-concentrated again"
fi
if ! awk '
  /ticket-featured \.write-after-rule\[data-write-after-open-two\]/ { write=NR }
  /ticket-featured \.open-this-brief\[data-open-after-write-two\]/ { open=NR }
  /ticket-featured \.write-after-rule\[data-write-after-open-three\]/ { three=NR }
  END { exit !(write && open && three && write < open && open < three) }
' src/app/board.css; then
  fail "featured CSS must concentrate Write this ticket after Open this brief is re-concentrated again"
fi
grep -q 'data-open-after-write-three' src/app/board.tsx \
  || fail "featured #1 Open this brief must concentrate after Write this ticket is re-concentrated again"
grep -q 'data-open-after-write-three' src/app/board.css \
  || fail "CSS must concentrate Open this brief after Write this ticket is re-concentrated again"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-open-after-write-three'; then
  fail "empty week must not concentrate Open this brief after Write this ticket is re-concentrated again"
fi
if ! awk '
  /ticket-featured \.write-after-rule\[data-write-after-open-three\]/ { write=NR }
  /ticket-featured \.open-this-brief\[data-open-after-write-two\] \{/ { open=NR }
  /ticket-featured \.open-this-brief\[data-open-after-write-three\]/ { three=NR }
  END { exit !(write && open && three && open < write && write < three) }
' src/app/board.css; then
  fail "featured CSS must concentrate Open this brief after Write this ticket is re-concentrated again"
fi
grep -q 'data-write-after-open-four' src/app/board.tsx \
  || fail "featured #1 Write this ticket must concentrate after Open this brief is re-concentrated a fourth time"
grep -q 'data-write-after-open-four' src/app/board.css \
  || fail "CSS must concentrate Write this ticket after Open this brief is re-concentrated a fourth time"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-write-after-open-four'; then
  fail "empty week must not concentrate Write this ticket after Open this brief is re-concentrated a fourth time"
fi
if ! awk '
  /ticket-featured \.write-after-rule\[data-write-after-open-three\]/ { write=NR }
  /ticket-featured \.open-this-brief\[data-open-after-write-three\]/ { open=NR }
  /ticket-featured \.write-after-rule\[data-write-after-open-four\]/ { four=NR }
  END { exit !(write && open && four && write < open && open < four) }
' src/app/board.css; then
  fail "featured CSS must concentrate Write this ticket after Open this brief is re-concentrated a fourth time"
fi
grep -q 'data-open-after-write-four' src/app/board.tsx \
  || fail "featured #1 Open this brief must concentrate after Write this ticket is re-concentrated a fourth time"
grep -q 'data-open-after-write-four' src/app/board.css \
  || fail "CSS must concentrate Open this brief after Write this ticket is re-concentrated a fourth time"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-open-after-write-four'; then
  fail "empty week must not concentrate Open this brief after Write this ticket is re-concentrated a fourth time"
fi
if ! awk '
  /ticket-featured \.write-after-rule\[data-write-after-open-four\]/ { write=NR }
  /ticket-featured \.open-this-brief\[data-open-after-write-three\] \{/ { open=NR }
  /ticket-featured \.open-this-brief\[data-open-after-write-four\]/ { four=NR }
  END { exit !(write && open && four && open < write && write < four) }
' src/app/board.css; then
  fail "featured CSS must concentrate Open this brief after Write this ticket is re-concentrated a fourth time"
fi
grep -q 'data-write-after-open-five' src/app/board.tsx \
  || fail "featured #1 Write this ticket must concentrate after Open this brief is re-concentrated a fifth time"
grep -q 'data-write-after-open-five' src/app/board.css \
  || fail "CSS must concentrate Write this ticket after Open this brief is re-concentrated a fifth time"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-write-after-open-five'; then
  fail "empty week must not concentrate Write this ticket after Open this brief is re-concentrated a fifth time"
fi
if ! awk '
  /ticket-featured \.write-after-rule\[data-write-after-open-four\]/ { write=NR }
  /ticket-featured \.open-this-brief\[data-open-after-write-four\]/ { open=NR }
  /ticket-featured \.write-after-rule\[data-write-after-open-five\]/ { five=NR }
  END { exit !(write && open && five && write < open && open < five) }
' src/app/board.css; then
  fail "featured CSS must concentrate Write this ticket after Open this brief is re-concentrated a fifth time"
fi
grep -q 'data-open-after-write-five' src/app/board.tsx \
  || fail "featured #1 Open this brief must concentrate after Write this ticket is re-concentrated a fifth time"
grep -q 'data-open-after-write-five' src/app/board.css \
  || fail "CSS must concentrate Open this brief after Write this ticket is re-concentrated a fifth time"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-open-after-write-five'; then
  fail "empty week must not concentrate Open this brief after Write this ticket is re-concentrated a fifth time"
fi
if ! awk '
  /ticket-featured \.write-after-rule\[data-write-after-open-five\]/ { write=NR }
  /ticket-featured \.open-this-brief\[data-open-after-write-four\] \{/ { open=NR }
  /ticket-featured \.open-this-brief\[data-open-after-write-five\]/ { five=NR }
  END { exit !(write && open && five && open < write && write < five) }
' src/app/board.css; then
  fail "featured CSS must concentrate Open this brief after Write this ticket is re-concentrated a fifth time"
fi
grep -q 'data-write-after-open-six' src/app/board.tsx \
  || fail "featured #1 Write this ticket must concentrate after Open this brief is re-concentrated a sixth time"
grep -q 'data-write-after-open-six' src/app/board.css \
  || fail "CSS must concentrate Write this ticket after Open this brief is re-concentrated a sixth time"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-write-after-open-six'; then
  fail "empty week must not concentrate Write this ticket after Open this brief is re-concentrated a sixth time"
fi
if ! awk '
  /ticket-featured \.write-after-rule\[data-write-after-open-five\]/ { write=NR }
  /ticket-featured \.open-this-brief\[data-open-after-write-five\]/ { open=NR }
  /ticket-featured \.write-after-rule\[data-write-after-open-six\]/ { six=NR }
  END { exit !(write && open && six && write < open && open < six) }
' src/app/board.css; then
  fail "featured CSS must concentrate Write this ticket after Open this brief is re-concentrated a sixth time"
fi
grep -q 'data-prize-before-price' src/app/board.tsx \
  || fail "featured #1 ticket must stamp prize before price"
grep -q 'data-prize=' src/app/board.tsx \
  || fail "featured #1 ticket must mark the winner rule as the prize"
grep -q 'prize-before-price' src/app/board.tsx \
  || fail "featured #1 winner rule must use the prize-before-price class"
grep -q 'ticket-bid-later' src/app/board.tsx \
  || fail "featured #1 ticket must keep \$bid + clicks as a later fact"
grep -q 'ticket-featured .prize-before-price .winner-rule-text' src/app/board.css \
  || fail "CSS must enlarge #1 winner rule over \$bid"
grep -Fq 'ticket-featured[data-prize-before-price] .ticket-bid-later .bid' src/app/board.css \
  || fail "CSS must keep #1 \$bid quieter than the winner rule"
grep -Fq 'ticket-featured[data-prize-before-price] .ticket-bid-later .clicks' src/app/board.css \
  || fail "CSS must keep #1 clicks quieter than the winner rule"
grep -q '.hopper .bid' src/app/board.css \
  || fail "CSS must keep hopper ranks quieter than featured #1"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'prize-before-price'; then
  fail "empty week must not stamp prize before price"
fi
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-prize'; then
  fail "empty week must not mark a prize"
fi
if grep -qE 'data-write-after-open-seven|data-open-after-write-six' src/app/board.tsx src/app/board.css; then
  fail "prize before price must not add another numbered hop stamp"
fi
python3 - src/app/board.css <<'PY' || fail "#1 winner rule must be larger than \$bid and clicks"
import re
import sys
css = open(sys.argv[1], encoding="utf-8").read()

def size(pattern):
    match = re.search(pattern, css, re.S)
    if not match:
        raise SystemExit(1)
    return float(match.group(1))

prize = size(r"\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem")
bid = size(r"\.ticket-featured\[data-prize-before-price\] \.ticket-bid-later \.bid\s*\{[^}]*font-size:\s*([\d.]+)rem")
clicks = size(r"\.ticket-featured\[data-prize-before-price\] \.ticket-bid-later \.clicks\s*\{[^}]*font-size:\s*([\d.]+)rem")
if not (prize > bid and prize > clicks):
    raise SystemExit(1)
PY
grep -q 'winner rule is the prize before' tests/rank.test.ts \
  || fail "rank tests must cover prize-before-price on occupied #1"
grep -q 'data-prize-before-price' tests/rank.test.ts \
  || fail "rank tests must stamp the occupied #1 prize"
if ! awk '
  /ticket-featured \.ticket-read-winner/ { winner=NR }
  /ticket-featured \.prize-before-price \.winner-rule-text/ { prize=NR }
  /ticket-featured\[data-prize-before-price\] \.ticket-bid-later \.bid/ { bid=NR }
  /ticket-featured \.open-this-brief \{/ { open=NR }
  END { exit !(winner && prize && bid && open && winner < prize && prize < bid && bid < open) }
' src/app/board.css; then
  fail "featured CSS must paint the winner-rule prize before quieter \$bid and Open this brief"
fi

echo "== UX: occupied rank is the bid; budget stays a later fact =="
grep -q 'data-rank-is-bid' src/app/board.tsx \
  || fail "featured #1 ticket must stamp rank is the bid"
grep -q 'data-rank-bid' src/app/board.tsx \
  || fail "featured #1 $bid must mark the paid bid as rank"
grep -q 'rank-is-bid' src/app/board.tsx \
  || fail "featured #1 $bid must use the rank-is-bid class"
grep -q 'data-budget-later' src/app/board.tsx \
  || fail "featured #1 ticket must keep project budget as a later fact"
grep -q 'Project budget, not the bid' src/app/board.tsx \
  || fail "featured #1 ticket must say project budget is not the bid"
grep -Fq 'ticket-featured[data-rank-is-bid] .ticket-bid-later .rank-is-bid' src/app/board.css \
  || fail "CSS must make #1 rank the paid bid after the prize"
grep -Fq 'ticket-featured[data-rank-is-bid] [data-budget-later] .budget-amount' src/app/board.css \
  || fail "CSS must keep #1 project budget quieter than rank"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-rank-is-bid'; then
  fail "empty week must not stamp rank is the bid"
fi
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-budget-later'; then
  fail "empty week must not stamp a later project budget"
fi
if grep -qE 'data-write-after-open-seven|data-open-after-write-six' src/app/board.tsx src/app/board.css; then
  fail "rank is the bid must not add another numbered hop stamp"
fi
python3 - src/app/board.css <<'PY' || fail "#1 rank bid must be larger than project budget"
import re
import sys
css = open(sys.argv[1], encoding="utf-8").read()

def size(pattern):
    match = re.search(pattern, css, re.S)
    if not match:
        raise SystemExit(1)
    return float(match.group(1))

prize = size(r"\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem")
rank = size(r"\.ticket-featured\[data-rank-is-bid\] \.ticket-bid-later \.rank-is-bid\s*\{[^}]*font-size:\s*([\d.]+)rem")
budget = size(r"\.ticket-featured\[data-rank-is-bid\] \[data-budget-later\] \.budget-amount\s*\{[^}]*font-size:\s*([\d.]+)rem")
if not (prize > rank and rank > budget):
    raise SystemExit(1)
PY
grep -q 'rank is the bid; project budget stays a later fact' tests/rank.test.ts \
  || fail "rank tests must cover occupied #1 rank is the bid"
grep -q 'data-rank-is-bid' tests/rank.test.ts \
  || fail "rank tests must stamp occupied #1 rank is the bid"
if ! awk '
  /ticket-featured \.prize-before-price \.winner-rule-text/ { prize=NR }
  /ticket-featured\[data-rank-is-bid\] \[data-budget-later\] \.budget-amount/ { budget=NR }
  /ticket-featured\[data-rank-is-bid\] \.ticket-bid-later \.rank-is-bid/ { rank=NR }
  /ticket-featured \.open-this-brief \{/ { open=NR }
  END { exit !(prize && budget && rank && open && prize < rank && budget < rank && rank < open) }
' src/app/board.css; then
  fail "featured CSS must paint quieter project budget before rank \$bid after the prize"
fi

echo "== UX: empty week stays Claim #1 + No paid brief =="
grep -q 'data-empty-ticket' src/app/board.tsx \
  || fail "empty week must stamp Claim #1 + No paid brief so occupied chrome cannot leak"
grep -q 'data-empty-ticket' src/app/outbid-form.tsx \
  || fail "empty Claim #1 must stamp so occupied Write cannot leak"
grep -Fq '.board[data-empty-ticket]' src/app/board.css \
  || fail "empty-ticket CSS must hide occupied prize / Write / Open on an empty week"
empty_ticket_rule="$(awk '/^\.board\[data-empty-ticket\] \.ticket-featured,/,/^\}/' src/app/board.css)"
echo "$empty_ticket_rule" | grep -q 'display: none' \
  || fail "empty-ticket CSS must hide occupied prize / Write / Open"
echo "$empty_ticket_rule" | grep -q 'prize-before-price' \
  || fail "empty-ticket CSS must hide prize-before-price"
echo "$empty_ticket_rule" | grep -q 'data-rank-is-bid' \
  || fail "empty-ticket CSS must hide rank-is-bid"
echo "$empty_ticket_rule" | grep -q 'data-budget-later' \
  || fail "empty-ticket CSS must hide later project budget"
echo "$empty_ticket_rule" | grep -q 'open-this-brief' \
  || fail "empty-ticket CSS must hide Open this brief"
echo "$empty_ticket_rule" | grep -q 'p.write-this-ticket' \
  || fail "empty-ticket CSS must hide Write this ticket"
echo "$empty_ticket_rule" | grep -q 'write-after-rule' \
  || fail "empty-ticket CSS must hide write-after-rule"
echo "$empty_ticket_rule" | grep -q 'data-write-later-quiet' \
  || fail "empty-ticket CSS must hide quieter occupied Write"
if echo "$empty_ticket_rule" | grep -q 'background:'; then
  fail "empty-ticket must hide occupied chrome, not recolor the desk"
fi
grep -q 'empty week stays Claim #1 + No paid brief without prize' tests/rank.test.ts \
  || fail "rank tests must cover empty week staying Claim #1 + No paid brief"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'prize-before-price'; then
  fail "empty week must not stamp prize before price"
fi
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'Open this brief'; then
  fail "empty week must not invent Open this brief"
fi
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'Write this ticket'; then
  fail "empty week must not invent Write this ticket"
fi
if grep -qE 'data-write-after-open-seven|data-open-after-write-six' src/app/board.tsx src/app/board.css src/app/outbid-form.tsx; then
  fail "empty ticket must not add another numbered hop stamp"
fi
grep -q 'data-prize-before-price' src/app/board.tsx \
  || fail "empty ticket cut must keep occupied prize before price"
grep -q 'Open this brief' src/app/board.tsx \
  || fail "empty ticket cut must keep occupied Open this brief"
grep -q 'Write this ticket' src/app/outbid-form.tsx \
  || fail "empty ticket cut must keep occupied Write this ticket"
grep -q 'Claim #1' src/app/outbid-form.tsx \
  || fail "empty ticket cut must leave Claim #1 on the form"
grep -q 'desk-surface-empty' src/app/board.tsx \
  || fail "empty ticket cut must not rebuild the ticket desk"
if grep -qE 'grid-template-columns: 1fr 1fr' src/app/outbid-form.tsx src/app/board.tsx; then
  fail "empty ticket cut must not rebuild the ticket desk into a long form"
fi

echo "== UX: occupied Open this brief stays the first freelancer click =="
grep -q 'data-write-later-quiet' src/app/board.tsx \
  || fail "featured Write this ticket must recede so Open this brief stays first"
grep -q 'data-write-later-quiet' src/app/outbid-form.tsx \
  || fail "occupied Write this ticket stamp must recede so Open this brief stays first"
grep -q 'data-first-click={featured ? "open" : undefined}' src/app/board.tsx \
  || fail "featured #1 first click must stay Open this brief"
grep -q 'data-prize=' src/app/board.tsx \
  || fail "featured #1 winner rule must stay the prize"
grep -q 'data-rank-is-bid' src/app/board.tsx \
  || fail "featured #1 rank must stay the bid"
grep -q 'data-budget-later' src/app/board.tsx \
  || fail "featured #1 project budget must stay a later fact"
grep -Fq '.ticket-featured a.write-after-rule[data-write-later-quiet]' src/app/board.css \
  || fail "CSS must recede Write this ticket after Open this brief"
grep -Fq '.write-this-ticket[data-write-later-quiet]' src/app/board.css \
  || fail "CSS must recede the occupied Write this ticket stamp"
grep -Fq '.board[data-empty-ticket] [data-write-later-quiet]' src/app/board.css \
  || fail "empty-ticket CSS must hide quieter Write"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-write-later-quiet'; then
  fail "empty week must not recede Write this ticket"
fi
if grep -qE 'data-write-after-open-seven|data-open-after-write-six' src/app/board.tsx src/app/board.css src/app/outbid-form.tsx; then
  fail "open-brief-first must not add another numbered hop stamp"
fi
if grep -n 'data-first-click' -A 12 src/app/board.tsx | grep -q 'data-write-later-quiet'; then
  fail "Open this brief must not stamp quieter Write"
fi
python3 - src/app/board.css <<'PY' || fail "Open this brief must stay larger than quieter Write, \$bid, and budget"
import re
import sys
css = open(sys.argv[1], encoding="utf-8").read()

def size(pattern):
    match = re.search(pattern, css, re.S)
    if not match:
        raise SystemExit(1)
    return float(match.group(1))

open_sz = size(r"\.ticket-featured \.open-this-brief\[data-open-after-write-five\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
write_sz = size(r"\.ticket-featured a\.write-after-rule\[data-write-later-quiet\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
bid_sz = size(r"\.ticket-featured\[data-rank-is-bid\] \.ticket-bid-later \.rank-is-bid\s*\{[^}]*font-size:\s*([\d.]+)rem")
budget_sz = size(r"\.ticket-featured\[data-rank-is-bid\] \[data-budget-later\] \.budget-amount\s*\{[^}]*font-size:\s*([\d.]+)rem")
prize_sz = size(r"\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem")
if not (open_sz > write_sz and open_sz > bid_sz and open_sz > budget_sz and prize_sz > bid_sz):
    raise SystemExit(1)
write_block = re.search(
    r"\.ticket-featured a\.write-after-rule\[data-write-later-quiet\]\s*\{[^}]*\}",
    css,
    re.S,
)
if not write_block or "var(--muted)" not in write_block.group(0):
    raise SystemExit(1)
if write_block and "var(--stamp)" in write_block.group(0):
    raise SystemExit(1)
if "background:" in write_block.group(0):
    raise SystemExit(1)
PY
grep -q 'Open this brief stays the first freelancer click; Write this ticket recedes' tests/rank.test.ts \
  || fail "rank tests must keep occupied Open this brief the first freelancer click"
if ! awk '
  /ticket-featured \.prize-before-price \.winner-rule-text/ { prize=NR }
  /ticket-featured\[data-rank-is-bid\] \[data-budget-later\] \.budget-amount/ { budget=NR }
  /ticket-featured\[data-rank-is-bid\] \.ticket-bid-later \.rank-is-bid/ { rank=NR }
  /ticket-featured \.open-this-brief \{/ { open=NR }
  /ticket-featured a\.write-after-rule\[data-write-later-quiet\]/ { write=NR }
  END { exit !(prize && budget && rank && open && write && prize < rank && budget < rank && rank < open && open < write) }
' src/app/board.css; then
  fail "featured CSS must recede Write after first-click Open this brief"
fi

echo "== UX: empty week stays Claim #1 — Open / Write cannot leak =="
grep -q 'board desk week-empty' src/app/board.tsx \
  || fail "empty week must wrap in week-empty so occupied Open / Write cannot leak"
grep -q 'board desk week-occupied' src/app/board.tsx \
  || fail "occupied week must wrap in week-occupied so Open / Write CSS stay scoped"
grep -q 'data-week-empty' src/app/board.tsx \
  || fail "empty week must stamp data-week-empty"
grep -q 'data-week-occupied' src/app/board.tsx \
  || fail "occupied week must stamp data-week-occupied"
grep -q 'empty week stays Claim #1 — Open / Write cannot leak' tests/rank.test.ts \
  || fail "rank tests must cover empty week isolation so Open / Write cannot leak"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'Open this brief'; then
  fail "empty week must not invent Open this brief"
fi
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'Write this ticket'; then
  fail "empty week must not invent Write this ticket"
fi
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'prize-before-price'; then
  fail "empty week must not stamp prize before price"
fi
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-write-later-quiet'; then
  fail "empty week must not recede Write this ticket"
fi
if grep -qE 'data-write-after-open-seven|data-open-after-write-six' src/app/board.tsx src/app/board.css src/app/outbid-form.tsx; then
  fail "empty isolation must not add another numbered hop stamp"
fi
grep -q 'data-empty-ticket' src/app/board.tsx \
  || fail "empty isolation must keep Claim #1 + No paid brief"
grep -q 'data-empty-ticket' src/app/outbid-form.tsx \
  || fail "empty isolation must keep empty Claim #1 stamped"
grep -q 'No paid brief' src/app/board.tsx \
  || fail "empty isolation must keep No paid brief"
grep -q 'Claim #1' src/app/outbid-form.tsx \
  || fail "empty isolation must leave Claim #1 on the form"
grep -q 'Open this brief' src/app/board.tsx \
  || fail "empty isolation must keep occupied Open this brief"
grep -q 'Write this ticket' src/app/outbid-form.tsx \
  || fail "empty isolation must keep occupied Write this ticket"
grep -q 'data-first-click={featured ? "open" : undefined}' src/app/board.tsx \
  || fail "empty isolation must keep occupied Open this brief the first click"
grep -q 'data-write-later-quiet' src/app/board.tsx \
  || fail "empty isolation must keep occupied Write receded"
grep -q 'data-prize-before-price' src/app/board.tsx \
  || fail "empty isolation must keep occupied prize before price"
grep -q 'data-rank-is-bid' src/app/board.tsx \
  || fail "empty isolation must keep occupied rank as the bid"
grep -q 'data-budget-later' src/app/board.tsx \
  || fail "empty isolation must keep occupied project budget as a later fact"
grep -q 'desk-surface-empty' src/app/board.tsx \
  || fail "empty isolation must not rebuild the ticket desk"
grep -q 'amount-field' src/app/outbid-form.tsx \
  || fail "empty isolation must keep the dashed amount"
grep -q 'Outbid' src/app/outbid-form.tsx \
  || fail "empty isolation must keep Outbid"
if grep -qE 'grid-template-columns: 1fr 1fr' src/app/outbid-form.tsx src/app/board.tsx; then
  fail "empty isolation must not rebuild the ticket desk into a long form"
fi
grep -Fq '.week-empty[data-empty-ticket] .open-this-brief' src/app/board.css \
  || fail "empty week shell must hide leaked Open this brief"
grep -Fq '.week-empty[data-empty-ticket] p.write-this-ticket' src/app/board.css \
  || fail "empty week shell must hide leaked Write this ticket"
grep -Fq '.week-empty[data-empty-ticket] [data-prize]' src/app/board.css \
  || fail "empty week shell must hide leaked prize chrome"
grep -Fq '.week-empty[data-empty-ticket] [data-write-later-quiet]' src/app/board.css \
  || fail "empty week shell must hide leaked quieter Write"
grep -Fq '.week-empty .open-this-brief' src/app/board.css \
  || fail "empty week shell must hide leaked Open pills"
grep -Fq '.week-empty .write-after-rule' src/app/board.css \
  || fail "empty week shell must hide leaked Write hops"
grep -Fq '.week-occupied .empty-week' src/app/board.css \
  || fail "occupied week shell must hide empty-week chrome"
grep -Fq '.week-occupied .ticket-featured .open-this-brief {' src/app/board.css \
  || fail "Open this brief CSS must be scoped to week-occupied"
grep -Fq '.week-occupied .ticket-featured a.write-after-rule[data-write-later-quiet]' src/app/board.css \
  || fail "quieter Write CSS must be scoped to week-occupied"
grep -Fq '.week-occupied .write-this-ticket[data-write-later-quiet]' src/app/board.css \
  || fail "occupied Write stamp CSS must be scoped to week-occupied"
grep -Fq '.week-occupied .ticket-featured .prize-before-price .winner-rule-text' src/app/board.css \
  || fail "prize CSS must be scoped to week-occupied"
grep -Fq '.week-occupied .ticket-featured[data-rank-is-bid] .ticket-bid-later .rank-is-bid' src/app/board.css \
  || fail "rank-is-bid CSS must be scoped to week-occupied"
if grep -E '^\.ticket-featured' src/app/board.css; then
  fail "featured Open / prize CSS must not apply outside week-occupied"
fi
if grep -E '^\.write-this-ticket' src/app/board.css; then
  fail "Write this ticket CSS must not apply outside week-occupied"
fi
empty_no_open_rule="$(awk '/^\.board\[data-empty-ticket\] \.ticket-featured,/,/^\}/' src/app/board.css)"
echo "$empty_no_open_rule" | grep -q 'display: none' \
  || fail "empty week CSS must hide occupied Open / Write / prize"
echo "$empty_no_open_rule" | grep -q 'week-empty\[data-empty-ticket\] \.open-this-brief' \
  || fail "empty week CSS must hide leaked Open on the week-empty shell"
echo "$empty_no_open_rule" | grep -q 'week-empty \.write-after-rule' \
  || fail "empty week CSS must hide leaked Write on the week-empty shell"
if echo "$empty_no_open_rule" | grep -q 'background:'; then
  fail "empty isolation must hide occupied chrome, not recolor the desk"
fi
if grep -qE 'grid-template-columns: 1fr 1fr' src/app/outbid-form.tsx src/app/board.tsx; then
  fail "empty isolation must not rebuild the ticket desk into a stacked layout"
fi

echo "== UX: occupied later Write this ticket stays quieter than Open this brief =="
grep -q 'ticket-write-later' src/app/board.tsx \
  || fail "featured Write this ticket must sit in a later foot after Open this brief"
grep -q 'data-write-later' src/app/board.tsx \
  || fail "featured Write this ticket must stamp later Write"
grep -q 'data-write-later' src/app/outbid-form.tsx \
  || fail "occupied claim must stamp later Write so it recedes after Open"
grep -q 'claim ticket-blank write-later' src/app/outbid-form.tsx \
  || fail "occupied claim must use the later Write class"
grep -q 'data-first-click={featured ? "open" : undefined}' src/app/board.tsx \
  || fail "later Write cut must keep Open this brief the first occupied click"
grep -q 'data-prize=' src/app/board.tsx \
  || fail "later Write cut must keep the winner rule as the prize"
grep -q 'data-rank-is-bid' src/app/board.tsx \
  || fail "later Write cut must keep rank as the bid"
grep -q 'data-budget-later' src/app/board.tsx \
  || fail "later Write cut must keep project budget as a later fact"
grep -q 'Claim #1' src/app/outbid-form.tsx \
  || fail "later Write cut must keep Claim #1"
grep -q 'No paid brief' src/app/board.tsx \
  || fail "later Write cut must keep empty No paid brief"
grep -q 'Open this brief' src/app/board.tsx \
  || fail "later Write cut must keep Open this brief"
grep -q 'Write this ticket' src/app/outbid-form.tsx \
  || fail "later Write cut must keep Write this ticket"
grep -q 'amount-field' src/app/outbid-form.tsx \
  || fail "later Write cut must keep the dashed amount"
grep -q 'className="step"' src/app/outbid-form.tsx \
  || fail "later Write cut must keep ± steppers"
grep -q 'Outbid' src/app/outbid-form.tsx \
  || fail "later Write cut must keep Outbid"
grep -Fq '.week-occupied .desk-surface {' src/app/board.css \
  || fail "occupied desk must stack Open this brief before later Write"
grep -Fq '.week-occupied .ticket-featured .ticket-write-later' src/app/board.css \
  || fail "CSS must compose later Write as a ticket foot"
grep -Fq '.week-occupied .claim-after-ticket[data-claim-after-ticket] .claim.write-later[data-write-later]' src/app/board.css \
  || fail "CSS must stack later Write claim after Open this brief"
grep -Fq '.week-occupied .ticket-featured .ticket-write-later a.write-after-rule[data-write-later-quiet]' src/app/board.css \
  || fail "CSS must keep later Write an unboxed hop after Open"
grep -Fq '.board[data-empty-ticket] .ticket-write-later' src/app/board.css \
  || fail "empty-ticket CSS must hide later Write foot"
grep -Fq '.week-empty .ticket-write-later' src/app/board.css \
  || fail "empty week shell must hide later Write foot"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'ticket-write-later'; then
  fail "empty week must not invent a later Write foot"
fi
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-write-later'; then
  fail "empty week must not stamp later Write"
fi
if grep -qE 'data-write-after-open-seven|data-open-after-write-six' src/app/board.tsx src/app/board.css src/app/outbid-form.tsx; then
  fail "later Write must not add another numbered hop stamp"
fi
if grep -qE 'grid-template-columns: 1fr 1fr' src/app/outbid-form.tsx src/app/board.tsx; then
  fail "later Write must not rebuild the ticket desk into a long form"
fi
python3 - src/app/board.css <<'PY' || fail "later Write must stay quieter than Open this brief and the winner-rule prize"
import re
import sys
css = open(sys.argv[1], encoding="utf-8").read()

def size(pattern):
    match = re.search(pattern, css, re.S)
    if not match:
        raise SystemExit(1)
    return float(match.group(1))

open_sz = size(r"\.ticket-featured \.open-this-brief\[data-open-after-write-five\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
write_sz = size(r"\.ticket-featured a\.write-after-rule\[data-write-later-quiet\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
prize_sz = size(r"\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem")
bid_sz = size(r"\.ticket-featured\[data-rank-is-bid\] \.ticket-bid-later \.rank-is-bid\s*\{[^}]*font-size:\s*([\d.]+)rem")
if not (open_sz > write_sz and prize_sz > write_sz and open_sz > bid_sz and prize_sz > bid_sz):
    raise SystemExit(1)
foot = re.search(r"\.week-occupied \.ticket-featured \.ticket-write-later\s*\{[^}]*\}", css, re.S)
hop = re.search(
    r"\.week-occupied \.ticket-featured \.ticket-write-later a\.write-after-rule\[data-write-later-quiet\]\s*\{[^}]*\}",
    css,
    re.S,
)
if not foot or "border-top" not in foot.group(0):
    raise SystemExit(1)
if not hop or "display: inline" not in hop.group(0) or "var(--muted)" not in hop.group(0):
    raise SystemExit(1)
if "var(--stamp)" in hop.group(0) or "min-height: 2" in hop.group(0):
    raise SystemExit(1)
if "background:" in hop.group(0):
    raise SystemExit(1)
PY
if ! awk '
  /week-occupied \.desk-surface \{/ { stack=NR }
  /ticket-featured \.prize-before-price \.winner-rule-text/ { prize=NR }
  /ticket-featured \.open-this-brief \{/ { open=NR }
  /ticket-featured \.ticket-write-later \{/ { foot=NR }
  /ticket-featured a\.write-after-rule\[data-write-later-quiet\]/ { write=NR }
  END { exit !(stack && prize && open && foot && write && stack < prize && prize < open && open < foot && foot < write) }
' src/app/board.css; then
  fail "featured CSS must stack later Write after prize and Open this brief"
fi
grep -q 'occupied later Write this ticket stays quieter than Open this brief' tests/rank.test.ts \
  || fail "rank tests must cover later Write quieter than Open this brief"
grep -q 'desk-surface-empty' src/app/board.tsx \
  || fail "later Write cut must not rebuild the empty ticket desk"

echo "== UX: occupied later-rank tickets stay quieter than #1 — winner rule stays the prize =="
grep -q 'function LaterRankTicket' src/app/board.tsx \
  || fail "later ranks must use a later-ticket composition, not the #1 prize card"
grep -q 'ticket-later' src/app/board.tsx \
  || fail "later ranks must use ticket-later anatomy"
grep -q 'data-later-rank' src/app/board.tsx \
  || fail "later ranks must stamp data-later-rank"
grep -q 'data-later-pack' src/app/board.tsx \
  || fail "later ranks must group in a later pack"
grep -q 'These tickets are not the last 7 days’ #1 prize' src/app/board.tsx \
  || fail "later pack must say later tickets are not the #1 prize"
grep -q 'data-later-open' src/app/board.tsx \
  || fail "later ranks must keep a quieter Open brief hop"
grep -q 'Open brief' src/app/board.tsx \
  || fail "later ranks must keep Open brief"
grep -q 'data-first-click={featured ? "open" : undefined}' src/app/board.tsx \
  || fail "later-rank cut must keep Open this brief the first occupied click"
grep -q 'data-prize=' src/app/board.tsx \
  || fail "later-rank cut must keep the winner rule as the prize"
grep -q 'data-rank-is-bid' src/app/board.tsx \
  || fail "later-rank cut must keep rank as the bid"
grep -q 'ticket-write-later' src/app/board.tsx \
  || fail "later-rank cut must keep Write as a later foot"
grep -q 'Claim #1' src/app/outbid-form.tsx \
  || fail "later-rank cut must keep Claim #1"
grep -q 'No paid brief' src/app/board.tsx \
  || fail "later-rank cut must keep empty No paid brief"
grep -q 'Open this brief' src/app/board.tsx \
  || fail "later-rank cut must keep Open this brief"
grep -q 'Write this ticket' src/app/outbid-form.tsx \
  || fail "later-rank cut must keep Write this ticket"
grep -q 'amount-field' src/app/outbid-form.tsx \
  || fail "later-rank cut must keep the dashed amount"
grep -q 'className="step"' src/app/outbid-form.tsx \
  || fail "later-rank cut must keep ± steppers"
grep -q 'Outbid' src/app/outbid-form.tsx \
  || fail "later-rank cut must keep Outbid"
grep -q 'desk-surface-empty' src/app/board.tsx \
  || fail "later-rank cut must not rebuild the empty ticket desk"
grep -Fq '.week-occupied .hopper.later-pack[data-later-pack]' src/app/board.css \
  || fail "CSS must group later ranks in a hopper pack after #1"
grep -Fq '.week-occupied .hopper .ticket-later[data-later-rank]' src/app/board.css \
  || fail "CSS must compose later ranks as hopper slips"
grep -Fq '.week-occupied .hopper .ticket-later[data-later-rank] .later-rule .winner-rule' src/app/board.css \
  || fail "CSS must keep later winner-rule copy quieter than the #1 prize"
grep -Fq '.week-occupied .hopper .ticket-later[data-later-rank] a.later-open[data-later-open]' src/app/board.css \
  || fail "CSS must keep later Open brief quieter than Open this brief"
grep -Fq '.board[data-empty-ticket] .later-pack' src/app/board.css \
  || fail "empty-ticket CSS must hide later-rank pack"
grep -Fq '.week-empty .ticket-later' src/app/board.css \
  || fail "empty week shell must hide later-rank tickets"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'ticket-later'; then
  fail "empty week must not invent later-rank tickets"
fi
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'data-later-rank'; then
  fail "empty week must not stamp later ranks"
fi
if grep -qE 'data-write-after-open-seven|data-open-after-write-six' src/app/board.tsx src/app/board.css src/app/outbid-form.tsx; then
  fail "later-rank quiet must not add another numbered hop stamp"
fi
if grep -qE 'grid-template-columns: 1fr 1fr' src/app/outbid-form.tsx src/app/board.tsx; then
  fail "later-rank quiet must not rebuild the ticket desk into a long form"
fi
if awk '/function LaterRankTicket/,/export function ListingCard/' src/app/board.tsx | grep -q 'data-prize='; then
  fail "later ranks must not wear the #1 prize stamp"
fi
if awk '/function LaterRankTicket/,/export function ListingCard/' src/app/board.tsx | grep -q 'Open this brief'; then
  fail "later ranks must not wear Open this brief"
fi
if awk '/function LaterRankTicket/,/export function ListingCard/' src/app/board.tsx | grep -q 'ticket-featured'; then
  fail "later ranks must not reuse featured ticket chrome"
fi
if awk '/function LaterRankTicket/,/export function ListingCard/' src/app/board.tsx | grep -q 'ticket-facts'; then
  fail "later ranks must not reuse #1 ticket-facts anatomy"
fi
python3 - src/app/board.css src/app/board.tsx <<'PY' || fail "later ranks must stay quieter than the #1 winner-rule prize without recolor or a new hop"
import re
import sys
css = open(sys.argv[1], encoding="utf-8").read()
board = open(sys.argv[2], encoding="utf-8").read()

def size(pattern):
    match = re.search(pattern, css, re.S)
    if not match:
        raise SystemExit(1)
    return float(match.group(1))

prize = size(r"\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem")
later_rule = size(r"\.hopper \.ticket-later\[data-later-rank\] \.later-rule \.winner-rule\s*\{[^}]*font-size:\s*([\d.]+)rem")
later_buyer = size(r"\.hopper \.ticket-later\[data-later-rank\] \.later-buyer\s*\{[^}]*font-size:\s*([\d.]+)rem")
later_open = size(r"\.hopper \.ticket-later\[data-later-rank\] a\.later-open\[data-later-open\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
open_sz = size(r"\.ticket-featured \.open-this-brief\[data-open-after-write-five\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
if not (prize > later_rule and prize > later_buyer and open_sz > later_open):
    raise SystemExit(1)
pack = re.search(r"\.week-occupied \.hopper\.later-pack\[data-later-pack\]\s*\{[^}]*\}", css, re.S)
slip = re.search(r"\.week-occupied \.hopper \.ticket-later\[data-later-rank\]\s*\{[^}]*\}", css, re.S)
hop = re.search(
    r"\.week-occupied \.hopper \.ticket-later\[data-later-rank\] a\.later-open\[data-later-open\]\s*\{[^}]*\}",
    css,
    re.S,
)
if not pack or "border-top" not in pack.group(0):
    raise SystemExit(1)
if not slip or "box-shadow: none" not in slip.group(0) or "border: 1px dashed var(--rule)" not in slip.group(0):
    raise SystemExit(1)
if "background:" in slip.group(0) and "var(--paper)" not in slip.group(0):
    raise SystemExit(1)
if not hop or "display: inline" not in hop.group(0) or "var(--muted)" not in hop.group(0):
    raise SystemExit(1)
if "var(--stamp)" in hop.group(0) or "min-height: 2" in hop.group(0) or "background:" in hop.group(0):
    raise SystemExit(1)
later_fn = board.split("function LaterRankTicket", 1)[-1].split("export function ListingCard", 1)[0]
if "data-prize" in later_fn or "Open this brief" in later_fn or "ticket-featured" in later_fn:
    raise SystemExit(1)
if "ticket-facts" in later_fn or "data-write-later" in later_fn:
    raise SystemExit(1)
if "data-write-after-open-seven" in board or "data-open-after-write-six" in board:
    raise SystemExit(1)
PY
if ! awk '
  /ticket-featured \.prize-before-price \.winner-rule-text/ { prize=NR }
  /ticket-featured \.open-this-brief \{/ { open=NR }
  /ticket-featured \.ticket-write-later \{/ { foot=NR }
  /week-occupied \.hopper\.later-pack\[data-later-pack\] \{/ { pack=NR }
  /hopper \.ticket-later\[data-later-rank\] \{/ { later=NR }
  END { exit !(prize && open && foot && pack && later && prize < open && open < foot && foot < pack && pack < later) }
' src/app/board.css; then
  fail "later-rank CSS must sit after occupied prize / Open / later Write"
fi
grep -q 'occupied later-rank tickets stay quieter than #1' tests/rank.test.ts \
  || fail "rank tests must cover quieter later-rank tickets"
grep -q 'These tickets are not the last 7 days’ #1 prize' tests/rank.test.ts \
  || fail "rank tests must name later tickets as not the #1 prize"
grep -q 'data-later-rank' tests/rank.test.ts \
  || fail "rank tests must stamp later ranks"

echo "== UX: empty week Claim #1 is the first click — brief URL is a later write =="
grep -q 'empty-claim-first' src/app/outbid-form.tsx \
  || fail "empty Claim #1 must use the empty-claim-first class"
grep -q 'data-empty-claim-first' src/app/outbid-form.tsx \
  || fail "empty Claim #1 must stamp data-empty-claim-first"
grep -q 'data-first-click="claim"' src/app/outbid-form.tsx \
  || fail "empty Claim #1 Outbid must win the first click"
grep -q 'data-later-write' src/app/outbid-form.tsx \
  || fail "empty week must stamp the brief URL as a later write"
grep -q 'data-ticket-identity' src/app/outbid-form.tsx \
  || fail "empty week must wrap ticket fields as listing identity"
grep -q 'Then the brief URL' src/app/outbid-form.tsx \
  || fail "empty week must name the brief URL as a later write"
grep -q 'EmptyClaimFirstWrite' src/app/outbid-form.tsx \
  || fail "empty week must compose Claim #1 before the brief URL"
grep -q 'OccupiedTicketWrite' src/app/outbid-form.tsx \
  || fail "occupied claim must keep ticket fields on the rail with Outbid"
grep -q 'Empty week: Brief URL is a later write after Claim #1 / Outbid' src/app/board.css \
  || fail "empty CSS must name the brief URL as a later write after Claim #1"
grep -Fq '.week-empty .claim.empty-claim-first[data-empty-claim-first] .ticket-identity[data-later-write]' src/app/board.css \
  || fail "empty CSS must compose later-write identity off the claim rail"
grep -Fq '.week-empty .claim.empty-claim-first[data-empty-claim-first] .later-write-label' src/app/board.css \
  || fail "empty CSS must label the later brief URL write"
grep -Fq '.week-empty .claim.empty-claim-first[data-empty-claim-first] .outbid[data-first-click="claim"]' src/app/board.css \
  || fail "empty CSS must make Claim #1 Outbid the first click"
grep -Fq '.week-occupied .claim .ticket-identity[data-later-write]' src/app/board.css \
  || fail "occupied week must hide empty later-write identity"
grep -Fq '.week-occupied .claim [data-first-click="claim"]' src/app/board.css \
  || fail "occupied week must hide empty Claim #1 first-click"
grep -q 'empty week Claim #1 is the first click — brief URL is a later write' tests/rank.test.ts \
  || fail "rank tests must cover empty-week Claim #1 then later brief URL"
grep -q 'Then the brief URL' tests/rank.test.ts \
  || fail "rank tests must name the later brief URL write"
grep -q 'data-first-click="claim"' tests/rank.test.ts \
  || fail "rank tests must stamp empty Claim #1 as the first click"
grep -q 'Claim #1' src/app/outbid-form.tsx \
  || fail "empty later-write cut must keep Claim #1"
grep -q 'No paid brief' src/app/board.tsx \
  || fail "empty later-write cut must keep No paid brief"
grep -q 'Open this brief' src/app/board.tsx \
  || fail "empty later-write cut must keep occupied Open this brief"
grep -q 'Write this ticket' src/app/outbid-form.tsx \
  || fail "empty later-write cut must keep occupied Write this ticket"
grep -q 'data-first-click={featured ? "open" : undefined}' src/app/board.tsx \
  || fail "empty later-write cut must keep occupied Open this brief the first click"
grep -q 'data-prize=' src/app/board.tsx \
  || fail "empty later-write cut must keep the winner rule as the prize"
grep -q 'data-rank-is-bid' src/app/board.tsx \
  || fail "empty later-write cut must keep rank as the bid"
grep -q 'amount-field' src/app/outbid-form.tsx \
  || fail "empty later-write cut must keep the dashed amount"
grep -q 'className="step"' src/app/outbid-form.tsx \
  || fail "empty later-write cut must keep ± steppers"
grep -q 'Outbid' src/app/outbid-form.tsx \
  || fail "empty later-write cut must keep Outbid"
grep -q 'name="buyer"' src/app/outbid-form.tsx \
  || fail "empty later-write cut must keep Who is buying"
grep -q 'name="budgetUsd"' src/app/outbid-form.tsx \
  || fail "empty later-write cut must keep What it pays"
grep -q 'name="deadline"' src/app/outbid-form.tsx \
  || fail "empty later-write cut must keep When it’s due"
grep -q 'name="winnerRule"' src/app/outbid-form.tsx \
  || fail "empty later-write cut must keep How a winner is chosen"
grep -q 'name="briefUrl"' src/app/outbid-form.tsx \
  || fail "empty later-write cut must keep Brief URL"
grep -q 'desk-surface-empty' src/app/board.tsx \
  || fail "empty later-write cut must not rebuild the ticket desk"
if grep -qE 'data-write-after-open-seven|data-open-after-write-six' src/app/board.tsx src/app/board.css src/app/outbid-form.tsx; then
  fail "empty later-write must not add another numbered hop stamp"
fi
if grep -qE 'grid-template-columns: 1fr 1fr' src/app/outbid-form.tsx src/app/board.tsx; then
  fail "empty later-write must not rebuild the ticket desk into a long form"
fi
if awk '/function OccupiedTicketWrite/,/function EmptyClaimFirstWrite/' src/app/outbid-form.tsx | grep -q 'data-first-click="claim"'; then
  fail "occupied claim must not stamp empty Claim #1 as the first click"
fi
if awk '/function OccupiedTicketWrite/,/function EmptyClaimFirstWrite/' src/app/outbid-form.tsx | grep -q 'Then the brief URL'; then
  fail "occupied claim must not name a later brief URL write"
fi
if awk '/function OccupiedTicketWrite/,/function EmptyClaimFirstWrite/' src/app/outbid-form.tsx | grep -q 'data-later-write'; then
  fail "occupied ticket fields must stay on the claim rail with Outbid"
fi
if ! awk '
  /function EmptyClaimFirstWrite/ { empty=NR }
  empty && /data-first-click="claim"/ { click=NR }
  empty && /Then the brief URL/ { label=NR }
  empty && /TicketIdentityFields/ { ident=NR }
  END { exit !(empty && click && label && ident && empty < click && click < label && label < ident) }
' src/app/outbid-form.tsx; then
  fail "empty Claim #1 / Outbid must precede the later brief URL write"
fi
if ! awk '
  /function OccupiedTicketWrite/ { occ=NR }
  occ && /className="ticket-fields"/ && !fields { fields=NR }
  occ && /className="bid-row"/ && !row { row=NR }
  /function EmptyClaimFirstWrite/ { empty=NR }
  END { exit !(occ && fields && row && empty && occ < fields && fields < row && row < empty) }
' src/app/outbid-form.tsx; then
  fail "occupied claim must keep ticket fields before Outbid"
fi
python3 - src/app/board.css src/app/outbid-form.tsx <<'PY' || fail "empty later-write must recede after Claim #1 / Outbid without recolor or a new hop"
import re
import sys
css = open(sys.argv[1], encoding="utf-8").read()
form = open(sys.argv[2], encoding="utf-8").read()
marker = "Empty week: Brief URL is a later write after Claim #1 / Outbid"
if marker not in css:
    raise SystemExit(1)
later = css.split(marker, 1)[1].split("End empty-week later-write", 1)[0]
if ".ticket-identity[data-later-write]" not in later:
    raise SystemExit(1)
if "border-top: 1px dashed var(--rule)" not in later:
    raise SystemExit(1)
if "background:" in later or "var(--stamp)" in later:
    raise SystemExit(1)
if "data-write-after-open-seven" in later or "data-open-after-write-six" in later:
    raise SystemExit(1)
click = re.search(
    r"\.week-empty \.claim\.empty-claim-first\[data-empty-claim-first\] \.outbid\[data-first-click=\"claim\"\]\s*\{[^}]*\}",
    css,
    re.S,
)
if not click or "min-height: 2.75rem" not in click.group(0):
    raise SystemExit(1)
if "background:" in click.group(0):
    raise SystemExit(1)
empty = form.split("function EmptyClaimFirstWrite", 1)[-1].split("export function OutbidForm", 1)[0]
occupied = form.split("function OccupiedTicketWrite", 1)[-1].split("function EmptyClaimFirstWrite", 1)[0]
if empty.find("Outbid") < 0 or empty.find("data-later-write") < empty.find("Outbid"):
    raise SystemExit(1)
if empty.find("TicketIdentityFields") < empty.find("Then the brief URL"):
    raise SystemExit(1)
if occupied.find("ticket-fields") < 0 or occupied.find("Outbid") < occupied.find("ticket-fields"):
    raise SystemExit(1)
if 'data-first-click="claim"' in occupied or "Then the brief URL" in occupied:
    raise SystemExit(1)
PY
if ! awk '
  /ticket-featured \.prize-before-price \.winner-rule-text/ { prize=NR }
  /ticket-featured \.open-this-brief \{/ { open=NR }
  /ticket-featured \.ticket-write-later \{/ { foot=NR }
  /Empty week: Brief URL is a later write after Claim #1 \/ Outbid/ { later=NR }
  END { exit !(prize && open && foot && later && prize < open && open < foot && foot < later) }
' src/app/board.css; then
  fail "empty later-write CSS must sit after occupied prize / Open / later Write"
fi

echo "== UX: unpaid stays off the ticket desk — No paid brief until Polar reports paid =="
grep -q 'export function isPolarPaidListing' src/core/rank.ts \
  || fail "rank.ts must export isPolarPaidListing"
grep -q 'filter(isPolarPaidListing)' src/core/rank.ts \
  || fail "rankListings must drop unpaid Polar checkout"
grep -q 'listPaidRolling' src/core/rank.ts \
  || fail "live board must load Polar-paid listings only"
grep -q 'export function listUnpaid' src/core/listings.ts \
  || fail "listings.ts must expose unpaid Polar checkout off the desk"
grep -q 'export function rememberUnpaidCheckout' src/core/listings.ts \
  || fail "listings.ts must remember unpaid Polar checkout"
grep -q 'isPolarPaidListing' src/core/listings.ts \
  || fail "listPaid must keep Polar-paid rows only"
grep -q 'rememberUnpaidCheckout' src/app/api/checkout/route.ts \
  || fail "checkout must remember unpaid Polar checkout off the desk"
grep -q 'forgetUnpaidCheckout' src/app/api/polar/webhook/route.ts \
  || fail "abandoned Polar webhook must forget unpaid checkout"
grep -q 'listUnpaid' src/app/page.tsx \
  || fail "board page must load unpaid Polar leftover off the desk"
grep -q 'data-unpaid-off' src/app/board.tsx \
  || fail "empty leftover Polar checkout must stamp unpaid-off"
grep -q 'An unpaid Polar checkout stays off this desk until Polar reports paid' src/app/board.tsx \
  || fail "empty leftover must say unpaid Polar checkout stays off this desk"
grep -q 'data-unpaid-off' src/app/outbid-form.tsx \
  || fail "claim form must stamp unpaid Polar checkout stays off the desk"
grep -q 'Unpaid Polar checkout stays off this desk until Polar reports paid' src/app/outbid-form.tsx \
  || fail "claim form must say unpaid Polar checkout stays off this desk"
grep -q 'An abandoned ticket is not #1' src/app/outbid-form.tsx \
  || fail "claim form must say an abandoned ticket is not #1"
grep -q 'Polar reports paid' src/app/return/page.tsx \
  || fail "return page must wait for Polar paid, not the query string"
grep -Fq '.claim-note[data-unpaid-off]' src/app/board.css \
  || fail "CSS must make unpaid-off certain on the claim note"
grep -Fq '.board[data-unpaid-off] .ticket-featured' src/app/board.css \
  || fail "unpaid leftover CSS must hide featured prize chrome"
grep -Fq '.board[data-unpaid-off] [data-prize]' src/app/board.css \
  || fail "unpaid leftover CSS must hide prize chrome"
grep -Fq '.board[data-unpaid-off] .open-this-brief' src/app/board.css \
  || fail "unpaid leftover CSS must hide Open this brief"
grep -Fq '.week-empty[data-unpaid-off] [data-prize]' src/app/board.css \
  || fail "empty unpaid leftover CSS must hide prize chrome"
grep -Fq '.week-empty[data-unpaid-off] .later-pack' src/app/board.css \
  || fail "empty unpaid leftover CSS must hide later-pack"
unpaid_hide="$(awk '/^\.board\[data-unpaid-off\] \.ticket-featured,/,/^\}/' src/app/board.css)"
echo "$unpaid_hide" | grep -q 'display: none' \
  || fail "unpaid leftover CSS must hide occupied prize / Open / later-pack"
echo "$unpaid_hide" | grep -q 'data-prize' \
  || fail "unpaid leftover CSS must hide data-prize"
echo "$unpaid_hide" | grep -q 'open-this-brief' \
  || fail "unpaid leftover CSS must hide Open this brief"
echo "$unpaid_hide" | grep -q 'later-pack' \
  || fail "unpaid leftover CSS must hide later-pack"
if echo "$unpaid_hide" | grep -q 'background:'; then
  fail "unpaid leftover must hide occupied chrome, not recolor the desk"
fi
grep -q 'unpaid stays off the ticket desk' tests/rank.test.ts \
  || fail "rank tests must cover unpaid Polar checkout off the ticket desk"
grep -q 'unpaid Polar checkout never ranks as #1' tests/rank.test.ts \
  || fail "rank tests must drop unpaid Polar checkout from rankListings"
grep -q 'unpaid Polar checkout stays off the ticket desk until Polar reports paid' tests/checkout.test.ts \
  || fail "checkout tests must keep unpaid Polar checkout off the desk"
grep -q 'data-prize=' src/app/board.tsx \
  || fail "unpaid-off cut must keep occupied winner rule as the prize"
grep -q 'Open this brief' src/app/board.tsx \
  || fail "unpaid-off cut must keep occupied Open this brief"
grep -q 'data-first-click={featured ? "open" : undefined}' src/app/board.tsx \
  || fail "unpaid-off cut must keep occupied Open this brief the first click"
grep -q 'data-rank-is-bid' src/app/board.tsx \
  || fail "unpaid-off cut must keep rank as the bid"
grep -q 'Write this ticket' src/app/outbid-form.tsx \
  || fail "unpaid-off cut must keep occupied Write this ticket"
grep -q 'Claim #1' src/app/outbid-form.tsx \
  || fail "unpaid-off cut must keep Claim #1"
grep -q 'No paid brief' src/app/board.tsx \
  || fail "unpaid-off cut must keep empty No paid brief"
grep -q 'Then the brief URL' src/app/outbid-form.tsx \
  || fail "unpaid-off cut must keep empty later brief URL"
grep -q 'data-first-click="claim"' src/app/outbid-form.tsx \
  || fail "unpaid-off cut must keep empty Claim #1 the first click"
grep -q 'function LaterRankTicket' src/app/board.tsx \
  || fail "unpaid-off cut must keep later-rank tickets quieter than #1"
grep -q 'desk-surface-empty' src/app/board.tsx \
  || fail "unpaid-off cut must not rebuild the ticket desk"
grep -q 'amount-field' src/app/outbid-form.tsx \
  || fail "unpaid-off cut must keep the dashed amount"
grep -q 'className="step"' src/app/outbid-form.tsx \
  || fail "unpaid-off cut must keep ± steppers"
grep -q 'Outbid' src/app/outbid-form.tsx \
  || fail "unpaid-off cut must keep Outbid"
if grep -qE 'data-write-after-open-seven|data-open-after-write-six' src/app/board.tsx src/app/board.css src/app/outbid-form.tsx; then
  fail "unpaid-off must not add another numbered hop stamp"
fi
if grep -qE 'grid-template-columns: 1fr 1fr' src/app/outbid-form.tsx src/app/board.tsx; then
  fail "unpaid-off must not rebuild the ticket desk into a long form"
fi
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'Open this brief'; then
  fail "empty week must not invent Open this brief"
fi
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'prize-before-price'; then
  fail "empty week must not stamp prize before price"
fi
if awk '/function EmptyClaimFirstWrite/,/export function OutbidForm/' src/app/outbid-form.tsx | grep -q 'Write this ticket'; then
  fail "empty Claim #1 must not invent Write this ticket"
fi
python3 - src/app/board.css src/app/board.tsx src/app/outbid-form.tsx <<'PY' || fail "unpaid leftover must stay off the desk without recolor or a new hop"
import re
import sys
css = open(sys.argv[1], encoding="utf-8").read()
board = open(sys.argv[2], encoding="utf-8").read()
form = open(sys.argv[3], encoding="utf-8").read()
if "data-write-after-open-seven" in css or "data-open-after-write-six" in css:
    raise SystemExit(1)
if "data-write-after-open-seven" in board or "data-open-after-write-six" in board:
    raise SystemExit(1)
if "data-write-after-open-seven" in form or "data-open-after-write-six" in form:
    raise SystemExit(1)
hide = re.search(r"\.board\[data-unpaid-off\] \.ticket-featured,[\s\S]*?display: none;", css)
if not hide:
    raise SystemExit(1)
if "background:" in hide.group(0):
    raise SystemExit(1)
note = re.search(r"\.claim-note\[data-unpaid-off\]\s*\{[^}]*\}", css)
if not note or "font-weight: 600" not in note.group(0):
    raise SystemExit(1)
if "background:" in note.group(0):
    raise SystemExit(1)
if "isPolarPaidListing" not in board or "data-unpaid-off" not in board:
    raise SystemExit(1)
if "Unpaid Polar checkout stays off this desk" not in form:
    raise SystemExit(1)
if "An abandoned ticket is not #1" not in form:
    raise SystemExit(1)
PY
if ! awk '
  /ticket-featured \.prize-before-price \.winner-rule-text/ { prize=NR }
  /ticket-featured \.open-this-brief \{/ { open=NR }
  /Empty week: Brief URL is a later write after Claim #1 \/ Outbid/ { later=NR }
  /Unpaid Polar checkout stays off the ticket desk/ { unpaid=NR }
  END { exit !(prize && open && later && unpaid && prize < open && open < later && later < unpaid) }
' src/app/board.css; then
  fail "unpaid-off CSS must sit after occupied prize / Open / empty later-write"
fi

echo "== UX: occupied week window is rolling last-7-days — not Monday 00:00 UTC =="
grep -q 'ROLLING_WEEK_MS' src/core/week.ts \
  || fail "week.ts must export ROLLING_WEEK_MS"
grep -q 'bidInRollingWeek' src/core/week.ts \
  || fail "week.ts must export bidInRollingWeek"
grep -q 'listPaidRolling' src/core/listings.ts \
  || fail "listings.ts must load paid rows in the rolling last-7-days window"
grep -q 'isPolarPaidListing' src/core/listings.ts \
  || fail "rolling week must keep Polar-paid occupancy"
grep -q 'data-rolling-week="true"' src/app/board.tsx \
  || fail "board must stamp data-rolling-week"
grep -q 'Rolling last 7 days. Not Monday 00:00 UTC.' src/app/board.tsx \
  || fail "board must name the rolling last-7-days window, not Monday midnight"
grep -Fq '.week-occupied[data-rolling-week] .week-window[data-rolling-week]' src/app/board.css \
  || fail "occupied rolling week cue must be composed in occupied CSS"
grep -Fq '.week-empty[data-rolling-week] .week-window[data-rolling-week]' src/app/board.css \
  || fail "empty rolling week cue must be composed in empty CSS"
grep -q 'occupied week window is rolling last-7-days' tests/rank.test.ts \
  || fail "rank tests must cover occupied rolling last-7-days window"
grep -Fq 'rolling last-7-days window is 7 * 24h' tests/week.test.ts \
  || fail "week tests must cover rolling last-7-days window"
grep -q 'Monday 00:00 UTC does not drop a bid still inside the rolling week' tests/week.test.ts \
  || fail "week tests must prove Monday midnight is not the drop"
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q '24h lock'; then
  fail "rolling week is not a 24h lock on #1"
fi
if grep -qE 'data-write-after-open-seven|data-open-after-write-six' src/app/board.tsx src/app/board.css src/app/outbid-form.tsx; then
  fail "rolling week must not add another numbered hop stamp"
fi
grep -q 'data-first-click={featured ? "open" : undefined}' src/app/board.tsx \
  || fail "rolling week must keep occupied Open this brief the first click"
grep -q 'data-prize=' src/app/board.tsx \
  || fail "rolling week must keep the winner rule as the prize"
grep -q 'data-rank-is-bid' src/app/board.tsx \
  || fail "rolling week must keep rank as the bid"
grep -q 'Claim #1' src/app/outbid-form.tsx \
  || fail "rolling week must keep Claim #1"
grep -q 'No paid brief' src/app/board.tsx \
  || fail "rolling week must keep empty No paid brief"
grep -q 'Open this brief' src/app/board.tsx \
  || fail "rolling week must keep Open this brief"
grep -q 'Write this ticket' src/app/outbid-form.tsx \
  || fail "rolling week must keep Write this ticket"
grep -q 'amount-field' src/app/outbid-form.tsx \
  || fail "rolling week must keep the dashed amount"
grep -q 'className="step"' src/app/outbid-form.tsx \
  || fail "rolling week must keep ± steppers"
grep -q 'Outbid' src/app/outbid-form.tsx \
  || fail "rolling week must keep Outbid"
grep -q 'desk-surface-empty' src/app/board.tsx \
  || fail "rolling week must not rebuild the empty ticket desk"
grep -q 'data-unpaid-off' src/app/board.tsx \
  || fail "rolling week must keep unpaid Polar leftover off the desk"
if grep -qE 'grid-template-columns: 1fr 1fr' src/app/outbid-form.tsx src/app/board.tsx; then
  fail "rolling week must not rebuild the ticket desk into a long form"
fi
if echo "$(awk '/^\.week-occupied\[data-rolling-week\] \.week-window\[data-rolling-week\]/,/^\}/' src/app/board.css)" | grep -q 'background:'; then
  fail "rolling week must compose the window, not recolor the desk"
fi

echo "== UX: occupied ticket desk keeps one first click — Open this brief, Claim stays after =="
grep -q 'claim-after-ticket' src/app/board.tsx \
  || fail "occupied Claim #1 must wrap as claim-after-ticket after the ticket"
grep -q 'data-claim-after-ticket' src/app/board.tsx \
  || fail "occupied Claim #1 must stamp data-claim-after-ticket after the ticket"
grep -Fq 'className="claim-after-ticket"' src/app/board.tsx \
  || fail "occupied Claim #1 must wrap as claim-after-ticket, not a same-weight rail"
python3 - src/app/board.tsx <<'PY' || fail "occupied / must not mount Claim / Outbid beside the #1 prize"
import sys
board = open(sys.argv[1], encoding="utf-8").read()
start = board.find("{featured ? (")
end = board.find(") : (", start)
if start < 0 or end < 0:
    raise SystemExit(1)
prize = board[start:end]
if "OutbidForm" in prize or "claim-after-ticket" in prize:
    raise SystemExit(1)
surface = board.split('data-desk-surface={empty ? "empty" : "occupied"}', 1)[-1]
surface = surface.split("{rest.length > 0", 1)[0]
if "occupied unpaidOff" in surface or "claim-after-ticket" in surface:
    raise SystemExit(1)
if "data-claim-after-ticket" not in board.split("{rest.length > 0", 1)[-1]:
    raise SystemExit(1)
PY
grep -Fq '.week-occupied .claim-after-ticket[data-claim-after-ticket]' src/app/board.css \
  || fail "occupied Claim after the ticket must be quieter than Open this brief"
grep -Fq '.week-occupied .claim-after-ticket[data-claim-after-ticket] .outbid' src/app/board.css \
  || fail "occupied Outbid after the ticket must recede under Open this brief"
grep -Fq '.board[data-empty-ticket] .claim-after-ticket' src/app/board.css \
  || fail "empty-ticket CSS must hide leaked Claim-after-ticket"
grep -Fq '.week-empty .claim-after-ticket' src/app/board.css \
  || fail "empty week shell must hide leaked Claim-after-ticket"
if grep -E '^\.claim-after-ticket' src/app/board.css; then
  fail "Claim-after-ticket CSS must stay scoped to week-occupied"
fi
if grep -n 'data-empty-week' -A 20 src/app/board.tsx | grep -q 'claim-after-ticket'; then
  fail "empty week must not wrap Claim after the ticket"
fi
if grep -qE 'data-write-after-open-seven|data-open-after-write-six' src/app/board.tsx src/app/board.css src/app/outbid-form.tsx; then
  fail "Claim after the ticket must not add another numbered hop stamp"
fi
if grep -qE 'grid-template-columns: 1fr 1fr' src/app/outbid-form.tsx src/app/board.tsx; then
  fail "Claim after the ticket must not rebuild the ticket desk into a long form"
fi
grep -q 'data-first-click={featured ? "open" : undefined}' src/app/board.tsx \
  || fail "Claim after the ticket must keep Open this brief the first occupied click"
grep -q 'data-prize=' src/app/board.tsx \
  || fail "Claim after the ticket must keep the winner rule as the prize"
grep -q 'data-rank-is-bid' src/app/board.tsx \
  || fail "Claim after the ticket must keep rank as the bid"
grep -q 'ticket-write-later' src/app/board.tsx \
  || fail "Claim after the ticket must keep Write as a later foot"
grep -q 'Claim #1' src/app/outbid-form.tsx \
  || fail "Claim after the ticket must keep Claim #1"
grep -q 'No paid brief' src/app/board.tsx \
  || fail "Claim after the ticket must keep empty No paid brief"
grep -q 'Open this brief' src/app/board.tsx \
  || fail "Claim after the ticket must keep Open this brief"
grep -q 'Write this ticket' src/app/outbid-form.tsx \
  || fail "Claim after the ticket must keep Write this ticket"
grep -q 'amount-field' src/app/outbid-form.tsx \
  || fail "Claim after the ticket must keep the dashed amount"
grep -q 'className="step"' src/app/outbid-form.tsx \
  || fail "Claim after the ticket must keep ± steppers"
grep -q 'Outbid' src/app/outbid-form.tsx \
  || fail "Claim after the ticket must keep Outbid"
grep -q 'desk-surface-empty' src/app/board.tsx \
  || fail "Claim after the ticket must not rebuild the empty ticket desk"
grep -q 'data-unpaid-off' src/app/board.tsx \
  || fail "Claim after the ticket must keep unpaid Polar leftover off the desk"
grep -q 'data-rolling-week="true"' src/app/board.tsx \
  || fail "Claim after the ticket must keep the rolling last-7-days window"
grep -q 'occupied ticket desk keeps one first click' tests/rank.test.ts \
  || fail "rank tests must cover occupied Open this brief before Claim"
grep -q 'Claim stays after' tests/rank.test.ts \
  || fail "rank tests must keep Claim #1 after the occupied ticket"
python3 - src/app/board.css src/app/board.tsx src/app/outbid-form.tsx <<'PY' || fail "occupied Claim after the ticket must recede under Open this brief without recolor or a new hop"
import re
import sys
css = open(sys.argv[1], encoding="utf-8").read()
board = open(sys.argv[2], encoding="utf-8").read()
form = open(sys.argv[3], encoding="utf-8").read()
marker = "Occupied: Open this brief is the only first click. Claim #1 / Outbid stay after the ticket."
if marker not in css:
    raise SystemExit(1)
later = css.split(marker, 1)[1].split("End occupied Claim-after-ticket", 1)[0]
if ".claim-after-ticket[data-claim-after-ticket]" not in later:
    raise SystemExit(1)
if "border-top: 1px dashed" not in later:
    raise SystemExit(1)
if "background:" in later:
    raise SystemExit(1)
if "data-write-after-open-seven" in later or "data-open-after-write-six" in later:
    raise SystemExit(1)
if "empty-claim-first" in later or "data-later-write" in later or "data-unpaid-off" in later:
    raise SystemExit(1)

def size(pattern):
    match = re.search(pattern, css, re.S)
    if not match:
        raise SystemExit(1)
    return float(match.group(1))

open_sz = size(r"\.ticket-featured \.open-this-brief\[data-open-after-write-five\]\s*\{[^}]*font-size:\s*([\d.]+)rem")
outbid_h = size(r"\.claim-after-ticket\[data-claim-after-ticket\] \.outbid\s*\{[^}]*height:\s*([\d.]+)rem")
prize_sz = size(r"\.ticket-featured \.prize-before-price \.winner-rule-text\s*\{[^}]*font-size:\s*([\d.]+)rem")
empty_h = size(r"\.week-empty \.claim\.empty-claim-first\[data-empty-claim-first\] \.outbid\[data-first-click=\"claim\"\]\s*\{[^}]*min-height:\s*([\d.]+)rem")
if not (outbid_h < open_sz and outbid_h < empty_h and prize_sz > outbid_h and outbid_h < prize_sz):
    raise SystemExit(1)
if "className=\"claim-after-ticket\"" not in board or "data-claim-after-ticket" not in board:
    raise SystemExit(1)
if board.find("data-claim-after-ticket") < board.find("Open this brief"):
    raise SystemExit(1)
if 'data-first-click="claim"' in form.split("function OccupiedTicketWrite", 1)[-1].split("function EmptyClaimFirstWrite", 1)[0]:
    raise SystemExit(1)
if "data-write-after-open-seven" in board or "data-open-after-write-six" in board:
    raise SystemExit(1)
PY
if ! awk '
  /ticket-featured \.prize-before-price \.winner-rule-text/ { prize=NR }
  /ticket-featured \.open-this-brief \{/ { open=NR }
  /ticket-featured \.ticket-write-later \{/ { foot=NR }
  /week-occupied \.hopper\.later-pack\[data-later-pack\] \{/ { pack=NR }
  /Occupied: Open this brief is the only first click/ { claim=NR }
  END { exit !(prize && open && foot && pack && claim && prize < open && open < foot && foot < pack && pack < claim) }
' src/app/board.css; then
  fail "featured CSS must recede Claim after prize / Open / later Write / later-rank pack"
fi

echo "== UX: occupied raise identity is last-7-days — not this week =="
grep -q 'Same canonical brief URL still inside last 7 days raises' src/app/rules/page.tsx \
  || fail "occupied /rules must name last-7-days raise identity"
grep -q 'weekId</code> stays an audit label — not raise identity' src/app/rules/page.tsx \
  || fail "occupied /rules must keep weekId as an audit label"
if grep -qi 'same UTC week raises' src/app/rules/page.tsx; then
  fail "occupied /rules must not tax raise identity as the UTC week"
fi
if grep -qi 'in the same weekId' src/app/rules/page.tsx SPEC.md; then
  fail "raise identity must not key on weekId"
fi
if grep -q 'Already on this week?' src/app/outbid-form.tsx src/app/board.tsx src/app/rules/page.tsx; then
  fail "occupied raise hint must not tax identity as this week"
fi
grep -q 'Already on the last 7 days?' src/app/outbid-form.tsx \
  || fail "occupied raise hint must name last-7-days identity"
grep -Fq 'Identity for raise: same **canonical brief URL** still inside the rolling last 7 days' SPEC.md \
  || fail "SPEC must name last-7-days raise identity"
grep -Fq '`weekId` stays a Polar/audit label — not raise identity' SPEC.md \
  || fail "SPEC must keep weekId as an audit label, not raise identity"
grep -Fq 'weekId` is not the raise key' SPEC.md \
  || fail "SPEC raise row must keep weekId off raise identity"
grep -Fq 'Raise identity is the same canonical brief URL still inside that window — not `weekId`' BUILD.md \
  || fail "BUILD must keep raise identity off weekId"
grep -q 'Same brief still inside last 7 days raises' src/core/rank.ts \
  || fail "rank.ts must name last-7-days raise identity"
grep -q 'weekId is not the raise key' src/core/rank.ts \
  || fail "rank.ts must keep weekId off raise identity"
grep -q 'weekId is not the raise key' src/core/listing.ts \
  || fail "listing.ts must keep weekId off raise identity"
if grep -A 8 'export function sameListingIdentity' src/core/listing.ts | grep -q 'weekId ==='; then
  fail "sameListingIdentity must not key raise identity on weekId"
fi
grep -A 40 'export function parseCheckoutInput' src/billing/port.ts | grep -q 'findPaidByIdentity' \
  || fail "parseCheckoutInput must look up the rolling live listing"
grep -Fq 'Raise identity is `findPaidByIdentity`' src/billing/port.ts \
  || fail "weekId listing lookup must stay an audit helper, not raise identity"
grep -Fq 'Raise identity: same canonical brief URL still inside last 7 days. Not weekId.' src/core/listings.ts \
  || fail "findPaidByIdentity must be raise identity, not weekId"
grep -Fq 'Raise identity: same canonical brief URL still inside last 7 days. Not weekId.' src/core/week.ts \
  || fail "weekIdUtc must keep weekId off raise identity"
grep -q 'occupied /rules raise identity is last-7-days, not the UTC week label' tests/honesty.test.ts \
  || fail "rules tests must cover last-7-days raise identity"
grep -q 'same brief still inside last-7-days raises after the UTC week label rolls' tests/checkout.test.ts \
  || fail "checkout tests must cover Sunday pay Monday raise"
grep -q 'occupied raise identity is last-7-days, not this week' tests/rank.test.ts \
  || fail "rank tests must cover occupied last-7-days raise copy"
grep -q 'Raise pays difference' src/app/rules/page.tsx \
  || fail "raise-identity cut must keep raise pays difference"
grep -q 'Rolling last 7 days. Not Monday 00:00 UTC.' src/app/board.tsx \
  || fail "raise-identity cut must keep occupied rolling last-7-days"
grep -q 'data-prize=' src/app/board.tsx \
  || fail "raise-identity cut must keep the winner rule as the prize"
grep -q 'data-first-click={featured ? "open" : undefined}' src/app/board.tsx \
  || fail "raise-identity cut must keep occupied Open this brief the first click"
grep -q 'Open this brief' src/app/board.tsx \
  || fail "raise-identity cut must keep Open this brief"
grep -q 'Claim #1' src/app/outbid-form.tsx \
  || fail "raise-identity cut must keep Claim #1"
grep -q 'Then the brief URL' src/app/outbid-form.tsx \
  || fail "raise-identity cut must keep empty later-write brief URL"
grep -q 'No paid brief' src/app/board.tsx \
  || fail "raise-identity cut must keep empty No paid brief"
grep -q 'Write this ticket' src/app/outbid-form.tsx \
  || fail "raise-identity cut must keep Write this ticket"
grep -q 'amount-field' src/app/outbid-form.tsx \
  || fail "raise-identity cut must keep the dashed amount"
grep -q 'className="step"' src/app/outbid-form.tsx \
  || fail "raise-identity cut must keep ± steppers"
grep -q 'Outbid' src/app/outbid-form.tsx \
  || fail "raise-identity cut must keep Outbid"
grep -q 'desk-surface-empty' src/app/board.tsx \
  || fail "raise identity must not rebuild the empty ticket desk"
grep -q 'Unpaid Polar checkout stays off this desk until Polar reports paid' src/app/outbid-form.tsx \
  || fail "raise-identity cut must keep unpaid off the board"
grep -q 'data-empty-week="true"' src/app/board.tsx \
  || fail "raise-identity cut must keep honest empty desk"
grep -q 'data-rolling-week="true"' src/app/board.tsx \
  || fail "raise-identity cut must keep occupied rolling last-7-days"
grep -q 'data-unpaid-off' src/app/board.tsx \
  || fail "raise-identity cut must keep unpaid Polar leftover off the desk"
if grep -qE 'data-write-after-open-seven|data-open-after-write-six' src/app/board.tsx src/app/board.css src/app/outbid-form.tsx src/app/rules/page.tsx; then
  fail "raise identity must not add another numbered hop stamp"
fi
if grep -qE 'grid-template-columns: 1fr 1fr' src/app/outbid-form.tsx src/app/board.tsx src/app/rules/page.tsx; then
  fail "raise identity must not rebuild the ticket desk into a long form"
fi
python3 - src/app/board.css <<'PY' || fail "raise identity must not recolor the desk"
import sys
css = open(sys.argv[1], encoding="utf-8").read()
if "raise-identity" in css or "raise-rolling" in css:
    raise SystemExit(1)
PY

echo "== UX: occupied desk chrome names last-7-days — not this week =="
grep -q 'The last 7 days’ #1 freelance brief' src/app/board.tsx \
  || fail "occupied kicker must name last-7-days, not this week"
grep -q 'The last 7 days’ #1' src/app/board.tsx \
  || fail "occupied #1 heading must name last-7-days, not this week"
grep -q 'These tickets are not the last 7 days’ #1 prize' src/app/board.tsx \
  || fail "occupied later-pack must name last-7-days, not this week"
grep -q 'This week’s #1 freelance brief' src/app/board.tsx \
  || fail "empty kicker may still name this week"
grep -q 'This week’s board is empty' src/app/board.tsx \
  || fail "empty desk must keep This week’s board is empty"
if grep -q 'These tickets are not this week’s #1 prize' src/app/board.tsx; then
  fail "occupied later-pack must not tax the prize as this week"
fi
grep -Fq 'Occupied prize chrome (kicker, #1 heading, later-pack) names that rolling window, not a calendar week' SPEC.md \
  || fail "SPEC must name occupied prize chrome as last-7-days, not a calendar week"
grep -q 'Empty week stays Claim #1 / No paid brief' SPEC.md \
  || fail "SPEC must keep empty Claim #1 / No paid brief"
grep -q 'occupied desk chrome names last-7-days, not this week' tests/rank.test.ts \
  || fail "rank tests must cover occupied last-7-days prize chrome"
grep -q 'Already on the last 7 days?' src/app/outbid-form.tsx \
  || fail "occupied chrome cut must keep last-7-days raise identity"
grep -q 'Rolling last 7 days. Not Monday 00:00 UTC.' src/app/board.tsx \
  || fail "occupied chrome cut must keep occupied rolling last-7-days"
grep -q 'data-prize=' src/app/board.tsx \
  || fail "occupied chrome cut must keep the winner rule as the prize"
grep -q 'data-first-click={featured ? "open" : undefined}' src/app/board.tsx \
  || fail "occupied chrome cut must keep occupied Open this brief the first click"
grep -q 'Open this brief' src/app/board.tsx \
  || fail "occupied chrome cut must keep Open this brief"
grep -q 'Claim #1' src/app/outbid-form.tsx \
  || fail "occupied chrome cut must keep Claim #1"
grep -q 'No paid brief' src/app/board.tsx \
  || fail "occupied chrome cut must keep empty No paid brief"
grep -q 'Write this ticket' src/app/outbid-form.tsx \
  || fail "occupied chrome cut must keep Write this ticket"
grep -q 'amount-field' src/app/outbid-form.tsx \
  || fail "occupied chrome cut must keep the dashed amount"
grep -q 'className="step"' src/app/outbid-form.tsx \
  || fail "occupied chrome cut must keep ± steppers"
grep -q 'Outbid' src/app/outbid-form.tsx \
  || fail "occupied chrome cut must keep Outbid"
grep -q 'desk-surface-empty' src/app/board.tsx \
  || fail "occupied chrome must not rebuild the empty ticket desk"
grep -q 'Unpaid Polar checkout stays off this desk until Polar reports paid' src/app/outbid-form.tsx \
  || fail "occupied chrome cut must keep unpaid off the board"
grep -q 'data-empty-week="true"' src/app/board.tsx \
  || fail "occupied chrome cut must keep honest empty desk"
grep -q 'data-later-pack' src/app/board.tsx \
  || fail "occupied chrome cut must keep the later-pack"
if grep -qE 'data-write-after-open-seven|data-open-after-write-six' src/app/board.tsx src/app/board.css src/app/outbid-form.tsx; then
  fail "occupied chrome must not add another numbered hop stamp"
fi
if grep -qE 'grid-template-columns: 1fr 1fr' src/app/board.tsx src/app/outbid-form.tsx; then
  fail "occupied chrome must not rebuild the ticket desk into a long form"
fi
python3 - src/app/board.css <<'PY' || fail "occupied chrome must not recolor the desk"
import sys
css = open(sys.argv[1], encoding="utf-8").read()
if "occupied-rolling-chrome" in css or "write-after-open-N" in css:
    raise SystemExit(1)
PY

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
grep -q 'export function polarApiBase' src/billing/polar.ts \
  || fail "polar.ts must honor POLAR_API_BASE override"
grep -q 'https://api.polar.sh' src/billing/polar.ts \
  || fail "polar.ts default Polar API must stay production"
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
if grep -R --include='*.ts' --include='*.tsx' -nE 'fetch\(|https://api\.polar\.sh|https://sandbox-api\.polar\.sh' tests \
  | grep -v 'polarApiBase' \
  | grep -v 'POLAR_API_BASE' \
  | grep -v 'sandbox-api' \
  | grep -v 'sandbox.polar.sh' \
  | grep -v 'api.polar.sh' \
  | grep -v 'POLAR_API_BASE/' \
  | grep -v 'checkout-created.json' >/dev/null; then
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

  unset POLAR_LIVE POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET POLAR_API_BASE POLAR_PRODUCT_ID
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
  grep -q 'writing a new ticket after the winner rule' "$test_log" \
    || fail "occupied-week write-after-rule buyer test did not run"
  grep -q 'win the first click after Write follows the winner rule' "$test_log" \
    || fail "occupied-week open-after-write first-click test did not run"
  grep -q 'concentrates writing a new ticket after Open this brief' "$test_log" \
    || fail "occupied-week write-after-open first-write test did not run"
  grep -q 'concentrates opening the paid #1 brief after Write this ticket' "$test_log" \
    || fail "occupied-week open-after-write-first freelancer test did not run"
  grep -q 'concentrates writing a new ticket after Open this brief is re-concentrated' "$test_log" \
    || fail "occupied-week write-after-open-two buyer test did not run"
  grep -q 'concentrates opening the paid #1 brief after Write this ticket is re-concentrated' "$test_log" \
    || fail "occupied-week open-after-write-two freelancer test did not run"
  grep -q 'concentrates writing a new ticket after Open this brief is re-concentrated again' "$test_log" \
    || fail "occupied-week write-after-open-three buyer test did not run"
  grep -q 'concentrates opening the paid #1 brief after Write this ticket is re-concentrated again' "$test_log" \
    || fail "occupied-week open-after-write-three freelancer test did not run"
  grep -q 'concentrates writing a new ticket after Open this brief is re-concentrated a fourth time' "$test_log" \
    || fail "occupied-week write-after-open-four buyer test did not run"
  grep -q 'concentrates opening the paid #1 brief after Write this ticket is re-concentrated a fourth time' "$test_log" \
    || fail "occupied-week open-after-write-four freelancer test did not run"
  grep -q 'concentrates writing a new ticket after Open this brief is re-concentrated a fifth time' "$test_log" \
    || fail "occupied-week write-after-open-five buyer test did not run"
  grep -q 'concentrates opening the paid #1 brief after Write this ticket is re-concentrated a fifth time' "$test_log" \
    || fail "occupied-week open-after-write-five freelancer test did not run"
  grep -q 'concentrates writing a new ticket after Open this brief is re-concentrated a sixth time' "$test_log" \
    || fail "occupied-week write-after-open-six buyer test did not run"
  grep -q 'winner rule is the prize before' "$test_log" \
    || fail "occupied-week prize-before-price freelancer test did not run"
  grep -q 'empty week stays Claim #1 + No paid brief without prize' "$test_log" \
    || fail "empty-week Claim #1 + No paid brief isolation test did not run"
  grep -q 'rank is the bid; project budget stays a later fact' "$test_log" \
    || fail "occupied-week rank-is-bid freelancer test did not run"
  grep -q 'Open this brief stays the first freelancer click' "$test_log" \
    || fail "occupied-week open-brief-first freelancer test did not run"
  grep -q 'empty week stays Claim #1 — Open / Write cannot leak' "$test_log" \
    || fail "empty-week Open / Write isolation test did not run"
  grep -q 'occupied later Write this ticket stays quieter than Open this brief' "$test_log" \
    || fail "occupied-week later Write quieter-than-Open test did not run"
  grep -q 'empty week Claim #1 is the first click — brief URL is a later write' "$test_log" \
    || fail "empty-week Claim #1 then later brief URL test did not run"
  grep -q 'occupied later-rank tickets stay quieter than #1' "$test_log" \
    || fail "occupied later-rank quieter-than-#1 test did not run"
  grep -q 'unpaid stays off the ticket desk' "$test_log" \
    || fail "unpaid Polar leftover off-desk UX test did not run"
  grep -q 'unpaid Polar checkout never ranks as #1' "$test_log" \
    || fail "unpaid Polar checkout rank gate test did not run"
  grep -q 'unpaid Polar checkout stays off the ticket desk until Polar reports paid' "$test_log" \
    || fail "unpaid Polar checkout fixture test did not run"
  grep -q 'rolling last-7-days' "$test_log" \
    || fail "week tests must cover rolling last-7-days window"
  grep -q 'occupied week window is rolling last-7-days' "$test_log" \
    || fail "rank tests must cover occupied rolling last-7-days window"
  grep -q 'occupied ticket desk keeps one first click' "$test_log" \
    || fail "occupied-week Open this brief before Claim test did not run"
  grep -q 'Claim stays after' "$test_log" \
    || fail "occupied-week Claim after the ticket test did not run"
  grep -q 'same brief still inside last-7-days raises after the UTC week label rolls' "$test_log" \
    || fail "Sunday pay Monday raise identity test did not run"
  grep -q 'occupied /rules raise identity is last-7-days' "$test_log" \
    || fail "occupied /rules last-7-days raise identity test did not run"
  grep -q 'occupied raise identity is last-7-days, not this week' "$test_log" \
    || fail "occupied last-7-days raise copy test did not run"
  grep -q 'occupied desk chrome names last-7-days, not this week' "$test_log" \
    || fail "occupied last-7-days prize chrome test did not run"
fi

echo "OK: buildable and testable"
