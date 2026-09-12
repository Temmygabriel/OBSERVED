/**
 * Payment contracts — Rules 8 and 9.
 *
 * Rule 8: the ERC-8021 attribution tag must be embedded in calldata from the
 *         very FIRST mainnet transaction. There is no backfill.
 * Rule 9: hard spend caps, fail closed. Zero automatic retries after an
 *         ambiguous outcome — a `500` may mean the payment already succeeded,
 *         and retrying can double-pay.
 */

/** Assets `buy` can settle in. Kept as a union so a typo can't reach a wire format. */
export type PaymentAsset = 'USDC' | 'USDT' | 'USAT';

export type PaymentStatus =
  | 'quoted'
  | 'settled'
  | 'failed'
  /**
   * The call returned something we could not classify — most importantly a
   * 5xx, which per buy-skill's own README may mean the payment ALREADY
   * SUCCEEDED. This state exists so that "I don't know" is representable and
   * therefore cannot be quietly retried into a double-payment.
   */
  | 'ambiguous_no_retry';

/** Statuses that must never be automatically retried. */
export function isRetryable(status: PaymentStatus): boolean {
  switch (status) {
    case 'failed':
      // A clean, deterministic failure — safe to try again later.
      return true;
    case 'quoted':
    case 'settled':
    case 'ambiguous_no_retry':
      return false;
  }
}

export interface PaymentRecord {
  payment_id: string;
  review_session_id: string;
  provider_hostname: string;
  provider_path: string;
  /**
   * Decimal string, not a float. Money is never a JS number here — a float
   * rounding error in a spend ledger is how a cap gets silently exceeded.
   */
  amount: string;
  asset: PaymentAsset;
  /** Must be present on every mainnet transaction. Empty string means "not yet wired". */
  attribution_tag: string;
  tx_hash: string | null;
  status: PaymentStatus;
  observed_at: string;
}
