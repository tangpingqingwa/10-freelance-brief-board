#!/usr/bin/env node

// `npm start` is the production workflow. Keep configuration parsing
// dependency-free so a production install fails before Next binds a port.
// Database readiness below invokes the shared src/db.ts migration/query path;
// only its exit status is used, so no path or secret details are logged.
import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const value = (name) => {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
};

const fail = (message) => {
  console.error(`BLOCKED-CONFIG: ${message}`);
  process.exit(1);
};

const mode = value("WAFFO_MODE");
if (mode !== "waffo-prod" && mode !== "waffo-test") {
  fail("WAFFO_MODE must be waffo-prod or explicit waffo-test for npm start");
}

for (const name of [
  "WAFFO_MERCHANT_ID",
  "WAFFO_STORE_ID",
  "WAFFO_PRODUCT_ID",
  "DATABASE_PATH",
]) {
  if (!value(name)) fail(name);
}

if ([":memory:", "file::memory:", "file:memdb", "file:memory:"].some((prefix) => value("DATABASE_PATH").startsWith(prefix))) {
  fail("DATABASE_PATH must be durable");
}

const base = value("PUBLIC_BASE_URL");
if (!base) fail("PUBLIC_BASE_URL");
let parsed;
try {
  parsed = new URL(base);
} catch {
  fail("PUBLIC_BASE_URL");
}
if (
  !parsed ||
  (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
  parsed.username ||
  parsed.password ||
  parsed.pathname !== "/" ||
  parsed.search ||
  parsed.hash
) {
  fail("PUBLIC_BASE_URL must be an origin-only URL");
}

if (mode === "waffo-prod") {
  if (parsed.protocol !== "https:") fail("PUBLIC_BASE_URL must be HTTPS in waffo-prod");
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname.includes(".") ||
    [".example", ".test", ".invalid", ".localhost", ".local", ".home.arpa", ".onion", ".alt", ".internal"]
      .some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix))
  ) {
    fail("PUBLIC_BASE_URL host must be a delegable public hostname");
  }
  const ipv4Parts = hostname.split(".");
  if (ipv4Parts.every((part) => /^\d+$/.test(part))) {
    if (
      ipv4Parts.length !== 4 ||
      ipv4Parts.some((part) => Number(part) < 0 || Number(part) > 255)
    ) {
      fail("PUBLIC_BASE_URL host must be a valid public IPv4 address");
    }
    const [first, second, third] = ipv4Parts.map(Number);
    if (
      first === 0 || first === 10 || first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0 && third === 0) ||
      (first === 192 && second === 0 && third === 2) ||
      (first === 192 && second === 31 && third === 196) ||
      (first === 192 && second === 52 && third === 193) ||
      (first === 192 && second === 88 && third === 99) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 175 && third === 48) ||
      (first === 198 && second >= 18 && second <= 19) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    ) {
      fail("PUBLIC_BASE_URL host must be a public IPv4 address");
    }
  }
  if (value("WAFFO_API_BASE") && value("WAFFO_API_BASE") !== "https://api.waffo.ai") {
    fail("WAFFO_API_BASE must be https://api.waffo.ai in waffo-prod");
  }
}

if (!value("WAFFO_PRIVATE_KEY") && !value("WAFFO_PRIVATE_KEY_FILE")) {
  fail("WAFFO_PRIVATE_KEY or WAFFO_PRIVATE_KEY_FILE");
}
const normalizePem = (raw) => raw.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
const parsePrivateKey = (raw, name) => {
  const pem = normalizePem(raw);
  const isPem =
    /^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/.test(pem) ||
    /^-----BEGIN RSA PRIVATE KEY-----[\s\S]+-----END RSA PRIVATE KEY-----$/.test(pem);
  if (!isPem) fail(name);
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "rsa") fail(name);
  } catch {
    fail(name);
  }
};
const parsePublicKey = (raw, name) => {
  const pem = normalizePem(raw);
  const isPem =
    /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/.test(pem) ||
    /^-----BEGIN RSA PUBLIC KEY-----[\s\S]+-----END RSA PUBLIC KEY-----$/.test(pem);
  if (!isPem) fail(name);
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "rsa") fail(name);
  } catch {
    fail(name);
  }
};
if (value("WAFFO_PRIVATE_KEY_FILE")) {
  const path = value("WAFFO_PRIVATE_KEY_FILE");
  if (!path || !existsSync(path)) fail("WAFFO_PRIVATE_KEY_FILE");
  let key;
  try {
    key = readFileSync(path, "utf8").trim();
  } catch {
    fail("WAFFO_PRIVATE_KEY_FILE");
  }
  if (!key) fail("WAFFO_PRIVATE_KEY_FILE");
  parsePrivateKey(key, "WAFFO_PRIVATE_KEY_FILE");
}
if (value("WAFFO_PRIVATE_KEY")) parsePrivateKey(value("WAFFO_PRIVATE_KEY"), "WAFFO_PRIVATE_KEY");
const publicKey = mode === "waffo-prod"
  ? "WAFFO_WEBHOOK_PROD_PUBLIC_KEY"
  : "WAFFO_WEBHOOK_TEST_PUBLIC_KEY";
if (!value(publicKey)) fail(publicKey);
parsePublicKey(value(publicKey), publicKey);

const databaseModule = new URL("../src/db.ts", import.meta.url).href;
const databaseProbe = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    `import { assertDatabaseReady } from ${JSON.stringify(databaseModule)}; assertDatabaseReady(process.env);`,
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "ignore",
  },
);
if (databaseProbe.error || databaseProbe.status !== 0) {
  fail("DATABASE_PATH is not ready");
}

console.log("production configuration preflight OK");
