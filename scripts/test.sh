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
fi

echo "OK: buildable and testable"
