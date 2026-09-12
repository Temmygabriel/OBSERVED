import type { EvidenceArtifact, ReviewSubmission } from '@observed/shared-types';
import { COLLECTOR_LABELS } from '@observed/shared-types';
import { IconDetected, IconObserved } from './icons';

/**
 * Screen 5 — Rejected / Held.
 *
 * Copy rule: "Review held", never "Review failed" and never "Error". The
 * system refusing to ship a claim it cannot support is a trust signal, so this
 * screen shows the refused draft verbatim and names the specific reason.
 *
 * "Rewritten" appears in evidence-blue elsewhere; this screen uses detected-
 * amber only for the refused sentence itself, because that sentence is the
 * thing being flagged — not the review as a whole.
 */
export function HeldScreen({
  review,
  evidence,
  canRewrite,
}: {
  review: ReviewSubmission;
  evidence: EvidenceArtifact[];
  canRewrite: boolean;
}) {
  // One row per collector that actually produced an artifact. Nothing is
  // listed as "available" unless an artifact backs it.
  const availableByCollector = new Map<string, EvidenceArtifact>();
  for (const artifact of evidence) {
    if (!availableByCollector.has(artifact.collector)) {
      availableByCollector.set(artifact.collector, artifact);
    }
  }

  return (
    <section className="state">
      <h2 className="state__title">Review held</h2>

      <p className="state__body">
        We found evidence, but the draft wasn&rsquo;t specific enough to ship.
      </p>

      <div className="stack stack--tight" style={{ marginBottom: 'var(--s5)' }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--s3)' }}>
          <span className="evrow__icon" style={{ marginTop: '2px' }}>
            <IconDetected />
          </span>
          <p className="h2" style={{ maxWidth: '48ch' }}>
            &ldquo;{review.draft_text}&rdquo;
          </p>
        </div>

        <p className="meta" style={{ margin: 0 }}>
          Why: no claim was tied to a specific observed artifact.
        </p>
      </div>

      <div className="stack stack--tight" style={{ marginBottom: 'var(--s5)' }}>
        <p className="section-label" style={{ margin: 0 }}>
          Evidence available
        </p>

        <div className="row">
          {[...availableByCollector.entries()].map(([collector, artifact]) => (
            <span key={collector} className="row" style={{ gap: 'var(--s2)' }}>
              <IconObserved />
              <span className="meta">{COLLECTOR_LABELS[artifact.collector]}</span>
            </span>
          ))}

          {availableByCollector.size === 0 ? (
            <span className="meta">
              No evidence artifacts were recorded for this session.
            </span>
          ) : null}
        </div>
      </div>

      <div className="row">
        <button type="button" className="btn" disabled={!canRewrite}>
          Rewrite from evidence
        </button>
        {!canRewrite ? (
          <span className="meta">
            Rewriting needs a connected worker. It re-runs the review generator
            against the same stored evidence — it does not collect anything new.
          </span>
        ) : null}
      </div>
    </section>
  );
}
