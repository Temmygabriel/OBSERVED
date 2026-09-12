/**
 * The HTTP contract between apps/worker and apps/web.
 *
 * Both sides import these, so a change to a field name is a compile error on
 * the other side rather than a silently-undefined value in production.
 */

import type { RecordProvenance, ReviewBundle, ReviewStatus } from './review';
import type { SpendState, WatchdogState } from './policy';

/**
 * Headline totals for the History screen.
 *
 * `useful_rating` is `number | null` on purpose. `null` means "we genuinely do
 * not know yet" and the UI must render that honestly. It never means "show a
 * placeholder number" — the design spec forbids hardcoded example counts once
 * real data exists, and this type makes a fake number impossible to type in.
 */
export interface ReviewTotals {
  reviews: number;
  accepted: number;
  rewritten: number;
  held: number;
  useful_rating: number | null;
}

/** One row on the History screen. */
export interface ReviewSummary {
  review_id: string;
  project_name: string | null;
  target_url: string;
  status: ReviewStatus;
  /** The single most important observed fact, e.g. "/signup -> 404". */
  headline: string | null;
  observed_at: string;
}

export interface ReviewsIndexResponse {
  provenance: RecordProvenance;
  totals: ReviewTotals;
  reviews: ReviewSummary[];
  spend: SpendState;
}

// ---------------------------------------------------------------------------
// /status — the public mirror of the Watchdog
// ---------------------------------------------------------------------------

export type ProbeState = 'ok' | 'degraded' | 'down' | 'unknown';

export interface StatusProbe {
  name: string;
  state: ProbeState;
  detail: string | null;
  checked_at: string;
}

export interface PublicStatusResponse {
  watchdog_state: WatchdogState;
  payments_enabled: boolean;
  last_successful_review_at: string | null;
  /** How long since the last successful review attempt. The Rule 12 metric. */
  minutes_since_last_review: number | null;
  inactivity_alert_minutes: number;
  degraded_reason: string | null;
  spend: SpendState;
  probes: StatusProbe[];
}

export type { ReviewBundle };
