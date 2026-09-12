/**
 * Policy contracts — Rules 5, 9 and 12.
 *
 * Rule 5:  conflict-of-interest exclusion runs BEFORE anything is spent.
 * Rule 9:  hard spend caps, fail closed.
 * Rule 12: the watchdog alerts on BUSINESS inactivity, not process liveness.
 */

/** Everything about a project that can collide with the operator's own identity. */
export type ExclusionType =
  | 'domain'
  | 'github_owner'
  | 'telegram_handle'
  | 'wallet_address'
  | 'erc8004_agent_id';

export const EXCLUSION_TYPES: readonly ExclusionType[] = [
  'domain',
  'github_owner',
  'telegram_handle',
  'wallet_address',
  'erc8004_agent_id',
];

export interface ExclusionListEntry {
  type: ExclusionType;
  value: string;
  reason: string;
}

/** Cross-cutting health of the whole system. */
export type WatchdogState = 'HEALTHY' | 'DEGRADED' | 'BLOCKED' | 'RECOVERING';

/** Why paid calls are currently not being made. `null` means they are. */
export type PauseReason =
  | 'daily_cap_reached'
  | 'hourly_cap_reached'
  | 'payments_disabled';

export interface SpendState {
  /** All monetary values are decimal strings. Never floats. */
  hourly_spent: string;
  hourly_cap: string;
  daily_spent: string;
  daily_cap: string;
  per_review_cap: string;
  /** Reviews attempted since 00:00 UTC. Shown on the Paused screen. */
  reviews_today: number;
  /** True when paid calls are halted — as designed, not as an error. */
  paused: boolean;
  paused_reason: PauseReason | null;
  /** ISO 8601 UTC. The next 00:00 UTC boundary, when caps reset. */
  resumes_at: string | null;
}

/**
 * Caps from the build spec, Section 3 Rule 9. These are defaults only — the
 * live values come from the environment, and the environment is the source of
 * truth. Nothing in the codebase may raise a cap on its own.
 */
export const DEFAULT_SPEND_CAPS = {
  hourly: '0.25',
  daily: '1.00',
  perReview: '0.03',
  perProviderRequest: '0.01',
  maxPaidCallsPerProviderPerReview: 3,
  /** Rule 9: exactly one paid call in flight at a time. */
  maxConcurrentPaidCalls: 1,
} as const;

/** Rule 9: alert at 50% of the daily cap. */
export const DAILY_CAP_ALERT_THRESHOLD = 0.5;

/** Rule 12. */
export const DEFAULT_INACTIVITY_ALERT_MINUTES = 60;

/**
 * Rule 12 requires this literal wording. Not "process is up" — the alert has
 * to name the business-level failure, because that is the silent-failure
 * pattern that actually bites.
 */
export function inactivityAlertMessage(minutes: number): string {
  return `reviewer inactive for ${minutes} minutes`;
}
