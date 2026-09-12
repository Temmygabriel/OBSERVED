import type {
  PublicStatusResponse,
  ReviewBundle,
  ReviewSummary,
  ReviewsIndexResponse,
} from '@observed/shared-types';
import { IS_CONNECTED, OBSERVED_API_URL } from './config';
import {
  SAMPLE_BUNDLES,
  SAMPLE_INDEX_TOTALS,
  SAMPLE_REVIEWS,
  disconnectedStatus,
} from './sample';

/**
 * The one place the app decides what to show.
 *
 * The design principle here: "the worker is down" and "the worker is up and
 * has nothing to report" are DIFFERENT ANSWERS and must never collapse into
 * the same screen. Collapsing them is how a dashboard ends up cheerfully
 * showing zeroes while the thing behind it is on fire — the exact silent
 * failure mode the build spec's Rule 12 exists to catch.
 *
 * So every fetch returns a `Loaded<T>`, and `unavailable` carries a reason the
 * UI is required to display.
 */

export type Loaded<T> =
  | { status: 'ok'; data: T }
  | { status: 'unavailable'; reason: string };

const REVALIDATE_SECONDS = 30;

async function getJson<T>(path: string): Promise<Loaded<T>> {
  if (!OBSERVED_API_URL) {
    return {
      status: 'unavailable',
      reason:
        'No worker is connected. NEXT_PUBLIC_OBSERVED_API_URL is not set for this deployment.',
    };
  }

  try {
    const response = await fetch(`${OBSERVED_API_URL}${path}`, {
      headers: { accept: 'application/json' },
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (!response.ok) {
      return {
        status: 'unavailable',
        reason: `The worker answered ${response.status} for ${path}.`,
      };
    }

    return { status: 'ok', data: (await response.json()) as T };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: `Could not reach the worker for ${path}: ${
        error instanceof Error ? error.message : 'unknown network error'
      }`,
    };
  }
}

// ---------------------------------------------------------------------------
// Real data
// ---------------------------------------------------------------------------

export function isConnected(): boolean {
  return IS_CONNECTED;
}

export async function getReviewsIndex(): Promise<Loaded<ReviewsIndexResponse>> {
  return getJson<ReviewsIndexResponse>('/reviews');
}

export async function getReviewBundle(
  reviewId: string,
): Promise<Loaded<ReviewBundle>> {
  return getJson<ReviewBundle>(`/reviews/${encodeURIComponent(reviewId)}`);
}

export async function getPublicStatus(): Promise<PublicStatusResponse> {
  if (!IS_CONNECTED) return disconnectedStatus(new Date());

  const loaded = await getJson<PublicStatusResponse>('/status');
  if (loaded.status === 'unavailable') {
    const base = disconnectedStatus(new Date());
    return {
      ...base,
      watchdog_state: 'BLOCKED',
      degraded_reason: loaded.reason,
    };
  }
  return loaded.data;
}

// ---------------------------------------------------------------------------
// Sample data — reachable only by explicit request, always labelled
// ---------------------------------------------------------------------------

/**
 * Sample bundles are never merged into the real index and never fall back into
 * place of a failed fetch. Reaching one requires asking for it by name, and
 * every sample bundle carries a `provenance_label` that the UI renders.
 */
export function getSampleBundle(reviewId: string): ReviewBundle | null {
  return SAMPLE_BUNDLES[reviewId] ?? null;
}

export function isSampleReviewId(reviewId: string): boolean {
  return Object.prototype.hasOwnProperty.call(SAMPLE_BUNDLES, reviewId);
}

/** The sample index, used by /history?view=sample for previewing the layout. */
export function getSampleIndex(): ReviewsIndexResponse {
  return {
    provenance: 'sample',
    totals: SAMPLE_INDEX_TOTALS,
    reviews: SAMPLE_REVIEWS,
    spend: SAMPLE_BUNDLES['sample']?.spend ?? {
      hourly_spent: '0.00',
      hourly_cap: '0.25',
      daily_spent: '0.00',
      daily_cap: '1.00',
      per_review_cap: '0.03',
      reviews_today: 0,
      paused: false,
      paused_reason: null,
      resumes_at: null,
    },
  };
}

/** Reviews that can be linked to from the History rows. */
export function sampleReviewExists(reviewId: string): boolean {
  return isSampleReviewId(reviewId);
}

export type { ReviewSummary };
