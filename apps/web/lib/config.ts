/**
 * Build-time configuration.
 *
 * `NEXT_PUBLIC_*` values are inlined into the bundle at build time, so these
 * are constants rather than runtime lookups — which is what we want: the app
 * should never be able to discover a worker endpoint at runtime that the
 * deployment did not explicitly configure.
 */

/**
 * The worker's public read API. `null` means no worker is connected.
 *
 * When this is null the app renders its honest empty state. It does NOT
 * substitute placeholder data — inventing numbers to fill a screen is the
 * exact behaviour this product exists to be the opposite of.
 */
export const OBSERVED_API_URL: string | null =
  process.env.NEXT_PUBLIC_OBSERVED_API_URL?.trim() || null;

export const IS_CONNECTED: boolean = OBSERVED_API_URL !== null;

/** AskBots' live limits are unresolved (build spec Section 8). Change here, once. */
export const ASKBOTS_DAILY_LIMIT_UNRESOLVED = true;
