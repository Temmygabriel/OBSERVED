/**
 * A redirect-following HTTP client that connects to a PINNED address.
 *
 * Rule 4 lives in `ssrf-guard.ts`, but a guard is only ever as good as the
 * fetcher that calls it. This is the fetcher, and it is written so that the two
 * ways a guard normally gets bypassed are structurally impossible rather than
 * merely discouraged:
 *
 *   1. IT FOLLOWS REDIRECTS ITSELF, calling `assertRedirectHop` on every hop, so
 *      there is no code path where a `Location` header is followed unchecked.
 *      A client option like `redirect: 'follow'` cannot be used here, because
 *      the client resolves the next hop internally where the guard cannot see
 *      it — the check would silently cover only the first URL.
 *
 *   2. IT CONNECTS TO THE IP THAT WAS VALIDATED, not to the hostname. Node
 *      skips DNS entirely when `host` is an IP literal, so there is no second
 *      resolution between the check and the connect — which is precisely the
 *      DNS-rebinding window. TLS SNI and certificate verification still use the
 *      real hostname, so pinning costs nothing in correctness.
 *
 * Everything here is bounded: one wall-clock deadline shared across ALL hops, a
 * body size cap, and a hop limit. An unbounded read from a hostile host is a
 * memory exhaustion primitive, not a page fetch.
 *
 * Why no `undici`/`fetch`: `fetch` offers no way to pin the connect address, so
 * using it would mean validating one address and connecting to another. That is
 * the bug this file exists to not have.
 */

import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import {
  MAX_REDIRECT_HOPS,
  assertPublicTarget,
  assertRedirectHop,
  pinResolvedAddress,
  type Resolver,
  type ValidatedTarget,
} from './ssrf-guard';

/** Identifies us honestly. A reviewer that lies about who it is is not a reviewer. */
export const USER_AGENT =
  'ObservedBot/0.1 (+https://github.com/Temmygabriel/OBSERVED)';

/** 512 KiB. Past this it is not a page anyone is going to read. */
export const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

export class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

export class TooManyRedirectsError extends Error {
  readonly hops: number;

  constructor(hops: number) {
    super(`more than ${hops} redirects — refusing to follow further`);
    this.name = 'TooManyRedirectsError';
    this.hops = hops;
  }
}

export interface PinnedResponse {
  /** The URL actually fetched, after redirects. */
  final_url: string;
  /** Rule 4 evidence: the exact address the socket connected to. */
  resolved_ip: string;
  status_code: number;
  headers: IncomingMessage['headers'];
  body: Uint8Array;
  body_truncated: boolean;
  /** Absolute URL of each hop followed, in order. Empty when there were none. */
  redirect_chain: string[];
  elapsed_ms: number;
}

export interface FetchOptions {
  /** Shared deadline for the whole chain, not per hop. */
  timeoutMs: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
}

interface SingleHop {
  status_code: number;
  headers: IncomingMessage['headers'];
  body: Uint8Array;
  body_truncated: boolean;
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/**
 * One request to one already-validated target. Does not follow anything.
 *
 * Kept separate from the redirect loop so that "make a request" and "decide
 * whether to make another one" are different functions — the second is where
 * Rule 4 is enforced, and it should be impossible to reach the first without
 * having gone through it.
 */
function requestOnce(
  target: ValidatedTarget,
  timeoutMs: number,
  maxBodyBytes: number,
): Promise<SingleHop> {
  return new Promise<SingleHop>((resolve, reject) => {
    const { url } = target;
    const isHttps = url.protocol === 'https:';
    const port = url.port === '' ? (isHttps ? 443 : 80) : Number(url.port);

    // The address that was CHECKED, which is also the address we connect to.
    const address = pinResolvedAddress(target);

    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      settle();
    };

    const options: RequestOptions = {
      // An IP literal, so Node performs no name resolution here at all.
      host: address,
      port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        // We connect by address but speak by name, so virtual hosts work.
        Host: url.host,
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en',
        // No connection reuse: a pooled socket outlives the validation that
        // justified it.
        Connection: 'close',
      },
      // TLS verifies the certificate against the real hostname, never the IP.
      ...(isHttps ? { servername: url.hostname } : {}),
    };

    const onResponse = (response: IncomingMessage): void => {
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;

      const settle = (): void =>
        finish(() =>
          resolve({
            status_code: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
            body_truncated: truncated,
          }),
        );

      response.on('data', (chunk: Buffer) => {
        if (truncated) return;

        const remaining = maxBodyBytes - size;
        if (chunk.length >= remaining) {
          if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
          size = maxBodyBytes;
          truncated = true;
          // Stop reading AND release the socket. The host does not get to
          // decide how much memory we spend on it.
          response.destroy();
          settle();
          return;
        }

        chunks.push(chunk);
        size += chunk.length;
      });

      response.on('end', settle);
      response.on('error', (error: Error) =>
        finish(() =>
          reject(new Error(`response stream failed: ${error.message}`)),
        ),
      );
    };

    // An if/else rather than `(isHttps ? httpsRequest : httpRequest)(…)`:
    // calling a union of two overloaded functions is a type error, and every
    // workaround for it obscures which module is doing the TLS.
    const request = isHttps
      ? httpsRequest(options, onResponse)
      : httpRequest(options, onResponse);

    timer = setTimeout(() => {
      finish(() =>
        reject(
          new RequestTimeoutError(
            `no response from ${url.host} within ${timeoutMs}ms`,
          ),
        ),
      );
      request.destroy();
    }, timeoutMs);

    request.on('error', (error: Error) => finish(() => reject(error)));
  });
}

/**
 * Fetch a URL, following redirects, re-validating Rule 4 on every hop.
 *
 * Throws `BlockedTargetError` (including `ResolutionFailedError`) rather than
 * returning an artifact: whether a refusal is a finding about the target or a
 * gap in our own network is a Rule 3 decision, and it belongs to the collector
 * that knows what it was trying to observe — not here.
 */
export async function fetchPinned(
  rawUrl: string,
  resolve: Resolver,
  options: FetchOptions,
): Promise<PinnedResponse> {
  const startedAt = Date.now();
  const deadline = startedAt + options.timeoutMs;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECT_HOPS;

  // Rule 4, hop zero: validate AND resolve before any socket is opened.
  let target = await assertPublicTarget(rawUrl, resolve);
  const redirectChain: string[] = [];

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new RequestTimeoutError(
        `gave up after ${options.timeoutMs}ms across ${redirectChain.length} redirect(s)`,
      );
    }

    const hop = await requestOnce(target, remaining, maxBodyBytes);
    const location = firstHeaderValue(hop.headers['location']);

    const isRedirect =
      hop.status_code >= 300 && hop.status_code < 400 && location !== null;

    if (!isRedirect) {
      return {
        final_url: target.url.toString(),
        resolved_ip: pinResolvedAddress(target),
        status_code: hop.status_code,
        headers: hop.headers,
        body: hop.body,
        body_truncated: hop.body_truncated,
        redirect_chain: redirectChain,
        elapsed_ms: Date.now() - startedAt,
      };
    }

    if (redirectChain.length >= maxRedirects) {
      throw new TooManyRedirectsError(maxRedirects);
    }

    // Rule 4's actual teeth. This line is the one a bypass would have to remove,
    // and it runs on the hop rather than on the input — which is the whole
    // difference between this and a guard that only looks convincing.
    target = await assertRedirectHop(location, target.url, resolve);
    redirectChain.push(target.url.toString());
  }
}
