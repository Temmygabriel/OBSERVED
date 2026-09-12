/**
 * Payment Worker / PaymentGate — Rules 8 and 9.
 *
 * This is the ONLY component in the codebase allowed to invoke `buy`. One
 * concurrency slot, an attribution tag on every mainnet transaction, and a
 * deterministic policy check between the quote and the call.
 *
 * The gate is a fixed sequence, and the ordering is the whole design:
 *
 *   LLM intent → structured evidence request → allowlisted provider resolver
 *     → quote → authorizeSpend (Rule 9) → buy → receipt → PaymentRecord
 *
 * Two properties that fall out of doing it in this order and nowhere else:
 *
 *   - Nothing is bought because a model asked for it. The model produces an
 *     intent; the resolver turns that into an allowlisted provider; the policy
 *     engine decides. A model that hallucinates a provider hostname gets a
 *     refusal from the allowlist, not a transaction.
 *
 *   - The quote is obtained BEFORE the policy check and the policy check
 *     happens BEFORE the buy. Checking the cap after the call would be
 *     bookkeeping, not a cap.
 */

import type { PaymentRecord } from '@observed/shared-types';
import { isRetryable } from '@observed/shared-types';

/**
 * The providers Observed is willing to pay. A hostname not on this list is
 * refused outright — the allowlist is not advisory, and it is the reason a
 * prompt-injected "fetch this URL for $50" cannot become a transaction.
 */
export interface AllowedProvider {
  hostname: string;
  /** The path template that may be requested. */
  paths: readonly string[];
  /** Flat price, or a per-path table once a provider charges differently. */
  price: string;
  asset: string;
}

export const ALLOWED_PROVIDERS: readonly AllowedProvider[] = [];

export interface Quote {
  provider_hostname: string;
  path: string;
  amount: string;
  asset: string;
  provider_request_id: string | null;
  quoted_at: string;
}

export type PaymentOutcome =
  | { kind: 'settled'; record: PaymentRecord }
  | { kind: 'refused'; reason: string; rule: 'spend_cap' | 'payments_disabled' | 'provider_not_allowlisted' }
  /**
   * The outcome we do not know. Rule 9's second half lives here: an ambiguous
   * result is recorded, counted against the budget, and NEVER retried.
   */
  | { kind: 'ambiguous_no_retry'; record: PaymentRecord; reason: string };

/**
 * Resolve a model-proposed provider into an allowlisted one.
 *
 * Returns null rather than throwing, because "the model proposed a provider we
 * do not pay" is an expected outcome that the caller must handle, not an
 * exceptional one it may forget to.
 */
export function resolveProvider(hostname: string, path: string): AllowedProvider | null {
  const provider = ALLOWED_PROVIDERS.find(
    (candidate) => candidate.hostname === hostname,
  );
  if (!provider) return null;
  if (!provider.paths.includes(path)) return null;
  return provider;
}

/**
 * Rule 8 — the attribution tag, injected here and nowhere else.
 *
 * There is deliberately no "add the tag later" path. A transaction that settles
 * without the tag cannot be retroactively tagged, because the money has already
 * moved — so if the tag is missing, the correct behaviour is to NOT SPEND rather
 * than to spend and hope.
 */
export function attributionTagOrRefuse(
  tag: string | null,
): { ok: true; tag: string } | { ok: false; reason: string } {
  if (tag === null || tag.trim() === '') {
    return {
      ok: false,
      reason:
        'ATTRIBUTION_TAG is not configured. Rule 8 requires it on every mainnet transaction and it cannot be backfilled, so no transaction is made.',
    };
  }
  return { ok: true, tag: tag.trim() };
}

/**
 * Whether an outcome may be retried.
 *
 * Delegates to `isRetryable` from shared-types so there is exactly one place
 * that decides this. The important case: `ambiguous_no_retry` returns false.
 * A timeout does not tell us the payment failed — it tells us we do not know,
 * and retrying on "I do not know" is how one purchase becomes two.
 */
export function mayRetry(status: PaymentRecord['status']): boolean {
  return isRetryable(status);
}

/**
 * NOT IMPLEMENTED YET.
 *
 * What remains: the actual `buy` invocation, through the MCP server, with the
 * wallet key read at call time from the secret store (Rule 11) and never
 * logged. Everything that decides WHETHER to call it — the allowlist, the
 * policy check, the attribution requirement, the no-retry rule — is above and
 * is real.
 */
export async function executePayment(_input: {
  review_session_id: string;
  provider: AllowedProvider;
  path: string;
  quote: Quote;
  attribution_tag: string;
}): Promise<PaymentOutcome> {
  throw new Error(
    'payment-gate.executePayment is not implemented yet — needs the buy MCP invocation and receipt handling',
  );
}
