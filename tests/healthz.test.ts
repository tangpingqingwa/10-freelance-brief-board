import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { GET } from "../src/app/healthz/route";

test("GET /healthz returns 200 { ok: true }", async () => {
  const response = GET();
  const contentType = response.headers.get("content-type") ?? "";

  assert.equal(response.status, 200);
  assert.match(contentType, /^application\/json\b/);
  assert.deepEqual(await response.json(), { ok: true });
});

test("production readiness opens, migrates, and queries durable DB before reporting ready", async () => {
  const directory = mkdtempSync(join(tmpdir(), "freelance-healthz-readiness-"));
  const databasePath = join(directory, "board.sqlite");
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const readinessEnv: Record<string, string | undefined> = {
    NODE_ENV: "production",
    WAFFO_MODE: "waffo-test",
    WAFFO_MERCHANT_ID: "MER_readiness_test",
    WAFFO_STORE_ID: "STO_readiness_test",
    WAFFO_PRODUCT_ID: "PROD_readiness_test",
    WAFFO_PRIVATE_KEY: keys.privateKey,
    WAFFO_PRIVATE_KEY_FILE: undefined,
    WAFFO_WEBHOOK_TEST_PUBLIC_KEY: keys.publicKey,
    WAFFO_WEBHOOK_PROD_PUBLIC_KEY: undefined,
    WAFFO_API_BASE: "https://test.waffo.example",
    PUBLIC_BASE_URL: "https://briefboard.example.com",
    DATABASE_PATH: databasePath,
  };
  const names = Object.keys(readinessEnv);
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const restore = () => {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };

  try {
    for (const [name, value] of Object.entries(readinessEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    const ready = GET();
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { ok: true });
    assert.equal(existsSync(databasePath), true);

    const preflight = spawnSync(process.execPath, ["scripts/preflight.mjs"], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    });
    assert.equal(preflight.status, 0);

    process.env.DATABASE_PATH = directory;
    const notReady = GET();
    assert.equal(notReady.status, 503);
    const notReadyBody = JSON.stringify(await notReady.json());
    assert.equal(notReadyBody, JSON.stringify({ ok: false, error: "not_ready" }));
    assert.equal(notReadyBody.includes(directory), false);

    const blocked = spawnSync(process.execPath, ["scripts/preflight.mjs"], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    });
    assert.notEqual(blocked.status, 0);
    assert.match(`${blocked.stdout}\n${blocked.stderr}`, /DATABASE_PATH is not ready/);
    assert.equal(`${blocked.stdout}\n${blocked.stderr}`.includes(directory), false);
  } finally {
    restore();
    rmSync(directory, { recursive: true, force: true });
  }
});
