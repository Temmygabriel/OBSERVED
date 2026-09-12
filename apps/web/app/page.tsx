import { EmptyState } from '@/components/EmptyState';
import { ReviewList } from '@/components/ReviewList';
import { TargetForm } from '@/components/TargetForm';
import { getReviewsIndex } from '@/lib/data';

/**
 * Screen 1 — Landing.
 *
 * The recent-reviews line is real accumulated data, or nothing at all. There is
 * deliberately no third option: the design spec forbids placeholder counts, and
 * a "2 reviews" that is not true would poison the one thing this product sells.
 */
export default async function LandingPage() {
  const loaded = await getReviewsIndex();

  const reviews = loaded.status === 'ok' ? loaded.data.reviews : [];
  const unavailableReason =
    loaded.status === 'unavailable' ? loaded.reason : null;

  return (
    <div className="stack" style={{ gap: 'var(--s6)' }}>
      <header className="stack stack--tight">
        <h1 className="h1">It checks before it judges.</h1>
        <p className="lede" style={{ maxWidth: '60ch' }}>
          Observed spends a fraction of a cent to take a real screenshot, check
          a real TLS certificate and test real endpoints — then writes a review
          that cites exactly what it found, down to the timestamp.
        </p>
      </header>

      <TargetForm />

      {reviews.length > 0 ? (
        <section className="stack stack--tight">
          <h2 className="h2">Recently observed</h2>
          <ReviewList reviews={reviews} limit={5} />
        </section>
      ) : (
        <EmptyState />
      )}

      {/*
        Shown alongside the empty state rather than instead of it. "Nothing has
        been checked yet" and "we could not reach the worker" are different
        facts, and a reader is entitled to know which one they are looking at.
      */}
      {unavailableReason ? (
        <p className="meta" style={{ margin: 0 }}>
          {unavailableReason}
        </p>
      ) : null}
    </div>
  );
}
