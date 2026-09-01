import { createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export type DatabaseEnv = Record<string, string | undefined>;

export type ProviderMode = "fixture" | "waffo-test" | "waffo-prod";

export const DEFAULT_DATABASE_PATH = "./data/freelance-brief-board.sqlite";
export const DEFAULT_WAFFO_API_BASE = "https://api.waffo.ai";
const NON_DELEGABLE_SUFFIXES = [
  ".example",
  ".test",
  ".invalid",
  ".localhost",
  ".local",
  ".home.arpa",
  ".onion",
  ".alt",
  ".internal",
] as const;

function nonEmpty(env: DatabaseEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/** The mode is explicit; legacy provider flags are never selectors. */
export function providerMode(env: DatabaseEnv = process.env): ProviderMode | undefined {
  const waffoMode = nonEmpty(env, "WAFFO_MODE");
  if (waffoMode === "fixture" || waffoMode === "waffo-test" || waffoMode === "waffo-prod") {
    return waffoMode;
  }
  return undefined;
}

export function databasePath(env: DatabaseEnv = process.env): string {
  return nonEmpty(env, "DATABASE_PATH") ?? DEFAULT_DATABASE_PATH;
}

export function isDurableDatabasePath(path: string): boolean {
  return !(
    path === ":memory:" ||
    path.startsWith("file::memory:") ||
    path.startsWith("file:memdb")
  );
}

export function publicBaseUrl(env: DatabaseEnv = process.env): string | undefined {
  const value = nonEmpty(env, "PUBLIC_BASE_URL");
  return value?.replace(/\/$/, "");
}

export function waffoPrivateKey(env: DatabaseEnv = process.env): string | undefined {
  return nonEmpty(env, "WAFFO_PRIVATE_KEY");
}

export function waffoApiBase(env: DatabaseEnv = process.env): string {
  return (
    nonEmpty(env, "WAFFO_API_BASE") ?? DEFAULT_WAFFO_API_BASE
  ).replace(/\/$/, "");
}

/**
 * Fail closed for every provider mode that could reach Waffo. `waffo-test` is
 * deliberately explicit and may be used by an optimized production build,
 * but it still needs an isolated durable database and test verification key.
 * Key material is parsed here, before a server can report readiness. The
 * contents are never included in an error or log message.
 */
export function assertProviderSettings(env: DatabaseEnv = process.env): ProviderMode {
  const mode = providerMode(env);
  if (!mode) {
    throw new Error("BLOCKED-CONFIG: WAFFO_MODE must be fixture, waffo-test, or waffo-prod");
  }
  if (mode === "fixture") {
    if (env.NODE_ENV === "production") {
      throw new Error("BLOCKED-CONFIG: production cannot use fixture mode");
    }
    return mode;
  }

  requireSetting(env, "WAFFO_MERCHANT_ID", "BLOCKED-SECRET");
  requireSetting(env, "WAFFO_STORE_ID", "BLOCKED-CONFIG");
  requireSetting(env, "WAFFO_PRODUCT_ID", "BLOCKED-CONFIG");
  requireSetting(env, "DATABASE_PATH", "BLOCKED-CONFIG");
  if (!isDurableDatabasePath(databasePath(env))) {
    throw new Error("BLOCKED-CONFIG: DATABASE_PATH must be a durable shared file");
  }
  const baseUrl = publicBaseUrl(env);
  if (!baseUrl || !isOriginOnlyHttpUrl(baseUrl)) {
    throw new Error("BLOCKED-CONFIG: PUBLIC_BASE_URL");
  }
  if (mode === "waffo-prod" && !isPublicHttpsUrl(baseUrl)) {
    throw new Error("BLOCKED-CONFIG: PUBLIC_BASE_URL must be public HTTPS in production");
  }
  const privateKeyFile = nonEmpty(env, "WAFFO_PRIVATE_KEY_FILE");
  const inlinePrivateKey = waffoPrivateKey(env);
  if (!inlinePrivateKey && !privateKeyFile) {
    throw new Error("BLOCKED-SECRET: WAFFO_PRIVATE_KEY");
  }
  if (privateKeyFile) {
    if (!existsSync(privateKeyFile)) {
      throw new Error("BLOCKED-SECRET: WAFFO_PRIVATE_KEY_FILE");
    }
    // Validate a configured file even when an inline value is also present;
    // silently accepting a broken alternate production secret makes a deploy
    // dependent on an undocumented precedence rule.
    assertRsaPrivateKey(readSecretFile(privateKeyFile), "WAFFO_PRIVATE_KEY_FILE");
  }
  if (inlinePrivateKey) {
    assertRsaPrivateKey(inlinePrivateKey, "WAFFO_PRIVATE_KEY");
  }
  if (mode === "waffo-prod" && waffoApiBase(env) !== DEFAULT_WAFFO_API_BASE) {
    throw new Error("BLOCKED-CONFIG: WAFFO_API_BASE must be https://api.waffo.ai in production");
  }
  const keyName = mode === "waffo-prod"
    ? "WAFFO_WEBHOOK_PROD_PUBLIC_KEY"
    : "WAFFO_WEBHOOK_TEST_PUBLIC_KEY";
  assertRsaPublicKey(requireSetting(env, keyName, "BLOCKED-SECRET"), keyName);
  return mode;
}

function readSecretFile(path: string): string {
  try {
    const value = readFileSync(path, "utf8").trim();
    if (!value) throw new Error("empty");
    return value;
  } catch {
    throw new Error("BLOCKED-SECRET: WAFFO_PRIVATE_KEY_FILE");
  }
}

function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();
}

function assertRsaPrivateKey(value: string, name: string): void {
  const pem = normalizePem(value);
  const isPem =
    /^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/.test(pem) ||
    /^-----BEGIN RSA PRIVATE KEY-----[\s\S]+-----END RSA PRIVATE KEY-----$/.test(pem);
  if (!isPem) throw new Error(`BLOCKED-SECRET: ${name}`);
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "rsa") throw new Error("not-rsa");
  } catch {
    throw new Error(`BLOCKED-SECRET: ${name}`);
  }
}

function assertRsaPublicKey(value: string, name: string): void {
  const pem = normalizePem(value);
  const isPem =
    /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/.test(pem) ||
    /^-----BEGIN RSA PUBLIC KEY-----[\s\S]+-----END RSA PUBLIC KEY-----$/.test(pem);
  if (!isPem) throw new Error(`BLOCKED-SECRET: ${name}`);
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "rsa") throw new Error("not-rsa");
  } catch {
    throw new Error(`BLOCKED-SECRET: ${name}`);
  }
}

function requireSetting(
  env: DatabaseEnv,
  name: string,
  prefix: "BLOCKED-SECRET" | "BLOCKED-CONFIG",
): string {
  const value = nonEmpty(env, name);
  if (!value) throw new Error(`${prefix}: ${name}`);
  return value;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname.length > 0 && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isOriginOnlyHttpUrl(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.pathname === "/" && parsed.search === "" && parsed.hash === "";
  } catch {
    return false;
  }
}

/** A provider destination must be HTTPS and resolve to a public host. */
export function isPublicHttpsUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const normalizedHost = host.endsWith(".") ? host.slice(0, -1) : host;
  if (
    normalizedHost === "localhost" ||
    normalizedHost.endsWith(".localhost") ||
    normalizedHost.endsWith(".local") ||
    normalizedHost === "::1"
  ) {
    return false;
  }
  if (isPrivateIpv4(normalizedHost) || isPrivateIpv6(normalizedHost)) return false;
  if (!normalizedHost) return false;
  // A callback/checkout destination must be a delegable DNS name or a public
  // numeric IP. Single-label names and special-use suffixes are not
  // externally verifiable, even when they happen to resolve on one network.
  const numericIpv4 = normalizedHost.split(".").every((part) => /^\d+$/.test(part));
  if (numericIpv4 || normalizedHost.includes(":")) return true;
  const hostname = normalizedHost;
  if (!hostname.includes(".") || hostname.length > 253) return false;
  if (
    NON_DELEGABLE_SUFFIXES.some(
      (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
    )
  ) {
    return false;
  }
  return hostname.split(".").every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
  );
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.some((part) => !/^\d+$/.test(part))) return false;
  // Numeric shorthand (127.1, 2130706433, etc.) is also a loopback/private
  // URL form and must not be accepted as a public callback origin.
  if (parts.length !== 4) return true;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  return isRestrictedIpv4Number(
    ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0,
  );
}

function isPrivateIpv6(host: string): boolean {
  if (!host.includes(":")) return false;
  const words = parseIpv6(host);
  // A colon-bearing URL host is expected to be a literal. Fail closed if it
  // cannot be parsed rather than accidentally treating it as a public name.
  if (!words) return true;
  if (words.every((word) => word === 0) ||
      (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)) {
    return true;
  }

  // IPv4-mapped and IPv4-compatible forms are not valid public callback
  // origins. In particular, URL normalization turns 127.0.0.1 into
  // ::ffff:7f00:1, so textual-prefix checks are insufficient.
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const compatible = words.slice(0, 6).every((word) => word === 0);
  if (mapped || compatible) return true;

  const first = words[0]!;
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique-local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xffc0) === 0xfec0 || // deprecated site-local
    (first & 0xff00) === 0xff00 || // multicast/reserved
    startsWithIpv6(words, [0x2001, 0x0db8], 32) || // documentation
    startsWithIpv6(words, [0x2001, 0x0002, 0x0000], 48) || // benchmarking
    startsWithIpv6(words, [0x2001, 0x0010], 28) || // ORCHID
    startsWithIpv6(words, [0x2001, 0x0020], 28) || // ORCHIDv2
    startsWithIpv6(words, [0x3fff], 20) || // documentation (RFC 9637)
    startsWithIpv6(words, [0x0100, 0x0000, 0x0000, 0x0000], 64) || // discard-only 100::/64
    startsWithIpv6(words, [0x0064, 0xff9b], 48) // well-known translation prefix
  );
}

function isRestrictedIpv4Number(value: number): boolean {
  const first = (value >>> 24) & 0xff;
  const second = (value >>> 16) & 0xff;
  const third = (value >>> 8) & 0xff;
  return (
    first === 0 || // this network / unspecified
    first === 10 || // RFC1918
    first === 127 || // loopback
    (first === 100 && second >= 64 && second <= 127) || // CGNAT
    (first === 169 && second === 254) || // link-local
    (first === 172 && second >= 16 && second <= 31) || // RFC1918
    (first === 192 && second === 0 && third === 0) || // IETF protocol assignments
    (first === 192 && second === 0 && third === 2) || // TEST-NET-1
    (first === 192 && second === 31 && third === 196) || // AS112
    (first === 192 && second === 52 && third === 193) || // AMT
    (first === 192 && second === 88 && third === 99) || // deprecated 6to4 anycast
    (first === 192 && second === 168) || // RFC1918
    (first === 192 && second === 175 && third === 48) || // AS112
    (first === 198 && second >= 18 && second <= 19) || // benchmarking
    (first === 198 && second === 51 && third === 100) || // TEST-NET-2
    (first === 203 && second === 0 && third === 113) || // TEST-NET-3
    first >= 224 // multicast and reserved
  );
}

function parseIpv6(host: string): number[] | undefined {
  const halves = host.split("::");
  if (halves.length > 2) return undefined;
  const left = parseIpv6Side(halves[0] ?? "");
  const right = halves.length === 2 ? parseIpv6Side(halves[1] ?? "") : [];
  if (!left || !right) return undefined;
  if (halves.length === 1) return left.length === 8 ? left : undefined;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return undefined;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function parseIpv6Side(side: string): number[] | undefined {
  if (!side) return [];
  const groups = side.split(":");
  const result: number[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]!;
    if (group.includes(".")) {
      if (index !== groups.length - 1) return undefined;
      const octets = group.split(".").map(Number);
      if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
        return undefined;
      }
      result.push(((octets[0]! << 8) | octets[1]!) >>> 0);
      result.push(((octets[2]! << 8) | octets[3]!) >>> 0);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return undefined;
    result.push(Number.parseInt(group, 16));
  }
  return result;
}

function startsWithIpv6(words: number[], prefix: number[], bits: number): boolean {
  const fullWords = Math.floor(bits / 16);
  for (let index = 0; index < fullWords; index += 1) {
    if (words[index] !== prefix[index]) return false;
  }
  const remaining = bits % 16;
  if (remaining === 0) return true;
  const mask = (0xffff << (16 - remaining)) & 0xffff;
  return (words[fullWords]! & mask) === (prefix[fullWords]! & mask);
}

/** Config used by openBoardDatabase; fixture is allowed only explicitly. */
export function assertProductionSettings(env: DatabaseEnv = process.env): void {
  const mode = providerMode(env);
  if (env.NODE_ENV === "production" || mode === "waffo-test" || mode === "waffo-prod") {
    assertProviderSettings(env);
  }
}
