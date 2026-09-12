import Link from 'next/link';
import type { ReviewSummary } from '@observed/shared-types';
import { reviewStatusToBadge } from '@observed/shared-types';
import { compactUrl } from '@/lib/format';
import { RelativeTime } from './RelativeTime';
import { StatusBadge } from './StatusBadge';

/**
 * The recent-reviews list. Shared by the Landing screen (a single line) and
 * the History screen (the full list), so the two can never drift apart.
 *
 * The headline is always a raw observed fact in mono, never a summary. If a
 * review has no headline — because nothing conclusive was observed — the row
 * says so rather than inventing one.
 */
export function ReviewList({
  reviews,
  limit,
}: {
  reviews: ReviewSummary[];
  limit?: number;
}) {
  const shown = typeof limit === 'number' ? reviews.slice(0, limit) : reviews;

  return (
    <div>
      {shown.map((review) => (
        <Link
          key={review.review_id}
          href={`/review/${encodeURIComponent(review.review_id)}`}
          className="history-row"
        >
          <span className="history-row__left">
            <span className="history-row__headline">
              {review.headline ?? 'no conclusive observation recorded'}
            </span>
            <br />
            <span className="history-row__sub">
              {review.project_name ?? compactUrl(review.target_url)}
            </span>
          </span>

          <span className="row">
            <StatusBadge state={reviewStatusToBadge(review.status)} />
            <RelativeTime iso={review.observed_at} className="mono muted" />
          </span>
        </Link>
      ))}
    </div>
  );
}
