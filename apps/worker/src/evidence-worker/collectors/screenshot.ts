/**
 * Screenshot collector — NOT IMPLEMENTED YET.
 *
 * This is the collector that runs against a `buy`-purchased endpoint, so it is
 * the one place the Evidence Worker's "no wallet" boundary is visible in code.
 * Note what it takes: an already-purchased `PaidFetchResult` on the context.
 * It has no way to cause a payment, which is the point.
 *
 * The orchestration order it depends on, which is NOT this file's job but is
 * worth stating where someone will read it:
 *
 *   1. Review Generator (or the orchestrator) declares it wants a screenshot.
 *   2. Payment Worker quotes it, runs `authorizeSpend` (Rule 9), calls `buy`,
 *      injects the attribution tag (Rule 8), and records the receipt.
 *   3. ONLY THEN does this collector run, with the resulting bytes.
 *
 * So a screenshot that was never paid for cannot exist, and a screenshot that
 * was paid for but failed is recorded as a paid call that produced nothing —
 * which belongs in the spend ledger, not hidden here.
 *
 * What it records: the sha256 of the image bytes, the byte length, the content
 * type, the provider hostname and request id (so the receipt is traceable), and
 * the elapsed time. The image itself is stored behind `raw_ref` and never
 * reaches the Review Generator — it can cite the screenshot, not read it.
 */

import { CollectorNotImplementedError, MissingPaidFetchError, type Collector, type CollectorContext } from './types';

const VERSION = '0.1.0';

export const screenshotCollector: Collector = {
  kind: 'screenshot',
  version: VERSION,
  requires_paid_fetch: true,

  async collect(context: CollectorContext) {
    // This check is real and stays: it is the guard that catches an
    // orchestrator wiring mistake before it turns into an unpriced paid call.
    if (!context.paid_fetch) {
      throw new MissingPaidFetchError('screenshot');
    }

    throw new CollectorNotImplementedError(
      'screenshot',
      'paid_fetch is present and validated; what remains is hashing the image bytes, storing them behind raw_ref, and mapping a non-2xx provider response',
    );
  },
};
