/**
 * HTML collector — the "Live page" check. NOT IMPLEMENTED YET.
 *
 * This is the collector the whole demo leans on, so it is the next one to
 * write. What it must do, precisely, because the details are where this gets
 * quietly wrong:
 *
 *   1. `assertPublicTarget(target_url, context.resolve)` before the first
 *      request — and `assertRedirectHop` on EVERY hop, up to
 *      `MAX_REDIRECT_HOPS`. A guard that only checks the input URL is bypassed
 *      by a one-line 302 to 169.254.169.254.
 *   2. Connect to `pinResolvedAddress(target)` with the original Host header
 *      and TLS servername, so the address that was validated is the address
 *      connected to. Re-resolving at connect time reopens the rebinding window.
 *   3. Cap the body size and the total time. An unbounded read from a hostile
 *      host is a memory exhaustion primitive.
 *   4. Record `request_path`, `method`, `status_code`, `content_type` and the
 *      response time in `metadata`, and store the body's sha256 as
 *      `content_hash` with the raw dump behind `raw_ref`.
 *   5. The link sweep (broken links) is a separate pass over the parsed body.
 *      It reports per-link results; it does NOT fold them into one status, and
 *      a link that could not be reached stays `unknown_*`.
 *
 * The status mapping is the part Rule 3 governs: a 4xx/5xx from the server is
 * `invalid` (we observed the server's answer). A timeout or a TLS handshake
 * failure is `unknown_*` (we observed nothing about the server).
 */

import { CollectorNotImplementedError, type Collector, type CollectorContext } from './types';

const VERSION = '0.1.0';

export const htmlCollector: Collector = {
  kind: 'html',
  version: VERSION,
  requires_paid_fetch: false,

  async collect(_context: CollectorContext) {
    throw new CollectorNotImplementedError(
      'html',
      'needs the redirect-following fetcher built on assertPublicTarget/assertRedirectHop',
    );
  },
};
