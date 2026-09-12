import Link from 'next/link';

/**
 * Screen 4 — Empty state.
 *
 * "an invitation, not an apology" (copy guidelines). Note what it does NOT do:
 * it does not show example numbers, and it does not pretend to have data. The
 * design spec forbids hardcoded example counts once real data exists, and the
 * safest reading of that is to never introduce them in the first place.
 */
export function EmptyState() {
  return (
    <section className="state">
      <h2 className="state__title">Nothing has been checked yet.</h2>

      <p className="state__body">
        Observed inspects the live product first, then writes only what its
        evidence supports.
      </p>

      <div className="row" style={{ marginBottom: 'var(--s5)' }}>
        <Link className="btn" href="/review/sample">
          Run a sample review
        </Link>
      </div>

      <p className="state__path">
        First check: website → TLS → links → evidence → review
      </p>
    </section>
  );
}
