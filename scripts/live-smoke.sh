#!/usr/bin/env bash
# Operator smoke against a local process. Not called from scripts/test.sh or CI.
# Walks board, about/rules, checkout (live Polar or BLOCKED-SECRET), click, honesty.
# Missing Polar secret → BLOCKED-SECRET: POLAR_ACCESS_TOKEN
# Do not invent a paid rank or ratings. Empty week is valid.
# Next.js webpack cannot load node:crypto via the client bid form, so this
# process serves the same App Router handlers through tsx (not next dev).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  fail "live-smoke must not run in GitHub Actions"
fi
if [[ "${CI:-}" == "true" ]]; then
  fail "live-smoke refuses CI=true"
fi

command -v curl >/dev/null || fail "curl is required"
command -v node >/dev/null || fail "node is required"

if [[ ! -d node_modules ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
fi

PASS=0
PASS_ERROR=0
BLOCKED=0
FAIL=0
STARTED_PID=""
LIVE_PID=""
WORKDIR=""
RESULT_LOG=""
BASE="${LIVE_SMOKE_BASE:-}"

# Capture operator Polar flags before the fixture process unsets them.
OP_POLAR_LIVE="${POLAR_LIVE:-}"
OP_POLAR_ACCESS_TOKEN="${POLAR_ACCESS_TOKEN:-}"
OP_POLAR_WEBHOOK_SECRET="${POLAR_WEBHOOK_SECRET:-}"

kill_tree() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  if [[ -n "${LIVE_PID}" ]]; then
    kill_tree "${LIVE_PID}"
    wait "${LIVE_PID}" 2>/dev/null || true
  fi
  if [[ -n "${STARTED_PID}" ]]; then
    kill_tree "${STARTED_PID}"
    wait "${STARTED_PID}" 2>/dev/null || true
  fi
  if [[ -n "${WORKDIR}" && -d "${WORKDIR}" ]]; then
    rm -rf "${WORKDIR}"
  fi
}
trap cleanup EXIT

record() {
  local flow="$1"
  local status="$2"
  local note="${3:-}"
  printf 'RESULT\t%s\t%s\t%s\n' "$flow" "$status" "$note"
  if [[ -n "${RESULT_LOG}" ]]; then
    printf '%s\t%s\t%s\n' "$flow" "$status" "$note" >>"${RESULT_LOG}"
  fi
  case "$status" in
    PASS) PASS=$((PASS + 1)) ;;
    PASS-ERROR) PASS_ERROR=$((PASS_ERROR + 1)) ;;
    BLOCKED-SECRET) BLOCKED=$((BLOCKED + 1)) ;;
    FAIL) FAIL=$((FAIL + 1)) ;;
    *) fail "unknown smoke status ${status}" ;;
  esac
}

pick_port() {
  node --input-type=module -e '
    import net from "node:net";
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") process.exit(1);
      process.stdout.write(String(addr.port));
      server.close();
    });
  '
}

iso_week_utc() {
  node --input-type=module -e '
    const now = new Date();
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = cursor.getUTCDay() || 7;
    cursor.setUTCDate(cursor.getUTCDate() + 4 - day);
    const isoYear = cursor.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const week = Math.ceil(((cursor.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    process.stdout.write(`${isoYear}-W${String(week).padStart(2, "0")}`);
  '
}

wait_health() {
  local url="$1/healthz"
  local i
  for i in $(seq 1 80); do
    if curl -fsS --connect-timeout 2 --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

write_smoke_server() {
  local dest="$1"
  cat >"$dest" <<'EOF'
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AboutPage from "../src/app/about/page.tsx";
import { POST as postCheckout } from "../src/app/api/checkout/route.ts";
import { POST as postWebhook } from "../src/app/api/polar/webhook/route.ts";
import { GET as getClick } from "../src/app/click/[id]/route.ts";
import { GET as getHealthz } from "../src/app/healthz/route.ts";
import HomePage from "../src/app/page.tsx";
import ReturnPage from "../src/app/return/page.tsx";
import RulesPage from "../src/app/rules/page.tsx";

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT is required");
}
const origin = process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`;

function htmlDocument(node: ReactNode): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><title>Freelance Brief Board</title></head><body><header class="site-header"><nav class="site-nav"><a href="/">Board</a><a href="/about">About</a><a href="/rules">Rules</a></nav></header>${renderToStaticMarkup(node)}</body></html>`;
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? "/", origin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}

async function sendWeb(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}

function sendHtml(res: ServerResponse, node: ReactNode): void {
  const body = htmlDocument(node);
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "private, no-store");
  res.end(body);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(body);
}

const server = createServer((req, res) => {
  void (async () => {
    const request = await toRequest(req);
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/healthz") {
      await sendWeb(res, getHealthz());
      return;
    }
    if (request.method === "GET" && path === "/") {
      sendHtml(res, createElement(HomePage));
      return;
    }
    if (request.method === "GET" && path === "/about") {
      sendHtml(res, createElement(AboutPage));
      return;
    }
    if (request.method === "GET" && path === "/rules") {
      sendHtml(res, createElement(RulesPage));
      return;
    }
    if (request.method === "GET" && path === "/return") {
      const searchParams = {
        sessionId: url.searchParams.get("sessionId") ?? undefined,
        checkoutId: url.searchParams.get("checkoutId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      };
      sendHtml(res, await ReturnPage({ searchParams: Promise.resolve(searchParams) }));
      return;
    }
    if (request.method === "POST" && (path === "/api/checkout" || path === "/checkout")) {
      await sendWeb(res, await postCheckout(request));
      return;
    }
    if (request.method === "POST" && path === "/api/polar/webhook") {
      await sendWeb(res, await postWebhook(request));
      return;
    }
    const click = path.match(/^\/click\/([^/]+)$/);
    if (request.method === "GET" && click) {
      await sendWeb(res, await getClick(request, { params: { id: decodeURIComponent(click[1]) } }));
      return;
    }
    sendText(res, 404, "not found");
  })().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    if (!res.headersSent) sendText(res, 500, message);
    else res.end();
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`live-smoke listening ${origin}\n`);
});
EOF
}

start_smoke_server() {
  local port="$1"
  local log_path="$2"
  local server_path="$3"
  shift 3
  (
    cd "$root"
    unset POLAR_LIVE POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET || true
    export POLAR_FIXTURE_ONLY=1
    export PORT="${port}"
    export PUBLIC_BASE_URL="http://127.0.0.1:${port}"
    while [[ $# -gt 0 ]]; do
      export "$1"
      shift
    done
    exec npx --no-install tsx --tsconfig "${root}/tsconfig.json" "${server_path}"
  ) >"${log_path}" 2>&1 &
  echo $!
}

http_get() {
  local base="$1"
  local path="$2"
  local out="$3"
  curl -sS -o "$out" -w "%{http_code}" --connect-timeout 5 --max-time 20 \
    "${base}${path}"
}

http_get_headers() {
  local base="$1"
  local path="$2"
  local body="$3"
  local hdrs="$4"
  curl -sS -D "$hdrs" -o "$body" -w "%{http_code}" --connect-timeout 5 --max-time 20 \
    --max-redirs 0 \
    "${base}${path}"
}

http_post_json() {
  local base="$1"
  local path="$2"
  local payload="$3"
  local body="$4"
  local hdrs="$5"
  curl -sS -D "$hdrs" -o "$body" -w "%{http_code}" --connect-timeout 5 --max-time 30 \
    --max-redirs 0 \
    -X POST \
    -H "content-type: application/json" \
    -H "accept: application/json" \
    --data "$payload" \
    "${base}${path}"
}

header_value() {
  local file="$1"
  local name="$2"
  awk -v name="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" '
    BEGIN { FS = ": " }
    tolower($1) == name {
      val = $0
      sub(/^[^:]+:[ \t]*/, "", val)
      gsub(/\r/, "", val)
      print val
      exit
    }
  ' "$file"
}

json_field() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const raw = readFileSync(process.argv[1], "utf8");
    let data;
    try { data = JSON.parse(raw); } catch { process.exit(2); }
    const key = process.argv[2];
    const value = data == null ? undefined : data[key];
    if (value === undefined || value === null) process.exit(3);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      process.stdout.write(String(value));
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(value));
  ' "$1" "$2"
}

html_has() {
  local file="$1"
  local pattern="$2"
  grep -Eq "$pattern" "$file"
}

invented_ratings() {
  local file="$1"
  grep -Eiq '★|⭐|4\.8 stars|star rating|data-stars=|data-rating=' "$file"
}

listing_count() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    process.stdout.write(String([...html.matchAll(/data-listing-id="([^"]+)"/g)].length));
  ' "$1"
}

id_for_host() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    const host = process.argv[2];
    const cards = [...html.matchAll(/<article class="card"[\s\S]*?<\/article>/g)].map((m) => m[0]);
    for (const card of cards) {
      if (card.includes(host)) {
        const id = card.match(/data-listing-id="([^"]+)"/);
        if (id) {
          process.stdout.write(id[1]);
          process.exit(0);
        }
      }
    }
    process.exit(2);
  ' "$1" "$2"
}

clicks_for_id() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    const id = process.argv[2];
    const cards = [...html.matchAll(/<article class="card"[\s\S]*?<\/article>/g)].map((m) => m[0]);
    for (const card of cards) {
      if (card.includes(`data-listing-id="${id}"`)) {
        const clicks = card.match(/(\d+) clicks?/);
        if (clicks) {
          process.stdout.write(clicks[1]);
          process.exit(0);
        }
      }
    }
    process.exit(2);
  ' "$1" "$2"
}

card_has_listing_shape() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const html = readFileSync(process.argv[1], "utf8");
    const host = process.argv[2];
    const cards = [...html.matchAll(/<article class="card"[\s\S]*?<\/article>/g)].map((m) => m[0]);
    for (const card of cards) {
      if (!card.includes(host)) continue;
      const hasBuyer = /data-buyer=/.test(card) && /data-buyer-name/.test(card);
      const hasBudget = /data-budget/.test(card) && /Budget \$/.test(card);
      const hasDeadline = /data-deadline/.test(card) && /Deadline \d{4}-\d{2}-\d{2}/.test(card);
      const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const hasBrief = new RegExp(`data-brief-url="https://${escaped}"`).test(card);
      process.stdout.write(hasBuyer && hasBudget && hasDeadline && hasBrief ? "1" : "0");
      process.exit(0);
    }
    process.exit(2);
  ' "$1" "$2"
}

WORKDIR="$(mktemp -d "${root}/.live-smoke.XXXXXX")"
RESULT_LOG="${WORKDIR}/results.tsv"
: >"${RESULT_LOG}"
STAMP="$(date -u +%Y%m%d%H%M%S)"
EXPECT_WEEK="$(iso_week_utc)"
BRIEF_HOST="brief.example/smoke-${STAMP}"
BRIEF_URL="https://${BRIEF_HOST}"
TRACKED_URL="${BRIEF_URL}?utm_source=smoke&fbclid=1"
BUYER="Smoke Buyer ${STAMP}"
SERVER_PATH="${WORKDIR}/smoke-server.tsx"
write_smoke_server "$SERVER_PATH"

echo "== live-smoke (operator only; not CI) =="
echo "root=${root}"
echo "weekId=${EXPECT_WEEK}"

if [[ -z "${BASE}" ]]; then
  PORT="${LIVE_SMOKE_PORT:-$(pick_port)}"
  BASE="http://127.0.0.1:${PORT}"
  LOG_PATH="${WORKDIR}/server.log"
  echo "starting local fixture process on ${BASE}"
  STARTED_PID="$(start_smoke_server "$PORT" "$LOG_PATH" "$SERVER_PATH" "POLAR_FIXTURE_ONLY=1")"
  if ! wait_health "$BASE"; then
    echo "server log:" >&2
    cat "${LOG_PATH}" >&2 || true
    fail "local server did not become healthy at ${BASE}/healthz"
  fi
else
  BASE="${BASE%/}"
  echo "assuming existing server at ${BASE}"
  if ! wait_health "$BASE"; then
    fail "existing server at ${BASE} did not answer /healthz"
  fi
fi

echo "base=${BASE}"
echo "operator POLAR_LIVE=${OP_POLAR_LIVE:-<unset>}"

# --- healthz ---
health_body="${WORKDIR}/healthz.json"
health_code="$(http_get "$BASE" "/healthz" "$health_body" || true)"
if [[ "$health_code" != "200" ]] || ! grep -q '"ok":true' "$health_body"; then
  fail "GET /healthz HTTP ${health_code}"
fi

# --- Board: current UTC week, listing shape, honest empty week ---
board0="${WORKDIR}/board0.html"
board0_code="$(http_get "$BASE" "/" "$board0" || true)"
board0_count="$(listing_count "$board0" || echo 0)"
if [[ "$board0_code" != "200" ]]; then
  record "board" "FAIL" "GET / HTTP ${board0_code}"
elif ! html_has "$board0" "data-week=\"${EXPECT_WEEK}\"" \
  || ! html_has "$board0" 'name="buyer"' \
  || ! html_has "$board0" 'name="budgetUsd"' \
  || ! html_has "$board0" 'name="deadline"' \
  || ! html_has "$board0" 'name="briefUrl"' \
  || ! html_has "$board0" 'action="/api/checkout"'; then
  record "board" "FAIL" "GET / missing week ${EXPECT_WEEK} or buyer + budget + deadline + brief URL form"
elif invented_ratings "$board0"; then
  record "board" "FAIL" "GET / invented ratings"
elif [[ "$board0_count" == "0" ]] && html_has "$board0" 'data-empty-week' \
  && html_has "$board0" 'no invented #1 brief'; then
  record "board" "PASS" "GET / 200 week ${EXPECT_WEEK} empty board + form; no invented ratings"
elif [[ "$board0_count" != "0" ]] \
  && html_has "$board0" 'data-budget' \
  && html_has "$board0" 'data-deadline' \
  && html_has "$board0" 'data-brief-url' \
  && html_has "$board0" 'data-buyer'; then
  record "board" "PASS" "GET / 200 week ${EXPECT_WEEK}; ${board0_count} already-paid card(s); listing shape present"
else
  record "board" "FAIL" "GET / 200 but empty-week / listing-shape contract broken"
fi

# --- About / rules ---
about_body="${WORKDIR}/about.html"
about_code="$(http_get "$BASE" "/about" "$about_body" || true)"
rules_body="${WORKDIR}/rules.html"
rules_code="$(http_get "$BASE" "/rules" "$rules_body" || true)"
if [[ "$about_code" == "200" && "$rules_code" == "200" ]] \
  && html_has "$about_body" 'Rank is the bid' \
  && html_has "$about_body" 'no invented ratings' \
  && html_has "$about_body" 'freelance-brief-board' \
  && html_has "$rules_body" '\$5' \
  && html_has "$rules_body" 'Older wins ties' \
  && html_has "$rules_body" 'Raise pays difference' \
  && html_has "$rules_body" 'Monday 00:00:00.000 UTC' \
  && html_has "$rules_body" 'No invented ratings' \
  && ! invented_ratings "$about_body" \
  && ! invented_ratings "$rules_body"; then
  record "about-rules" "PASS" "GET /about and /rules 200; min \$5, older wins, raise difference, weekly UTC, no invented ratings"
else
  record "about-rules" "FAIL" "about HTTP ${about_code} rules HTTP ${rules_code}"
fi

# --- Honesty: no stars / invented #1; rating field is rating_forbidden ---
if invented_ratings "$board0" || invented_ratings "$about_body" || invented_ratings "$rules_body"; then
  record "honesty" "FAIL" "stars or review scores rendered"
elif [[ "$board0_count" == "0" ]] && ! html_has "$board0" 'data-empty-week'; then
  record "honesty" "FAIL" "empty week invented a #1 brief"
else
  record "honesty" "PASS" "no stars, no review scores, no invented #1 brief"
fi

rating_body="${WORKDIR}/rating.json"
rating_hdrs="${WORKDIR}/rating.hdrs"
rating_code="$(http_post_json "$BASE" "/api/checkout" \
  "{\"buyer\":\"Rated Buyer\",\"budgetUsd\":3200,\"deadline\":\"2026-12-15\",\"winnerRule\":\"Best portfolio\",\"briefUrl\":\"${BRIEF_URL}-rated\",\"amountUsd\":5,\"rating\":\"4.8\"}" \
  "$rating_body" "$rating_hdrs" || true)"
rating_err="$(json_field "$rating_body" "error" || true)"
board_after_rating="${WORKDIR}/board-after-rating.html"
http_get "$BASE" "/" "$board_after_rating" >/dev/null || true
if [[ "$rating_code" == "400" && "$rating_err" == "rating_forbidden" ]] \
  && ! html_has "$board_after_rating" "${BRIEF_HOST}-rated"; then
  record "honesty-rating" "PASS-ERROR" "POST /api/checkout rating=4.8 → 400 rating_forbidden; no listing"
else
  record "honesty-rating" "FAIL" "rating HTTP ${rating_code} error=${rating_err}"
fi

# --- Create checkout: live Polar session or BLOCKED-SECRET ---
echo "== polar live checkout =="
if [[ "${OP_POLAR_LIVE}" == "1" ]]; then
  if [[ -z "${OP_POLAR_ACCESS_TOKEN}" ]]; then
    echo "BLOCKED-SECRET: POLAR_ACCESS_TOKEN"
    record "checkout" "BLOCKED-SECRET" "POLAR_ACCESS_TOKEN"
  else
    live_port="$(pick_port)"
    live_log="${WORKDIR}/polar-live.log"
    live_base="http://127.0.0.1:${live_port}"
    LIVE_PID="$(start_smoke_server "$live_port" "$live_log" "$SERVER_PATH" \
      "POLAR_LIVE=1" \
      "POLAR_ACCESS_TOKEN=${OP_POLAR_ACCESS_TOKEN}" \
      "POLAR_WEBHOOK_SECRET=${OP_POLAR_WEBHOOK_SECRET:-}" \
      "POLAR_FIXTURE_ONLY=")"
    if ! wait_health "$live_base"; then
      if grep -q 'BLOCKED-SECRET: POLAR_ACCESS_TOKEN' "${live_log}"; then
        echo "BLOCKED-SECRET: POLAR_ACCESS_TOKEN"
        record "checkout" "BLOCKED-SECRET" "POLAR_ACCESS_TOKEN"
      else
        record "checkout" "FAIL" "live Polar process did not become healthy"
      fi
    else
      live_body="${WORKDIR}/live-checkout.json"
      live_hdrs="${WORKDIR}/live-checkout.hdrs"
      live_code="$(http_post_json "$live_base" "/api/checkout" \
        "{\"buyer\":\"Live Polar Buyer\",\"budgetUsd\":2500,\"deadline\":\"2026-12-15\",\"winnerRule\":\"First qualified\",\"briefUrl\":\"https://live.example/brief-${STAMP}\",\"amountUsd\":5}" \
        "$live_body" "$live_hdrs" || true)"
      live_url="$(json_field "$live_body" "checkoutUrl" || true)"
      live_err="$(json_field "$live_body" "error" || true)"
      live_board="${WORKDIR}/live-board.html"
      http_get "$live_base" "/" "$live_board" >/dev/null || true
      if html_has "$live_board" "live.example/brief-${STAMP}"; then
        record "checkout" "FAIL" "unpaid live Polar session appeared on the board"
      elif [[ "$live_code" == "200" && "$live_url" == https://*polar.sh* ]]; then
        record "checkout" "PASS" "live Polar checkout URL; unpaid session not listed"
      elif [[ "$live_code" == "503" && "$live_err" == "polar_unavailable" ]]; then
        record "checkout" "PASS-ERROR" "POLAR_LIVE=1 polar_unavailable; no invented paid rank"
      else
        record "checkout" "PASS-ERROR" "POLAR_LIVE=1 HTTP ${live_code} error=${live_err}; no invented paid rank"
      fi
    fi
    if [[ -n "${LIVE_PID}" ]]; then
      kill_tree "${LIVE_PID}"
      wait "${LIVE_PID}" 2>/dev/null || true
    fi
    LIVE_PID=""
  fi
else
  if [[ -z "${OP_POLAR_ACCESS_TOKEN}" ]]; then
    echo "BLOCKED-SECRET: POLAR_ACCESS_TOKEN"
    record "checkout" "BLOCKED-SECRET" "POLAR_ACCESS_TOKEN"
  else
    record "checkout" "PASS-ERROR" "POLAR_LIVE unset; token present but live Polar not invoked"
  fi
fi

# --- Click: fixture listing allowed when live pay is blocked ---
# Rank updates only after a paid webhook / fixture event. Unpaid checkout does not list.
fix_body="${WORKDIR}/fixture-checkout.json"
fix_hdrs="${WORKDIR}/fixture-checkout.hdrs"
fix_code="$(http_post_json "$BASE" "/api/checkout" \
  "{\"buyer\":\"${BUYER}\",\"budgetUsd\":3200,\"deadline\":\"2026-12-15\",\"winnerRule\":\"Best portfolio by Friday\",\"briefUrl\":\"${TRACKED_URL}\",\"amountUsd\":5}" \
  "$fix_body" "$fix_hdrs" || true)"
fix_session="$(json_field "$fix_body" "sessionId" || true)"
board_unpaid="${WORKDIR}/board-unpaid.html"
http_get "$BASE" "/" "$board_unpaid" >/dev/null || true
if [[ "$fix_code" != "200" || -z "$fix_session" ]]; then
  record "click" "FAIL" "fixture checkout HTTP ${fix_code} (needed for click hop)"
elif html_has "$board_unpaid" "$BRIEF_HOST"; then
  record "click" "FAIL" "unpaid fixture checkout appeared on the board"
else
  hook_body="${WORKDIR}/fixture-webhook.json"
  hook_hdrs="${WORKDIR}/fixture-webhook.hdrs"
  hook_code="$(http_post_json "$BASE" "/api/polar/webhook" \
    "{\"type\":\"checkout.updated\",\"data\":{\"id\":\"${fix_session}\",\"status\":\"succeeded\"}}" \
    "$hook_body" "$hook_hdrs" || true)"
  board_paid="${WORKDIR}/board-paid.html"
  board_paid_code="$(http_get "$BASE" "/" "$board_paid" || true)"
  listing_id="$(id_for_host "$board_paid" "$BRIEF_HOST" || true)"
  shape_ok="$(card_has_listing_shape "$board_paid" "$BRIEF_HOST" || echo 0)"
  if [[ "$hook_code" != "200" || "$board_paid_code" != "200" || -z "$listing_id" ]]; then
    record "click" "FAIL" "fixture paid event did not list (webhook HTTP ${hook_code} id=${listing_id})"
  elif [[ "$shape_ok" != "1" ]] \
    || html_has "$board_paid" 'utm_source' \
    || invented_ratings "$board_paid"; then
    record "click" "FAIL" "paid card missing listing shape or leaked tracking/ratings"
  else
    before_clicks="$(clicks_for_id "$board_paid" "$listing_id" || echo "")"
    click_body="${WORKDIR}/click.body"
    click_hdrs="${WORKDIR}/click.hdrs"
    click_code="$(http_get_headers "$BASE" "/click/${listing_id}" "$click_body" "$click_hdrs" || true)"
    click_loc="$(header_value "$click_hdrs" "location" || true)"
    board_clicked="${WORKDIR}/board-clicked.html"
    http_get "$BASE" "/" "$board_clicked" >/dev/null || true
    after_clicks="$(clicks_for_id "$board_clicked" "$listing_id" || echo "")"
    if [[ "$click_code" == "302" \
      && "$click_loc" == "${BRIEF_URL}" \
      && "$before_clicks" =~ ^[0-9]+$ \
      && "$after_clicks" =~ ^[0-9]+$ \
      && "$after_clicks" -eq $((before_clicks + 1)) ]]; then
      record "click" "PASS" "GET /click/${listing_id} 302 → stripped URL; clicks ${before_clicks}→${after_clicks}"
    else
      record "click" "FAIL" "GET /click/${listing_id} HTTP ${click_code} loc=${click_loc} clicks ${before_clicks}→${after_clicks}"
    fi
  fi
fi

echo
echo "== summary =="
echo "PASS=${PASS} PASS-ERROR=${PASS_ERROR} BLOCKED-SECRET=${BLOCKED} FAIL=${FAIL}"
echo "base=${BASE}"
echo "weekId=${EXPECT_WEEK}"
if [[ -f "${RESULT_LOG}" ]]; then
  echo "----"
  while IFS=$'\t' read -r flow status note; do
    printf '%-18s %-16s %s\n' "$flow" "$status" "$note"
  done <"${RESULT_LOG}"
fi

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
