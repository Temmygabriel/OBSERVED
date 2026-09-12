/**
 * TLS collector — NOT IMPLEMENTED YET.
 *
 * Deliberately the simplest of the stubs to finish, because `node:tls` does the
 * work and there is no redirect surface to get wrong. What it must record, all
 * of which is safe to show to the Review Generator:
 *
 *   - the certificate's subject and issuer,
 *   - `not_after`, and whether the certificate is currently inside its validity
 *     window (an expired certificate is `invalid`, not a network failure),
 *   - the sha256 fingerprint, which is what makes the observation checkable by
 *     a third party rather than merely asserted,
 *   - the negotiated protocol version and cipher.
 *
 * The status mapping Rule 3 governs: an expired or mismatched certificate is
 * `invalid` — the server answered, and the answer was bad. A connection that
 * times out, or a host that refuses the handshake outright, is `unknown_*` —
 * we did not get far enough to observe anything about the certificate.
 *
 * Misconfiguration to avoid: `rejectUnauthorized: false` must NOT be used to
 * "get the handshake to complete". That flag exists to make broken things look
 * fine, which is the opposite of this product's purpose. If the handshake
 * fails, that failure IS the observation.
 */

import { CollectorNotImplementedError, type Collector, type CollectorContext } from './types';

const VERSION = '0.1.0';

export const tlsCollector: Collector = {
  kind: 'tls',
  version: VERSION,
  requires_paid_fetch: false,

  async collect(_context: CollectorContext) {
    throw new CollectorNotImplementedError(
      'tls',
      'needs a node:tls probe that records subject/issuer/not_after/fingerprint and never sets rejectUnauthorized:false',
    );
  },
};
