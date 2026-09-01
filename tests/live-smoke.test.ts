import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { WAFFO_API_BASE } from "../src/billing/waffo";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

test("live-smoke.sh is executable and operator-only", () => {
  const scriptPath = join(ROOT, "scripts/live-smoke.sh");
  const mode = statSync(scriptPath).mode;
  assert.equal(mode & 0o111, 0o111, "scripts/live-smoke.sh must be executable");

  const script = read("scripts/live-smoke.sh");
  assert.match(script, /WAFFO_MODE/);
  assert.match(script, /WAFFO_PRIVATE_KEY/);
  assert.match(script, /fixture development/);
  assert.match(script, /live-smoke refuses CI=true/);
  assert.match(script, /live-smoke must not run in GitHub Actions/);
  assert.match(script, /\/about/);
  assert.match(script, /\/rules/);
  assert.match(script, /\/checkout/);
  assert.match(script, /\/click\//);
  assert.match(script, /rating_forbidden/);
  assert.match(script, /no invented ratings/i);
  assert.match(script, /waffo\.ai/);
  assert.doesNotMatch(script, /invented paid #1 brief|fake #1 brief/i);
});

test("docs/live-smoke.md records verdict labels and is not a paid-rank invention", () => {
  const docs = read("docs/live-smoke.md");
  assert.match(docs, /PASS/);
  assert.match(docs, /PASS-ERROR/);
  assert.match(docs, /BLOCKED-SECRET/);
  assert.match(docs, /FAIL/);
  assert.match(docs, /scripts\/live-smoke\.sh/);
  assert.match(docs, /not\*\* called from `scripts\/test\.sh`|not called from `scripts\/test\.sh`/i);
  assert.match(docs, /never rewritten to fixture/);
  assert.match(docs, /offline fixture and makes no provider request/);
  assert.doesNotMatch(docs, /invented paid #1|seeded #1 brief/i);
});

test("scripts/test.sh and CI stay offline and do not invoke live-smoke", () => {
  const testSh = read("scripts/test.sh");
  const script = read("scripts/live-smoke.sh");
  const ci = read(".github/workflows/ci.yml");

  assert.doesNotMatch(testSh, /^\s*(bash )?(\.\/)?scripts\/live-smoke\.sh/m);
  assert.match(testSh, /must not invoke live-smoke/);
  assert.match(testSh, /WAFFO_MODE=fixture/);
  assert.match(testSh, /test_database=.*board\.sqlite/);
  assert.match(testSh, /export DATABASE_PATH="\$test_database"/);
  assert.doesNotMatch(testSh, /DATABASE_PATH\s*=\s*["']?:memory:/);
  assert.match(testSh, /next start/);
  assert.match(testSh, /journal_mode/);
  assert.match(testSh, /quick_check/);
  assert.match(script, /SMOKE_DATABASE_PATH/);
  assert.doesNotMatch(script, /DATABASE_PATH\s*=\s*["']?:memory:/);
  assert.doesNotMatch(ci, /live-smoke/);
  assert.doesNotMatch(ci, /WAFFO_PRIVATE_KEY/);
  assert.match(ci, /bash scripts\/test\.sh/);
});

test("paid-card smoke parsing requires value-bearing budget and due facts", () => {
  const script = read("scripts/live-smoke.sh");
  assert.match(script, /hasBudgetMarker/);
  assert.match(script, /hasBudgetValue/);
  assert.match(script, /Budget\\s\+\\\$\[0-9\]/);
  assert.match(script, /hasDeadlineMarker/);
  assert.match(script, /hasDeadlineValue/);
  assert.match(script, /assert_card_parser_regression/);

  const hasValueBearingFacts = (card: string): boolean =>
    /data-budget(?:=""|="[^"]*")/.test(card) &&
    /Budget\s+\$[0-9][0-9,]*/.test(card) &&
    /data-deadline(?:=""|="[^"]*")/.test(card) &&
    /(?:Due|Deadline)\s+(?:\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Z][a-z]+\s+\d{4})/.test(card);

  const emptyFacts = '<li data-listing-card="" data-budget="" data-deadline=""></li>';
  const populatedFacts = '<li data-listing-card="" data-budget="">Budget $3,200<dd data-deadline="">Due 15 December 2026</dd></li>';
  assert.equal(hasValueBearingFacts(emptyFacts), false);
  assert.equal(hasValueBearingFacts(populatedFacts), true);
});

test("explicit live Waffo mode is blocked, never converted to fixture", () => {
  const result = spawnSync("bash", ["scripts/live-smoke.sh"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      CI: "",
      GITHUB_ACTIONS: "",
      NODE_ENV: "production",
      WAFFO_MODE: "waffo-prod",
      WAFFO_MERCHANT_ID: "",
      WAFFO_STORE_ID: "",
      WAFFO_PRODUCT_ID: "",
      WAFFO_PRIVATE_KEY: "dummy",
      WAFFO_PRIVATE_KEY_FILE: "",
      WAFFO_WEBHOOK_TEST_PUBLIC_KEY: "",
      WAFFO_WEBHOOK_PROD_PUBLIC_KEY: "",
      WAFFO_API_BASE: "",
      DATABASE_PATH: "",
      PUBLIC_BASE_URL: "",
    },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /BLOCKED-SECRET: WAFFO_MERCHANT_ID/);
  assert.match(output, /PASS=4 PASS-ERROR=1 BLOCKED-SECRET=1 FAIL=0/);
  assert.doesNotMatch(output, /Waffo fixture checkout \(offline\)/);
});

test("Waffo provider default remains production", () => {
  assert.equal(WAFFO_API_BASE, "https://api.waffo.ai");
});
