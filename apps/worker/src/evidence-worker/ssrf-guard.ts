/**
 * Rule 4 — SSRF guard.
 *
 * Observed fetches URLs that strangers hand it. Without a guard, the first
 * thing a hostile submission does is point the reviewer at
 * `http://169.254.169.254/latest/meta-data/` and read the worker's cloud
 * credentials out of the review it writes back.
 *
 * Three properties this module is built around, in order of how easy they are
 * to get wrong:
 *
 *   1. EVERY redirect hop is re-validated, not just the first URL. A public
 *      hostname that 302s to `http://10.0.0.5/` is the standard bypass, and a
 *      guard that only checks the input catches none of it.
 *
 *   2. Validation happens on the RESOLVED ADDRESS, not on the hostname text.
 *      A hostname is a claim; an IP is the thing the socket actually connects
 *      to. `assertHostIsPublic` resolves first and checks every answer, because
 *      DNS can return several and only one of them has to be private.
 *
 *   3. The address that was CHECKED is the address that must be CONNECTED TO.
 *      Resolving, then letting the HTTP client resolve again, reopens the
 *      rebinding window. `pinResolvedAddress` returns the validated IP so the
 *      caller can connect to it directly with the original Host header.
 *
 * This module is pure with respect to the network: name resolution is injected,
 * so every branch below is reachable in a test without a DNS server.
 */

import { isIP } from 'node:net';

export class BlockedTargetError extends Error {
  /** Rule 4 refuses; it does not warn and continue. */
  readonly rule = 'ssrf_guard' as const;

  constructor(message: string) {
    super(message);
    this.name = 'BlockedTargetError';
  }
}

export type Resolver = (hostname: string) => Promise<string[]>;

/** Only these two schemes are ever fetched. No file:, no gopher:, no data:. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Ports the fetcher may reach. Anything else is a service probe, not a page. */
const ALLOWED_PORTS = new Set([80, 443]);

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inV4Range(value: number, cidr: string): boolean {
  const [base = '', bitsRaw = '32'] = cidr.split('/');
  const baseValue = ipv4ToInt(base);
  if (baseValue === null) return false;

  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) >>> 0 === (baseValue & mask) >>> 0;
}

/**
 * Every IPv4 range that must never be reachable. This is deliberately wider
 * than "RFC1918" — the ranges that actually get exploited in SSRF are the
 * cloud metadata endpoint and the carrier-grade NAT space, neither of which is
 * private in the 10/8 sense.
 */
const BLOCKED_V4: readonly string[] = [
  '0.0.0.0/8', // "this network"
  '10.0.0.0/8', // RFC1918
  '100.64.0.0/10', // CGNAT — used by some cloud metadata shims
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local — 169.254.169.254 is the cloud metadata API
  '172.16.0.0/12', // RFC1918
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // TEST-NET-1
  '192.88.99.0/24', // 6to4 relay anycast
  '192.168.0.0/16', // RFC1918
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // TEST-NET-2
  '203.0.113.0/24', // TEST-NET-3
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved, includes 255.255.255.255
];

export function isPublicIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return false;
  return !BLOCKED_V4.some((cidr) => inV4Range(value, cidr));
}

/**
 * IPv6 is checked as text rather than expanded to 128 bits, because every
 * dangerous range here has an unambiguous textual prefix. The one case that
 * needs handling beyond prefixes is IPv4-mapped (`::ffff:10.0.0.1`), which
 * would otherwise sail past every IPv6 rule and land on an IPv4 address.
 */
export function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? '';

  if (normalized === '::' || normalized === '::1') return false;

  // ::ffff:a.b.c.d and ::a.b.c.d — classify by the embedded IPv4 address.
  const mapped = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized);
  if (mapped?.[1]) return isPublicIpv4(mapped[1]);

  if (/^f[cd]/.test(normalized)) return false; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(normalized)) return false; // fe80::/10 link-local
  if (/^ff/.test(normalized)) return false; // ff00::/8 multicast
  if (/^2001:0?db8:/.test(normalized)) return false; // documentation
  if (/^2002:/.test(normalized)) return false; // 6to4, tunnels to IPv4

  // Anything not recognised as public is refused. Unknown is not a pass.
  return isIP(normalized) === 6;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

export interface ValidatedTarget {
  url: URL;
  hostname: string;
  /** The exact address that was checked. Connect to THIS, not to the name. */
  addresses: string[];
}

function assertAllowedShape(url: URL): void {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BlockedTargetError(
      `refusing to fetch ${url.protocol} — only http and https are allowed`,
    );
  }

  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
  if (!ALLOWED_PORTS.has(port)) {
    throw new BlockedTargetError(
      `refusing to fetch port ${port} — only 80 and 443 are allowed`,
    );
  }

  // Credentials in the URL are stripped by the URL parser into username/
  // password, where they become an exfiltration channel in a redirect chain.
  if (url.username !== '' || url.password !== '') {
    throw new BlockedTargetError('refusing to fetch a URL with embedded credentials');
  }

  // A bare IP literal skips DNS entirely, so it has to be classified here.
  if (isIP(url.hostname) !== 0 && !isPublicAddress(url.hostname)) {
    throw new BlockedTargetError(
      `refusing to fetch non-public address ${url.hostname}`,
    );
  }

  // A single-label hostname resolves through the search domain, which is how
  // an internal service gets reached by a name that looks harmless.
  const isBareHostname =
    url.hostname === '' ||
    (!url.hostname.includes('.') && isIP(url.hostname) === 0);

  if (isBareHostname) {
    throw new BlockedTargetError(
      `refusing to fetch single-label hostname ${JSON.stringify(url.hostname)}`,
    );
  }
}

/**
 * Validate one URL and resolve it. This is the function to call on the initial
 * target AND on every redirect hop — see `assertRedirectHop`.
 */
export async function assertPublicTarget(
  rawUrl: string,
  resolve: Resolver,
): Promise<ValidatedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedTargetError(`not a valid absolute URL: ${rawUrl}`);
  }

  assertAllowedShape(url);

  // An IP literal has nothing to resolve; it was already classified above.
  if (isIP(url.hostname) !== 0) {
    return { url, hostname: url.hostname, addresses: [url.hostname] };
  }

  let addresses: string[];
  try {
    addresses = await resolve(url.hostname);
  } catch (error) {
    throw new BlockedTargetError(
      `could not resolve ${url.hostname}: ${
        error instanceof Error ? error.message : 'unknown resolver error'
      }`,
    );
  }

  if (addresses.length === 0) {
    throw new BlockedTargetError(`${url.hostname} resolved to no addresses`);
  }

  // Fail if ANY answer is non-public. A host that returns one public and one
  // private address is a rebinding attempt, not a load-balanced service.
  const blocked = addresses.filter((address) => !isPublicAddress(address));
  if (blocked.length > 0) {
    throw new BlockedTargetError(
      `${url.hostname} resolves to non-public address ${blocked[0]} — refusing to fetch`,
    );
  }

  return { url, hostname: url.hostname, addresses };
}

/**
 * Rule 4's actual teeth: the same check, run again on the redirect target.
 *
 * A fetcher written as `validate(input); follow(url)` passes every review that
 * only reads the input validation. The bypass is one line of server config:
 * `302 Location: http://169.254.169.254/`. So the fetch loop must call this on
 * each hop and stop rather than following when it throws.
 */
export async function assertRedirectHop(
  location: string,
  from: URL,
  resolve: Resolver,
): Promise<ValidatedTarget> {
  let next: URL;
  try {
    next = new URL(location, from);
  } catch {
    throw new BlockedTargetError(`redirect to an unparseable location: ${location}`);
  }
  return assertPublicTarget(next.toString(), resolve);
}

/**
 * The address to connect to, for a caller that resolves names itself.
 *
 * Returning the first validated address (rather than the hostname) is what
 * closes the DNS-rebinding window: the HTTP client must be handed this IP with
 * the original Host header and TLS servername preserved.
 */
export function pinResolvedAddress(target: ValidatedTarget): string {
  const address = target.addresses[0];
  if (!address) throw new BlockedTargetError('no validated address to connect to');
  return address;
}

/** How many hops Observed will follow before giving up. */
export const MAX_REDIRECT_HOPS = 3;
