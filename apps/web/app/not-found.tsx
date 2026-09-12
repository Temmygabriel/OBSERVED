import Link from 'next/link';

/**
 * 404.
 *
 * Written as a plain statement of fact rather than an apology or a joke. The
 * product's whole voice is "here is exactly what is true", and a 404 page that
 * breaks into a mascot would be the one screen where the voice slips.
 */
export default function NotFound() {
  return (
    <div className="stack">
      <h1 className="h1">No review at that address.</h1>

      <p className="lede" style={{ maxWidth: '58ch' }}>
        This review id is not in the record. It may never have existed, or it may
        have been a sample id that has since been removed.
      </p>

      <p className="meta" style={{ margin: 0 }}>
        This is different from a review that exists but could not be loaded. If
        the worker were unreachable, this page would say so instead of showing
        you this.
      </p>

      <div className="row">
        <Link className="btn" href="/">
          Back to the start
        </Link>
        <Link className="btn" href="/review/sample">
          Open a labelled sample review
        </Link>
      </div>
    </div>
  );
}
