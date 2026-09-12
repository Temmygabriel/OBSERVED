import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReviewsIndexResponse, ReviewTotals } from '@observed/shared-types';
import { EmptyState } from '@/components/EmptyState';
import { ProvenanceBanner } from '@/components/ProvenanceBanner';
import { ReviewList } from '@/components/ReviewList';
import { getReviewsIndex, getSampleIndex } from '@/lib/data';

export const metadata: Metadata = { title: 'History' };

type HistoryLookup =
  | { kind: 'ok'; index: ReviewsIndexResponse }
  | { kind: 'unavailable'; reason: string };

/**
 * Screen 3 — History.
 *
 * Two rules from the design spec drive this screen:
 *
 *   1. Never show a hardcoded example count once real data exists. So the
 *      numbers here are always the real totals, and when there are none the
 *      screen shows the empty state rather than zeroes dressed up as data.
 *   2. `useful_rating` is `number | null`. `null` renders as "not yet known",
 *      never as a placeholder number. The type makes a fake value impossible
 *      to type in, which is the point.
 */
async function lookupHistory(useSample: boolean): Promise<HistoryLookup> {
  if (useSample) return { kind: 'ok', index: getSampleIndex() };

  const loaded = await getReviewsIndex();
  if (loaded.status === 'ok') return { kind: 'ok', index: loaded.data };
  return { kind: 'unavailable', reason: loaded.reason };
}

function Totals({ totals }: { totals: ReviewTotals }) {
  const rating =
    totals.useful_rating === null
      ? 'not yet known'
      : `${totals.useful_rating}%`;

  // Not a <dl>: the number has to read above its label, and a definition list
  // requires the term first. Using plain elements keeps the visual order and
  // the markup order the same, which is what a screen reader announces.
  return (
    <div className="stats">
      <div>
        <div className="stat__num">{totals.reviews}</div>
        <div className="stat__label">reviews</div>
      </div>
      <div>
        <div className="stat__num">{totals.accepted}</div>
        <div className="stat__label">accepted</div>
      </div>
      <div>
        <div className="stat__num">{totals.rewritten}</div>
        <div className="stat__label">rewritten</div>
      </div>
      <div>
        <div className="stat__num">{totals.held}</div>
        <div className="stat__label">held</div>
      </div>
      <div>
        <div className="stat__num">{rating}</div>
        <div className="stat__label">marked useful</div>
      </div>
    </div>
  );
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const useSample = view === 'sample';

  const lookup = await lookupHistory(useSample);

  return (
    <div className="stack">
      <header className="spread">
        <h1 className="h1">History</h1>

        {/* The sample view is one click away and always labelled. It is a
            preview of the layout, never a stand-in for missing data. */}
        <Link
          className="chip"
          href={useSample ? '/history' : '/history?view=sample'}
        >
          {useSample ? 'Back to real history' : 'Preview with sample data'}
        </Link>
      </header>

      {lookup.kind === 'unavailable' ? (
        <div className="stack">
          <div className="state">
            <h2 className="state__title">No history to show.</h2>
            <p className="state__body">{lookup.reason}</p>
          </div>
          <EmptyState />
        </div>
      ) : (
        <div className="stack">
          {useSample && lookup.index.provenance !== 'live' ? (
            <ProvenanceBanner
              provenance={lookup.index.provenance}
              label="Sample record — demonstration only, not a real observation. The rows below are fixed examples, not a real history."
            />
          ) : null}

          <Totals totals={lookup.index.totals} />

          {lookup.index.reviews.length > 0 ? (
            <ReviewList reviews={lookup.index.reviews} />
          ) : (
            <EmptyState />
          )}

          <p className="meta" style={{ margin: 0 }}>
            Spend today: ${lookup.index.spend.daily_spent} of $
            {lookup.index.spend.daily_cap} · {lookup.index.spend.reviews_today}{' '}
            reviews since 00:00 UTC
          </p>
        </div>
      )}
    </div>
  );
}
