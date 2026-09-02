/** Canonical brief URL: HTTPS by default, tracking stripped, chat/NSFW/shorteners rejected. */

export class UrlError extends Error {
  constructor(
    readonly code: "url_insecure" | "url_forbidden",
    readonly httpStatus = 400,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "UrlError";
  }
}

/** Exact tracking / affiliate keys. `utm_*` and `ref_` are prefix-matched. */
export const TRACKING_QUERY_KEYS: readonly string[] = [
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "ref",
  "affiliate",
  "aff",
  "irclickid",
  "mc_cid",
  "mc_eid",
  "icid",
  "si",
  "igshid",
];

const TRACKING_KEY_SET = new Set(TRACKING_QUERY_KEYS);

/** Chat / invite hosts. Subdomains match. `discord.com` only `/invite`. */
export const CHAT_HOSTS: readonly string[] = [
  "t.me",
  "telegram.me",
  "telegram.org",
  "telegram.dog",
  "wa.me",
  "chat.whatsapp.com",
  "discord.gg",
  "m.me",
  "signal.me",
];

/** Known shorteners are not stored. Offline path rejects. */
export const SHORTENER_HOSTS: readonly string[] = [
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "lnkd.in",
];

/** Operator adult-host list. Subdomains match. Keep it boring. */
export const NSFW_HOSTS: readonly string[] = [
  "onlyfans.com",
  "fansly.com",
  "pornhub.com",
  "pornhub.org",
  "pornhubpremium.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "chaturbate.com",
  "stripchat.com",
  "manyvids.com",
  "redtube.com",
  "youporn.com",
  "brazzers.com",
  "adultfriendfinder.com",
  "spankbang.com",
];

const NSFW_PATH_TOKENS = new Set([
  "porn",
  "porno",
  "xxx",
  "nsfw",
  "onlyfans",
  "fansly",
  "hentai",
  "escort",
  "escorts",
  "camgirl",
  "camgirls",
  "nude",
  "nudes",
]);

const NSFW_COPY_RE =
  /\b(porn|porno|xxx|nsfw|onlyfans|fansly|hentai|escort|escorts|camgirl|camgirls|nude|nudes|naked)\b/i;

function normalizePolicyHost(host: string): string {
  return host.toLowerCase().replace(/\.+$/, "");
}

function hostMatches(host: string, listed: string): boolean {
  const normalized = normalizePolicyHost(host);
  return normalized === listed || normalized.endsWith(`.${listed}`);
}

function hostnameOf(parsed: URL): string {
  return normalizePolicyHost(parsed.hostname);
}

export function isTrackingQueryKey(key: string): boolean {
  const lowered = key.toLowerCase();
  if (lowered.startsWith("utm_")) return true;
  if (lowered.startsWith("ref_")) return true;
  return TRACKING_KEY_SET.has(lowered);
}

export function isChatUrl(parsed: URL): boolean {
  const host = hostnameOf(parsed);
  if (CHAT_HOSTS.some((listed) => hostMatches(host, listed))) {
    return true;
  }
  if (hostMatches(host, "discord.com")) {
    const path = parsed.pathname.toLowerCase();
    return path === "/invite" || path.startsWith("/invite/");
  }
  return false;
}

export function isNsfwHost(host: string): boolean {
  const lowered = normalizePolicyHost(host);
  if (NSFW_HOSTS.some((listed) => hostMatches(lowered, listed))) {
    return true;
  }
  return lowered.split(".").some((label) => NSFW_PATH_TOKENS.has(label));
}

export function isNsfwPath(path: string): boolean {
  return path
    .toLowerCase()
    .split("/")
    .some((segment) => NSFW_PATH_TOKENS.has(segment));
}

export function isNsfwCopy(raw: string): boolean {
  return NSFW_COPY_RE.test(raw);
}

export function isShortenerHost(host: string): boolean {
  return SHORTENER_HOSTS.some((listed) => hostMatches(host, listed));
}

const URL_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const ENCODED_BACKSLASH_RE = /%5c/i;
const SCHEME_RE = /^([a-z][a-z\d+.-]*):/i;
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function stripHostBrackets(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "");
}

function parseIpv4(host: string): number[] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return undefined;
  }
  const octets = parts.map(Number);
  return octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ? undefined
    : octets;
}

function isRestrictedIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.some((part) => !/^\d+$/.test(part))) return false;
  // Numeric shorthand (127.1, 2130706433, etc.) is also a loopback/private
  // URL form. WHATWG URL normalization expands many of these before this
  // check, but the remaining numeric shapes still fail closed here.
  if (parts.length !== 4) return true;
  const octets = parseIpv4(host);
  if (!octets) return true;
  const [a, b, c] = octets as [number, number, number, number];
  return (
    a === 0 || // this network / unspecified
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 168) || // RFC1918
    (a === 198 && b >= 18 && b <= 19) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast and reserved
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
      if (
        octets.length !== 4 ||
        octets.some(
          (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255,
        )
      ) {
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

function isRestrictedIpv6(host: string): boolean {
  if (!host.includes(":")) return false;
  const words = parseIpv6(host);
  // A colon-bearing URL host is expected to be a literal. Fail closed if it
  // cannot be parsed rather than accidentally treating it as a public name.
  if (!words) return true;
  if (
    words.every((word) => word === 0) ||
    (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)
  ) {
    return true;
  }

  // IPv4-mapped and IPv4-compatible literals can hide loopback/private IPv4
  // destinations behind URL's normalized hexadecimal form. Treat mapped
  // forms as non-public regardless of the embedded address.
  const mapped =
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const compatible = words.slice(0, 6).every((word) => word === 0);
  if (mapped || compatible) return true;

  const first = words[0]!;
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique-local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xffc0) === 0xfec0 || // deprecated site-local
    (first & 0xff00) === 0xff00 // multicast and reserved
  );
}

function isUnusableHost(host: string): boolean {
  const lowered = normalizePolicyHost(host);
  const bracketless = stripHostBrackets(lowered);
  return (
    lowered === "localhost" ||
    lowered.endsWith(".localhost") ||
    lowered.endsWith(".local") ||
    isRestrictedIpv6(bracketless) ||
    isRestrictedIpv4(bracketless)
  );
}

function isPlausiblePublicHost(host: string): boolean {
  const bracketless = stripHostBrackets(host);
  if (bracketless.includes(":")) {
    return parseIpv6(bracketless) !== undefined;
  }
  if (parseIpv4(bracketless)) return true;
  if (!bracketless.includes(".") || bracketless.length > 253) return false;
  return bracketless
    .split(".")
    .every((label) => label.length > 0 && label.length <= 63 && DNS_LABEL_RE.test(label));
}

function stripTracking(parsed: URL): void {
  for (const key of [...parsed.searchParams.keys()]) {
    if (isTrackingQueryKey(key)) {
      parsed.searchParams.delete(key);
    }
  }
}

/**
 * Treat a host/path entered without a scheme as an HTTPS URL. Keep explicit
 * schemes intact so `http:`, `javascript:`, and `data:` retain their normal
 * rejection paths. A host followed by a numeric port is the one URI shape
 * that can look like a scheme to the WHATWG parser.
 */
function authorityPrefix(value: string): string {
  const scheme = SCHEME_RE.exec(value);
  let candidate = scheme ? value.slice(scheme[0].length) : value;
  if (candidate.startsWith("//")) candidate = candidate.slice(2);
  const boundary = candidate.search(/[\/?#]/);
  return boundary < 0 ? candidate : candidate.slice(0, boundary);
}

function hasEncodedAuthority(value: string): boolean {
  return authorityPrefix(value).includes("%");
}

function isPlausibleBareHost(host: string): boolean {
  const normalized = normalizePolicyHost(host);
  if (normalized === "localhost") return true;
  if (parseIpv4(normalized)) return true;
  return normalized.includes(".") && normalized
    .split(".")
    .every((label) => label.length > 0 && label.length <= 63 && DNS_LABEL_RE.test(label));
}

function urlWithHttpsDefault(trimmed: string): string {
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  const scheme = SCHEME_RE.exec(trimmed);
  if (!scheme) {
    return `https://${trimmed}`;
  }

  const schemeName = scheme[1]?.toLowerCase() ?? "";
  if (schemeName === "javascript" || schemeName === "data") {
    return trimmed;
  }
  const remainder = trimmed.slice(scheme[0].length);
  const isBareHostWithPort =
    isPlausibleBareHost(schemeName) &&
    /^\d+(?:[/?#]|$)/.test(remainder);
  return isBareHostWithPort ? `https://${trimmed}` : trimmed;
}

/**
 * Default bare host/path input to HTTPS, drop fragment, strip tracking keys,
 * reject chat / NSFW / shorteners / credentials / localhost. Store and click
 * this URL only.
 */
export function canonicalizeBriefUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < 1) {
    throw new UrlError("url_insecure");
  }
  if (
    URL_CONTROL_RE.test(raw) ||
    trimmed.includes("\\") ||
    ENCODED_BACKSLASH_RE.test(trimmed)
  ) {
    throw new UrlError("url_forbidden");
  }
  if (
    trimmed.startsWith("/") &&
    (!trimmed.startsWith("//") || trimmed.startsWith("///"))
  ) {
    throw new UrlError("url_insecure");
  }
  if (
    trimmed.startsWith("//") &&
    (trimmed.length <= 2 || trimmed[2] === "/" || trimmed[2] === "\\")
  ) {
    throw new UrlError("url_insecure");
  }
  if (hasEncodedAuthority(trimmed)) {
    throw new UrlError("url_forbidden");
  }

  let parsed: URL;
  try {
    parsed = new URL(urlWithHttpsDefault(trimmed));
  } catch {
    throw new UrlError("url_insecure");
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === "javascript:" || protocol === "data:") {
    throw new UrlError("url_forbidden");
  }
  if (protocol !== "https:") {
    throw new UrlError("url_insecure");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new UrlError("url_forbidden");
  }

  const host = hostnameOf(parsed);
  if (!host || isUnusableHost(host) || !isPlausiblePublicHost(host)) {
    throw new UrlError("url_forbidden");
  }
  if (isShortenerHost(host)) {
    throw new UrlError("url_forbidden");
  }
  if (isChatUrl(parsed) || isNsfwHost(host) || isNsfwPath(parsed.pathname)) {
    throw new UrlError("url_forbidden");
  }

  parsed.hash = "";
  parsed.hostname = host;
  if (parsed.port === "443") {
    parsed.port = "";
  }
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  stripTracking(parsed);
  return parsed.toString();
}
